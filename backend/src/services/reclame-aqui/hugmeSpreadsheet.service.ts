/** hugmeSpreadsheet.service v1.2.0 — Id Origem = ID da reclamação */
import * as XLSX from 'xlsx';
import { parseBrCivilDateTimeToIso, parseBrCivilDateToDate } from '../dates/brDateTime.util';

export const HUGME_COLUMN_MAP: Record<string, string[]> = {
  consumidor: ['nome', 'consumidor', 'nome do consumidor', 'cliente'],
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
  dataReclamacao: ['data reclamacao', 'data reclamação', 'data da reclamacao', 'data da reclamação'],
  dataResposta: ['data de resposta', 'data da resposta'],
  // "Produto"/"Motivo" (sem sufixo "RA") são colunas exclusivas da base histórica — já vêm no
  // formato da tabulação própria do Desk (produto da árvore comum + motivo da lista do RA), pra
  // reidratar a classificação sem perder o histórico. "Produto RA"/"Motivo da Reclamação RA" são
  // a taxonomia bruta da plataforma Reclame Aqui, sem relação com a tabulação do Desk.
  produto: ['produto'],
  motivo: ['motivo'],
  produtoRa: ['produto ra', 'produto/servico', 'produto/serviço'],
  motivoRa: ['motivo da reclamacao ra', 'motivo da reclamação ra'],
  categoriaRa: ['categoria ra'],
  problemaRa: ['problema ra'],
  sentimentoRa: ['sentimento ra*', 'sentimento ra'],
  statusRaLabel: ['status ra'],
  statusHugme: ['status hugme'],
  origem: ['origem'],
  respostaPublica: ['resposta da empresa', 'resposta publica', 'resposta pública'],
  nota: ['nota'],
  cidade: ['cidade'],
  estado: ['estado'],
};

export type HugmeRowStatus = 'valid' | 'invalid' | 'duplicate';

export interface ParsedHugmeRow {
  rowIndex: number;
  idOrigem: string;
  status: HugmeRowStatus;
  errors: string[];
  colunasOriginais: Record<string, string>;
  cabecalhos: string[];
  consumidor: string;
  cpf: string;
  email: string;
  telefoneWhatsapp: string;
  assunto: string;
  descricao: string;
  idReclamacaoRa: string;
  protocoloRa: string;
  /** Coluna A (Origem) — canal por onde a reclamação chegou na plataforma RA. */
  canal?: string;
  /** Coluna "Nome social do consumidor" — hoje só usada como fallback de `consumidor` quando
   * "Nome" vem vazio, mas preservada separadamente aqui também (registro de primeira classe). */
  nomeSocial?: string;
  hugmeMotivoRa?: string;
  hugmeCategoriaRa?: string;
  hugmeProblemaRa?: string;
  hugmeSentimentoRa?: string;
  dataReclamacao?: string;
  dataResposta?: string;
  /** Produto/motivo já na formatação da tabulação própria do Desk (colunas "Produto"/"Motivo" —
   * só presentes na base histórica; a taxonomia bruta do RA fica em produtoRa/hugmeMotivoRa). */
  produto?: string;
  tipo?: string;
  motivo?: string;
  produtoRa?: string;
  nota?: string;
  statusRa?: string;
  statusRaLabel?: string;
  statusHugme?: string;
  respostaPublica?: string;
  cidade?: string;
  uf?: string;
}

export interface HugmeParseResult {
  rows: ParsedHugmeRow[];
  headerRowIndex: number;
  cabecalhos: string[];
  missingColumns: string[];
  stats: {
    total: number;
    valid: number;
    invalid: number;
    duplicate: number;
  };
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

function cellToString(value: unknown): string {
  if (value == null || value === '') return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) || Math.abs(value) >= 1e10) {
      return String(Math.trunc(value));
    }
  }
  return String(value).trim();
}

function cellToIdString(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return String(value).trim();
}

