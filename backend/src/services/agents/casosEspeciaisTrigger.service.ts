/**
 * casosEspeciaisTrigger.service v1.2.0 — reload antes do save evita sobrescrever scanStatus
 * VERSION: v1.2.0 | DATE: 2026-08-18
 */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { assertChamadoModifiable } from '../chamado.mapper';
import {
  buildFastPathTriagem,
  classifyCasosEspeciais,
} from './casosEspeciaisAgent.service';
import { detectCasoEspecialSignal } from './casosEspeciaisPrecheck';
import {
  persistCasosEspeciaisTriagemOnly,
  routeCasoEspecialFormal,
} from './casosEspeciaisRouting.service';
import type { CasoEspecialTriagemPersisted } from './casosEspeciais.types';
import { hasCasosEspeciaisTriagem } from './casosEspeciais.util';
import {
  findReclamacaoByChamadoIdAnyOrgao,
  syncFromChamado,
} from '../reclamacoes/reclamacao.service';

export interface CasosEspeciaisTriggerContext {
  source: string;
}

export interface CasosEspeciaisTriggerResult {
  ran: boolean;
  action?: 'none' | 'routed' | 'handoff_gestao' | 'falso_positivo' | 'skipped';
  error?: string;
}

function buildPersistedTriagem(
  triagem: Omit<CasoEspecialTriagemPersisted, 'at' | 'signals'>,
  signals: string[],
): CasoEspecialTriagemPersisted {
  return {
    ...triagem,
    signals,
    at: new Date().toISOString(),
  };
}

async function reloadChamadoForSave(chamado: IChamadoN1): Promise<IChamadoN1> {
  if (!chamado._id) return chamado;
  return (await ChamadoN1.findById(chamado._id)) ?? chamado;
}

async function saveChamadoWithFreshMutation(
  chamado: IChamadoN1,
  mutate: (doc: IChamadoN1) => void,
): Promise<IChamadoN1> {
  const fresh = await reloadChamadoForSave(chamado);
  mutate(fresh);
  await fresh.save();
  return fresh;
}

async function applyTriagemOutcome(
  chamado: IChamadoN1,
  triagem: CasoEspecialTriagemPersisted,
  signals: string[],
  context: CasosEspeciaisTriggerContext,
): Promise<CasosEspeciaisTriggerResult> {
  if (triagem.classificacao === 'caso_formal_real') {
    const fresh = await reloadChamadoForSave(chamado);
    const routed = await routeCasoEspecialFormal(
      fresh,
      { ...triagem, signals },
      { origemEntrada: context.source },
    );
    if (!routed.success) {
      return { ran: true, action: 'none', error: routed.error };
    }
    return { ran: true, action: 'routed' };
  }

  // ameaca_vazia não tem substância real (é isso que "vazia" quer dizer) — não escala pra
  // gestão como se fosse crítico. Só registra a classificação, igual falso_positivo; segue o
  // atendimento normal.
  await saveChamadoWithFreshMutation(chamado, (doc) => {
    persistCasosEspeciaisTriagemOnly(doc, triagem, { skipAgentPipeline: false });
  });
  return { ran: true, action: 'falso_positivo' };
}

export async function runCasosEspeciaisTriagem(
  chamadoInput: IChamadoN1,
  context: CasosEspeciaisTriggerContext,
): Promise<CasosEspeciaisTriggerResult> {
  // Registro manual (agente já escolheu o órgão explicitamente, ex.: "Registrar" no
  // formulário de Reclame Aqui/Procon) não depende da IA de casos especiais — o sinal
  // é determinístico (fast path). Só a detecção automática via canais inbound (e-mail,
  // WhatsApp etc.) fica atrás da flag `AGENT_CASOS_ESPECIAIS_ENABLED`.
  const isManualRegistration = context.source === 'reclamacoes-manual';
  if (!env.agentCasosEspeciaisEnabled && !isManualRegistration) {
    return { ran: false, action: 'skipped' };
  }

  try {
    const chamado = chamadoInput._id
      ? await ChamadoN1.findById(chamadoInput._id) ?? chamadoInput
      : chamadoInput;

    if (!chamado?._id) return { ran: false, action: 'skipped' };

    try {
      assertChamadoModifiable(chamado);
    } catch {
      return { ran: false, action: 'skipped' };
    }

    const existingReclamacao = await findReclamacaoByChamadoIdAnyOrgao(chamado._id);
    if (existingReclamacao) {
      await syncFromChamado(chamado);
      return { ran: true, action: 'skipped' };
    }

    const signal = detectCasoEspecialSignal(chamado);
    if (!signal.triggered) {
      return { ran: false, action: 'none' };
    }

    if (hasCasosEspeciaisTriagem(chamado) && !signal.institutionalSender) {
      return { ran: false, action: 'skipped' };
    }

    if (!env.agentCasosEspeciaisEnabled && !signal.fastPathReal) {
      // Flag de IA desligada globalmente: com a exceção do registro manual habilitada acima,
      // nunca deixa cair na classificação por LLM (`classifyCasosEspeciais`) — só o caminho
      // determinístico (fast path) é permitido enquanto a feature estiver desativada.
      return { ran: false, action: 'skipped' };
    }

    let triagemPersisted: CasoEspecialTriagemPersisted;

    if (signal.fastPathReal) {
      triagemPersisted = buildPersistedTriagem(
        buildFastPathTriagem(signal.origemProvavel, signal.signals),
        signal.signals,
      );
    } else {
      const classified = await classifyCasosEspeciais({
        chamado,
        signals: signal.signals,
        origemProvavel: signal.origemProvavel,
      });
      if (!classified.success || !classified.result) {
        console.warn('[casos-especiais-trigger] classificação falhou:', classified.error);
        return { ran: true, action: 'none', error: classified.error };
      }
      triagemPersisted = buildPersistedTriagem(classified.result, signal.signals);
    }

    const result = await applyTriagemOutcome(chamado, triagemPersisted, signal.signals, context);

    console.info('[casos-especiais-trigger]', {
      protocolo: chamado.chamadoProtocolo,
      source: context.source,
      action: result.action,
      classificacao: triagemPersisted.classificacao,
      orgao: triagemPersisted.orgao,
    });

    return result;
  } catch (err) {
    console.warn('[casos-especiais-trigger] fail-soft:', (err as Error).message);
    return { ran: true, action: 'none', error: (err as Error).message };
  }
}
