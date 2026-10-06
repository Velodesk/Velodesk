/** gmailAttachment.service v1.6.0 — attachmentGuard antes de persistir */
import crypto from 'crypto';
import type { gmail_v1 } from 'googleapis';
import type { InboundEmailAttachment } from '../inbound-email/types';
import {
  attachmentHashFingerprint,
  attachmentMatchesKnownFingerprints,
  attachmentSizeNameFingerprint,
  isBrandInlineAttachmentFilename,
  isKnownDeskAssetHash,
  isOwnInlineContentId,
  normalizeContentId,
} from '../attachmentFilter.util';
import { inspectAttachmentGuard } from '../attachmentGuard.util';
import { persistInboundAttachment } from '../inboundAttachmentStorage.service';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface GmailAttachmentPartRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
}

function decodeBase64Url(data: string): Buffer {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

function getPartHeader(part: gmail_v1.Schema$MessagePart, name: string): string {
  const found = part.headers?.find(
    (header) => String(header.name ?? '').toLowerCase() === name.toLowerCase(),
  );
  return String(found?.value ?? '').trim();
}

/**
 * Content-IDs referenciados como `cid:` no HTML do e-mail. Quando o cliente responde, o corpo cita
 * o HTML que o VeloDesk enviou (logo, assinatura, estrelas do CSAT) e o cliente de e-mail reanexa
 * essas imagens — muitas vezes com Content-Disposition: attachment e o mesmo Content-ID. Imagem
 * referenciada no HTML é parte do corpo, nunca anexo. Já um anexo real (mesmo que o Gmail grave
 * Content-ID nele) não é referenciado por `cid:` no corpo.
 */
export function collectReferencedCids(part: gmail_v1.Schema$MessagePart | undefined): Set<string> {
  const cids = new Set<string>();
  const visit = (node: gmail_v1.Schema$MessagePart | undefined) => {
    if (!node) return;
    const mime = String(node.mimeType ?? '').toLowerCase();
    const data = node.body?.data;
    if (mime === 'text/html' && data) {
      const html = decodeBase64Url(String(data)).toString('utf8');
      for (const match of html.matchAll(/cid:([^"'\s>)]+)/gi)) {
        cids.add(normalizeContentId(match[1]));
      }
    }
    for (const child of node.parts ?? []) visit(child);
  };
  visit(part);
  return cids;
}

function shouldSkipGmailAttachmentPart(
  part: gmail_v1.Schema$MessagePart,
  referencedCids: Set<string> = new Set(),
): boolean {
  const filename = String(part.filename ?? '').trim();
  if (!filename) return true;

  if (isBrandInlineAttachmentFilename(filename)) {
    return true;
  }

  const disposition = getPartHeader(part, 'Content-Disposition').toLowerCase();
  const isExplicitAttachment = disposition.includes('attachment');
  const contentId = getPartHeader(part, 'Content-ID');

  if (disposition.includes('inline') && !isExplicitAttachment) {
    return true;
  }

  if (contentId) {
    // Imagem gerada pelo próprio VeloDesk ou referenciada no corpo HTML = corpo, não anexo.
    if (isOwnInlineContentId(contentId) || referencedCids.has(normalizeContentId(contentId))) {
      return true;
    }
    // Sem disposition=attachment, Content-ID indica inline (logo/CID).
    if (!isExplicitAttachment) return true;
  }

  return false;
}

export function listGmailAttachmentParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: GmailAttachmentPartRef[] = [],
  referencedCids: Set<string> = collectReferencedCids(part),
): GmailAttachmentPartRef[] {
  if (!part) return acc;

  // message/rfc822 (e-mail encaminhado) não interrompe a descida: o container pode ser
  // o próprio .eml anexado e/ou trazer anexos aninhados nas sub-partes.
  const filename = String(part.filename ?? '').trim();
  const attachmentId = String(part.body?.attachmentId ?? '').trim();
  if (filename && attachmentId && !shouldSkipGmailAttachmentPart(part, referencedCids)) {
    acc.push({
      filename,
      mimeType: String(part.mimeType ?? 'application/octet-stream').trim(),
      attachmentId,
    });
  }

  for (const child of part.parts ?? []) {
    listGmailAttachmentParts(child, acc, referencedCids);
  }
  return acc;
}

export async function downloadGmailAttachments(
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
  messageIdForStorage: string,
  knownFingerprints: Set<string> = new Set(),
): Promise<InboundEmailAttachment[]> {
  const gmailId = String(message.id ?? '').trim();
  if (!gmailId) return [];

  const parts = listGmailAttachmentParts(message.payload ?? undefined);
  if (!parts.length) return [];

  const stored: InboundEmailAttachment[] = [];
  const seenInMessage = new Set<string>();

  for (const part of parts) {
    try {
      const res = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: gmailId,
        id: part.attachmentId,
      });
      const raw = String(res.data.data ?? '').trim();
      if (!raw) continue;

      const buffer = decodeBase64Url(raw);
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        console.warn('[gmailAttachment] anexo ignorado (tamanho)', {
          filename: part.filename,
          bytes: buffer.length,
          messageId: messageIdForStorage,
        });
        continue;
      }

      const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
      // Sem fingerprint por nome isolado: arquivos homônimos com conteúdo distinto são anexos válidos.
      const fingerprints = [
        attachmentHashFingerprint(contentHash),
        attachmentSizeNameFingerprint(part.filename, buffer.length),
      ];

      // Mesmo conteúdo de um asset de e-mail do VeloDesk (logo/símbolo/estrela do CSAT) reanexado
      // pelo cliente de e-mail na resposta — nunca é anexo do cliente.
      if (isKnownDeskAssetHash(contentHash)) {
        console.info('[gmailAttachment] imagem do próprio VeloDesk ignorada', {
          filename: part.filename,
          messageId: messageIdForStorage,
        });
        continue;
      }

      if (fingerprints.some((fp) => seenInMessage.has(fp))) {
        console.info('[gmailAttachment] anexo duplicado na mesma mensagem — ignorado', {
          filename: part.filename,
          messageId: messageIdForStorage,
        });
        continue;
      }

      if (attachmentMatchesKnownFingerprints(
        { filename: part.filename, contentHash, bytes: buffer.length },
        knownFingerprints,
      )) {
        console.info('[gmailAttachment] anexo já presente no ticket — ignorado', {
          filename: part.filename,
          messageId: messageIdForStorage,
        });
        continue;
      }

      const guard = inspectAttachmentGuard(part.filename, part.mimeType, buffer);
      if (!guard.ok) {
        console.warn('[gmailAttachment] anexo bloqueado pelo filtro', {
          filename: part.filename,
          reason: guard.reason,
          code: guard.code,
          messageId: messageIdForStorage,
        });
        continue;
      }

      const saved = await persistInboundAttachment({
        messageId: messageIdForStorage,
        filename: part.filename,
        contentType: guard.detectedMime || part.mimeType,
        buffer,
        scanStatus: guard.scanStatus,
      });

      for (const fp of fingerprints) {
        seenInMessage.add(fp);
        knownFingerprints.add(fp);
      }

      stored.push({
        filename: saved.filename,
        contentType: saved.contentType,
        url: saved.url,
        gcsUri: saved.gcsUri,
        storageKey: saved.storageKey,
        contentHash,
        bytes: buffer.length,
        scanStatus: saved.scanStatus,
      });
    } catch (err) {
      console.warn('[gmailAttachment] falha ao baixar anexo', {
        filename: part.filename,
        messageId: messageIdForStorage,
        error: (err as Error).message,
      });
    }
  }

  return stored;
}

