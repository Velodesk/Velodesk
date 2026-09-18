/** velodeskWebhook.service v1.0.0 — webhook outbound Velodesk → App Velotax
 * Dispara em qualquer origem/canal quando um chamado ganha mensagem pública de
 * agente/sistema ou muda de status. Fire-and-forget: nunca bloqueia nem propaga erro
 * pro fluxo que gerou a mudança (mesmo espírito de publishTicketEvent/notifyAgentReplyAsync).
 */
import { env } from '../config/env';
import type { IChamadoN1, IRegistro } from '../models/ChamadoN1';
import { currentStatus, readChamadoOriginSource, resolveCanalLabelFromSource } from './chamado.mapper';

export type VelodeskWebhookEvent = 'message.created' | 'ticket.resolved' | 'ticket.updated';

interface VelodeskWebhookPayload {
  event: VelodeskWebhookEvent;
  chamadoProtocolo: string;
  ticketId: string;
  clientCPF: string | null;
  status: string;
  canal: string;
  titulo: string;
  ultimaMensagem?: {
    texto: string;
    remetente: 'cliente' | 'agente' | 'sistema';
    data: Date;
    attachments: { url: string }[];
  };
}

function maskCpfForLog(cpf: string | null): string {
  const digits = String(cpf ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

function remetenteFromOrigin(origin: unknown): 'cliente' | 'agente' | 'sistema' {
  const value = String(origin ?? '').trim().toLowerCase();
  if (value === 'cliente') return 'cliente';
  if (value === 'agente') return 'agente';
  return 'sistema';
}

function resolveCanal(chamado: IChamadoN1): string {
  const tabs = chamado.tabulacao ?? [];
  return String(tabs[tabs.length - 1]?.canal ?? '').trim()
    || resolveCanalLabelFromSource(readChamadoOriginSource(chamado));
}

function buildPayload(chamado: IChamadoN1, event: VelodeskWebhookEvent, entry: IRegistro): VelodeskWebhookPayload {
  const payload: VelodeskWebhookPayload = {
    event,
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
    ticketId: chamado._id.toString(),
    clientCPF: chamado.cliente?.[0]?.clienteCpf || null,
    status: currentStatus(chamado),
    canal: resolveCanal(chamado),
    titulo: String(chamado.chamadoTitulo ?? ''),
  };

  if (event === 'message.created' && entry.mensagemPublica) {
    payload.ultimaMensagem = {
      texto: entry.mensagemPublica,
      remetente: remetenteFromOrigin(entry.origin),
      data: entry.data ? new Date(entry.data) : new Date(),
      attachments: (entry.anexosMensagemPublica ?? []).map((url) => ({ url })),
    };
  }

  return payload;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function isVelodeskWebhookConfigured(): boolean {
  return Boolean(env.velodeskWebhookUrl && env.velodeskWebhookSecret);
}

async function postWebhook(payload: VelodeskWebhookPayload, attempt = 0): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.velodeskWebhookTimeoutMs);

  try {
    const response = await fetch(env.velodeskWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Velodesk-Webhook-Secret': env.velodeskWebhookSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok && response.status >= 500 && attempt < 1) {
      await sleep(2000);
      return postWebhook(payload, attempt + 1);
    }

    console.info(
      '[velodesk-webhook] event=%s protocolo=%s cpf=%s http=%s',
      payload.event, payload.chamadoProtocolo, maskCpfForLog(payload.clientCPF), response.status,
    );
  } catch (err) {
    if (attempt < 1) {
      await sleep(2000);
      return postWebhook(payload, attempt + 1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[velodesk-webhook] falha ao notificar protocolo=%s: %s', payload.chamadoProtocolo, message);
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget — nunca lança erro pro chamador. */
export function dispatchVelodeskWebhook(chamado: IChamadoN1, event: VelodeskWebhookEvent, entry: IRegistro): void {
  if (!isVelodeskWebhookConfigured()) return;
  const payload = buildPayload(chamado, event, entry);
  void postWebhook(payload).catch((err) => {
    console.warn('[velodesk-webhook] erro inesperado no dispatch:', err);
  });
}
