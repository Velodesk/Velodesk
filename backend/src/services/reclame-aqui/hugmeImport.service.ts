/**
 * hugmeImport.service v2.0.0 — sem coleção paralela (reclame_aqui_hugme_registros removida):
 * cada linha da planilha vira upsert direto em reclamacoes_reclameAqui, deduplicado por
 * idOrigem (enriquece o ticket existente em vez de duplicar). reclame_aqui_hugme_import_batches
 * segue só como log/auditoria do lote (contadores, erros, quem/quando importou).
 */
import { randomUUID } from 'crypto';
import type { HugmeOrigemImportacao } from '../../models/reclamacoes/ReclameAquiHugmeRegistro.schema';
import { getReclameAquiHugmeImportBatchModel } from '../../models/reclamacoes/hugmeModels';
import { getReclamacaoReclameAquiModel, type IReclamacao } from '../../models/reclamacoes/reclamacaoModels';
import { reclamacaoToPortalDto } from '../reclamacoes/reclamacao.service';
import {
  parseHugmeBuffer,
  type HugmeParseResult,
  type ParsedHugmeRow,
} from './hugmeSpreadsheet.service';
import {
  parsedRowToRaTicketSource,
  upsertRaTicketFromSource,
} from './reclameAquiTicketCreate.service';

export interface HugmeImportOptions {
  modo: HugmeOrigemImportacao;
  fileName?: string;
  importedBy?: string;
  batchId?: string;
}

export interface HugmeImportRowResult {
  rowIndex: number;
  idOrigem: string;
  action: 'inserted' | 'updated' | 'skipped' | 'failed';
  ticketCreated?: boolean;
  chamadoId?: string;
  errors?: string[];
}

export interface HugmeImportResult {
  batchId: string;
  parse: HugmeParseResult;
  stats: {
    total: number;
    inserted: number;
    updated: number;
    skipped: number;
    ticketsCreated: number;
    failed: number;
  };
  rows: HugmeImportRowResult[];
  errors: Array<{ rowIndex: number; idOrigem?: string; message: string }>;
}

export type HugmeImportStats = HugmeImportResult['stats'];

export interface HugmeImportStarted {
  batchId: string;
  parse: HugmeParseResult;
  stats: HugmeImportStats;
  rows: HugmeImportRowResult[];
  errors: HugmeImportResult['errors'];
  options: HugmeImportOptions;
  now: Date;
}

export interface HugmeImportBatchView {
  batchId: string;
  modo: HugmeOrigemImportacao;
  fileName: string;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  ticketsCreated: number;
  failed: number;
  processed: number;
  running: boolean;
  importedAt: Date;
  importedBy?: string;
  errors?: Array<{ rowIndex: number; idOrigem?: string; message: string }>;
}

let hugmeImportInProcess = false;

export function computeHugmeProcessed(stats: Pick<HugmeImportStats, 'inserted' | 'updated' | 'skipped' | 'failed'>): number {
  return stats.inserted + stats.updated + stats.skipped + stats.failed;
}

export function isHugmeBatchRunning(stats: Pick<HugmeImportStats, 'total' | 'inserted' | 'updated' | 'skipped' | 'failed'>): boolean {
  return computeHugmeProcessed(stats) < stats.total;
}

function mapHugmeBatch(
  batch: {
    batchId: string;
    modo: HugmeOrigemImportacao;
    fileName?: string;
    total?: number;
    inserted?: number;
    updated?: number;
    skipped?: number;
    ticketsCreated?: number;
    failed?: number;
    importedAt: Date;
    importedBy?: string;
    batchErrors?: Array<{ rowIndex: number; idOrigem?: string; message: string }>;
  },
  includeErrors = false,
): HugmeImportBatchView {
  const stats = {
    total: batch.total || 0,
    inserted: batch.inserted || 0,
    updated: batch.updated || 0,
    skipped: batch.skipped || 0,
    ticketsCreated: batch.ticketsCreated || 0,
    failed: batch.failed || 0,
  };
  const processed = computeHugmeProcessed(stats);
  return {
    batchId: batch.batchId,
    modo: batch.modo,
    fileName: batch.fileName || '',
    ...stats,
    processed,
    running: processed < stats.total,
    importedAt: batch.importedAt,
    importedBy: batch.importedBy,
    ...(includeErrors ? { errors: (batch.batchErrors || []).slice(0, 100) } : {}),
  };
}

