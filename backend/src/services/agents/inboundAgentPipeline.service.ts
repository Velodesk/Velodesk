/**
 * inboundAgentPipeline.service v1.4.0 — e-mail sem contexto aguarda 1ª nota interna do agente
 * VERSION: v1.4.0 | DATE: 2026-08-21
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { currentStatus } from '../chamado.mapper';
import { runAgentPipeline } from './agentOrchestrator.service';
import type { TicketAiMessageInput } from './agentTypes';
import { shouldSkipAgentPipeline } from './casosEspeciais.util';
import { runCasosEspeciaisTriagem } from './casosEspeciaisTrigger.service';
import { ChamadoN1 } from '../../models/ChamadoN1';
import {
  buildTicketIaInternalNotesFromChamado,
  buildTicketIaMessagesFromChamado,
  hasMeaningfulClientContextInChamado,
} from '../ticketIaAdapter.service';
import { resolveChamadoClientName } from '../placeholders.util';

function extractMessagesFromChamado(chamado: IChamadoN1): TicketAiMessageInput[] {
  return buildTicketIaMessagesFromChamado(chamado).map((item) => ({
    role: item.role,
    text: item.text,
  }));
}

function extractCanal(chamado: IChamadoN1): string {
  const meta = chamado.registro?.[0]?.metadados || {};
  if (meta.source === 'email-inbound') return 'E-mail';
  return 'digital';
}

/**
 * Primeira nota interna do agente com conteúdo, em qualquer posição do registro
 * (não só o evento inicial) — cobre tanto anotações internas explícitas quanto
 * o resumo automático de ligação (gravado como mensagemPublica de origem "agente").
 */
function findFirstInternalContextNote(chamado: IChamadoN1): string {
  for (const reg of chamado.registro || []) {
    const note = String(reg.anotacaoInterna || '').trim();
    if (note) return note;
  }
  const isTelephony = (chamado.registro || []).some(
    (reg) => String(reg.metadados?.source ?? '').trim().toLowerCase() === 'telephony-inbound',
  );
  if (!isTelephony) return '';

  for (const reg of chamado.registro || []) {
    if (reg.origin === 'cliente') continue;
    const pub = String(reg.mensagemPublica || '').trim();
    if (pub) return pub;
  }
  return '';
}

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
    const messages = extractMessagesFromChamado(chamado);
    const hasClient = hasMeaningfulClientContextInChamado(chamado);
    // Com msg do cliente, ainda assim leva as anotações internas como contexto adicional
    // (o Agente 1 as usa independente do contextSource) — sem elas, cai no resumo automático
    // de ligação/1ª nota, único contexto disponível quando não há msg do cliente.
    const internalNote = hasClient
      ? buildTicketIaInternalNotesFromChamado(chamado)
      : findFirstInternalContextNote(chamado);
    if (!hasClient && !internalNote) return;

    const pipelineModo = env.agentsAutonomyEnabled ? 'inbound' as const : 'desk' as const;

    const result = await runAgentPipeline({
      ticketId: chamado._id.toString(),
      protocolo: chamado.chamadoProtocolo,
      titulo: chamado.chamadoTitulo,
      canal: extractCanal(chamado),
      status: currentStatus(chamado),
      clientName: await resolveChamadoClientName(chamado),
      nomeOperador: 'Atendimento Velotax',
      contextSource: hasClient ? 'public' : 'internal',
      messages: hasClient ? messages : undefined,
      internalNote: internalNote || undefined,
      pipelineModo,
    });

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
