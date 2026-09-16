/** parseConsumidorGovEmail v1.1.0 — datas BR com offset -03:00 explícito */
import type { InboundEmailPayload } from './types';
import { parseBrSlashDateToIso } from '../dates/brDateTime.util';

export const CGOV_PRIORITY_SUBJECT_PATTERN = /PRIORIZAR\s*-\s*CGOV/i;

/** Protocolo Consumidor.gov no assunto, ex.: "CGOV - 2026.07/00015790834". */
export const CGOV_SUBJECT_PROTOCOL_PATTERN = /CGOV\s*-\s*([\d]{4}\.\d{2}\/\d+)/i;

/** Prazo de resposta no assunto, ex.: "Prazo: 10/08" (sem ano — inferido na extração). */
export const CGOV_SUBJECT_PRAZO_PATTERN = /Prazo\s*:\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i;

export interface ParsedCgovInboundEmail {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  cidade: string;
  uf: string;
  protocolo: string;
  area: string;
  assunto: string;
  problema: string;
  situacao: string;
  dataAberturaIso?: string;
  prazoIso?: string;
  protocoloEmpresa: string;
  descricao: string;
  isValid(): boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

function normalizeTelefone(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

function parseLocalidade(value: string): { cidade: string; uf: string } {
  const raw = String(value ?? '').trim();
  if (!raw) return { cidade: '', uf: '' };
  const parts = raw.split(/\s*-\s*/);
  if (parts.length >= 2) {
    const uf = parts[parts.length - 1].trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(uf)) {
      return {
        cidade: parts.slice(0, -1).join(' - ').trim(),
        uf,
      };
    }
  }
  return { cidade: raw, uf: '' };
}

function parseBrDate(value: string, endOfDay = false): string | undefined {
  return parseBrSlashDateToIso(value, endOfDay);
}

/** Número do protocolo Consumidor.gov quando ele vem no assunto do e-mail (ex.: "CGOV - 2026.07/00015790834"). */
export function extractCgovProtocoloFromSubject(subject: string): string {
  const match = String(subject ?? '').match(CGOV_SUBJECT_PROTOCOL_PATTERN);
  return match?.[1]?.trim() || '';
}

/**
 * "Prazo: 10/08" no assunto não traz ano — infere a partir da data de recebimento do e-mail e
 * avança pro ano seguinte se a data cair mais de ~30 dias no passado (evita, por ex., um e-mail
 * recebido em janeiro com "Prazo: 10/12" apontar de volta pro dezembro do ano anterior).
 */
export function extractCgovPrazoIsoFromSubject(subject: string, referenceDate: Date = new Date()): string | undefined {
  const match = String(subject ?? '').match(CGOV_SUBJECT_PRAZO_PATTERN);
  if (!match) return undefined;

  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3]
    ? Number(match[3].length === 2 ? `20${match[3]}` : match[3])
    : referenceDate.getFullYear();

  if (!match[3]) {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    const diffDays = (candidate.getTime() - referenceDate.getTime()) / 86400000;
    if (diffDays < -30) year += 1;
  }

  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  return parseBrDate(`${dd}/${mm}/${year}`, true);
}