async function persistHugmeBatchProgress(
  batchId: string,
  stats: HugmeImportStats,
  errors: HugmeImportResult['errors'],
): Promise<void> {
  await getReclameAquiHugmeImportBatchModel().updateOne(
    { batchId },
    {
      $set: {
        inserted: stats.inserted,
        updated: stats.updated,
        skipped: stats.skipped,
        ticketsCreated: stats.ticketsCreated,
        failed: stats.failed,
        batchErrors: errors.slice(0, 500),
      },
    },
  ).exec();
}

export async function beginHugmeImport(
  buffer: Buffer,
  options: HugmeImportOptions,
): Promise<HugmeImportStarted> {
  if (hugmeImportInProcess) {
    throw Object.assign(new Error('Já existe uma importação Hugme em andamento.'), { status: 409 });
  }
  hugmeImportInProcess = true;

  try {
    const batchId = options.batchId || randomUUID();
    const now = new Date();
    const parse = parseHugmeBuffer(buffer);
    const BatchModel = getReclameAquiHugmeImportBatchModel();

    const stats: HugmeImportStats = {
      total: parse.rows.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      ticketsCreated: 0,
      failed: 0,
    };
    const rows: HugmeImportRowResult[] = [];
    const errors: HugmeImportResult['errors'] = [];

    for (const row of parse.rows) {
      if (row.status === 'valid') continue;
      stats.skipped += 1;
      rows.push({
        rowIndex: row.rowIndex,
        idOrigem: row.idOrigem,
        action: 'skipped',
        errors: row.errors,
      });
      errors.push({
        rowIndex: row.rowIndex,
        idOrigem: row.idOrigem,
        message: row.errors.join('; ') || row.status,
      });
    }

    await BatchModel.create({
      batchId,
      modo: options.modo,
      fileName: options.fileName || '',
      total: stats.total,
      inserted: stats.inserted,
      updated: stats.updated,
      skipped: stats.skipped,
      ticketsCreated: stats.ticketsCreated,
      failed: stats.failed,
      batchErrors: errors.slice(0, 500),
      importedAt: now,
      importedBy: options.importedBy || '',
    });

    console.info('[hugme-import] início', {
      batchId,
      fileName: options.fileName || '',
      total: parse.rows.length,
      valid: parse.rows.length - stats.skipped,
    });

    return {
      batchId,
      parse,
      stats,
      rows,
      errors,
      options: { ...options, batchId },
      now,
    };
  } catch (err) {
    hugmeImportInProcess = false;
    throw err;
  }
}

export async function runHugmeImportLoop(started: HugmeImportStarted): Promise<HugmeImportResult> {
  const { batchId, parse, stats, rows, errors, now } = started;
  const options = started.options;
  const validRows = parse.rows.filter((row) => row.status === 'valid');
  const validTotal = validRows.length;
  let processedValid = 0;

  try {
    for (const row of validRows) {
      try {
        // Sem coleção paralela: upsertRaTicketFromSource já dedupe por idOrigem e
        // enriquece o documento existente em reclamacoes_reclameAqui em vez de duplicar.
        const ticketResult = await upsertRaTicketFromSource(
          parsedRowToRaTicketSource(row),
          options.importedBy || 'sistema',
          'hugme-import',
        );
        const action: 'inserted' | 'updated' = ticketResult.updated ? 'updated' : 'inserted';
        if (action === 'updated') stats.updated += 1;
        else stats.inserted += 1;

        let ticketCreated = false;
        if (!ticketResult.updated) {
          ticketCreated = true;
          stats.ticketsCreated += 1;
        }
        const chamadoId = ticketResult.chamadoId.toString();

        processedValid += 1;
        await persistHugmeBatchProgress(batchId, stats, errors).catch(() => undefined);
        if (processedValid === 1 || processedValid % 25 === 0 || processedValid === validTotal) {
          console.info('[hugme-import] progresso', {
            batchId,
            processed: processedValid,
            valid: validTotal,
            ticketsCreated: stats.ticketsCreated,
            failed: stats.failed,
          });
        }

        rows.push({
          rowIndex: row.rowIndex,
          idOrigem: row.idOrigem,
          action,
          ticketCreated,
          chamadoId,
        });
      } catch (err) {
        stats.failed += 1;
        processedValid += 1;
        const message = err instanceof Error ? err.message : 'Erro ao importar linha';
        rows.push({
          rowIndex: row.rowIndex,
          idOrigem: row.idOrigem,
          action: 'failed',
          errors: [message],
        });
        errors.push({ rowIndex: row.rowIndex, idOrigem: row.idOrigem, message });
        await persistHugmeBatchProgress(batchId, stats, errors).catch(() => undefined);
      }
    }

    await persistHugmeBatchProgress(batchId, stats, errors);
    console.info('[hugme-import] fim', { batchId, stats });
    return { batchId, parse, stats, rows, errors };
  } catch (err) {
    const remaining = Math.max(0, stats.total - computeHugmeProcessed(stats));
    if (remaining > 0) stats.failed += remaining;
    errors.push({
      rowIndex: 0,
      message: err instanceof Error ? err.message : 'Falha no lote Hugme',
    });
    await persistHugmeBatchProgress(batchId, stats, errors).catch(() => undefined);
    throw err;
  } finally {
    hugmeImportInProcess = false;
  }
}

