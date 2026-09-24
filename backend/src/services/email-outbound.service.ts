/** email-outbound.service v1.5.1 — espera Gmail no startup antes de descartar envio */
import { sendViaGmailApi, type GmailInlineImage, type GmailOutboundAttachment } from './gmail/gmailApiSend';
import {
  ensureEmailTransportReady,
  getEffectiveFromAddress,
  getEmailTransportSnapshot,
  isEmailTransportReady,
} from './emailTransport.service';
import type { OutboundEmailThreadHeaders } from './emailThread.service';
import { buildClientEmailSubject } from './emailThread.service';

export interface OutboundEmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: OutboundEmailThreadHeaders;
  inlineImages?: GmailInlineImage[];
  attachments?: GmailOutboundAttachment[];
}

export interface OutboundEmailResult {
  sent: boolean;
  reason?: string;
}

/**
 * Throttle serializado com aquecimento adaptativo: espaça os envios pra não
 * estourar o rate limit de anti-abuso do Gmail API. Começa conservador
 * (intervalo alto) e vai reduzindo o intervalo a cada envio bem-sucedido;
 * qualquer "User-rate limit exceeded" dobra o intervalo de novo. Isso deixa
 * o sistema reaprender o ritmo seguro sozinho em vez de depender de ajuste
 * manual a cada vez que a reputação de envio da caixa cai.
 */
const SEND_FLOOR_MS = Number(process.env.EMAIL_SEND_MIN_INTERVAL_MS || 5000);
const SEND_CEILING_MS = Number(process.env.EMAIL_SEND_MAX_INTERVAL_MS || 60000);
const SEND_WARMUP_START_MS = Number(process.env.EMAIL_SEND_WARMUP_START_MS || 30000);
const SEND_WARMUP_STEP_MS = 1000;

let currentIntervalMs = Math.max(SEND_FLOOR_MS, Math.min(SEND_CEILING_MS, SEND_WARMUP_START_MS));
let sendQueueTail: Promise<void> = Promise.resolve();
let lastSendAt = 0;

function isRateLimitError(err: unknown): boolean {
  return /rate limit exceeded/i.test(String((err as Error)?.message || ''));
}

function throttleSend<T>(fn: () => Promise<T>): Promise<T> {
  const scheduled = sendQueueTail.then(async () => {
    const wait = Math.max(0, lastSendAt + currentIntervalMs - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastSendAt = Date.now();
  });
  sendQueueTail = scheduled.catch(() => {});

  return scheduled.then(async () => {
    try {
      const result = await fn();
      currentIntervalMs = Math.max(SEND_FLOOR_MS, currentIntervalMs - SEND_WARMUP_STEP_MS);
      return result;
    } catch (err) {
      if (isRateLimitError(err)) {
        currentIntervalMs = Math.min(SEND_CEILING_MS, currentIntervalMs * 2);
      }
      throw err;
    }
  });
}

export function buildProtocolSubject(protocolo: string, _titulo?: string): string {
  return buildClientEmailSubject(protocolo, false);
}

function wrapTextAsHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333">${escaped}</div>`;
}

export async function sendOutboundEmail(payload: OutboundEmailPayload): Promise<OutboundEmailResult> {
  if (!isEmailTransportReady()) {
    const ready = await ensureEmailTransportReady();
    if (!ready) {
      return { sent: false, reason: 'Gmail API não configurado (desk_config.email_transport)' };
    }
  }

  const snap = getEmailTransportSnapshot();
  if (!snap) {
    return { sent: false, reason: 'Snapshot de transporte ausente' };
  }

  const to = String(payload.to ?? '').trim();
  if (!to.includes('@')) {
    return { sent: false, reason: 'Destinatário inválido' };
  }

  try {
    await throttleSend(() =>
      sendViaGmailApi(
        {
          serviceAccountJson: snap.serviceAccountJson,
          delegatedUserEmail: snap.delegatedUserEmail,
        },
        {
          from: getEffectiveFromAddress(),
          to,
          subject: payload.subject,
          html: payload.html ?? wrapTextAsHtml(payload.text),
          messageId: payload.headers?.messageId,
          inReplyTo: payload.headers?.inReplyTo,
          references: payload.headers?.references,
          inlineImages: payload.inlineImages,
          attachments: payload.attachments,
        }
      )
    );
    return { sent: true };
  } catch (err) {
    const reason = (err as Error).message;
    console.error('[email-outbound]', reason);
    return { sent: false, reason };
  }
}
