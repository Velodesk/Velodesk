/** sentAttachmentStorage v1.5.0 — outbound do agente sem fila ClamAV (skipAntivirusScan)
 * — v1.5.0: `__` na chave não vira mais `/` na leitura. Nome com acento ("solicitação" →
 *   "solicita__o") dava 404 no bucket e o anexo ficava de fora do e-mail ao cliente.
 *   Nome do arquivo também perde os acentos antes de sanitizar ("solicitacao"). */
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { env } from '../config/env';
import { inspectAttachmentGuard, type AttachmentGuardOptions } from './attachmentGuard.util';

const AGENT_OUTBOUND_GUARD: AttachmentGuardOptions = { skipAntivirusScan: true };
import {
  buildGcsObjectUri,
  getSentAttachmentsPrefix,
  isGcsAttachmentStorageConfigured,
  readSentAttachmentFromGcs,
  uploadSentAttachmentToGcs,
} from './gcsAttachmentStorage.service';

const STORAGE_KEY_SEP = '__';
const MAX_SENT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function resolveBaseDir(): string {
  const configured = String(env.sentAttachmentsDir || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), 'data', 'sent-attachments');
}

function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || 'anexo').trim()) || 'anexo';
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\-()+\s]/g, '_')
    .slice(0, 180);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Chaves de anexo do agente são sempre planas (`<uuid>-<nome>`, sem subpasta), então `__` é
 * literal — pode vir do próprio nome sanitizado — e não é revertido para `/`.
 */
function decodeStorageKey(rawKey: string): string {
  const decoded = decodeURIComponent(String(rawKey || '').trim());
  if (!decoded || decoded.includes('..') || decoded.includes('\\') || decoded.includes('/')) {
    throw new Error('Chave de anexo inválida');
  }
  return decoded;
}

/**
 * Chaves atuais (persistSentAttachment) nunca têm "/" de verdade — só as de antes da
 * v1.4 (subpasta por ticket) tinham. Mas um nome sanitizado por sanitizeFilename pode
 * acabar com "__" por coincidência (ex.: acento virando "_" do lado de outro "_"), e aí
 * decodeStorageKey interpreta isso como barra e corrompe o caminho. Tenta a versão com
 * barra primeiro (compatibilidade com anexos antigos de verdade aninhados) e cai pra
 * chave crua (sem a substituição) se o arquivo não existir nesse caminho.
 */
function decodeStorageKeyCandidates(rawKey: string): string[] {
  const decoded = decodeURIComponent(String(rawKey || '').trim());
  if (!decoded || decoded.includes('..') || decoded.includes('\\') || decoded.startsWith('/')) {
    throw new Error('Chave de anexo inválida');
  }
  const withSlash = decoded.replace(new RegExp(STORAGE_KEY_SEP, 'g'), '/');
  return withSlash === decoded ? [decoded] : [withSlash, decoded];
}

export interface PersistSentAttachmentInput {
  ticketId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
}

export interface StoredSentAttachment {
  url: string;
  gcsUri: string;
  filename: string;
  contentType: string;
  storageKey: string;
}