export async function importHugmeBuffer(
  buffer: Buffer,
  options: HugmeImportOptions,
): Promise<HugmeImportResult> {
  const started = await beginHugmeImport(buffer, options);
  return runHugmeImportLoop(started);
}

export interface HugmeRegistroListFilters {
  semTicket?: boolean;
  limit?: number;
  skip?: number;
}

/**
 * Substitui a antiga coleção paralela reclame_aqui_hugme_registros: lista/consulta direto em
 * reclamacoes_reclameAqui (idOrigem é o mesmo campo, agora de primeira classe lá).
 */
export async function listHugmeRegistros(filters: HugmeRegistroListFilters = {}) {
  const Model = getReclamacaoReclameAquiModel();
  const query: Record<string, unknown> = {};
  if (filters.semTicket) {
    query.chamadoId = { $in: [null, undefined] };
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const skip = Math.max(filters.skip ?? 0, 0);

  const [items, total] = await Promise.all([
    Model.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).exec(),
    Model.countDocuments(query),
  ]);

  return {
    items: items.map((doc) => reclamacaoToPortalDto(doc as unknown as IReclamacao)),
    total,
  };
}

export async function getHugmeRegistroByIdOrigem(idOrigem: string) {
  const doc = await getReclamacaoReclameAquiModel()
    .findOne({ idOrigem: String(idOrigem).trim() })
    .exec();
  return doc ? reclamacaoToPortalDto(doc as unknown as IReclamacao) : null;
}

export async function getHugmeImportStats() {
  const Model = getReclamacaoReclameAquiModel();
  const BatchModel = getReclameAquiHugmeImportBatchModel();

  const [total, comTicket, semTicket, ultimoBatch] = await Promise.all([
    Model.countDocuments({}),
    Model.countDocuments({ chamadoId: { $ne: null } }),
    Model.countDocuments({ $or: [{ chamadoId: null }, { chamadoId: { $exists: false } }] }),
    BatchModel.findOne({}).sort({ importedAt: -1 }).exec(),
  ]);

  return {
    total,
    comTicket,
    semTicket,
    ultimoImport: ultimoBatch ? {
      batchId: ultimoBatch.batchId,
      modo: ultimoBatch.modo,
      fileName: ultimoBatch.fileName,
      importedAt: ultimoBatch.importedAt,
      inserted: ultimoBatch.inserted,
      updated: ultimoBatch.updated,
      ticketsCreated: ultimoBatch.ticketsCreated,
    } : null,
  };
}

export async function getHugmeImportBatch(batchId: string): Promise<HugmeImportBatchView | null> {
  const batch = await getReclameAquiHugmeImportBatchModel()
    .findOne({ batchId: String(batchId).trim() })
    .exec();
  return batch ? mapHugmeBatch(batch, true) : null;
}

export async function listHugmeImportBatches(limit = 50) {
  const items = await getReclameAquiHugmeImportBatchModel()
    .find({})
    .sort({ importedAt: -1 })
    .limit(Math.min(limit, 200))
    .exec();

  return items.map((batch) => mapHugmeBatch(batch, false));
}

