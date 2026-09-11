/** generic.adapter v1.0.0 */
import { parseEmailAddress, normalizeEmail } from '../../cliente.service';
import type { InboundEmailPayload } from '../types';

function normalizeMessageId(value: unknown): string {
  return String(value ?? '').trim().replace(/^<|>$/g, '');
}

function parseReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeMessageId(item)).filter(Boolean);
  }
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return raw.split(/\s+/).map((item) => normalizeMessageId(item)).filter(Boolean);
}

function parseRecipients(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeEmail(item)).filter(Boolean);
  }
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  return raw.split(',').map((part) => parseEmailAddress(part).email).filter(Boolean);
}

/**
 * Mailgun manda os headers originais em `message-headers` (JSON stringificado ou já
 * parseado) como array de pares [nome, valor]. Outros provedores podem mandar o campo
 * `Auto-Submitted`/`auto-submitted` direto no corpo do webhook.
 */
function extractAutoSubmittedHeader(body: Record<string, unknown>): string | undefined {
  const direct = body['Auto-Submitted'] ?? body['auto-submitted'] ?? body.autoSubmitted;
  if (direct) return String(direct).trim() || undefined;

  const raw = body['message-headers'];
  if (!raw) return undefined;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      const found = parsed.find((pair) => (
        Array.isArray(pair) && String(pair[0] ?? '').toLowerCase() === 'auto-submitted'
      ));
      if (found) return String(found[1] ?? '').trim() || undefined;
    }
  } catch {
    /* ignore malformed message-headers */
  }
  return undefined;
}

export function parseGenericInboundEmail(body: Record<string, unknown>): InboundEmailPayload {
  const fromRaw = body.from ?? body.sender ?? body.From ?? '';
  const fromParsed = typeof fromRaw === 'object' && fromRaw !== null
    ? {
        email: normalizeEmail((fromRaw as { email?: string }).email),
        name: String((fromRaw as { name?: string }).name ?? '').trim() || undefined,
      }
    : parseEmailAddress(fromRaw);

  const messageId = normalizeMessageId(
    body.messageId ?? body['Message-Id'] ?? body.message_id ?? `generic-${Date.now()}`
  );

  const textBody = String(
    body.textBody ?? body.text ?? body['body-plain'] ?? body['stripped-text'] ?? body.description ?? ''
  ).trim();

  const htmlBody = String(body.htmlBody ?? body.html ?? body['body-html'] ?? '').trim() || undefined;

  return {
    messageId,
    inReplyTo: normalizeMessageId(body.inReplyTo ?? body['In-Reply-To'] ?? '') || undefined,
    references: parseReferences(body.references ?? body.References),
    from: fromParsed,
    to: parseRecipients(body.to ?? body.recipient ?? body.To),
    subject: String(body.subject ?? body.Subject ?? '').trim(),
    textBody: textBody || (htmlBody ? htmlBody.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''),
    htmlBody,
    attachments: Array.isArray(body.attachments)
      ? body.attachments.map((item) => {
          const att = item as { filename?: string; contentType?: string; url?: string };
          return {
            filename: String(att.filename ?? 'anexo').trim(),
            contentType: String(att.contentType ?? 'application/octet-stream').trim(),
            url: att.url ? String(att.url).trim() : undefined,
          };
        })
      : undefined,
    receivedAt: body.receivedAt ? new Date(String(body.receivedAt)) : new Date(),
    autoSubmitted: extractAutoSubmittedHeader(body),
  };
}
