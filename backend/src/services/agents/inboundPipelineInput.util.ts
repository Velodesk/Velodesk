/**
 * inboundPipelineInput.util v1.0.0 — monta o input dos agentes a partir de um chamado
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Extraído de inboundAgentPipeline.service para ser reusado pela fila de aprovação humana
 * (reprovação ⇒ nova tentativa) sem dependência circular com o orquestrador.
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { currentStatus } from '../chamado.mapper';
import type { PipelineInput, TicketAiMessageInput } from './agentTypes';
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

/**
 * Retorna null quando não há contexto útil (sem mensagem do cliente nem nota interna).
 */
export async function buildInboundPipelineInput(
  chamado: IChamadoN1,
): Promise<Omit<PipelineInput, 'pipelineModo'> | null> {
  const messages = extractMessagesFromChamado(chamado);
  const hasClient = hasMeaningfulClientContextInChamado(chamado);
  // Com msg do cliente, ainda assim leva as anotações internas como contexto adicional
  // (o Agente 1 as usa independente do contextSource) — sem elas, cai no resumo automático
  // de ligação/1ª nota, único contexto disponível quando não há msg do cliente.
  const internalNote = hasClient
    ? buildTicketIaInternalNotesFromChamado(chamado)
    : findFirstInternalContextNote(chamado);
  if (!hasClient && !internalNote) return null;

  return {
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
    // Produto que veio da origem do ticket (o agente o mantém e classifica motivo/detalhe dentro dele).
    produtoFixo: String(chamado.tabulacao?.[chamado.tabulacao.length - 1]?.produto || '').trim() || undefined,
  };
}