export function buildSentAttachmentApiUrl(storageKey: string): string {
  const encodedKey = storageKey.replace(/\//g, STORAGE_KEY_SEP);
  return `/api/uploads/sent/${encodeURIComponent(encodedKey)}`;
}

export function parseSentAttachmentStorageKeyFromApiUrl(apiUrl: string): string | null {
  const raw = String(apiUrl || '').trim();
  const match = raw.match(/\/(?:api\/)?uploads\/sent\/([^?#]+)/i);
  if (!match?.[1]) return null;
  try {
    return decodeStorageKey(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function isSentAttachmentApiUrl(url: string): boolean {
  return /\/(?:api\/)?uploads\/sent\//i.test(String(url || '').trim());
}

/** Valida anexo enviado pelo agente antes de repassar ao Twilio WhatsApp. */
export async function resolveSentAttachmentSendMeta(apiUrl: string): Promise<{
  contentType: string;
  scanStatus: string;
}> {
  const storageKey = parseSentAttachmentStorageKeyFromApiUrl(apiUrl);
  if (!storageKey) {
    throw new Error('Anexo inválido');
  }
  const item = await readSentAttachmentBuffer(storageKey);
  if (!item) {
    throw new Error('Anexo não encontrado');
  }
  const guard = inspectAttachmentGuard(
    item.filename,
    item.contentType,
    item.buffer,
    AGENT_OUTBOUND_GUARD,
  );
  if (!guard.ok) {
    throw new Error(guard.reason);
  }
  return {
    contentType: guard.detectedMime,
    scanStatus: guard.scanStatus,
  };
}

export async function readSentAttachmentBuffer(
  storageKey: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  const found = await resolveExistingSentAttachmentPath(storageKey);
  if (found) {
    return {
      buffer: await fs.readFile(found.filePath),
      filename: path.basename(found.relative),
      contentType: 'application/octet-stream',
    };
  }

  for (const relative of decodeStorageKeyCandidates(storageKey)) {
    const gcs = await readSentAttachmentFromGcs(relative);
    if (gcs?.stream) {
      return {
        buffer: await streamToBuffer(gcs.stream as Readable),
        filename: path.basename(relative),
        contentType: gcs.contentType || 'application/octet-stream',
      };
    }
  }

  return null;
}

export async function loadSentAttachmentsForEmail(
  apiUrls: string[],
): Promise<Array<{ filename: string; contentType: string; buffer: Buffer }>> {
  const loaded = [];
  for (const apiUrl of apiUrls) {
    const storageKey = parseSentAttachmentStorageKeyFromApiUrl(apiUrl);
    if (!storageKey) continue;
    const item = await readSentAttachmentBuffer(storageKey);
    if (!item) {
      console.warn('[sentAttachment] anexo indisponível para e-mail:', apiUrl);
      continue;
    }
    const filename = item.filename.replace(/^[0-9a-f-]{36}-/i, '') || item.filename;
    loaded.push({
      filename,
      contentType: item.contentType,
      buffer: item.buffer,
    });
  }
  return loaded;
}

export async function persistSentAttachment(
  input: PersistSentAttachmentInput,
): Promise<StoredSentAttachment> {
  if (input.buffer.length > MAX_SENT_ATTACHMENT_BYTES) {
    throw new Error(`Anexo excede o limite de ${MAX_SENT_ATTACHMENT_BYTES / (1024 * 1024)}MB`);
  }

  const guard = inspectAttachmentGuard(
    input.filename,
    input.contentType,
    input.buffer,
    AGENT_OUTBOUND_GUARD,
  );
  if (!guard.ok) {
    throw new Error(guard.reason);
  }

  const safeName = sanitizeFilename(input.filename);
  const storageKey = `${crypto.randomUUID()}-${safeName}`;

  const contentType = guard.detectedMime || input.contentType;
  const gcsUploaded = await uploadSentAttachmentToGcs(storageKey, input.buffer, contentType);
  if (isGcsAttachmentStorageConfigured() && !gcsUploaded) {
    throw new Error(`Falha ao enviar anexo "${safeName}" para o bucket ${env.gcpStorageBucket}`);
  }

  const fullPath = path.join(resolveBaseDir(), storageKey);
  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.buffer);
  } catch (err) {
    if (!gcsUploaded) throw err;
    console.warn('[sentAttachment] cache local falhou (GCS ok):', (err as Error).message);
  }

  return {
    url: buildSentAttachmentApiUrl(storageKey),
    gcsUri: buildGcsObjectUri(getSentAttachmentsPrefix(), storageKey),
    filename: safeName,
    contentType: String(contentType || 'application/octet-stream').trim(),
    storageKey,
  };
}

function resolveSentAttachmentPathFor(relative: string): string {
  const base = resolveBaseDir();
  const fullPath = path.resolve(base, relative);
  if (!fullPath.startsWith(base + path.sep) && fullPath !== base) {
    throw new Error('Caminho de anexo inválido');
  }
  return fullPath;
}

/** Primeiro candidato que existir em disco, ou o primeiro da lista (pra GCS/erro) se nenhum existir. */
async function resolveExistingSentAttachmentPath(storageKey: string): Promise<{ relative: string; filePath: string } | null> {
  const candidates = decodeStorageKeyCandidates(storageKey);
  for (const relative of candidates) {
    const filePath = resolveSentAttachmentPathFor(relative);
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile()) return { relative, filePath };
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}

export async function openSentAttachment(storageKey: string): Promise<{
  source: 'disk' | 'gcs';
  filePath?: string;
  stream?: NodeJS.ReadableStream;
  contentType?: string;
  filename: string;
} | null> {
  const found = await resolveExistingSentAttachmentPath(storageKey);
  if (found) {
    return {
      source: 'disk',
      filePath: found.filePath,
      filename: path.basename(found.relative),
    };
  }

  for (const relative of decodeStorageKeyCandidates(storageKey)) {
    const gcs = await readSentAttachmentFromGcs(relative);
    if (gcs) {
      return {
        source: 'gcs',
        stream: gcs.stream,
        contentType: gcs.contentType,
        filename: path.basename(relative),
      };
    }
  }

  return null;
}

export function createSentDiskReadStream(filePath: string) {
  return createReadStream(filePath);
}

export async function ensureSentAttachmentDir(): Promise<void> {
  await fs.mkdir(resolveBaseDir(), { recursive: true });
}
