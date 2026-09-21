/**
 * octadesk-dump-attachments.ts v1.0.0
 * Passada C — baixa anexos Octadesk → GCS octadesk_legacy_attachments → URL desk no doc
 *
 * Uso:
 *   npx tsx scripts/octadesk-dump-attachments.ts
 *   npx tsx scripts/octadesk-dump-attachments.ts --max=50
 *   npx tsx scripts/octadesk-dump-attachments.ts --concurrency=2
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEmailTransport } from '../src/services/emailTransport.service';
import { persistOctadeskLegacyAttachment } from '../src/services/octadeskLegacyAttachmentStorage.service';
import {
  connectLegadoTickets,
  disconnectLegadoTickets,
  importadosCol,
  parseArg,
  requireOctadeskApiKey,
  type ImportadoAttachment,
  type ImportadoOctadeskDoc,
} from './lib/octadeskDumpShared';
import { toProtocoloDesk } from '../src/utils/octadeskProtocolo';

function guessContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}

/**
 * Só PDFs interessam ao módulo Legado Octa (comprovantes/contratos/regulamentos).
 * Prints/vídeos de evidência técnica são descartados antes mesmo do download.
 */
function isPdfAttachment(name: string, url: string): boolean {
  const lower = `${name || ''} ${url || ''}`.toLowerCase();
  return lower.includes('.pdf');
}

function collectFromTicket(ticket: Record<string, unknown> | undefined): ImportadoAttachment[] {
  const out: ImportadoAttachment[] = [];
  const list = Array.isArray(ticket?.attachments) ? ticket!.attachments as Array<Record<string, unknown>> : [];
  for (const a of list) {
    const originUrl = String(a.url || '').trim();
    if (!originUrl) continue;
    const name = String(a.name || 'anexo');
    if (!isPdfAttachment(name, originUrl)) continue;
    out.push({
      octadeskId: a.id != null ? String(a.id) : a._id != null ? String(a._id) : undefined,
      name,
      originUrl,
      status: 'pending',
      source: 'ticket',
    });
  }
  return out;
}

function collectFromInteractions(interactions: unknown[] | undefined): ImportadoAttachment[] {
  const out: ImportadoAttachment[] = [];
  for (const raw of interactions || []) {
    if (!raw || typeof raw !== 'object') continue;
    const inter = raw as Record<string, unknown>;
    const interactionId = inter._id != null ? String(inter._id) : inter.id != null ? String(inter.id) : undefined;
    const atts = Array.isArray(inter.attachments) ? inter.attachments as Array<Record<string, unknown>> : [];
    for (const a of atts) {
      const originUrl = String(a.url || '').trim();
      if (!originUrl) continue;
      const name = String(a.name || 'anexo');
      if (!isPdfAttachment(name, originUrl)) continue;
      out.push({
        octadeskId: a._id != null ? String(a._id) : a.id != null ? String(a.id) : undefined,
        name,
        originUrl,
        status: 'pending',
        source: 'interaction',
        interactionId,
      });
    }
  }
  return out;
}

function mergeAttachmentLists(
  existing: ImportadoAttachment[] | undefined,
  discovered: ImportadoAttachment[],
): ImportadoAttachment[] {
  const byKey = new Map<string, ImportadoAttachment>();
  const keyOf = (a: ImportadoAttachment) =>
    a.octadeskId || `${a.source}|${a.interactionId || ''}|${a.originUrl}`;

  for (const a of existing || []) {
    byKey.set(keyOf(a), a);
  }
  for (const a of discovered) {
    const k = keyOf(a);
    const prev = byKey.get(k);
    if (prev && (prev.status === 'ok' || prev.status === 'skipped')) {
      continue;
    }
    if (prev && prev.status === 'failed' && !process.argv.includes('--retry-failed')) {
      continue;
    }
    byKey.set(k, { ...prev, ...a, status: prev?.status === 'ok' ? 'ok' : 'pending' });
  }
  return [...byKey.values()];
}

