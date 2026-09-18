/** whatsappOutboundMedia.util v1.0.0 — URL pública temporária para mídia outbound Twilio */
import crypto from 'crypto';
import { env } from '../../config/env';
import { parseSentAttachmentStorageKeyFromApiUrl } from '../sentAttachmentStorage.service';

export const TOKEN_TTL_MS = 15 * 60 * 1000;

function signingSecret(): string {
  return env.attachmentScanCallbackSecret || env.jwtSecret;
}

export function buildWhatsAppOutboundMediaToken(
  storageKey: string,
  expiresAtMs = Date.now() + TOKEN_TTL_MS,
): string {
  const payload = `${storageKey}:${expiresAtMs}`;
  const sig = crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

export function verifyWhatsAppOutboundMediaToken(token: string): { storageKey: string } | null {
  try {
    const decoded = Buffer.from(String(token || ''), 'base64url').toString('utf8');
    const lastColon = decoded.lastIndexOf(':');
    if (lastColon <= 0) return null;
    const sig = decoded.slice(lastColon + 1);
    const rest = decoded.slice(0, lastColon);
    const sep = rest.lastIndexOf(':');
    if (sep <= 0) return null;
    const storageKey = rest.slice(0, sep);
    const expiresAtMs = Number(rest.slice(sep + 1));
    if (!storageKey || !Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return null;

    const payload = `${storageKey}:${expiresAtMs}`;
    const expected = crypto.createHmac('sha256', signingSecret()).update(payload).digest('hex');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
    return { storageKey };
  } catch {
    return null;
  }
}

export function buildWhatsAppOutboundMediaPublicUrl(storageKey: string): string {
  const token = buildWhatsAppOutboundMediaToken(storageKey);
  const base = env.twilioWebhookPublicBaseUrl.replace(/\/+$/, '');
  return `${base}/api/inbound/whatsapp/outbound-media/${encodeURIComponent(token)}`;
}

export function buildWhatsAppOutboundMediaPublicUrlFromApiUrl(apiUrl: string): string | null {
  const storageKey = parseSentAttachmentStorageKeyFromApiUrl(apiUrl);
  if (!storageKey) return null;
  return buildWhatsAppOutboundMediaPublicUrl(storageKey);
}
