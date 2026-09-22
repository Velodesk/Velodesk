/**
 * octadesk-dump-rehost-attachments.ts v1.0.0
 * Baixa os PDFs referenciados em legado_octa.tickets (ainda apontando para o bucket
 * público externo do Octadesk) e re-hospeda em GCS (velodesk_storage/octadesk_legacy_attachments),
 * atualizando a URL para a rota interna (/api/uploads/octadesk-legacy/...). Substitui o Pass C
 * original, que lia do staging — este fluxo (import direto do backup) não usa staging.
 *
 * Uso:
 *   npx tsx scripts/octadesk-dump-rehost-attachments.ts
 *   npx tsx scripts/octadesk-dump-rehost-attachments.ts --max=200 --concurrency=3
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { loadEmailTransport } from '../src/services/emailTransport.service';
import { persistOctadeskLegacyAttachment } from '../src/services/octadeskLegacyAttachmentStorage.service';
import { connectLegacyOcta, disconnectLegacyOcta } from '../src/config/legacyOctaConnection';
import { getTicketLegadoOctaModel } from '../src/models/TicketLegadoOcta';

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && !url.includes('/api/uploads/octadesk-legacy/');
}

function guessContentType(name: string): string {
  return name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
}

async function downloadUrl(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar anexo`);
  return Buffer.from(await res.arrayBuffer());
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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
  const maxDocs = Number(parseArg('max') || '0') || 0;
  const concurrency = Math.max(1, Math.min(5, Number(parseArg('concurrency') || '3') || 3));

  await connectDatabase();
  await loadEmailTransport(); // mesma service account usada pelo GCS
  await connectLegacyOcta();
  const Model = getTicketLegadoOctaModel();

  const cursor = Model.find({ 'interactions.attachments.0': { $exists: true } }).cursor();

  let docsProcessed = 0;
  let attachmentsOk = 0;
  let attachmentsFailed = 0;

  for await (const doc of cursor) {
    if (maxDocs > 0 && docsProcessed >= maxDocs) break;

    let changed = false;
    for (const interaction of doc.interactions) {
      const pending = interaction.attachments.filter((a) => isExternalUrl(a.url));
      if (!pending.length) continue;

      const results = await mapPool(pending, concurrency, async (att) => {
        try {
          const buffer = await downloadUrl(att.url);
          const saved = await persistOctadeskLegacyAttachment({
            protocolo: doc.protocoloExibicao,
            filename: att.name || 'anexo.pdf',
            contentType: guessContentType(att.name || ''),
            buffer,
          });
          return { att, url: saved.url, ok: true as const };
        } catch (err) {
          console.warn(`[rehost] falhou ${doc.octadeskNumber} "${att.name}": ${(err as Error).message}`);
          return { att, ok: false as const };
        }
      });

      for (const r of results) {
        if (r.ok) {
          r.att.url = r.url;
          changed = true;
          attachmentsOk += 1;
        } else {
          attachmentsFailed += 1;
        }
      }
    }

    if (changed) await doc.save();
    docsProcessed += 1;
    if (docsProcessed % 50 === 0) {
      console.log(`[rehost] docs=${docsProcessed} ok=${attachmentsOk} failed=${attachmentsFailed}`);
    }
  }

  console.log(JSON.stringify({ docsProcessed, attachmentsOk, attachmentsFailed }, null, 2));
}

main()
  .catch((err) => {
    console.error('[rehost] falhou:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLegacyOcta().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  });
