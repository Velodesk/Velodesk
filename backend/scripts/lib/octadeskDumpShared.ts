/**
 * octadeskDumpShared v1.1.0 — staging movido para o cluster dedicado (MONGODB_LEGACY),
 * nunca mais para o velodesk-dev (cluster compartilhado, causou "over space quota" real
 * em produção ao rodar o dump completo — ver histórico da migração).
 */
import mongoose, { Connection, Collection, Db } from 'mongoose';
import { env } from '../../src/config/env';
import { MONGO_DRIVER_OPTIONS } from '../../src/config/mongoUri';
import { resolveAtlasSrvUri } from '../../src/config/resolveAtlasUri';
import { toProtocoloDesk } from '../../src/utils/octadeskProtocolo';

export const IMPORTADOS_COLLECTION = 'importados_octadesk';
export const CHECKPOINTS_COLLECTION = 'dump_checkpoints';

export type AttachmentStatus = 'pending' | 'ok' | 'failed' | 'skipped';

export interface ImportadoAttachment {
  octadeskId?: string;
  name: string;
  originUrl: string;
  storageKey?: string;
  url?: string;
  gcsUri?: string;
  status: AttachmentStatus;
  source: 'ticket' | 'interaction';
  interactionId?: string;
  error?: string;
}

export interface ImportMeta {
  source: 'octadesk-dump';
  importedAt?: Date;
  passA?: { status: string; at?: Date; page?: number };
  passB?: { status: string; at?: Date; month?: string };
  passC?: { status: string; at?: Date };
  errors?: Array<{ at: Date; pass: string; message: string }>;
}

export interface ImportadoOctadeskDoc {
  protocolo: string;
  octadeskNumber: number;
  octadeskId?: string;
  ticket?: Record<string, unknown>;
  interactions?: unknown[];
  attachments?: ImportadoAttachment[];
  importMeta?: ImportMeta;
  updatedAt?: Date;
  createdAt?: Date;
}

let legadoConnection: Connection | null = null;

export function requireOctadeskApiKey(): string {
  const key = String(env.octadeskApiKey || '').trim();
  if (!key) {
    throw new Error('OCTADESK_API_KEY ausente — defina no backend/.env (não commitar).');
  }
  return key;
}

export async function connectLegadoTickets(
  options: { ensureIndexes?: boolean } = {},
): Promise<Db> {
  if (legadoConnection?.readyState === 1 && legadoConnection.db) {
    return legadoConnection.db;
  }

  // Cluster dedicado do módulo Legado Octa (MONGODB_LEGACY) — nunca o velodesk-dev principal.
  const mongoUri = String(env.mongoLegacyOctaUri || '').trim();
  if (!mongoUri) throw new Error('MONGODB_LEGADO_OCTA_URI ausente — defina no backend/.env.');

  const { uri: atlasUri } = await resolveAtlasSrvUri(mongoUri);
  legadoConnection = mongoose.createConnection(atlasUri, {
    dbName: env.mongoLegadoTicketsDbName || 'legado_tickets',
    ...MONGO_DRIVER_OPTIONS,
  });

  await legadoConnection.asPromise();
  if (!legadoConnection.db) throw new Error('DB legado_tickets indisponível');

  if (options.ensureIndexes !== false) {
    await ensureLegadoIndexes(legadoConnection.db);
  }
  console.log(`[octadesk-dump] conectado: ${env.mongoLegadoTicketsDbName || 'legado_tickets'}`);
  return legadoConnection.db;
}

export async function disconnectLegadoTickets(): Promise<void> {
  if (legadoConnection) {
    await legadoConnection.close();
    legadoConnection = null;
  }
}

async function ensureLegadoIndexes(db: Db): Promise<void> {
  const col = db.collection(IMPORTADOS_COLLECTION);
  await col.createIndex({ octadeskNumber: 1 }, { unique: true, name: 'octadeskNumber_1' });
  await col.createIndex({ protocolo: 1 }, { unique: true, name: 'protocolo_1' });
  await col.createIndex({ 'importMeta.passA.status': 1 }, { name: 'passA_status_1' });
  await col.createIndex({ 'attachments.status': 1 }, { name: 'attachments_status_1' });

  const cp = db.collection(CHECKPOINTS_COLLECTION);
  await cp.createIndex({ pass: 1 }, { unique: true, name: 'pass_1' });
}

