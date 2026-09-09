/**
 * casosEspeciaisRelacionadosTrigger.service v1.0.0 — Agente 5, orquestração fire-and-forget
 * VERSION: v1.0.0 | DATE: 2026-09-09
 */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IReclamacao } from '../../models/reclamacoes/reclamacaoModels';
import { env } from '../../config/env';
import { appendRegistroEntry } from '../chamado.mapper';
import { findReclamacoesByCpf, resolveReclamacaoModel } from '../reclamacoes/reclamacao.service';
import { fetchCpfHistoryChamadosRaw } from '../ticketSearch.service';
import { getAgentNomeOficial } from './agentRegistry';
import { isAgentsConfigured } from './openaiAgent.util';
import { classifyCasosEspeciaisRelacionados } from './casosEspeciaisRelacionadosAgent.service';
import {
  buildRelacionadosCandidatos,
  buildTicketBlockFromReclamacao,
} from './casosEspeciaisRelacionadosPrefilter.util';
import type {
  AnaliseRelacionadosPersisted,
  AnaliseRelacionadosTicketPersisted,
} from './casosEspeciaisRelacionados.types';

const AGENTE_VERSAO = 'casosEspeciaisRelacionadosAgent v1.0.0';
const HISTORICO_RECLAMACOES_LIMIT = 100;

export interface CasosEspeciaisRelacionadosContext {
  source: string;
}

export interface CasosEspeciaisRelacionadosResult {
  ran: boolean;
  status?: AnaliseRelacionadosPersisted['status'];
  error?: string;
}

async function persistAnalise(
  reclamacao: IReclamacao,
  analise: AnaliseRelacionadosPersisted,
): Promise<IReclamacao | null> {
  const Model = resolveReclamacaoModel(reclamacao.orgao);
  if (!Model) return null;
  // Filtra por _id (sempre presente e único), não chamadoId — desde a migração do schema
  // próprio do RA, chamadoId é opcional/sparse (linhas HugMe ainda sem ticket vinculado têm
  // chamadoId null, e um filtro por chamadoId bateria na primeira reclamação null que achasse).
  return Model.findOneAndUpdate(
    { _id: reclamacao._id },
    { $set: { analiseRelacionados: analise } },
    { new: true },
  ).exec();
}

function buildAnalise(
  status: AnaliseRelacionadosPersisted['status'],
  overrides: Partial<AnaliseRelacionadosPersisted> = {},
): AnaliseRelacionadosPersisted {
  return {
    status,
    tickets: [],
    resumoExecutivo: '',
    geradoEm: new Date(),
    agenteVersao: AGENTE_VERSAO,
    notaInternaCriada: false,
    ...overrides,
  };
}

async function createInternalNoteForResumo(
  chamadoId: string,
  resumoExecutivo: string,
  tickets: AnaliseRelacionadosTicketPersisted[],
): Promise<void> {
  const chamado = await ChamadoN1.findById(chamadoId);
  if (!chamado) return;

  const protocolos = tickets.map((t) => `#${t.chamadoProtocolo || t.chamadoId}`).join(', ');
  const nota = [
    `Tickets relacionados encontrados no histórico do cliente: ${protocolos}.`,
    resumoExecutivo,
  ].filter(Boolean).join('\n\n');

  appendRegistroEntry(chamado, {
    autor: getAgentNomeOficial(5),
    anotacaoInterna: nota,
    metadados: { agentCasosEspeciaisRelacionados: { tickets } },
  });
  await chamado.save();
}

/**
 * Correlaciona a reclamação com o histórico de tickets do CPF do cliente e persiste o resultado
 * em `reclamacao.analiseRelacionados`. Fail-soft: qualquer erro é logado e absorvido — nunca deve
 * interromper o fluxo de registro/atualização da reclamação que disparou a análise.
 */
