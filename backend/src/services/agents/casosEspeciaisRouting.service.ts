/**
 * casosEspeciaisRouting.service v1.4.0 — Agente 5 (extração) roda após o upsert, antes do Agente 6
 * VERSION: v1.4.0 | DATE: 2026-09-15
 */
import { Types } from 'mongoose';
import type { IChamadoN1, ITabulacao } from '../../models/ChamadoN1';
import {
  appendRegistroEntry,
  assertChamadoModifiable,
  currentStatus,
  readTabulacaoSnapshot,
} from '../chamado.mapper';
import { applyFuncaoEspecialAssignment } from '../assignmentRouter.service';
import { tryActivateWorkflowOnTabulation } from '../workflowTicket.service';
import { createCasoEspecialNotificacao } from '../workflowNotificacao.service';
import { listAgentesDeskLive } from '../agenteDesk.service';
import { extractFuncoes } from '../../utils/normalizeFuncao';
import type {
  CasoEspecialOrgao,
  CasoEspecialOrgaoConfig,
  CasoEspecialTriagemPersisted,
} from './casosEspeciais.types';
import { getAgentNomeOficial } from './agentRegistry';
import {
  readInboxDedicadaHint,
  upsertFromChamado,
} from '../reclamacoes/reclamacao.service';
import { extractCasosEspeciaisFields, type CasoEspecialExtracaoOrgao } from './casosEspeciaisExtracao.service';

function isExtracaoOrgao(orgao: CasoEspecialOrgao): orgao is CasoEspecialExtracaoOrgao {
  return orgao === 'procon' || orgao === 'bacen' || orgao === 'consumidor_gov';
}

export const CASO_ESPECIAL_ORGAO_CONFIG: Record<
  Exclude<CasoEspecialOrgao, 'indefinido'>,
  CasoEspecialOrgaoConfig
> = {
  reclame_aqui: {
    orgao: 'reclame_aqui',
    funcaoSlug: 'reclame-aqui',
    source: 'reclame-aqui',
    canalLabel: 'Reclame Aqui',
  },
  procon: {
    orgao: 'procon',
    funcaoSlug: 'procon',
    source: 'procon',
    canalLabel: 'Procon',
  },
  bacen: {
    orgao: 'bacen',
    funcaoSlug: 'bacen',
    source: 'bacen',
    canalLabel: 'Bacen',
  },
  consumidor_gov: {
    orgao: 'consumidor_gov',
    funcaoSlug: 'consumidor-gov',
    source: 'consumidor-gov',
    canalLabel: 'Consumidor.gov',
  },
};

function resolveOrgaoConfig(orgao: CasoEspecialOrgao): CasoEspecialOrgaoConfig | null {
  if (orgao === 'indefinido') return null;
  return CASO_ESPECIAL_ORGAO_CONFIG[orgao] ?? null;
}

function stampEspecialChannel(chamado: IChamadoN1, config: CasoEspecialOrgaoConfig): void {
  const registros = chamado.registro ?? [];
  const targetStatus = currentStatus(chamado) || 'novo';
  const metadados: Record<string, unknown> = {
    source: config.source,
    canalEspecial: config.canalLabel,
  };

  const clienteIdx = registros.findIndex(
    (reg) => String(reg.origin ?? '').toLowerCase() === 'cliente',
  );

  if (clienteIdx >= 0) {
    const reg = registros[clienteIdx];
    const existing = reg.metadados && typeof reg.metadados === 'object' ? reg.metadados : {};
    if (String(existing.source ?? '').toLowerCase() !== config.source) {
      reg.metadados = { ...existing, ...metadados };
    }
  } else {
    registros.unshift({
      data: new Date(),
      origin: 'cliente',
      autor: 'Canal especial',
      mensagemPublica: '',
      anexosMensagemPublica: [],
      anotacaoInterna: '',
      anexosAnotacaoInterna: [],
      alteracoes: [],
      metadados,
      status: targetStatus,
    });
    chamado.registro = registros;
  }
}

