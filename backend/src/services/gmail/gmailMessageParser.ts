/** gmailMessageParser v1.0.0 — Gmail API message → InboundEmailPayload */
import type { gmail_v1 } from 'googleapis';
import { normalizeEmail, parseEmailAddress } from '../cliente.service';
import { normalizeMessageId, stripHtml } from '../email-inbound.service';
import type { InboundEmailPayload } from '../inbound-email/types';
import { getDelegatedUserEmail } from '../emailTransport.service';

const SKIP_LABELS = new Set(['SENT', 'DRAFT', 'SPAM', 'TRASH']);

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  const found = headers?.find((h) => String(h.name ?? '').toLowerCase() === name.toLowerCase());
  return String(found?.value ?? '').trim();
}

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function extractBodyFromPart(part: gmail_v1.Schema$MessagePart | undefined): { text: string; html: string } {
  if (!part) return { text: '', html: '' };

  let text = '';
  let html = '';

  if (part.mimeType === 'text/plain' && part.body?.data) {
    text = decodeBase64Url(part.body.data);
  } else if (part.mimeType === 'text/html' && part.body?.data) {
    html = decodeBase64Url(part.body.data);
  }

  for (const child of part.parts ?? []) {
    const nested = extractBodyFromPart(child);
    if (!text && nested.text) text = nested.text;
    if (!html && nested.html) html = nested.html;
  }

  return { text, html };
}

function parseReferences(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/\s+/).map((item) => normalizeMessageId(item)).filter(Boolean);
}

function parseToList(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((part) => parseEmailAddress(part).email).filter(Boolean);
}

export function shouldSkipGmailMessage(
  message: gmail_v1.Schema$Message,
  delegatedEmail?: string
): boolean {
  const labels = message.labelIds ?? [];
  if (labels.some((label) => SKIP_LABELS.has(label))) return true;

  const headers = message.payload?.headers;
  const fromRaw = getHeader(headers, 'From');
  const from = parseEmailAddress(fromRaw);
  const mailbox = normalizeEmail(delegatedEmail ?? getDelegatedUserEmail());

  if (mailbox && from.email === mailbox) return true;

  return false;
}

export function gmailMessageToInboundPayload(message: gmail_v1.Schema$Message): InboundEmailPayload | null {
  if (!message.id) return null;

  const headers = message.payload?.headers;
  const fromRaw = getHeader(headers, 'From');
  const from = parseEmailAddress(fromRaw);
  if (!from.email) return null;

  const { text, html } = extractBodyFromPart(message.payload ?? undefined);
  const textBody = text.trim() || (html ? stripHtml(html) : '');

  const messageId = normalizeMessageId(getHeader(headers, 'Message-Id') || message.id);
  const inReplyTo = normalizeMessageId(getHeader(headers, 'In-Reply-To')) || undefined;

  return {
    messageId,
    inReplyTo,
    references: parseReferences(getHeader(headers, 'References')),
    from,
    to: parseToList(getHeader(headers, 'To')),
    subject: getHeader(headers, 'Subject'),
    textBody,
    htmlBody: html || undefined,
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)) : new Date(),
    autoSubmitted: getHeader(headers, 'Auto-Submitted') || undefined,
  };
}
