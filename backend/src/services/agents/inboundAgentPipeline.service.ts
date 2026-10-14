/**
 * inboundAgentPipeline.service v1.4.0 — e-mail sem contexto aguarda 1ª nota interna do agente
 * VERSION: v1.4.0 | DATE: 2026-08-21
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { runAgentPipeline } from './agentOrchestrator.service';
import { shouldSkipAgentPipeline } from './casosEspeciais.util';
import { runCasosEspeciaisTriagem } from './casosEspeciaisTrigger.service';
import { ChamadoN1 } from '../../models/ChamadoN1';
import { buildInboundPipelineInput } from './inboundPipelineInput.util';
import { isAutonomyEnabled } from './autonomyRules.service';

export async function runInboundAgentPipeline(
  chamado: IChamadoN1,
  context: { source: string },
): Promise<void> {
  if (!env.agentsEnabled) return;
  if (shouldSkipAgentPipeline(chamado)) {
    console.info('[inbound-agent-pipeline] skip — triagem casos especiais', {
      protocolo: chamado.chamadoProtocolo,
    });
    return;
  }

  try {
    const base = await buildInboundPipelineInput(chamado);
    if (!base) return;

    // Chamado bloqueado para a IA (2ª reprovação humana) nunca volta ao modo autônomo:
    // continua só com a sugestão normal para o atendente.
    const pipelineModo = !chamado.aiAutomation?.bloqueadoIA && await isAutonomyEnabled()
      ? 'inbound' as const
      : 'desk' as const;

    const result = await runAgentPipeline({ ...base, pipelineModo });

    console.info('[inbound-agent-pipeline]', {
      protocolo: chamado.chamadoProtocolo,
      source: context.source,
      success: result.success,
      auditScore: result.auditScore,
      envioAutonomo: result.envioAutonomo,
      decisao: result.auditDecisao,
    });
  } catch (err) {
    console.warn('[inbound-agent-pipeline] fail-soft:', (err as Error).message);
  }
}

/** Triagem Agente 4 (se habilitada) e pipeline Agente 1→2 na entrada do ticket. */
export async function runInboundPostCreateHooks(
  chamado: IChamadoN1,
  context: { source: string },
): Promise<void> {
  try {
    await runCasosEspeciaisTriagem(chamado, context);
  } catch (err) {
    console.warn('[inbound-post-create] casos-especiais fail-soft:', (err as Error).message);
  }

  const fresh = chamado._id
    ? await ChamadoN1.findById(chamado._id)
    : null;
  await runInboundAgentPipeline(fresh ?? chamado, context);
}