export interface GmailInlineImagePartRef {
  filename: string;
  mimeType: string;
  attachmentId: string;
  contentId: string;
}

function isImageMime(mimeType: string): boolean {
  return /^image\//i.test(String(mimeType || '').trim());
}

/** Partes inline/CID (imagens no corpo) — distintas dos anexos disposition=attachment. */
export function listGmailInlineImageParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: GmailInlineImagePartRef[] = [],
): GmailInlineImagePartRef[] {
  if (!part) return acc;

  const filename = String(part.filename ?? '').trim() || 'image.png';
  const attachmentId = String(part.body?.attachmentId ?? '').trim();
  const contentId = normalizeContentId(getPartHeader(part, 'Content-ID'));
  const mimeType = String(part.mimeType ?? '').trim();
  const disposition = getPartHeader(part, 'Content-Disposition').toLowerCase();
  const isExplicitAttachment = disposition.includes('attachment');

  if (
    attachmentId
    && contentId
    && !isExplicitAttachment
    && (isImageMime(mimeType) || disposition.includes('inline') || Boolean(contentId))
  ) {
    if (isImageMime(mimeType) || disposition.includes('inline')) {
      acc.push({
        filename: isBrandInlineAttachmentFilename(filename) ? 'image.png' : filename,
        mimeType: mimeType || 'image/png',
        attachmentId,
        contentId,
      });
    }
  }

  // Alguns clients embutem imagem sem filename mas com body.data direto (sem attachmentId)
  if (!attachmentId && part.body?.data && contentId && isImageMime(mimeType) && !isExplicitAttachment) {
    // Tratado em download via body.data no caller — marcar com attachmentId vazio não ajuda;
    // skip here; downloadGmailInlineImages handles body.data separately if needed.
  }

  for (const child of part.parts ?? []) {
    listGmailInlineImageParts(child, acc);
  }
  return acc;
}