function extractField(text: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = escapeRegex(label);
    const patterns = [
      new RegExp(`^\\s*#{0,6}\\s*${escaped}\\s*[:\\t]\\s*(.+)$`, 'im'),
      new RegExp(`^\\s*#{0,6}\\s*${escaped}\\s+(.+)$`, 'im'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }
  return '';
}

/**
 * Cabeçalho de seção tolerante a variações reais de template: prefixo markdown ("## "),
 * maiúsculas/minúsculas (repasses de parceiro, ex. Ouvidoria Celcoin, não seguem o
 * padrão oficial do órgão) e dois-pontos opcional no fim da linha.
 */
function sectionHeaderPattern(header: string): RegExp {
  return new RegExp(`^\\s*#{0,6}\\s*${escapeRegex(header)}\\s*:?\\s*$`, 'im');
}

function extractSection(text: string, header: string, nextHeaders: string[]): string {
  const startPattern = sectionHeaderPattern(header);
  const startMatch = text.match(startPattern);
  if (!startMatch || startMatch.index == null) return '';

  const start = startMatch.index + startMatch[0].length;
  let end = text.length;
  for (const next of nextHeaders) {
    const nextPattern = sectionHeaderPattern(next);
    const nextMatch = text.slice(start).match(nextPattern);
    if (nextMatch?.index != null) {
      end = Math.min(end, start + nextMatch.index);
    }
  }
  return text.slice(start, end).trim();
}

function extractDescricao(text: string): string {
  const block = extractSection(text, 'Descrição da Reclamação', []);
  if (!block) return '';

  const lines = block.split(/\r?\n/);
  const cleaned: string[] = [];
  let skippedHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!skippedHeader && /^descri[cç][aã]o$/i.test(trimmed)) {
      skippedHeader = true;
      continue;
    }
    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

function hasCgovBodyStructure(text: string): boolean {
  const body = String(text ?? '').toLowerCase();
  return body.includes('dados do reclamante') && body.includes('dados da reclama');
}

export function isCgovPrioritySubject(subject: string): boolean {
  return CGOV_PRIORITY_SUBJECT_PATTERN.test(String(subject ?? '').trim());
}

export function isCgovStructuredInboundEmail(
  payload: InboundEmailPayload,
  bodyText?: string,
): boolean {
  if (isCgovPrioritySubject(payload.subject)) return true;
  if (extractCgovProtocoloFromSubject(payload.subject)) return true;
  const body = bodyText ?? payload.textBody ?? '';
  return hasCgovBodyStructure(body);
}

export function parseConsumidorGovInboundEmail(bodyText: string, subject?: string): ParsedCgovInboundEmail {
  const text = String(bodyText ?? '').replace(/\r\n/g, '\n');

  const reclamanteSection = extractSection(text, 'Dados do Reclamante', [
    'Dados da Reclamação',
    'Descrição da Reclamação',
  ]);
  const reclamacaoSection = extractSection(text, 'Dados da Reclamação', [
    'Descrição da Reclamação',
  ]);

  const nome = extractField(reclamanteSection, ['Nome']);
  const cpf = normalizeCpf(extractField(reclamanteSection, ['CPF']));
  const email = extractField(reclamanteSection, ['E-mail', 'Email']);
  const telefone = normalizeTelefone(extractField(reclamanteSection, ['Telefone']));
  const localidade = parseLocalidade(extractField(reclamanteSection, ['Localidade']));

  const protocoloBody = extractField(reclamacaoSection, ['Protocolo']).replace(/^#+/, '').trim();
  const area = extractField(reclamacaoSection, ['Área', 'Area']);
  const assunto = extractField(reclamacaoSection, ['Assunto']);
  const problema = extractField(reclamacaoSection, ['Problema']);
  const situacao = extractField(reclamacaoSection, ['Situação', 'Situacao']);
  const aberturaRaw = extractField(reclamacaoSection, ['Abertura']);
  const prazoRaw = extractField(reclamacaoSection, ['Prazo']);
  const protocoloEmpresa = extractField(reclamacaoSection, ['Protocolo da empresa']);
  const descricao = extractDescricao(text);

  const dataAberturaIso = parseBrDate(aberturaRaw, false);
  // O assunto é a fonte confiável de protocolo/prazo (ex.: "CGOV - 2026.07/00015790834" e
  // "Prazo: 10/08") — prevalece sobre o que vier rotulado no corpo do e-mail.
  const protocolo = extractCgovProtocoloFromSubject(subject || '') || protocoloBody;
  const prazoIso = extractCgovPrazoIsoFromSubject(subject || '') ?? parseBrDate(prazoRaw, true);

  const parsed: ParsedCgovInboundEmail = {
    nome,
    cpf,
    email,
    telefone,
    cidade: localidade.cidade,
    uf: localidade.uf,
    protocolo,
    area,
    assunto,
    problema,
    situacao,
    dataAberturaIso,
    prazoIso,
    protocoloEmpresa,
    descricao,
    isValid() {
      return Boolean(
        parsed.nome
        && parsed.cpf.length === 11
        && parsed.protocolo
        && parsed.assunto
        && parsed.descricao,
      );
    },
  };

  return parsed;
}