export async function runCasosEspeciaisRelacionadosAnalise(
  reclamacao: IReclamacao,
  context: CasosEspeciaisRelacionadosContext,
): Promise<CasosEspeciaisRelacionadosResult> {
  if (!env.agentCasosEspeciaisRelacionadosEnabled || !isAgentsConfigured()) {
    await persistAnalise(reclamacao, buildAnalise('desativado'));
    return { ran: false, status: 'desativado' };
  }

  try {
    const cpf = String(reclamacao.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) {
      await persistAnalise(reclamacao, buildAnalise('sem_candidatos'));
      return { ran: true, status: 'sem_candidatos' };
    }

    // chamadoId é opcional desde o schema próprio do RA (linhas HugMe importadas ainda sem
    // ticket vinculado) — a correlação roda igual, só a nota interna (passo abaixo) não tem
    // onde ser gravada nesse caso.
    const chamadoIdAtual = reclamacao.chamadoId ? String(reclamacao.chamadoId) : null;
    const chamadoAtual = chamadoIdAtual ? await ChamadoN1.findById(chamadoIdAtual) : null;
    const ticketAtualBlock = buildTicketBlockFromReclamacao(reclamacao, chamadoAtual);

    const [historicoChamados, historicoReclamacoesBrutas] = await Promise.all([
      fetchCpfHistoryChamadosRaw(cpf, { excludeChamadoId: chamadoIdAtual ?? undefined }),
      findReclamacoesByCpf(cpf, HISTORICO_RECLAMACOES_LIMIT),
    ]);
    const historicoReclamacoes = historicoReclamacoesBrutas.filter(
      (r) => String(r._id) !== String(reclamacao._id),
    );

    const candidatos = buildRelacionadosCandidatos({
      ticketAtualBlock,
      historicoChamados,
      historicoReclamacoes,
    });

    if (!candidatos.length) {
      await persistAnalise(reclamacao, buildAnalise('sem_candidatos'));
      return { ran: true, status: 'sem_candidatos' };
    }

    const classified = await classifyCasosEspeciaisRelacionados({
      ticketAtual: ticketAtualBlock,
      candidatos,
      ticketId: chamadoIdAtual ?? String(reclamacao._id),
      protocolo: reclamacao.chamadoProtocolo,
    });

    if (!classified.success || !classified.result) {
      console.warn('[agent-casos-especiais-relacionados] classificação falhou:', classified.error);
      await persistAnalise(reclamacao, buildAnalise('erro'));
      return { ran: true, status: 'erro', error: classified.error };
    }

    const candidatoPorIdTicket = new Map(candidatos.map((c) => [c.block.id_ticket, c]));
    const ticketsPersisted = classified.result.tickets_relacionados
      .map((item): AnaliseRelacionadosTicketPersisted | null => {
        const candidato = candidatoPorIdTicket.get(item.id_ticket);
        if (!candidato) return null;
        return {
          chamadoId: candidato.chamadoId,
          chamadoProtocolo: candidato.chamadoProtocolo,
          scoreSimilaridade: item.score_similaridade,
          criterios: item.criterios,
          motivo: item.motivo,
        };
      })
      .filter((t): t is AnaliseRelacionadosTicketPersisted => Boolean(t));

    const resumoExecutivo = classified.result.resumo_executivo;
    // Reprocessamento (ex.: PATCH na reclamação) não deve duplicar a nota interna já criada
    // numa rodada anterior — só o primeiro achado de tickets relacionados gera nota.
    const notaJaCriada = Boolean(reclamacao.analiseRelacionados?.notaInternaCriada);

    const analise = buildAnalise('concluida', {
      tickets: ticketsPersisted,
      resumoExecutivo,
      notaInternaCriada: notaJaCriada || ticketsPersisted.length > 0,
    });
    await persistAnalise(reclamacao, analise);

    if (ticketsPersisted.length && !notaJaCriada && chamadoIdAtual) {
      await createInternalNoteForResumo(
        chamadoIdAtual,
        resumoExecutivo,
        ticketsPersisted,
      );
    }

    console.info('[agent-casos-especiais-relacionados]', {
      protocolo: reclamacao.chamadoProtocolo,
      source: context.source,
      candidatos: candidatos.length,
      relacionados: ticketsPersisted.length,
    });

    return { ran: true, status: 'concluida' };
  } catch (err) {
    console.warn('[agent-casos-especiais-relacionados] fail-soft:', (err as Error).message);
    await persistAnalise(reclamacao, buildAnalise('erro')).catch(() => null);
    return { ran: true, status: 'erro', error: (err as Error).message };
  }
}

/** Wrapper fire-and-forget para uso nas rotas — nunca deve segurar a resposta HTTP. */
export function scheduleCasosEspeciaisRelacionadosAnalise(
  reclamacao: IReclamacao,
  context: CasosEspeciaisRelacionadosContext,
): void {
  void runCasosEspeciaisRelacionadosAnalise(reclamacao, context).catch((err) => {
    console.warn('[agent-casos-especiais-relacionados] falha ao agendar análise:', (err as Error).message);
  });
}
