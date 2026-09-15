/**
 * casosEspeciaisRelacionadosPrefilter.util v1.1.0 — Agente 6 (renumerado), pré-filtro mecânico
 * VERSION: v1.1.0 | DATE: 2026-09-15
 *
 * Corta o histórico do CPF para um teto de candidatos antes de chamar o LLM: descarta tickets
 * sem conteúdo real (mensagem/anotação vazia) e pontua por sinais baratos (produto/categoria/
 * motivo em comum, números de contrato/valor compartilhados, overlap textual, recência). O LLM
 * decide a relação final — este filtro só existe para manter o payload enxuto e barato.
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import type { IReclamacao } from '../../models/reclamacoes/reclamacaoModels';
import { currentStatus } from '../chamado.mapper';
import {
  adaptChamadoToTicketIa,
  buildTicketIaMessagesFromChamado,
  buildTicketIaText,
  hasMeaningfulClientContextInChamado,
} from '../ticketIaAdapter.service';
import type { CasoRelacionadoCandidato, CasoRelacionadoTicketBlock } from './casosEspeciaisRelacionados.types';

export const MAX_CANDIDATOS_RELACIONADOS = 20;
const TEXTO_MAX_CHARS = 500;

function truncate(text: string, max = TEXTO_MAX_CHARS): string {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function textoFromChamado(chamado: IChamadoN1): string {
  const payload = adaptChamadoToTicketIa(chamado);
  if (payload) return buildTicketIaText(payload, TEXTO_MAX_CHARS);
  return truncate(String(chamado.chamadoTitulo ?? ''));
}

function lastAgentPublicMessage(chamado: IChamadoN1): string | null {
  const messages = buildTicketIaMessagesFromChamado(chamado).filter((m) => m.role === 'agente');
  const last = messages[messages.length - 1];
  return last ? truncate(last.text) : null;
}

function orNull(value: unknown): string | null {
  const s = String(value ?? '').trim();
  return s || null;
}

export function buildTicketBlockFromReclamacao(
  doc: IReclamacao,
  chamado?: IChamadoN1 | null,
): CasoRelacionadoTicketBlock {
  const tab = chamado?.tabulacao?.[chamado.tabulacao.length - 1];
  const textoDireto = String(doc.descricao ?? '').trim();
  const texto = truncate(textoDireto) || (chamado ? textoFromChamado(chamado) : '');

  return {
    id_ticket: String(doc.chamadoProtocolo || chamado?.chamadoProtocolo || doc.chamadoId || doc._id),
    origem: doc.orgao,
    data_reclamacao: new Date(doc.createdAt ?? Date.now()).toISOString(),
    categoria_ra: orNull(doc.tipo || tab?.tipoChamado),
    problema_ra: orNull(doc.motivo || tab?.motivo),
    produto_ra: orNull(doc.produto || tab?.produto),
    titulo: String(doc.assunto || chamado?.chamadoTitulo || '').trim() || '(sem título)',
    texto_reclamacao: texto || '(sem conteúdo)',
    resposta_empresa: chamado ? lastAgentPublicMessage(chamado) : null,
    status: doc.aberta === false ? 'resolvido' : String(doc.statusCanal || 'em-andamento'),
  };
}

export function buildTicketBlockFromChamado(chamado: IChamadoN1): CasoRelacionadoTicketBlock {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  return {
    id_ticket: String(chamado.chamadoProtocolo || chamado._id),
    origem: 'velodesk',
    data_reclamacao: new Date(chamado.createdAt ?? Date.now()).toISOString(),
    categoria_ra: orNull(tab?.tipoChamado),
    problema_ra: orNull(tab?.motivo),
    produto_ra: orNull(tab?.produto),
    titulo: String(chamado.chamadoTitulo ?? '').trim() || '(sem título)',
    texto_reclamacao: textoFromChamado(chamado) || '(sem conteúdo)',
    resposta_empresa: lastAgentPublicMessage(chamado),
    status: currentStatus(chamado),
  };
}

const NUMERIC_SIGNAL_PATTERN = /\b\d{6,}\b/g;
const MONEY_PATTERN = /r\$\s?\d[\d.,]*/gi;

function extractNumericSignals(text: string): Set<string> {
  const source = String(text ?? '');
  const nums = source.match(NUMERIC_SIGNAL_PATTERN) ?? [];
  const money = (source.match(MONEY_PATTERN) ?? []).map((m) => m.replace(/\s+/g, '').toLowerCase());
  return new Set([...nums, ...money]);
}

