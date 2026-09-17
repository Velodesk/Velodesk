/** inboundAttachmentStorage v1.8.0 — gate stale pending + reconcile antes do download */
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { env } from '../config/env';
import { inspectAttachmentGuard, type AttachmentScanStatus } from './attachmentGuard.util';
import {
  buildGcsObjectUri,
  getInboundAttachmentsPrefix,
  getInboundQuarantinePrefix,
  isGcsAttachmentStorageConfigured,
  inboundCleanObjectExists,
  readInboundAttachmentFromGcs,
  readQuarantineAttachmentFromGcs,
  readQuarantineAttachmentMeta,
  uploadInboundAttachmentToGcs,
  uploadQuarantineAttachmentToGcs,
} from './gcsAttachmentStorage.service';

const STORAGE_KEY_SEP = '__';

const STALE_PENDING_MS = Math.max(
  60_000,
  parseInt(process.env.ATTACHMENT_SCAN_STALE_MS || '300000', 10),
);

function resolveBaseDir(): string {
  const configured = String(env.inboundAttachmentsDir || '').trim();
  if (configured) return path.resolve(configured);
  return path.resolve(process.cwd(), 'data', 'inbound-attachments');
}

function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || 'anexo').trim()) || 'anexo';
  return base.replace(/[^\w.\-()+\s]/g, '_').slice(0, 180);
}

function decodeStorageKey(rawKey: string): string {
  const raw = String(rawKey || '').trim();
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Nome com '%' literal — Express já entregou o valor decodificado.
    decoded = raw;
  }
  if (!decoded || decoded.includes('..') || decoded.includes('\\') || decoded.startsWith('/')) {
    throw new Error('Chave de anexo inválida');
  }
  return decoded.replace(new RegExp(STORAGE_KEY_SEP, 'g'), '/');
}

/**
 * Chaves alternativas para a mesma chave lógica, em ordem de tentativa.
 *
 * O separador `__` da URL é ambíguo: pode ser a subpasta do layout legado
 * (`messageId/uuid-nome`) ou `__` literal do nome do arquivo no layout flat atual.
 * Por isso testamos as duas leituras antes de desistir.
 */
