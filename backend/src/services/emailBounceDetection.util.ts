/**
 * emailBounceDetection.util v1.0.0 — detecção pura de bounce/DSN (sem persistência, sem Mongoose)
 * Extraído de emailBounceLog.service.ts quando o registro de bounces deixou de ser um log
 * genérico separado e passou a virar `emailDeliveryFailures` dentro do próprio chamado.
 */
import type { InboundEmailPayload } from './inbound-email/types';

const BOUNCE_SENDER_PATTERNS = [
  /^mailer-daemon@/i,
  /^mail-delivery-subsystem@/i,
  /^mailerdaemon@/i,
  /^postmaster@/i,
  /^bounce(s)?@/i,
  /^no-reply@.*mail-delivery/i,
];

/**
 * Assunto de bounce sozinho não basta pra descartar — um cliente poderia citar esse texto
 * numa resposta legítima. Só conta combinado com um domínio de infra de e-mail conhecido
 * (ver KNOWN_MAIL_INFRA_DOMAINS), nunca isolado.
 */
const BOUNCE_SUBJECT_PATTERNS = [
  /delivery status notification/i,
  /mail delivery subsystem/i,
  /entrega incompleta/i,
  /undelivered mail returned to sender/i,
  /undeliverable/i,
  /returned mail/i,
];

const KNOWN_MAIL_INFRA_DOMAINS = [
  /(^|\.)google\.com$/i,
  /(^|\.)googlemail\.com$/i,
  /(^|\.)gmail\.com$/i,
  /(^|\.)outlook\.com$/i,
  /(^|\.)office365\.com$/i,
  /(^|\.)microsoft\.com$/i,
  /(^|\.)protonmail\.com$/i,
  /(^|\.)yahoo\.com$/i,
  /(^|\.)hotmail\.com$/i,
];

function emailDomain(email: string): string {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized.includes('@') ? normalized.split('@')[1] : '';
}

export function isBounceSender(email: string): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  return BOUNCE_SENDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isAutoSubmittedBounce(autoSubmitted?: string): boolean {
  const normalized = String(autoSubmitted || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.startsWith('auto-replied') || normalized.startsWith('auto-generated');
}

function isKnownMailInfraDomain(domain: string): boolean {
  if (!domain) return false;
  return KNOWN_MAIL_INFRA_DOMAINS.some((pattern) => pattern.test(domain));
}

function isBounceSubject(subject: string): boolean {
  const normalized = String(subject || '').trim();
  if (!normalized) return false;
  return BOUNCE_SUBJECT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isEmailBounce(payload: InboundEmailPayload): boolean {
  if (isBounceSender(payload.from.email)) return true;
  if (isAutoSubmittedBounce(payload.autoSubmitted)) return true;
  if (isBounceSubject(payload.subject) && isKnownMailInfraDomain(emailDomain(payload.from.email))) {
    return true;
  }
  return false;
}