function updateTabulacaoCanal(chamado: IChamadoN1, config: CasoEspecialOrgaoConfig): void {
  // Atualiza a tabulação existente NO LUGAR (nunca acrescenta uma 2ª entrada): todo o resto do
  // sistema (segmentação por canal em permission.service.ts, exibição em chamado.mapper.ts,
  // merge, workflow) lê sempre tabulacao[0] como a tabulação corrente do chamado.
  const idx = chamado.tabulacao?.length ? chamado.tabulacao.length - 1 : 0;
  const last = readTabulacaoSnapshot(chamado.tabulacao?.[idx]);
  const next: ITabulacao = {
    ...last,
    tipoChamado: last.tipoChamado || 'Reclamação',
    motivo: config.orgao === 'reclame_aqui' ? (last.motivo || '') : (last.motivo || config.canalLabel),
    detalhe: last.detalhe || `Demanda ${config.canalLabel}`,
    canal: config.canalLabel,
  };
  if (!chamado.tabulacao?.length) {
    chamado.tabulacao = [next];
  } else {
    chamado.tabulacao[idx] = next;
  }
  chamado.markModified('tabulacao');
}

async function resolveTeamEmails(funcaoSlug: string): Promise<string[]> {
  const agentes = await listAgentesDeskLive();
  const emails = agentes
    .filter((agente) => {
      if (agente.afastado) return false;
      const funcoes = extractFuncoes(agente.atuacao);
      return agente.funcaoSlug === funcaoSlug || funcoes.includes(funcaoSlug);
    })
    .map((agente) => String(agente.email ?? '').trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(emails)];
}

/**
 * Notifica o time do órgão via sininho: quem tem a função de acesso ao canal já vê o item
 * no dash dedicado ao entrar nele — a notificação é só o aviso proativo de "chegou algo novo".
 */
async function notifyTeam(params: {
  chamado: IChamadoN1;
  config: CasoEspecialOrgaoConfig;
  responsavelEmail: string;
  titulo: string;
  mensagem: string;
  reclamacaoId?: Types.ObjectId;
}): Promise<string[]> {
  const sent: string[] = [];
  const recipients = new Set<string>();

  if (params.responsavelEmail) recipients.add(params.responsavelEmail.toLowerCase());

  const teamEmails = await resolveTeamEmails(params.config.funcaoSlug);
  for (const email of teamEmails) recipients.add(email);

  for (const email of recipients) {
    await createCasoEspecialNotificacao({
      destinatarioEmail: email,
      ticketId: params.chamado._id!.toString(),
      chamadoProtocolo: params.chamado.chamadoProtocolo,
      orgao: params.config.source,
      reclamacaoId: params.reclamacaoId?.toString(),
      titulo: params.titulo,
      mensagem: params.mensagem,
    });
    sent.push(`sininho:${email}`);
  }

  return sent;
}

export interface RouteCasoEspecialResult {
  success: boolean;
  responsavelAtribuido?: string;
  notificacoes?: string[];
  workflowActivated?: boolean;
  error?: string;
}

export interface RouteCasoEspecialContext {
  origemEntrada?: string;
}