export function expandInboundStorageKeyCandidates(relative: string): string[] {
  const normalized = String(relative || '').trim().replace(/\\/g, '/');
  if (!normalized) return [];

  const out = new Set<string>([normalized]);

  if (normalized.includes('/')) {
    out.add(normalized.replace(/\//g, STORAGE_KEY_SEP));
    out.add(normalized.split('/').filter(Boolean).pop() as string);
  }

  return [...out].filter(Boolean);
}

export interface PersistInboundAttachmentInput {
  messageId: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
  scanStatus?: 'skipped' | 'pending';
}

export interface StoredInboundAttachment {
  url: string;
  gcsUri: string;
  filename: string;
  contentType: string;
  storageKey: string;
  scanStatus: AttachmentScanStatus;
}

export function buildInboundAttachmentApiUrl(storageKey: string): string {
  const encodedKey = storageKey.replace(/\//g, STORAGE_KEY_SEP);
  return `/api/uploads/inbound/${encodeURIComponent(encodedKey)}`;
}

export function parseInboundAttachmentStorageKeyFromApiUrl(apiUrl: string): string | null {
  const raw = String(apiUrl || '').trim();
  const match = raw.match(/\/(?:api\/)?uploads\/inbound\/([^?#]+)/i);
  if (!match?.[1]) return null;
  try {
    return decodeStorageKey(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export async function persistInboundAttachment(
  input: PersistInboundAttachmentInput,
): Promise<StoredInboundAttachment> {
  const safeName = sanitizeFilename(input.filename);
  const storageKey = `${crypto.randomUUID()}-${safeName}`;

  const canQuarantine = isGcsAttachmentStorageConfigured();
  const scanStatus: AttachmentScanStatus = input.scanStatus === 'pending' && canQuarantine
    ? 'pending'
    : 'skipped';
  const prefix = scanStatus === 'pending' ? getInboundQuarantinePrefix() : getInboundAttachmentsPrefix();
  const gcsUploaded = scanStatus === 'pending'
    ? await uploadQuarantineAttachmentToGcs(storageKey, input.buffer, input.contentType)
    : await uploadInboundAttachmentToGcs(storageKey, input.buffer, input.contentType);
  if (isGcsAttachmentStorageConfigured() && !gcsUploaded) {
    throw new Error(`Falha ao enviar anexo "${safeName}" para o bucket ${env.gcpStorageBucket}`);
  }
  if (env.nodeEnv === 'production' && !gcsUploaded) {
    throw new Error(
      `GCS indisponível em produção — anexo "${safeName}" não persistido (configure GCP_STORAGE_BUCKET e transport Gmail).`,
    );
  }

  if (scanStatus !== 'pending') {
    const fullPath = path.join(resolveBaseDir(), storageKey);
    try {
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, input.buffer);
    } catch (err) {
      if (!gcsUploaded) throw err;
      console.warn('[inboundAttachment] cache local falhou (GCS ok):', (err as Error).message);
    }
  }

  console.info('[inboundAttachment] persistido', {
    storageKey,
    filename: safeName,
    bytes: input.buffer.length,
    gcs: gcsUploaded,
    scanStatus,
    prefix,
    messageId: String(input.messageId || '').slice(0, 32),
  });

  return {
    url: buildInboundAttachmentApiUrl(storageKey),
    gcsUri: buildGcsObjectUri(prefix, storageKey),
    filename: safeName,
    contentType: String(input.contentType || 'application/octet-stream').trim(),
    storageKey,
    scanStatus,
  };
}

const EXTERNAL_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const EXTERNAL_ATTACHMENT_TIMEOUT_MS = 15_000;

const PRIVATE_HOSTNAME_RE = /^(localhost|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase();
  return PRIVATE_HOSTNAME_RE.test(host) || host.endsWith('.local') || host.endsWith('.internal');
}

async function readExternalResponseWithLimit(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > EXTERNAL_ATTACHMENT_MAX_BYTES) {
    throw new Error(`Anexo excede ${EXTERNAL_ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB`);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const chunk = Buffer.from(rawChunk);
    total += chunk.length;
    if (total > EXTERNAL_ATTACHMENT_MAX_BYTES) {
      throw new Error(`Anexo excede ${EXTERNAL_ATTACHMENT_MAX_BYTES / (1024 * 1024)}MB`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function inferExternalFilename(url: string, contentDisposition: string): string {
  const dispositionMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition);
  if (dispositionMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(dispositionMatch[1].replace(/^"|"$/g, '').trim());
      if (decoded) return path.basename(decoded);
    } catch {
      // usa nome inferido da URL
    }
  }
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname || '');
    if (base) return decodeURIComponent(base);
  } catch {
    // ignora
  }
  return 'anexo';
}

/**
 * Baixa e re-hospeda um anexo apontado por URL EXTERNA (ex.: attachments[] enviado pelo App
 * Velotax no POST /api/inbound/tickets) na mesma pipeline de storage/scan usada para
 * e-mail/WhatsApp — em vez de guardar a URL crua, que fica fora do controle do Desk (expira,
 * exige auth própria, ou só existe no ambiente/bucket de origem). Em caso de falha, retorna
 * null e o chamador deve decidir se mantém a URL original como fallback ou descarta o anexo.
 */
export async function fetchAndPersistInboundAttachmentFromUrl(
  url: string,
  messageId: string,
): Promise<StoredInboundAttachment | null> {
  const raw = String(url || '').trim();
  if (!raw) return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(raw);
  } catch {
    console.warn('[inboundAttachment] URL de anexo externo inválida:', raw);
    return null;
  }
  if (parsedUrl.protocol !== 'https:' || isPrivateOrLoopbackHostname(parsedUrl.hostname)) {
    console.warn('[inboundAttachment] URL de anexo externo não autorizada:', parsedUrl.hostname);
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_ATTACHMENT_TIMEOUT_MS);
  try {
    const response = await fetch(raw, { redirect: 'follow', signal: controller.signal });
    if (!response.ok) {
      throw new Error(`download falhou: HTTP ${response.status}`);
    }
    const buffer = await readExternalResponseWithLimit(response);
    if (!buffer.length) throw new Error('anexo vazio');

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim()
      || 'application/octet-stream';
    const filename = inferExternalFilename(raw, String(response.headers.get('content-disposition') || ''));

    const guard = inspectAttachmentGuard(filename, contentType, buffer);
    if (!guard.ok) {
      console.warn('[inboundAttachment] anexo externo bloqueado:', guard.reason, raw);
      return null;
    }

    return await persistInboundAttachment({
      messageId,
      filename,
      contentType: guard.detectedMime || contentType,
      buffer,
      scanStatus: guard.scanStatus,
    });
  } catch (err) {
    console.warn('[inboundAttachment] falha ao baixar anexo externo:', (err as Error).message, raw);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Path em disco a partir de uma chave JÁ decodificada (não reaplica decode). */
function resolveDiskPathFromRelative(relative: string): string {
  const normalized = String(relative || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.includes('..') || normalized.startsWith('/')) {
    throw new Error('Chave de anexo inválida');
  }
  const base = resolveBaseDir();
  const fullPath = path.resolve(base, normalized);
  if (!fullPath.startsWith(base + path.sep) && fullPath !== base) {
    throw new Error('Caminho de anexo inválido');
  }
  return fullPath;
}

export function resolveInboundAttachmentPath(storageKey: string): string {
  return resolveDiskPathFromRelative(decodeStorageKey(storageKey));
}

export function decodeInboundStorageKeyParam(rawKey: string): string {
  return decodeStorageKey(rawKey);
}

async function tryOpenFromDisk(relative: string): Promise<{
  source: 'disk';
  filePath: string;
  filename: string;
} | null> {
  try {
    const filePath = resolveDiskPathFromRelative(relative);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      return {
        source: 'disk',
        filePath,
        filename: path.basename(relative),
      };
    }
  } catch {
    // próximo candidato
  }
  return null;
}

export type InboundAttachmentGate =
  | { state: 'ready' }
  | { state: 'pending' }
  | { state: 'infected'; reason?: string }
  | { state: 'missing' };

export async function inspectInboundAttachmentGate(storageKey: string): Promise<InboundAttachmentGate> {
  const relative = decodeStorageKey(storageKey);
  const candidates = expandInboundStorageKeyCandidates(relative);

  for (const key of candidates) {
    const disk = await tryOpenFromDisk(key);
    if (disk) return { state: 'ready' };
    if (await inboundCleanObjectExists(key)) return { state: 'ready' };
  }

  for (const key of candidates) {
    const meta = await readQuarantineAttachmentMeta(key);
    if (!meta) continue;
    const status = String(meta.scanStatus || 'pending').toLowerCase();
    if (status === 'infected') return { state: 'infected', reason: meta.scanReason };
    if (status === 'unscannable') return { state: 'infected', reason: meta.scanReason || 'unscannable' };
    if (status === 'clean') return { state: 'ready' };
    if (status === 'pending') {
      const ageMs = meta.updatedAt instanceof Date
        ? Date.now() - meta.updatedAt.getTime()
        : 0;
      if (ageMs >= STALE_PENDING_MS) return { state: 'ready' };
      return { state: 'pending' };
    }
    return { state: 'pending' };
  }

  return { state: 'missing' };
}

export async function openInboundAttachment(storageKey: string): Promise<{
  source: 'disk' | 'gcs';
  filePath?: string;
  stream?: NodeJS.ReadableStream;
  contentType?: string;
  filename: string;
} | null> {
  const relative = decodeStorageKey(storageKey);
  const candidates = expandInboundStorageKeyCandidates(relative);

  for (const key of candidates) {
    const disk = await tryOpenFromDisk(key);
    if (disk) return disk;

    const gcs = await readInboundAttachmentFromGcs(key);
    if (gcs) {
      return {
        source: 'gcs',
        stream: gcs.stream,
        contentType: gcs.contentType,
        filename: path.basename(key),
      };
    }
  }

  for (const key of candidates) {
    const meta = await readQuarantineAttachmentMeta(key);
    if (String(meta?.scanStatus || '').toLowerCase() !== 'clean') continue;
    const gcs = await readQuarantineAttachmentFromGcs(key);
    if (gcs) {
      return {
        source: 'gcs',
        stream: gcs.stream,
        contentType: gcs.contentType,
        filename: path.basename(key),
      };
    }
  }

  console.warn('[inboundAttachment] não encontrado', { storageKey: relative, tried: candidates });
  return null;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function readInboundAttachmentBuffer(
  storageKey: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  const opened = await openInboundAttachment(storageKey);
  if (!opened) return null;
  if (opened.source === 'disk' && opened.filePath) {
    return {
      buffer: await fs.readFile(opened.filePath),
      filename: opened.filename,
      contentType: opened.contentType || 'application/octet-stream',
    };
  }
  if (opened.stream) {
    return {
      buffer: await streamToBuffer(opened.stream),
      filename: opened.filename,
      contentType: opened.contentType || 'application/octet-stream',
    };
  }
  return null;
}

export function createDiskReadStream(filePath: string) {
  return createReadStream(filePath);
}

export async function ensureInboundAttachmentDir(): Promise<void> {
  await fs.mkdir(resolveBaseDir(), { recursive: true });
}