const COMBINING_DIACRITICS_PATTERN = /[̀-ͯ]/g;

function extractTokens(text: string): Set<string> {
  const normalized = String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_PATTERN, '');
  return new Set(normalized.match(/[a-z0-9]{4,}/g) ?? []);
}

function sameFieldSignal(a: string | null, b: string | null): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function scoreCandidato(
  atual: CasoRelacionadoTicketBlock,
  candidato: CasoRelacionadoTicketBlock,
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let score = 0;

  if (sameFieldSignal(atual.produto_ra, candidato.produto_ra)) {
    score += 20;
    signals.push('mesmo_produto');
  }
  if (sameFieldSignal(atual.categoria_ra, candidato.categoria_ra)) {
    score += 15;
    signals.push('mesma_categoria');
  }
  if (sameFieldSignal(atual.problema_ra, candidato.problema_ra)) {
    score += 20;
    signals.push('mesmo_problema');
  }

  const atualTexto = `${atual.titulo} ${atual.texto_reclamacao}`;
  const candTexto = `${candidato.titulo} ${candidato.texto_reclamacao}`;

  const atualNums = extractNumericSignals(atualTexto);
  const candNums = extractNumericSignals(candTexto);
  const sharedNums = [...atualNums].filter((n) => candNums.has(n));
  if (sharedNums.length) {
    score += 40;
    signals.push(`numero_em_comum:${sharedNums[0]}`);
  }

  const atualTokens = extractTokens(atualTexto);
  const candTokens = extractTokens(candTexto);
  if (atualTokens.size && candTokens.size) {
    const sharedTokens = [...atualTokens].filter((t) => candTokens.has(t));
    const overlapRatio = sharedTokens.length / Math.min(atualTokens.size, candTokens.size);
    if (overlapRatio > 0.15) {
      score += Math.round(overlapRatio * 20);
      signals.push('overlap_textual');
    }
  }

  const diasEntre = Math.abs(
    new Date(atual.data_reclamacao).getTime() - new Date(candidato.data_reclamacao).getTime(),
  ) / (24 * 60 * 60 * 1000);
  if (diasEntre <= 90) {
    score += 5;
    signals.push('recente');
  }

  return { score, signals };
}

function hasRealContent(chamado: IChamadoN1 | undefined, reclamacao: IReclamacao | undefined): boolean {
  if (chamado) return hasMeaningfulClientContextInChamado(chamado);
  if (reclamacao) return Boolean(String(reclamacao.descricao ?? '').trim() || String(reclamacao.assunto ?? '').trim());
  return false;
}

export interface BuildCandidatosParams {
  ticketAtualBlock: CasoRelacionadoTicketBlock;
  historicoChamados: IChamadoN1[];
  historicoReclamacoes: IReclamacao[];
}

/** Monta e pontua os candidatos do histórico do CPF, já cortados para o teto que vai ao LLM. */
export function buildRelacionadosCandidatos(params: BuildCandidatosParams): CasoRelacionadoCandidato[] {
  const chamadoById = new Map<string, IChamadoN1>();
  for (const chamado of params.historicoChamados) {
    if (chamado._id) chamadoById.set(String(chamado._id), chamado);
  }

  const reclamacaoByChamadoId = new Map<string, IReclamacao>();
  for (const rec of params.historicoReclamacoes) {
    const key = String(rec.chamadoId || '');
    if (key) reclamacaoByChamadoId.set(key, rec);
  }

  const ids = new Set<string>([...chamadoById.keys(), ...reclamacaoByChamadoId.keys()]);

  const candidatos: CasoRelacionadoCandidato[] = [];
  for (const id of ids) {
    const chamado = chamadoById.get(id);
    const reclamacao = reclamacaoByChamadoId.get(id);
    if (!hasRealContent(chamado, reclamacao)) continue;

    const block = reclamacao
      ? buildTicketBlockFromReclamacao(reclamacao, chamado)
      : buildTicketBlockFromChamado(chamado!);

    const { score, signals } = scoreCandidato(params.ticketAtualBlock, block);
    candidatos.push({
      block,
      chamadoId: id,
      chamadoProtocolo: chamado?.chamadoProtocolo || reclamacao?.chamadoProtocolo || '',
      mechScore: score,
      mechSignals: signals,
    });
  }

  candidatos.sort((a, b) => b.mechScore - a.mechScore);
  return candidatos.slice(0, MAX_CANDIDATOS_RELACIONADOS);
}