function listInlinePartsWithEmbeddedData(
  part: gmail_v1.Schema$MessagePart | undefined,
  acc: Array<{ contentId: string; mimeType: string; filename: string; buffer: Buffer }> = [],
): typeof acc {
  if (!part) return acc;
  const contentId = normalizeContentId(getPartHeader(part, 'Content-ID'));
  const mimeType = String(part.mimeType ?? '').trim();
  const disposition = getPartHeader(part, 'Content-Disposition').toLowerCase();
  const isExplicitAttachment = disposition.includes('attachment');
  const data = String(part.body?.data ?? '').trim();
  if (contentId && data && isImageMime(mimeType) && !isExplicitAttachment && !part.body?.attachmentId) {
    acc.push({
      contentId,
      mimeType,
      filename: String(part.filename ?? '').trim() || 'image.png',
      buffer: decodeBase64Url(data),
    });
  }
  for (const child of part.parts ?? []) {
    listInlinePartsWithEmbeddedData(child, acc);
  }
  return acc;
}

/**
 * Baixa imagens CID/inline, persiste no storage inbound e reescreve htmlBody `cid:` → URL da API.
 * Retorna anexos inline (para opcionalmente listar) e o HTML reescrito.
 */
export async function downloadAndRewriteGmailInlineImages(
  gmail: gmail_v1.Gmail,
  message: gmail_v1.Schema$Message,
  messageIdForStorage: string,
  htmlBody: string,
): Promise<{ htmlBody: string; inlineAttachments: InboundEmailAttachment[] }> {
  const gmailId = String(message.id ?? '').trim();
  const cidToUrl = new Map<string, string>();
  const inlineAttachments: InboundEmailAttachment[] = [];

  if (!gmailId) {
    return { htmlBody, inlineAttachments };
  }

  const persistBuffer = async (
    contentId: string,
    filename: string,
    mimeType: string,
    buffer: Buffer,
  ) => {
    if (buffer.length > MAX_ATTACHMENT_BYTES) return;
    if (isBrandInlineAttachmentFilename(filename)) return;
    const guard = inspectAttachmentGuard(filename, mimeType, buffer);
    if (!guard.ok) {
      console.warn('[gmailAttachment] imagem inline bloqueada pelo filtro', {
        filename,
        reason: guard.reason,
        code: guard.code,
      });
      return;
    }
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const saved = await persistInboundAttachment({
      messageId: messageIdForStorage,
      filename,
      contentType: guard.detectedMime || mimeType,
      buffer,
      scanStatus: guard.scanStatus,
    });
    cidToUrl.set(contentId, saved.url);
    inlineAttachments.push({
      filename: saved.filename,
      contentType: saved.contentType,
      url: saved.url,
      gcsUri: saved.gcsUri,
      storageKey: saved.storageKey,
      contentHash,
      bytes: buffer.length,
      scanStatus: saved.scanStatus,
    });
  };

  const parts = listGmailInlineImageParts(message.payload ?? undefined);
  for (const part of parts) {
    try {
      const res = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: gmailId,
        id: part.attachmentId,
      });
      const raw = String(res.data.data ?? '').trim();
      if (!raw) continue;
      await persistBuffer(part.contentId, part.filename, part.mimeType, decodeBase64Url(raw));
    } catch (err) {
      console.warn('[gmailAttachment] falha ao baixar imagem inline', {
        contentId: part.contentId,
        messageId: messageIdForStorage,
        error: (err as Error).message,
      });
    }
  }

  for (const embedded of listInlinePartsWithEmbeddedData(message.payload ?? undefined)) {
    try {
      if (cidToUrl.has(embedded.contentId)) continue;
      await persistBuffer(embedded.contentId, embedded.filename, embedded.mimeType, embedded.buffer);
    } catch (err) {
      console.warn('[gmailAttachment] falha ao persistir imagem inline embutida', {
        contentId: embedded.contentId,
        error: (err as Error).message,
      });
    }
  }

  if (!cidToUrl.size || !htmlBody) {
    return { htmlBody, inlineAttachments };
  }

  const rewritten = htmlBody.replace(
    /(<img\b[^>]*\bsrc\s*=\s*["'])cid:([^"']+)(["'][^>]*>)/gi,
    (full, pre, cidRaw, post) => {
      const cid = normalizeContentId(cidRaw);
      const url = cidToUrl.get(cid);
      if (!url) return full;
      return `${pre}${url}${post}`;
    },
  );

  return { htmlBody: rewritten, inlineAttachments };
}
