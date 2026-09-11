/**
 * ticketEventsBroadcast.service v1.1.0 — tipo workflow para mutações de aprovação
 * VERSION: v1.1.0 | DATE: 2026-08-19
 */
import { env } from '../../config/env';

const CHANNEL_TOPIC = 'ticket-events';
const PUBLISH_TIMEOUT_MS = 4000;

export function isTicketEventsBroadcastConfigured(): boolean {
  return Boolean(env.ticketEventsRealtimeUrl && env.ticketEventsRealtimeApiKey);
}

export type TicketEventType =
  | 'whatsapp-inbound'
  | 'whatsapp-outbound'
  | 'message'
  | 'commit'
  | 'status'
  | 'workflow';

/**
 * Dispara um evento de mudança de ticket. Fire-and-forget: nunca lança nem bloqueia o fluxo do
 * chamador (o await interno é protegido). Chame com `void publishTicketEvent(...)`.
 */
export async function publishTicketEvent(ticketId: string, type: TicketEventType): Promise<void> {
  if (!isTicketEventsBroadcastConfigured()) return;
  const id = String(ticketId || '').trim();
  if (!id) return;

  const url = `${env.ticketEventsRealtimeUrl}/realtime/v1/api/broadcast`;
  const body = {
    messages: [
      {
        topic: CHANNEL_TOPIC,
        event: 'ticket',
        payload: { ticketId: id, type, at: new Date().toISOString() },
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.ticketEventsRealtimeApiKey,
        Authorization: `Bearer ${env.ticketEventsRealtimeApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // Realtime é só um acelerador; a falha não pode afetar o atendimento.
    console.warn('[ticket-events] broadcast falhou (seguindo no polling)', (err as Error)?.message);
  } finally {
    clearTimeout(timer);
  }
}