export function parseExcelDate(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const iso = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}T${String(parsed.H || 12).padStart(2, '0')}:${String(parsed.M || 0).padStart(2, '0')}:00-03:00`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  const str = String(value).trim();
  if (!str) return undefined;

  const brIso = parseBrCivilDateTimeToIso(str);
  if (brIso) return brIso;

  const brDateOnly = parseBrCivilDateToDate(str);
  if (brDateOnly) return brDateOnly.toISOString();

  if (/[zZ]$/.test(str) || /[+-]\d{2}:\d{2}$/.test(str)) {
    const iso = new Date(str);
    if (!Number.isNaN(iso.getTime())) return iso.toISOString();
  }

  return undefined;
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const normalized = headers.map((h) => normalizeHeader(h));
  const index: Record<string, number> = {};

  Object.entries(HUGME_COLUMN_MAP).forEach(([field, aliases]) => {
    const matchIdx = normalized.findIndex((h) => h && aliases.includes(h));
    if (matchIdx >= 0) index[field] = matchIdx;
  });

  return index;
}

export function detectHugmeHeaderRow(matrix: unknown[][], scanLimit = 25): number {
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

function isMetadataRow(row: unknown[]): boolean {
  const first = cellToString(row[0]).toLowerCase();
  return first === 'base completa' || first === 'origem';
}

function isEmptyRow(row: unknown[]): boolean {
  return !row.some((cell) => cellToString(cell));
}

function isDataRow(row: unknown[], headerIndex: Record<string, number>): boolean {
  if (isEmptyRow(row) || isMetadataRow(row)) return false;
  const idOrigem = headerIndex.idOrigem != null ? cellToIdString(row[headerIndex.idOrigem]) : '';
  const nome = headerIndex.consumidor != null ? cellToString(row[headerIndex.consumidor]) : '';
  return Boolean(idOrigem || nome);
}

function getFieldFromRow(row: unknown[], headerIndex: Record<string, number>, field: string): string {
  const idx = headerIndex[field];
  if (idx == null) return '';
  return cellToString(row[idx]);
}

function getIdFromRow(row: unknown[], headerIndex: Record<string, number>, field: string): string {
  const idx = headerIndex[field];
  if (idx == null) return '';
  return cellToIdString(row[idx]);
}

/** Colunas descartadas por decisão de negócio — nunca gravadas, nem no bag de colunas cruas. */
const DISCARDED_COLUMN_HEADERS = new Set(['id hugme']);

export function buildColunasOriginais(headers: string[], row: unknown[]): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((header, idx) => {
    const label = String(header ?? '').trim();
    if (!label) return;
    if (DISCARDED_COLUMN_HEADERS.has(normalizeHeader(label))) return;
    const value = cellToString(row[idx]);
    if (value !== '') result[label] = value;
  });
  return result;
}

function buildHugmeTaxonomia(row: unknown[], headerIndex: Record<string, number>) {
  return {
    hugmeMotivoRa: getFieldFromRow(row, headerIndex, 'motivoRa') || undefined,
    hugmeCategoriaRa: getFieldFromRow(row, headerIndex, 'categoriaRa') || undefined,
    hugmeProblemaRa: getFieldFromRow(row, headerIndex, 'problemaRa') || undefined,
    hugmeSentimentoRa: getFieldFromRow(row, headerIndex, 'sentimentoRa') || undefined,
  };
}

function buildDescricao(row: unknown[], headerIndex: Record<string, number>): string {
  const texto = getFieldFromRow(row, headerIndex, 'descricao');
  const consideracao = getFieldFromRow(row, headerIndex, 'consideracaoConsumidor');
  if (!consideracao) return texto;
  if (!texto) return consideracao;
  return `${texto}\n\nConsideração do consumidor:\n${consideracao}`;
}

function mapStatusRaFromHugme(label: string): string | undefined {
  const value = normalizeHeader(label);
  if (!value) return undefined;
  if (value.includes('replica') || value.includes('nao respond') || value.includes('não respond')) {
    return 'nao-respondida';
  }
  if (value === 'respondido') return 'respondida';
  if (value.includes('avaliado')) return 'aguard-avaliacao';
  return undefined;
}

/**
 * Status do TICKET (chamado.status) a partir da coluna "Status Hugme" — só "Novo" mantém o
 * ticket aberto; qualquer outro valor (Fechado/Respondido/Pendente/etc.) é histórico já
 * encerrado na plataforma RA e deve nascer resolvido, sem entupir as filas operacionais.
 */
export function mapTicketStatusFromHugme(statusHugmeLabel: string): 'novo' | 'resolvido' {
  return normalizeHeader(statusHugmeLabel) === 'novo' ? 'novo' : 'resolvido';
}

function mapRowToParsed(
  row: unknown[],
  headerIndex: Record<string, number>,
  cabecalhos: string[],
  rowIndex: number,
): ParsedHugmeRow {
  const colunasOriginais = buildColunasOriginais(cabecalhos, row);
  const consumidor = getFieldFromRow(row, headerIndex, 'consumidor')
    || getFieldFromRow(row, headerIndex, 'nomeSocial');
  const assunto = getFieldFromRow(row, headerIndex, 'assunto');
  const descricao = buildDescricao(row, headerIndex);
  const idOrigem = getIdFromRow(row, headerIndex, 'idOrigem');
  const statusRaLabel = getFieldFromRow(row, headerIndex, 'statusRaLabel');
  const taxonomia = buildHugmeTaxonomia(row, headerIndex);

  return {
    rowIndex,
    idOrigem: idOrigem.trim(),
    status: 'valid',
    errors: [],
    colunasOriginais,
    cabecalhos,
    consumidor,
    cpf: normalizeCpf(getFieldFromRow(row, headerIndex, 'cpf')),
    email: getFieldFromRow(row, headerIndex, 'email'),
    telefoneWhatsapp: getFieldFromRow(row, headerIndex, 'telefoneWhatsapp'),
    assunto,
    descricao: descricao || assunto,
    idReclamacaoRa: idOrigem,
    protocoloRa: idOrigem,
    nomeSocial: getFieldFromRow(row, headerIndex, 'nomeSocial') || undefined,
    // Coluna A (Origem) — canal de entrada da reclamação na plataforma RA (ex.: "ReclameAQUI",
    // Twitter, Facebook) — não é o "tipo" (Reclamação/Dúvida/etc.) da classificação do CRM.
    canal: getFieldFromRow(row, headerIndex, 'origem') || undefined,
    hugmeMotivoRa: taxonomia.hugmeMotivoRa,
    hugmeCategoriaRa: taxonomia.hugmeCategoriaRa,
    hugmeProblemaRa: taxonomia.hugmeProblemaRa,
    hugmeSentimentoRa: taxonomia.hugmeSentimentoRa,
    dataReclamacao: parseExcelDate(
      headerIndex.dataReclamacao != null ? row[headerIndex.dataReclamacao] : '',
    ),
    dataResposta: parseExcelDate(
      headerIndex.dataResposta != null ? row[headerIndex.dataResposta] : '',
    ),
    produto: getFieldFromRow(row, headerIndex, 'produto') || undefined,
    tipo: undefined,
    motivo: getFieldFromRow(row, headerIndex, 'motivo') || undefined,
    produtoRa: getFieldFromRow(row, headerIndex, 'produtoRa') || undefined,
    nota: getFieldFromRow(row, headerIndex, 'nota') || undefined,
    statusRa: mapStatusRaFromHugme(statusRaLabel),
    statusRaLabel: statusRaLabel || undefined,
    statusHugme: getFieldFromRow(row, headerIndex, 'statusHugme') || undefined,
    respostaPublica: getFieldFromRow(row, headerIndex, 'respostaPublica') || undefined,
    cidade: getFieldFromRow(row, headerIndex, 'cidade') || undefined,
    uf: getFieldFromRow(row, headerIndex, 'estado') || undefined,
  };
}

function validateParsedRow(row: ParsedHugmeRow, seenIdOrigem: Set<string>): ParsedHugmeRow {
  const errors: string[] = [];

  if (!row.idOrigem) errors.push('Id Origem obrigatório');
  if (!row.consumidor?.trim()) errors.push('Consumidor obrigatório');
  if (!row.assunto?.trim() && !row.descricao?.trim()) {
    errors.push('Assunto ou descrição obrigatório');
  }

  const idKey = row.idOrigem.trim().toLowerCase();
  if (idKey && seenIdOrigem.has(idKey)) {
    return { ...row, status: 'duplicate', errors: ['Id Origem duplicado no arquivo'] };
  }
  if (idKey) seenIdOrigem.add(idKey);

  if (errors.length) {
    return { ...row, status: 'invalid', errors };
  }

  return { ...row, status: 'valid', errors: [] };
}

export function prepareHugmeImport(
  rawRows: unknown[][],
  headers: string[],
  { headerRowIndex = 0 }: { headerRowIndex?: number } = {},
): HugmeParseResult {
  const cabecalhos = headers.map((h) => cellToString(h)).filter(Boolean);
  const headerIndex = buildHeaderIndex(headers);
  const dataRows = rawRows.filter((row) => isDataRow(row, headerIndex));
  const seenIdOrigem = new Set<string>();
  const missingColumns: string[] = [];

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
    const parsed = mapRowToParsed(row, headerIndex, cabecalhos, headerRowIndex + index + 2);
    return validateParsedRow(parsed, seenIdOrigem);
  });

  return {
    rows,
    headerRowIndex,
    cabecalhos,
    missingColumns,
    stats: {
      total: rows.length,
      valid: rows.filter((r) => r.status === 'valid').length,
      invalid: rows.filter((r) => r.status === 'invalid').length,
      duplicate: rows.filter((r) => r.status === 'duplicate').length,
    },
  };
}

export function parseHugmeBuffer(buffer: Buffer): HugmeParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Planilha vazia.');

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
  if (!matrix.length) throw new Error('Nenhuma linha encontrada na planilha.');

  const headerRowIndex = detectHugmeHeaderRow(matrix);
  const headers = (matrix[headerRowIndex] || []).map((h) => cellToString(h));
  const rawRows = matrix.slice(headerRowIndex + 1);

  return prepareHugmeImport(rawRows, headers, { headerRowIndex });
}
