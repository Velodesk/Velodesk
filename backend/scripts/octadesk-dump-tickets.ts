/**
 * octadesk-dump-tickets.ts v1.1.0
 * Passada A — lista tickets Octadesk dos últimos N meses (default 18) →
 * legado_tickets.importados_octadesk. Usa GET /search com filtro openDate
 * (API v1) em vez de paginar /tickets inteiro — evita reprocessar os
 * >100 mil tickets completos (causa do estouro de armazenamento anterior).
 *
 * Uso:
 *   npx tsx scripts/octadesk-dump-tickets.ts
 *   npx tsx scripts/octadesk-dump-tickets.ts --since-months=12
 *   npx tsx scripts/octadesk-dump-tickets.ts --from=2026-08-01 --to=2026-09-01
 *   npx tsx scripts/octadesk-dump-tickets.ts --max-pages=5
 *   npx tsx scripts/octadesk-dump-tickets.ts --reset-checkpoint
 */
import {
  connectLegadoTickets,
  disconnectLegadoTickets,
  getCheckpoint,
  setCheckpoint,
  importadosCol,
  octadeskFetch,
  headerInt,
  buildUpsertFromTicket,
  parseArg,
  hasFlag,
  requireOctadeskApiKey,
} from './lib/octadeskDumpShared';

const PASS = 'passA-tickets';
const LIMIT = 100;

function sinceDateIso(sinceMonths: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - sinceMonths);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  requireOctadeskApiKey();
  const maxPages = Number(parseArg('max-pages') || '0') || 0;
  const sinceMonths = Number(parseArg('since-months') || '12') || 12;
  const openDateFrom = parseArg('from') || sinceDateIso(sinceMonths);
  const openDateTo = parseArg('to') || '';
  const db = await connectLegadoTickets();
  const col = importadosCol(db);

  if (hasFlag('reset-checkpoint')) {
    await setCheckpoint(db, PASS, { page: 1, done: false });
    console.log('[passA] checkpoint resetado para page=1');
  }

  const cp = (await getCheckpoint(db, PASS)) || {};
  let page = Number(cp.page || 1);
  if (!Number.isFinite(page) || page < 1) page = 1;

  let pagesDone = 0;
  let upserted = 0;
  let totalItems: number | null = null;
  let totalPages: number | null = null;

  console.log(
    `[passA] iniciando em page=${page} limit=${LIMIT} createdAt>=${openDateFrom}`
    + (openDateTo ? ` createdAt<${openDateTo}` : ` (${sinceMonths} meses)`),
  );

  while (true) {
    if (maxPages > 0 && pagesDone >= maxPages) {
      console.log(`[passA] --max-pages=${maxPages} atingido`);
      break;
    }

    // GET /tickets/search e GET /search não existem neste gateway (testado contra a API
    // real — ambos devolvem 404). O filtro de data funciona via filters[] em GET /tickets,
    // com createdAt (openDate não é uma propriedade válida — testado, retorna 400).
    const path = `/tickets?page=${page}&limit=${LIMIT}`
      + `&filters[0][property]=createdAt&filters[0][operator]=ge&filters[0][value]=${openDateFrom}`
      + (openDateTo ? `&filters[1][property]=createdAt&filters[1][operator]=lt&filters[1][value]=${openDateTo}` : '')
      + `&sort[property]=number&sort[direction]=asc`;
    const res = await octadeskFetch(path);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`[passA] HTTP ${res.status}: ${res.text.slice(0, 400)}`);
    }

    totalItems = headerInt(res.headers, 'X-Total-Items') ?? totalItems;
    totalPages = headerInt(res.headers, 'X-Total-Pages') ?? totalPages;

    const list = Array.isArray(res.body) ? (res.body as Record<string, unknown>[]) : [];
    if (!list.length) {
      console.log(`[passA] página ${page} vazia — fim`);
      await setCheckpoint(db, PASS, {
        page,
        done: true,
        totalItems,
        totalPages,
        finishedAt: new Date(),
      });
      break;
    }

    const ops = list.map((ticket) => {
      const { filter, update } = buildUpsertFromTicket(ticket);
      return { updateOne: { filter, update, upsert: true } };
    });

    const bulk = await col.bulkWrite(ops as never, { ordered: false });
    const pageUpserts = (bulk.upsertedCount || 0) + (bulk.modifiedCount || 0) + (bulk.matchedCount || 0);
    upserted += list.length;

    console.log(
      `[passA] page=${page}/${totalPages ?? '?'} items=${list.length} `
      + `bulk(upserted=${bulk.upsertedCount} mod=${bulk.modifiedCount}) `
      + `totalAPI=${totalItems ?? '?'} acumulado=${upserted}`,
    );

    await setCheckpoint(db, PASS, {
      page: page + 1,
      done: false,
      totalItems,
      totalPages,
      lastNumbers: list.slice(0, 3).map((t) => t.number),
    });

    pagesDone += 1;
    page += 1;

    if (list.length < LIMIT) {
      await setCheckpoint(db, PASS, {
        page,
        done: true,
        totalItems,
        totalPages,
        finishedAt: new Date(),
      });
      console.log('[passA] última página (batch < take) — concluído');
      break;
    }
  }

  const count = await col.countDocuments();
  console.log(JSON.stringify({
    pass: PASS,
    upsertedBatch: upserted,
    stagingCount: count,
    totalItemsApi: totalItems,
    pagesProcessed: pagesDone,
  }, null, 2));
}

main()
  .catch(async (err) => {
    console.error('[passA] falhou:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectLegadoTickets().catch(() => undefined);
  });
