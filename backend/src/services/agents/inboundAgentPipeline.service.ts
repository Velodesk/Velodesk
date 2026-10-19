/**
 * inboundAgentPipeline.service v2.0.0 — pipeline dos agentes na entrada do ticket
 * VERSION: v2.0.0 | DATE: 2026-10-19
 *
 * Ticket que nasceu na fila do agente autônomo (aiAutomation.status = processando, decidido na criação pelo canal +
 * tabulação) roda o pipeline autônomo; qualquer outro roda a sugestão normal (modo desk) para o atendente.
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { runAgentPipeline } from './agentOrchestrator.service';
import { shouldSkipAgentPipeline } from './casosEspeciais.util';
import { runCasosEspeciaisTriagem } from './casosEspeciaisTrigger.service';
import { ChamadoN1 } from '../../models/ChamadoN1';
import { buildInboundPipelineInput } from './inboundPipelineInput.util';
import { releaseProcessing } from './aiAutomation.service';

function isAutonomo(chamado: IChamadoN1): boolean {
  return chamado.aiAutomation?.status === 'processando';
}

export async function runInboundAgentPipeline(
  chamado: IChamadoN1,
  context: { source: string },
): Promise<void> {
  const autonomo = isAutonomo(chamado);
  // O pipeline do ticket autônomo é disparado uma única vez, pela criação (evita execuções concorrentes).
  if (autonomo && context.source === 'nota-interna-inicial') return;

  const id = String(chamado._id);
  // Ticket autônomo que o agente não vai atender volta às filas humanas (nunca fica preso em "processando").
  const devolver = (motivo: string) => (autonomo
    ? releaseProcessing(id, motivo).catch((err: Error) => console.warn('[inbound-agent-pipeline] release fail-soft:', err.message))
    : Promise.resolve());

  if (!env.agentsEnabled) return devolver('agentes_desligados');
  if (shouldSkipAgentPipeline(chamado)) {
    console.info('[inbound-agent-pipeline] skip — triagem casos especiais', { protocolo: chamado.chamadoProtocolo });
    return devolver('triagem_casos_especiais');
  }

  try {
    const base = await buildInboundPipelineInput(chamado);
    if (!base) return devolver('sem_contexto');

    const result = await runAgentPipeline({ ...base, pipelineModo: autonomo ? 'autonomo' : 'desk' });

    console.info('[inbound-agent-pipeline]', {
      protocolo: chamado.chamadoProtocolo,
      source: context.source,
      modo: autonomo ? 'autonomo' : 'desk',
      success: result.success,
      auditScore: result.auditScore,
      aguardandoAprovacao: result.aguardandoAprovacao,
      decisao: result.auditDecisao,
    });
    if (autonomo) await devolver(result.autonomiaMotivo || result.error || 'nao_encaminhado');
  } catch (err) {
    console.warn('[inbound-agent-pipeline] fail-soft:', (err as Error).message);
    await devolver('erro_pipeline');
  }
}

/** Triagem Agente 4 (se habilitada) e pipeline Agente 1→2 na entrada do ticket. */
export async function runInboundPostCreateHooks(
  chamado: IChamadoN1,
  context: { source: string },
): Promise<void> {
  // Ticket do agente autônomo não passa pela triagem de casos especiais/palavras críticas: quem decide é o auditor humano.
  if (!isAutonomo(chamado)) {
    try {
      await runCasosEspeciaisTriagem(chamado, context);
    } catch (err) {
      console.warn('[inbound-post-create] casos-especiais fail-soft:', (err as Error).message);
    }
  }

  const fresh = chamado._id
    ? await ChamadoN1.findById(chamado._id)
    : null;
  await runInboundAgentPipeline(fresh ?? chamado, context);
}
