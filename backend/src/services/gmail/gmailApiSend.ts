/** gmailApiSend v1.3.0 — MIME multipart com anexos + imagens inline (logo CID) */
import { google } from 'googleapis';
import type { IServiceAccountJson } from '../../models/EmailTransportConfig';

export interface GmailOutboundAttachment {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface GmailInlineImage {
  cid: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface GmailSendParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  inlineImages?: GmailInlineImage[];
  attachments?: GmailOutboundAttachment[];
}

export interface GmailAuthParams {
  serviceAccountJson: IServiceAccountJson;
  delegatedUserEmail: string;
}

function mimeEncodeSubject(subject: string): string {
  const s = String(subject || '');
  const asciiSafe = /^[\x01-\x7F]+$/.test(s);
  if (asciiSafe) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function wrapBase64Lines(base64: string): string {
  return base64.match(/.{1,76}/g)?.join('\r\n') ?? base64;
}

function mimeEncodeFilename(filename: string): string {
  const safe = String(filename || 'anexo').replace(/[\r\n"]/g, '_');
  if (/^[\x20-\x7E]+$/.test(safe)) {
    return `filename="${safe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function appendHtmlPart(body: string[], boundary: string, htmlBody: string): void {
  body.push(`--${boundary}\r\n`);
  body.push('Content-Type: text/html; charset=UTF-8\r\n');
  body.push('Content-Transfer-Encoding: base64\r\n\r\n');
  body.push(`${wrapBase64Lines(Buffer.from(htmlBody, 'utf8').toString('base64'))}\r\n`);
}

function appendInlineImagePart(body: string[], boundary: string, image: GmailInlineImage): void {
  body.push(`--${boundary}\r\n`);
  body.push(`Content-Type: ${String(image.contentType || 'image/png').trim()}; ${mimeEncodeFilename(image.filename)}\r\n`);
  body.push(`Content-Transfer-Encoding: base64\r\n`);
  body.push(`Content-Disposition: inline; ${mimeEncodeFilename(image.filename)}\r\n`);
  body.push(`Content-ID: <${String(image.cid || 'inline-image').trim()}>\r\n\r\n`);
  body.push(`${wrapBase64Lines(image.buffer.toString('base64'))}\r\n`);
}

function appendFileAttachmentPart(body: string[], boundary: string, attachment: GmailOutboundAttachment): void {
  body.push(`--${boundary}\r\n`);
  body.push(`Content-Type: ${String(attachment.contentType || 'application/octet-stream').trim()}; ${mimeEncodeFilename(attachment.filename)}\r\n`);
  body.push(`Content-Disposition: attachment; ${mimeEncodeFilename(attachment.filename)}\r\n`);
  body.push('Content-Transfer-Encoding: base64\r\n\r\n');
  body.push(`${wrapBase64Lines(attachment.buffer.toString('base64'))}\r\n`);
}

function buildRelatedSection(htmlBody: string, inlineImages: GmailInlineImage[]): { contentType: string; body: string } {
  const boundary = `velodesk_rel_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const parts: string[] = [];
  appendHtmlPart(parts, boundary, htmlBody);
  for (const image of inlineImages) {
    appendInlineImagePart(parts, boundary, image);
  }
  parts.push(`--${boundary}--\r\n`);
  return {
    contentType: `multipart/related; boundary="${boundary}"`,
    body: parts.join(''),
  };
}

function buildMimeBody({
  html,
  inlineImages = [],
  attachments = [],
}: Pick<GmailSendParams, 'html' | 'inlineImages' | 'attachments'>): { contentType: string; body: string } {
  const htmlBody = String(html || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const safeInlines = (inlineImages || []).filter((item) => item.buffer?.length);
  const safeAttachments = (attachments || []).filter((item) => item.buffer?.length);

  if (!safeInlines.length && !safeAttachments.length) {
    return {
      contentType: 'text/html; charset=UTF-8',
      body: htmlBody,
    };
  }

  if (safeInlines.length && !safeAttachments.length) {
    return buildRelatedSection(htmlBody, safeInlines);
  }

  if (!safeInlines.length && safeAttachments.length) {
    const boundary = `velodesk_mix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const parts: string[] = [];
    appendHtmlPart(parts, boundary, htmlBody);
    for (const attachment of safeAttachments) {
      appendFileAttachmentPart(parts, boundary, attachment);
    }
    parts.push(`--${boundary}--\r\n`);
    return {
      contentType: `multipart/mixed; boundary="${boundary}"`,
      body: parts.join(''),
    };
  }

  const mixedBoundary = `velodesk_mix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const related = buildRelatedSection(htmlBody, safeInlines);
  const parts: string[] = [];

  parts.push(`--${mixedBoundary}\r\n`);
  parts.push(`Content-Type: ${related.contentType}\r\n\r\n`);
  parts.push(`${related.body}\r\n`);

  for (const attachment of safeAttachments) {
    appendFileAttachmentPart(parts, mixedBoundary, attachment);
  }
  parts.push(`--${mixedBoundary}--\r\n`);

  return {
    contentType: `multipart/mixed; boundary="${mixedBoundary}"`,
    body: parts.join(''),
  };
}

export function buildRawRfc822({
  from,
  to,
  subject,
  html,
  messageId,
  inReplyTo,
  references,
  inlineImages,
  attachments,
}: GmailSendParams): string {
  const subjectHeader = mimeEncodeSubject(subject);
  const mime = buildMimeBody({ html, inlineImages, attachments });
  let msg =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subjectHeader}\r\n`;

  if (messageId) {
    msg += `Message-ID: ${messageId}\r\n`;
  }
  if (inReplyTo) {
    msg += `In-Reply-To: ${inReplyTo}\r\n`;
  }
  if (references?.length) {
    msg += `References: ${references.join(' ')}\r\n`;
  }

  msg +=
    'MIME-Version: 1.0\r\n' +
    `Content-Type: ${mime.contentType}\r\n` +
    '\r\n' +
    mime.body;

  const b64 = Buffer.from(msg, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendViaGmailApi(
  authParams: GmailAuthParams,
  mail: GmailSendParams
): Promise<{ success: true }> {
  const { serviceAccountJson, delegatedUserEmail } = authParams;
  if (!serviceAccountJson?.client_email || !serviceAccountJson?.private_key) {
    throw new Error('serviceAccountJson inválido (client_email / private_key ausentes)');
  }

  const auth = new google.auth.JWT({
    email: serviceAccountJson.client_email,
    key: serviceAccountJson.private_key,
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    subject: delegatedUserEmail,
  });
  await auth.authorize();

  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRawRfc822({
    from: String(mail.from || '').trim(),
    to: String(mail.to || '').trim(),
    subject: String(mail.subject || '').trim(),
    html: mail.html || '',
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    inlineImages: mail.inlineImages,
    attachments: mail.attachments,
  });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });

  return { success: true };
}