export function importadosCol(db: Db): Collection<ImportadoOctadeskDoc> {
  return db.collection<ImportadoOctadeskDoc>(IMPORTADOS_COLLECTION);
}

export function checkpointsCol(db: Db): Collection {
  return db.collection(CHECKPOINTS_COLLECTION);
}

export async function getCheckpoint(db: Db, pass: string): Promise<Record<string, unknown> | null> {
  return checkpointsCol(db).findOne({ pass }) as Promise<Record<string, unknown> | null>;
}

export async function setCheckpoint(
  db: Db,
  pass: string,
  data: Record<string, unknown>,
): Promise<void> {
  await checkpointsCol(db).updateOne(
    { pass },
    { $set: { ...data, pass, updatedAt: new Date() } },
    { upsert: true },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface OctadeskFetchResult {
  status: number;
  body: unknown;
  headers: Headers;
  text: string;
}

export async function octadeskFetch(
  pathAndQuery: string,
  options: { retries?: number } = {},
): Promise<OctadeskFetchResult> {
  const key = requireOctadeskApiKey();
  const base = env.octadeskApiBase.replace(/\/+$/, '');
  const url = pathAndQuery.startsWith('http')
    ? pathAndQuery
    : `${base}${pathAndQuery.startsWith('/') ? '' : '/'}${pathAndQuery}`;

  const headers: Record<string, string> = {
    'X-API-KEY': key,
    Accept: 'application/json',
  };
  if (env.octadeskAgentEmail) {
    headers['octa-agent-email'] = env.octadeskAgentEmail;
  }

  const maxRetries = options.retries ?? 8;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { method: 'GET', headers });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        // mantém texto
      }

      // 409: conflito interno Octadesk em coleções sob escrita concorrente (visto no dump).
      if (res.status === 429 || res.status === 409 || res.status >= 500) {
        const wait = Math.min(60_000, 1500 * 2 ** attempt);
        console.warn(`[octadesk-dump] HTTP ${res.status} — retry em ${wait}ms (${attempt + 1}/${maxRetries})`);
        await sleep(wait);
        continue;
      }

      return { status: res.status, body, headers: res.headers, text };
    } catch (err) {
      lastErr = err as Error;
      const wait = Math.min(60_000, 1000 * 2 ** attempt);
      console.warn(`[octadesk-dump] rede: ${lastErr.message} — retry em ${wait}ms`);
      await sleep(wait);
    }
  }

  throw lastErr || new Error(`Falha ao chamar Octadesk: ${url}`);
}

export function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name) || headers.get(name.toLowerCase());
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function ticketNumberFromPayload(ticket: Record<string, unknown>): number {
  const n = Number(ticket.number);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Ticket sem number válido: ${JSON.stringify(ticket.number)}`);
  }
  return n;
}

export function buildUpsertFromTicket(ticket: Record<string, unknown>): {
  filter: { octadeskNumber: number };
  update: Record<string, unknown>;
} {
  const octadeskNumber = ticketNumberFromPayload(ticket);
  const protocolo = toProtocoloDesk(octadeskNumber);
  const octadeskId = ticket.id != null ? String(ticket.id) : undefined;
  const now = new Date();

  return {
    filter: { octadeskNumber },
    update: {
      $set: {
        protocolo,
        octadeskNumber,
        ...(octadeskId ? { octadeskId } : {}),
        ticket,
        updatedAt: now,
        'importMeta.source': 'octadesk-dump',
        'importMeta.passA': { status: 'done', at: now },
      },
      $setOnInsert: {
        createdAt: now,
        interactions: [],
        attachments: [],
        'importMeta.importedAt': now,
      },
    },
  };
}

export function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