async function downloadUrl(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ao baixar anexo`);
  }
  const contentType = String(res.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType };
}

async function processOneAttachment(
  protocolo: string,
  att: ImportadoAttachment,
): Promise<ImportadoAttachment> {
  if (att.status === 'ok' && att.url) return att;
  if (!att.originUrl) {
    return { ...att, status: 'failed', error: 'originUrl vazia' };
  }

  try {
    const { buffer, contentType } = await downloadUrl(att.originUrl);
    const saved = await persistOctadeskLegacyAttachment({
      protocolo,
      filename: att.name || 'anexo',
      contentType: contentType || guessContentType(att.name || ''),
      buffer,
    });
    return {
      ...att,
      status: 'ok',
      storageKey: saved.storageKey,
      url: saved.url,
      gcsUri: saved.gcsUri,
      error: undefined,
    };
  } catch (err) {
    return {
      ...att,
      status: 'failed',
      error: (err as Error).message || String(err),
    };
  }
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      results[i] = await fn(items[i]);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

async function main(): Promise<void> {
  requireOctadeskApiKey();
  const maxDocs = Number(parseArg('max') || '0') || 0;
  const concurrency = Math.max(1, Math.min(5, Number(parseArg('concurrency') || '2') || 2));

  // GCS usa a mesma SA do transport Gmail
  await connectDatabase();
  await loadEmailTransport();

  const db = await connectLegadoTickets();
  const col = importadosCol(db);

  const filter = {
    $or: [
      { 'ticket.attachments.0': { $exists: true } },
      { interactions: { $elemMatch: { 'attachments.0': { $exists: true } } } },
      { 'attachments.status': { $in: ['pending', 'failed'] } },
    ],
  };

  const cursor = col.find(filter as never).batchSize(20);
  let processed = 0;
  let ok = 0;
  let failed = 0;

  for await (const doc of cursor) {
    const d = doc as ImportadoOctadeskDoc;
    if (maxDocs > 0 && processed >= maxDocs) break;

    const octadeskNumber = Number(d.octadeskNumber);
    if (!Number.isFinite(octadeskNumber)) continue;
    const protocolo = d.protocolo || toProtocoloDesk(octadeskNumber);

    const discovered = [
      ...collectFromTicket(d.ticket as Record<string, unknown> | undefined),
      ...collectFromInteractions(d.interactions),
    ];
    let attachments = mergeAttachmentLists(d.attachments, discovered);
    const pendingIdx = attachments
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.status === 'pending' || (a.status === 'failed' && process.argv.includes('--retry-failed')));

    if (!pendingIdx.length && attachments.length === (d.attachments?.length || 0)) {
      // nada a fazer neste doc
      continue;
    }

    const updatedPending = await mapPool(pendingIdx, concurrency, async ({ a }) =>
      processOneAttachment(protocolo, a),
    );

    for (let j = 0; j < pendingIdx.length; j++) {
      attachments[pendingIdx[j].i] = updatedPending[j];
      if (updatedPending[j].status === 'ok') ok += 1;
      if (updatedPending[j].status === 'failed') failed += 1;
    }

    const errors = attachments
      .filter((a) => a.status === 'failed')
      .map((a) => ({
        at: new Date(),
        pass: 'passC',
        message: `${a.name}: ${a.error || 'failed'}`,
      }));

    await col.updateOne(
      { octadeskNumber },
      {
        $set: {
          protocolo,
          attachments,
          updatedAt: new Date(),
          'importMeta.passC': { status: 'done', at: new Date() },
        },
        ...(errors.length
          ? { $push: { 'importMeta.errors': { $each: errors.slice(0, 20) } } }
          : {}),
      } as never,
    );

    processed += 1;
    if (processed % 25 === 0) {
      console.log(`[passC] docs=${processed} ok=${ok} failed=${failed}`);
    }
  }

  console.log(JSON.stringify({
    pass: 'passC-attachments',
    docsProcessed: processed,
    attachmentsOk: ok,
    attachmentsFailed: failed,
    concurrency,
  }, null, 2));
}

main()
  .catch(async (err) => {
    console.error('[passC] falhou:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLegadoTickets().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  });
