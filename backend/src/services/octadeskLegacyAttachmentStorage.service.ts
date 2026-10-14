/** octadeskLegacyAttachmentStorage v1.0.0 — anexos dump Octadesk em octadesk_legacy_attachments */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { env } from '../config/env';
import {
  buildGcsObjectUri,
  getOctadeskLegacyAttachmentsPrefix,
  isGcsAttachmentStorageConfigured,
  readOctadeskLegacyAttachmentFromGcs,
  uploadOctadeskLegacyAttachmentToGcs,
} from './gcsAttachmentStorage.service';

const STORAGE_KEY_SEP = '__';

function resolveBaseDir(): string {
  return path.resolve(process.cwd(), 'data', 'octadesk-legacy-attachments');
}

function sanitizeFilename(name: string): string {
  const base = path.basename(String(name || 'anexo').trim()) || 'anexo';
  return base.replace(/[^\w.\-()+\s]/g, '_').slice(0, 180);
}

function decodeStorageKey(rawKey: string): string {
  const decoded = decodeURIComponent(String(rawKey || '').trim());
  if (!decoded || decoded.includes('..') || decoded.includes('\\') || decoded.startsWith('/')) {
    throw new Error('Chave de anexo inválida');
  }
  return decoded.replace(new RegExp(STORAGE_KEY_SEP, 'g'), '/');
}

export interface PersistOctadeskLegacyAttachmentInput {
  /** Protocolo desk (10 dígitos) — vira pasta no object key */
  protocolo: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
  /** Falha se o upload ao GCS não ocorrer, mesmo com o transporte "não pronto" (evita URL só-disco). */
  requireGcs?: boolean;
}

export interface StoredOctadeskLegacyAttachment {
  url: string;
  gcsUri: string;
  filename: string;
  contentType: string;
  storageKey: string;
}

export function buildOctadeskLegacyAttachmentApiUrl(storageKey: string): string {
  const encodedKey = storageKey.replace(/\//g, STORAGE_KEY_SEP);
  return `/api/uploads/octadesk-legacy/${encodeURIComponent(encodedKey)}`;
}

export async function persistOctadeskLegacyAttachment(
  input: PersistOctadeskLegacyAttachmentInput,
): Promise<StoredOctadeskLegacyAttachment> {
  const safeName = sanitizeFilename(input.filename);
  const protocolo = String(input.protocolo || '').replace(/\D/g, '').padStart(10, '0');
  const storageKey = `${protocolo}/${crypto.randomUUID()}-${safeName}`;

  const gcsUploaded = await uploadOctadeskLegacyAttachmentToGcs(
    storageKey,
    input.buffer,
    input.contentType,
  );
  if ((input.requireGcs || isGcsAttachmentStorageConfigured()) && !gcsUploaded) {
    throw new Error(`Falha ao enviar anexo "${safeName}" para o bucket ${env.gcpStorageBucket}`);
  }

  const fullPath = path.join(resolveBaseDir(), storageKey);
  try {
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, input.buffer);
  } catch (err) {
    if (!gcsUploaded) throw err;
    console.warn('[octadeskLegacyAttachment] cache local falhou (GCS ok):', (err as Error).message);
  }

  return {
    url: buildOctadeskLegacyAttachmentApiUrl(storageKey),
    gcsUri: buildGcsObjectUri(getOctadeskLegacyAttachmentsPrefix(), storageKey),
    filename: safeName,
    contentType: String(input.contentType || 'application/octet-stream').trim(),
    storageKey,
  };
}

function resolveDiskPath(storageKey: string): string {
  const relative = decodeStorageKey(storageKey);
  const base = resolveBaseDir();
  const fullPath = path.resolve(base, relative);
  if (!fullPath.startsWith(base + path.sep) && fullPath !== base) {
    throw new Error('Caminho de anexo inválido');
  }
  return fullPath;
}

export async function openOctadeskLegacyAttachment(storageKey: string): Promise<{
  source: 'disk' | 'gcs';
  filePath?: string;
  stream?: NodeJS.ReadableStream;
  contentType?: string;
  filename: string;
} | null> {
  const relative = decodeStorageKey(storageKey);

  try {
    const filePath = resolveDiskPath(storageKey);
    const stat = await fs.stat(filePath);
    if (stat.isFile()) {
      return {
        source: 'disk',
        filePath,
        filename: path.basename(relative),
      };
    }
  } catch {
    // tenta GCS
  }

  const gcs = await readOctadeskLegacyAttachmentFromGcs(relative);
  if (gcs) {
    return {
      source: 'gcs',
      stream: gcs.stream,
      contentType: gcs.contentType,
      filename: path.basename(relative),
    };
  }

  return null;
}
