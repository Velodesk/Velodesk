/**
 * hugmeImportService v1.2.0 — import assíncrono com poll do lote
 */
import * as XLSX from 'xlsx';
import { reclameAquiHugmeApi } from '../../api/client';

/** Aliases de colunas — export Hugme "Base Completa" (Relatório de Tickets) */
export const HUGME_COLUMN_MAP = {
  consumidor: [
    'nome',
    'consumidor',
    'nome do consumidor',
    'cliente',
  ],
  nomeSocial: ['nome social do consumidor'],
  cpf: ['cpf/cnpj', 'cpf', 'cpf cnpj', 'documento'],
  email: ['email', 'e-mail'],
  telefoneWhatsapp: ['telefones', 'telefone', 'celular', 'whatsapp'],
  assunto: ['titulo', 'título', 'assunto'],
  descricao: ['texto da reclamacao', 'texto da reclamação', 'descricao', 'descrição'],
  consideracaoConsumidor: ['consideracao consumidor', 'consideração consumidor'],
  idOrigem: [
    'id origem',
    'id da origem',
    'de origem',
    'id da reclamacao',
    'id reclamacao',
    'id da reclamação',
  ],
  idHugme: ['id hugme'],
  dataReclamacao: ['data reclamacao', 'data reclamação', 'data da reclamacao', 'data da reclamação'],
  dataResposta: ['data de resposta', 'data da resposta'],
  produto: ['produto ra', 'produto', 'produto/servico', 'produto/serviço'],
  motivoRa: ['motivo da reclamacao ra', 'motivo da reclamação ra'],
  categoriaRa: ['categoria ra'],
  problemaRa: ['problema ra'],
  statusRaLabel: ['status ra'],
  statusHugme: ['status hugme'],
  origem: ['origem'],
  respostaPublica: ['resposta da empresa', 'resposta publica', 'resposta pública'],
  nota: ['nota'],
  cidade: ['cidade'],
  estado: ['estado'],
};

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

function cellToString(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) || Math.abs(value) >= 1e10) {
      return String(Math.trunc(value));
    }
  }
  return String(value).trim();
}

function cellToIdString(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value).trim();
}

function parseExcelDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0));
      return d.toISOString();
    }
  }
  const str = String(value).trim();
  if (!str) return null;

  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (brMatch) {
    const day = parseInt(brMatch[1], 10);
    const month = parseInt(brMatch[2], 10) - 1;
    let year = parseInt(brMatch[3], 10);
    if (year < 100) year += 2000;
    const hour = brMatch[4] ? parseInt(brMatch[4], 10) : 12;
    const minute = brMatch[5] ? parseInt(brMatch[5], 10) : 0;
    const d = new Date(year, month, day, hour, minute);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const iso = new Date(str);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  return null;
}

function buildHeaderIndex(headers) {
  const normalized = headers.map((h) => normalizeHeader(h));
  const index = {};

  Object.entries(HUGME_COLUMN_MAP).forEach(([field, aliases]) => {
    const matchIdx = normalized.findIndex((h) => h && aliases.includes(h));
    if (matchIdx >= 0) index[field] = matchIdx;
  });

  return index;
}

/** Planilhas Hugme incluem linhas de título ("Base Completa") antes do cabeçalho real. */
export function detectHugmeHeaderRow(matrix, scanLimit = 25) {
  for (let i = 0; i < Math.min(scanLimit, matrix.length); i += 1) {
    const normalized = (matrix[i] || []).map((h) => normalizeHeader(h));
    const hasNome = normalized.includes('nome');
    const hasCpf = normalized.includes('cpf/cnpj');
    const hasIdHugme = normalized.includes('id hugme');
    const hasIdOrigem = normalized.includes('id origem') || normalized.includes('id da origem');
    const hasTitulo = normalized.includes('titulo') || normalized.includes('título');
    if (hasNome && hasCpf && (hasIdHugme || hasIdOrigem || hasTitulo)) {
      return i;
    }
  }
  return 0;
}

function isMetadataRow(row) {
  const first = cellToString(row[0]).toLowerCase();
  if (first === 'base completa') return true;
  if (first === 'origem') return true;
  return false;
}

function isDataRow(row, headerIndex) {
  if (isEmptyRow(row) || isMetadataRow(row)) return false;
  const idOrigem = headerIndex.idOrigem != null ? cellToIdString(row[headerIndex.idOrigem]) : '';
  const idHugme = headerIndex.idHugme != null ? cellToIdString(row[headerIndex.idHugme]) : '';
  const nome = headerIndex.consumidor != null ? cellToString(row[headerIndex.consumidor]) : '';
  return Boolean(idOrigem || idHugme || nome);
}