export async function routeCasoEspecialFormal(
  chamado: IChamadoN1,
  triagem: CasoEspecialTriagemPersisted,
  routeCtx: RouteCasoEspecialContext = {},
): Promise<RouteCasoEspecialResult> {
  try {
    assertChamadoModifiable(chamado);

    const config = resolveOrgaoConfig(triagem.orgao);
    if (!config) {
      return { success: false, error: 'Órgão indefinido — roteamento não aplicado' };
    }

    stampEspecialChannel(chamado, config);
    updateTabulacaoCanal(chamado, config);

    const assigned = await applyFuncaoEspecialAssignment(chamado, config.funcaoSlug, {
      source: 'casos-especiais',
    });

    // Sem workflow dedicado ao órgão. Reclame Aqui não aciona workflow na tabulação.
    const workflowActivated = config.orgao === 'reclame_aqui'
      ? false
      : await tryActivateWorkflowOnTabulation(chamado, getAgentNomeOficial(4));

    const responsavel = String(
      chamado.tabulacao?.[chamado.tabulacao.length - 1]?.responsavel ?? '',
    ).trim();

    const agentes = await listAgentesDeskLive();
    const responsavelEmail = agentes.find(
      (a) => a.colaboradorNome === responsavel || a.email.split('@')[0] === responsavel,
    )?.email ?? agentes.find((a) => {
      const funcoes = extractFuncoes(a.atuacao);
      return a.funcaoSlug === config.funcaoSlug || funcoes.includes(config.funcaoSlug);
    })?.email ?? '';

    const titulo = `Caso ${config.canalLabel} — triagem automática`;
    const mensagem = `Ticket ${chamado.chamadoProtocolo} classificado como caso formal (${config.canalLabel}). ${triagem.justificativa}`;

    appendRegistroEntry(chamado, {
      autor: getAgentNomeOficial(4),
      anotacaoInterna: `Roteamento automático — ${config.canalLabel}: ${triagem.evidencia || triagem.justificativa}`,
      metadados: {
        skipAgentPipeline: true,
        agentCasosEspeciaisTriagem: {
          ...triagem,
          skipAgentPipeline: true,
          routed: true,
          at: triagem.at,
        },
      },
      alteracoes: [{
        canalEspecial: config.canalLabel,
        responsavel: responsavel || undefined,
        funcaoSlug: config.funcaoSlug,
      }],
    });

    await chamado.save();

    const reclamacaoDoc = await upsertFromChamado(chamado, { ...triagem, signals: triagem.signals ?? [] }, {
      origemEntrada: routeCtx.origemEntrada || 'casos-especiais',
      inboxDedicada: readInboxDedicadaHint(chamado),
    });

    if (config.orgao === 'reclame_aqui' && !reclamacaoDoc) {
      return {
        success: false,
        error: 'Falha ao persistir reclamação Reclame Aqui',
        workflowActivated,
      };
    }

    // Agente 5 (extração de campos) só existe pra Procon/Bacen/Consumidor.gov — o Reclame Aqui já
    // tem seu próprio caminho determinístico (planilha Hugme/cadastro manual), sem precisar de LLM.
    // Roda ANTES do Agente 6 (relacionados, disparado por quem chama routeCasoEspecialFormal
    // depois que essa função retorna) — o registro da reclamação já está com os campos possíveis
    // preenchidos antes de qualquer correlação rodar em cima dele.
    if (reclamacaoDoc?._id && isExtracaoOrgao(config.orgao)) {
      const extraction = await extractCasosEspeciaisFields({
        chamado,
        orgao: config.orgao,
        reclamacaoId: reclamacaoDoc._id as Types.ObjectId,
      });
      if (extraction.ran && !extraction.error) {
        console.info('[casos-especiais-routing] extração (Agente 5)', {
          protocolo: chamado.chamadoProtocolo,
          orgao: config.orgao,
          filledFields: extraction.filledFields,
        });
      }
    }

    const notificacoes = await notifyTeam({
      chamado,
      config,
      responsavelEmail,
      titulo,
      mensagem,
      reclamacaoId: reclamacaoDoc?._id as Types.ObjectId | undefined,
    });

    console.info('[casos-especiais-routing]', {
      protocolo: chamado.chamadoProtocolo,
      orgao: config.orgao,
      responsavel,
      assigned,
      workflowActivated,
    });

    return {
      success: true,
      responsavelAtribuido: responsavel,
      notificacoes,
      workflowActivated,
    };
  } catch (err) {
    console.error('[casos-especiais-routing]', err);
    return { success: false, error: (err as Error).message };
  }
}

export function persistCasosEspeciaisTriagemOnly(
  chamado: IChamadoN1,
  triagem: CasoEspecialTriagemPersisted,
  options: { skipAgentPipeline?: boolean } = {},
): void {
  appendRegistroEntry(chamado, {
    autor: getAgentNomeOficial(4),
    anotacaoInterna: `Triagem casos especiais (${triagem.classificacao}): ${triagem.justificativa}`,
    metadados: {
      skipAgentPipeline: options.skipAgentPipeline === true,
      agentCasosEspeciaisTriagem: triagem,
    },
    alteracoes: [{ classificacao: triagem.classificacao, orgao: triagem.orgao }],
  });
}