function buildDescricao(row, headerIndex) {
  // "Consideração Consumidor" não entra mais na descrição — vira mensagem própria no chat do
  // ticket (ver backend hugmeSpreadsheet.service). Este preview só reflete o backend.
  return getFieldFromRow(row, headerIndex, 'descricao');
}

function mapStatusRaFromHugme(label) {
  const value = normalizeHeader(label);
  if (!value) return undefined;
  if (value.includes('replica') || value.includes('nao respond') || value.includes('não respond')) {
    return 'nao-respondida';
  }
  if (value === 'respondido') return 'respondida';
  if (value.includes('avaliado')) return 'aguard-avaliacao';
  return undefined;
}

function getFieldFromRow(row, headerIndex, field) {
  const idx = headerIndex[field];
  if (idx == null) return '';
  return cellToString(row[idx]);
}

function getIdFromRow(row, headerIndex, field) {
  const idx = headerIndex[field];
  if (idx == null) return '';
  return cellToIdString(row[idx]);
}

export function mapRowToReclamacao(row, headerIndex, rowIndex) {
  const consumidor = getFieldFromRow(row, headerIndex, 'consumidor')
    || getFieldFromRow(row, headerIndex, 'nomeSocial');
  const assunto = getFieldFromRow(row, headerIndex, 'assunto');
  const descricao = buildDescricao(row, headerIndex);
  const idHugme = getIdFromRow(row, headerIndex, 'idHugme');
  const idOrigem = getIdFromRow(row, headerIndex, 'idOrigem');
  const cpfRaw = getFieldFromRow(row, headerIndex, 'cpf');
  const dataReclamacao = parseExcelDate(
    headerIndex.dataReclamacao != null ? row[headerIndex.dataReclamacao] : '',
  );
  const statusRaLabel = getFieldFromRow(row, headerIndex, 'statusRaLabel');
  const statusRa = mapStatusRaFromHugme(statusRaLabel);

  return {
    id: `ra-hugme-row-${rowIndex}`,
    consumidor,
    cpf: normalizeCpf(cpfRaw),
    email: getFieldFromRow(row, headerIndex, 'email'),
    telefoneWhatsapp: getFieldFromRow(row, headerIndex, 'telefoneWhatsapp'),
    assunto,
    descricao: descricao || assunto,
    idReclamacaoRa: idOrigem,
    protocoloRa: idOrigem,
    dataReclamacao: dataReclamacao || undefined,
    produto: getFieldFromRow(row, headerIndex, 'produto') || undefined,
    tipo: undefined,
    motivo: '',
    respostaPublica: getFieldFromRow(row, headerIndex, 'respostaPublica') || undefined,
    statusRa,
    passivelNota: false,
    hugmeMeta: {
      idOrigem: idOrigem || undefined,
      idHugme: idHugme || undefined,
      hugmeMotivoRa: getFieldFromRow(row, headerIndex, 'motivoRa') || undefined,
      hugmeCategoriaRa: getFieldFromRow(row, headerIndex, 'categoriaRa') || undefined,
      hugmeProblemaRa: getFieldFromRow(row, headerIndex, 'problemaRa') || undefined,
      statusHugme: getFieldFromRow(row, headerIndex, 'statusHugme') || undefined,
      statusRaLabel: statusRaLabel || undefined,
      nota: getFieldFromRow(row, headerIndex, 'nota') || undefined,
      cidade: getFieldFromRow(row, headerIndex, 'cidade') || undefined,
      estado: getFieldFromRow(row, headerIndex, 'estado') || undefined,
    },
  };
}

function isEmptyRow(row) {
  return !row.some((cell) => cellToString(cell));
}

export function validateHugmeRow(form, seenIdOrigem) {
  const errors = [];
  const idOrigem = String(form.idReclamacaoRa || form.hugmeMeta?.idOrigem || '').trim();

  if (!idOrigem) errors.push('Id Origem obrigatório');
  if (!form.consumidor?.trim()) errors.push('Consumidor obrigatório');
  if (!form.assunto?.trim() && !form.descricao?.trim()) {
    errors.push('Assunto ou descrição obrigatório');
  }

  const idKey = idOrigem.toLowerCase();
  if (idKey && seenIdOrigem.has(idKey)) {
    return { status: 'duplicate', errors: ['Id Origem duplicado no arquivo'], form };
  }
  if (idKey) seenIdOrigem.add(idKey);

  if (errors.length) {
    return { status: 'invalid', errors, form };
  }

  return { status: 'valid', errors: [], form };
}

export function prepareHugmeImport(rawRows, headers, { headerRowIndex = 0 } = {}) {
  const headerIndex = buildHeaderIndex(headers);
  const dataRows = rawRows.filter((row) => isDataRow(row, headerIndex));
  const seenIdOrigem = new Set();
  const missingColumns = [];

  if (headerIndex.idOrigem == null) {
    missingColumns.push('Id Origem');
  }
  if (headerIndex.consumidor == null && headerIndex.nomeSocial == null) {
    missingColumns.push('Nome');
  }
  if (headerIndex.assunto == null && headerIndex.descricao == null) {
    missingColumns.push('Título/Texto da Reclamação');
  }

  const rows = dataRows.map((row, index) => {
    const form = mapRowToReclamacao(row, headerIndex, headerRowIndex + index + 2);
    const result = validateHugmeRow(form, seenIdOrigem);
    return {
      rowIndex: headerRowIndex + index + 2,
      form: result.form,
      status: result.status,
      errors: result.errors,
    };
  });

  return {
    rows,
    headerIndex,
    headerRowIndex,
    missingColumns,
    stats: {
      total: rows.length,
      valid: rows.filter((r) => r.status === 'valid').length,
      invalid: rows.filter((r) => r.status === 'invalid').length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
    },
  };
}

export async function parseHugmeFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const ext = ACCEPTED_EXTENSIONS.find((e) => name.endsWith(e));
  const mime = String(file?.type || '').toLowerCase();
  const mimeOk = mime.includes('spreadsheet')
    || mime.includes('excel')
    || mime === 'text/csv'
    || mime === 'application/vnd.ms-excel';
  if (!ext && !mimeOk) {
    throw new Error('Formato não suportado. Use .xlsx, .xls ou .csv.');
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Planilha vazia.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  if (!matrix.length) throw new Error('Nenhuma linha encontrada na planilha.');

  const headerRowIndex = detectHugmeHeaderRow(matrix);
  const headers = (matrix[headerRowIndex] || []).map((h) => cellToString(h));
  const rawRows = matrix.slice(headerRowIndex + 1);

  return prepareHugmeImport(rawRows, headers, { headerRowIndex });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function importHugmeFileViaApi(file, modo = 'incremental') {
  const result = await reclameAquiHugmeApi.import(file, modo);
  return mapHugmeImportStart(result);
}

const HUGME_JOB_STORAGE_KEY = 'velodesk_hugme_import_batch';
const HUGME_POLL_MS = 800;

let activeHugmeJob = null;
let hugmePollTimer = null;
const hugmeJobListeners = new Set();
const notifiedHugmeBatches = new Set();

function emitHugmeJob() {
  const snapshot = getActiveHugmeImportJob();
  hugmeJobListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // listener fail-soft
    }
  });
}

function persistHugmeJobId(batchId) {
  try {
    if (batchId) sessionStorage.setItem(HUGME_JOB_STORAGE_KEY, batchId);
    else sessionStorage.removeItem(HUGME_JOB_STORAGE_KEY);
  } catch {
    // sessionStorage indisponível
  }
}

function readStoredHugmeJobId() {
  try {
    return sessionStorage.getItem(HUGME_JOB_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function mapHugmeImportStart(result) {
  const stats = result?.stats || {};
  const skipped = stats.skipped ?? 0;
  const total = Math.max(0, (stats.total ?? 0) - skipped);
  const current = (stats.inserted ?? 0) + (stats.updated ?? 0) + (stats.failed ?? 0);
  return {
    batchId: result.batchId,
    modo: result.modo,
    created: stats.ticketsCreated ?? 0,
    stored: (stats.inserted ?? 0) + (stats.updated ?? 0),
    inserted: stats.inserted ?? 0,
    updated: stats.updated ?? 0,
    skipped,
    failed: stats.failed ?? 0,
    stats,
    errors: result.errors || [],
    running: result.running === true,
    current,
    total,
  };
}

function mapHugmeBatchToJob(batch, previous = {}) {
  const skipped = batch?.skipped ?? previous.skipped ?? 0;
  const validTotal = Math.max(0, (batch?.total ?? previous.totalRaw ?? 0) - skipped);
  const current = (batch?.inserted ?? 0) + (batch?.updated ?? 0) + (batch?.failed ?? 0);
  const running = batch?.running === true;
  return {
    ...previous,
    batchId: batch?.batchId || previous.batchId,
    created: batch?.ticketsCreated ?? 0,
    stored: (batch?.inserted ?? 0) + (batch?.updated ?? 0),
    inserted: batch?.inserted ?? 0,
    updated: batch?.updated ?? 0,
    skipped,
    failed: batch?.failed ?? 0,
    errors: batch?.errors || previous.errors || [],
    running,
    current,
    total: validTotal || previous.total || 0,
    totalRaw: batch?.total ?? previous.totalRaw ?? 0,
    done: !running,
  };
}

function stopHugmePoll() {
  if (hugmePollTimer) {
    clearInterval(hugmePollTimer);
    hugmePollTimer = null;
  }
}

function finishHugmeJob(job) {
  stopHugmePoll();
  persistHugmeJobId('');
  activeHugmeJob = { ...job, running: false, done: true };
  if (job?.batchId && !notifiedHugmeBatches.has(job.batchId)) {
    notifiedHugmeBatches.add(job.batchId);
    activeHugmeJob.justFinished = true;
    try {
      window.dispatchEvent(new CustomEvent('velodesk:ra-sync'));
    } catch {
      // window indisponível
    }
  }
  emitHugmeJob();
  if (activeHugmeJob) activeHugmeJob.justFinished = false;
}

async function pollHugmeJobOnce() {
  if (!activeHugmeJob?.batchId) return;
  try {
    const batch = await reclameAquiHugmeApi.getBatch(activeHugmeJob.batchId);
    activeHugmeJob = mapHugmeBatchToJob(batch, activeHugmeJob);
    emitHugmeJob();
    if (!activeHugmeJob.running) finishHugmeJob(activeHugmeJob);
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) {
      finishHugmeJob({ ...activeHugmeJob, running: false, done: true, failed: activeHugmeJob.failed || 1 });
    }
  }
}

function startHugmePoll() {
  stopHugmePoll();
  hugmePollTimer = setInterval(() => {
    pollHugmeJobOnce();
  }, HUGME_POLL_MS);
  void pollHugmeJobOnce();
}

export function getActiveHugmeImportJob() {
  return activeHugmeJob;
}

export function subscribeHugmeImportJob(listener) {
  hugmeJobListeners.add(listener);
  if (activeHugmeJob) listener(activeHugmeJob);
  return () => hugmeJobListeners.delete(listener);
}

export function resumeHugmeImportJobIfAny() {
  if (activeHugmeJob?.running && hugmePollTimer) return activeHugmeJob;
  const batchId = activeHugmeJob?.batchId || readStoredHugmeJobId();
  if (!batchId) return null;
  if (!activeHugmeJob) {
    activeHugmeJob = {
      batchId,
      running: true,
      done: false,
      current: 0,
      total: 0,
      created: 0,
      stored: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
  }
  persistHugmeJobId(batchId);
  startHugmePoll();
  return activeHugmeJob;
}

export async function startHugmeImportJob(file, modo = 'incremental') {
  if (activeHugmeJob?.running) {
    throw new Error('Já existe uma importação em andamento.');
  }
  const started = mapHugmeImportStart(await reclameAquiHugmeApi.import(file, modo));
  activeHugmeJob = {
    ...started,
    done: !started.running,
    justFinished: false,
  };
  persistHugmeJobId(started.batchId);
  emitHugmeJob();
  if (!started.running) {
    finishHugmeJob(activeHugmeJob);
    return activeHugmeJob;
  }
  startHugmePoll();
  return activeHugmeJob;
}

/** @deprecated use importHugmeFileViaApi — importação local linha a linha */
export async function importHugmeRows(validRows, { onProgress, throttleMs = 200 } = {}) {
  const { registerReclamacaoAndCreateTicket } = await import('./reclameAquiTicketService');
  const result = {
    created: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const toImport = validRows.filter((r) => r.status === 'valid');
  result.skipped = validRows.length - toImport.length;

  for (let i = 0; i < toImport.length; i += 1) {
    const row = toImport[i];
    onProgress?.({ current: i + 1, total: toImport.length, row });

    try {
      const created = await registerReclamacaoAndCreateTicket({
        ...row.form,
        id: row.form.id || `ra-hugme-${row.rowIndex}-${Date.now()}`,
      });
      result.created += 1;
      result.details.push({
        rowIndex: row.rowIndex,
        status: 'created',
        ticketId: created.ticketId,
        consumidor: row.form.consumidor,
      });
    } catch (err) {
      result.failed += 1;
      result.details.push({
        rowIndex: row.rowIndex,
        status: 'failed',
        consumidor: row.form.consumidor,
        error: err?.message || 'Erro ao criar ticket',
      });
    }

    if (i < toImport.length - 1 && throttleMs > 0) {
      await delay(throttleMs);
    }
  }

  return result;
}

export function buildErrorReportCsv(failedRows) {
  const header = 'Linha;Consumidor;Status;Erro\n';
  const lines = failedRows.map((r) =>
    [r.rowIndex, r.consumidor || r.form?.consumidor || '', r.status, (r.errors || [r.error]).join(' | ')]
      .map((v) => `"${String(v || '').replace(/"/g, '""')}"`)
      .join(';'),
  );
  return header + lines.join('\n');
}

export function downloadErrorReport(failedRows, filename = 'hugme-import-erros.csv') {
  const csv = buildErrorReportCsv(failedRows);
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const HUGME_ACCEPT = '.xlsx,.xls,.csv';
