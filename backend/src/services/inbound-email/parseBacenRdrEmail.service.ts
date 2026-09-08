/** parseBacenRdrEmail v1.1.0 — datas BR com offset -03:00 explícito */
import type { InboundEmailPayload } from './types';
import { parseBrCivilDateTimeToIso, parseBrSlashDateToIso } from '../dates/brDateTime.util';

export const BACEN_RDR_PRIORITY_SUBJECT_PATTERN = /PRIORIZAR\s*-\s*BACEN\s*\/?\s*RDR/i;

/** ID/RDR Bacen no assunto, ex.: "BACEN/ RDR - 20261074668" ou "BACEN / RDR - 20261074668". */
export const BACEN_SUBJECT_RDR_PATTERN = /BACEN\s*\/\s*RDR\s*-\s*(\d+)/i;

/** Prazo de resposta no assunto, ex.: "Prazo: 06/08/2026" (já vem com ano, ao contrário do CGOV). */
export const BACEN_SUBJECT_PRAZO_PATTERN = /Prazo\s*:\s*(\d{2}\/\d{2}\/\d{4})/i;

export interface ParsedBacenRdrInboundEmail {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  endereco: string;
  cidade: string;
  uf: string;
  idBacen: string;
  idReclamacao: string;
  descricaoHeader: string;
  tipo: string;
  mensagem: string;
  descricao: string;
  assunto: string;
  motivo: string;
  contrato: string;
  dataDemandaIso?: string;
  prazoIso?: string;
  protocoloBacen: string;
  idDemanda: string;
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

function parseEnderecoLocalidade(endereco: string): { cidade: string; uf: string } {
  const raw = String(endereco ?? '').trim();
  if (!raw) return { cidade: '', uf: '' };

  const match = raw.match(/,\s*([^,]+?)\s*,\s*([A-Z]{2})\b/i);
  if (match) {
    return {
      cidade: match[1].trim(),
      uf: match[2].trim().toUpperCase(),
    };
  }

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

  return { cidade: '', uf: '' };
}

function parseBrDateTime(value: string): string | undefined {
  return parseBrCivilDateTimeToIso(value);
}

/** ID/RDR Bacen quando vem no assunto do e-mail (ex.: "BACEN/ RDR - 20261074668"). */
export function extractBacenRdrFromSubject(subject: string): string {
  const match = String(subject ?? '').match(BACEN_SUBJECT_RDR_PATTERN);
  return match?.[1]?.trim() || '';
}

/** Prazo de resposta quando vem no assunto do e-mail (ex.: "Prazo: 06/08/2026"). */
export function extractBacenPrazoIsoFromSubject(subject: string): string | undefined {
  const match = String(subject ?? '').match(BACEN_SUBJECT_PRAZO_PATTERN);
  if (!match?.[1]) return undefined;
  return parseBrSlashDateToIso(match[1], true);
}

function extractField(text: string, labels: string[]): string {
  for (const label of labels) {
    const escaped = escapeRegex(label);
    const patterns = [
      new RegExp(`^${escaped}\\s*[:\\t]\\s*(.+)$`, 'im'),
      new RegExp(`^${escaped}\\s+(.+)$`, 'im'),
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
  }
  return '';
}

function extractSection(text: string, header: string, nextHeaders: string[]): string {
  const startPattern = new RegExp(`^\\s*${escapeRegex(header)}\\s*$`, 'im');
  const startMatch = text.match(startPattern);
  if (!startMatch || startMatch.index == null) return '';

  const start = startMatch.index + startMatch[0].length;
  let end = text.length;
  for (const next of nextHeaders) {
    const nextPattern = new RegExp(`^\\s*${escapeRegex(next)}\\s*$`, 'im');
    const nextMatch = text.slice(start).match(nextPattern);
    if (nextMatch?.index != null) {
      end = Math.min(end, start + nextMatch.index);
    }
  }
  return text.slice(start, end).trim();
}

function extractMensagem(reclamacaoSection: string): string {
  const match = reclamacaoSection.match(/^Mensagem\s*:\s*([\s\S]*)$/im);
  if (!match?.[1]) return '';
  return match[1].trim();
}

function extractDescricaoBlock(reclamacaoSection: string): string {
  const lines = reclamacaoSection.split(/\r?\n/);
  const collected: string[] = [];
  let inDescricao = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^descri[cç][aã]o$/i.test(trimmed)) {
      inDescricao = true;
      continue;
    }
    if (inDescricao) {
      if (/^tipo\s*:/i.test(trimmed) || /^mensagem\s*:/i.test(trimmed)) break;
      collected.push(line);
    }
  }

  return collected.join('\n').trim();
}

function extractFooterFields(text: string): { contrato: string; cpfFooter: string; nomeFooter: string } {
  const contrato = extractField(text, ['Contrato']);
  const cpfFooter = normalizeCpf(extractField(text, ['CPF']));
  const nomeFooter = extractField(text, ['Nome']);
  return { contrato, cpfFooter, nomeFooter };
}

function deriveAssuntoFromMensagem(mensagem: string): string {
  const raw = String(mensagem ?? '').trim();
  if (!raw) return 'Demanda Bacen RDR';

  const firstSentence = raw.split(/(?<=[.!?])\s+/)[0]?.trim() || raw;
  if (firstSentence.length <= 120) return firstSentence;
  return `${firstSentence.slice(0, 117).trim()}...`;
}

function buildProtocoloBacen(idBacen: string, dataDemandaIso?: string): string {
  const year = dataDemandaIso
    ? new Date(dataDemandaIso).getFullYear()
    : new Date().getFullYear();
  const suffix = String(idBacen ?? '').replace(/\D/g, '').padStart(8, '0').slice(-8);
  return `BC-${year}-${suffix}`;
}

function hasBacenRdrBodyStructure(text: string): boolean {
  const body = String(text ?? '');
  return body.includes('Dados do Demandante') && body.includes('Dados da Reclamação');
}

export function isBacenRdrPrioritySubject(subject: string): boolean {
  return BACEN_RDR_PRIORITY_SUBJECT_PATTERN.test(String(subject ?? '').trim());
}

export function isBacenRdrStructuredInboundEmail(
  payload: InboundEmailPayload,
  bodyText?: string,
): boolean {
  if (isBacenRdrPrioritySubject(payload.subject)) return true;
  if (extractBacenRdrFromSubject(payload.subject)) return true;
  const body = bodyText ?? payload.textBody ?? '';
  return hasBacenRdrBodyStructure(body);
}

export function parseBacenRdrInboundEmail(bodyText: string, subject?: string): ParsedBacenRdrInboundEmail {
  const text = String(bodyText ?? '').replace(/\r\n/g, '\n');

  const demandanteSection = extractSection(text, 'Dados do Demandante', [
    'Dados da Reclamação',
  ]);
  const reclamacaoSection = extractSection(text, 'Dados da Reclamação', [
    'Por gentileza',
  ]);

  const nome = extractField(demandanteSection, ['Nome']);
  const cpf = normalizeCpf(extractField(demandanteSection, ['Documento', 'CPF']));
  const email = extractField(demandanteSection, ['E-mail', 'Email']);
  const telefone = normalizeTelefone(extractField(demandanteSection, ['Telefone(s)', 'Telefone']));
  const endereco = extractField(demandanteSection, ['Endereço', 'Endereco']);
  const idBacen = String(
    extractField(demandanteSection, ['Id Bacen', 'ID Bacen']) || '',
  ).replace(/\D/g, '');

  const idLineMatch = reclamacaoSection.match(/^Id\s*\(?\s*(\d+)\s*\)?/im);
  const idReclamacaoRaw = idLineMatch?.[1] || extractField(reclamacaoSection, ['Id']);
  const idReclamacao = String(idReclamacaoRaw ?? '').replace(/[()]/g, '').replace(/\D/g, '') || idBacen;
  const descricaoHeader = extractDescricaoBlock(reclamacaoSection);
  const siscapMatch = descricaoHeader.match(/EXTERNA\s*-\s*SISCAP\s+em\s+([\d/: ]+)/i);
  const dataDemandaIso = siscapMatch ? parseBrDateTime(siscapMatch[1]) : undefined;
  const tipo = extractField(reclamacaoSection, ['Tipo']).replace(/^:\s*/, '') || 'Reclamação';
  const mensagem = extractMensagem(reclamacaoSection);

  const footer = extractFooterFields(text);
  const contrato = footer.contrato;

  const descricaoParts = [
    descricaoHeader,
    mensagem,
    footer.contrato ? `Contrato: ${footer.contrato}` : '',
  ].filter(Boolean);
  const descricao = descricaoParts.join('\n\n').trim();

  const assunto = deriveAssuntoFromMensagem(mensagem);
  const motivo = assunto;
  const localidade = parseEnderecoLocalidade(endereco);
  // O assunto é a fonte confiável do RDR/prazo (ex.: "BACEN/ RDR - 20261074668" e
  // "Prazo: 06/08/2026") — prevalece sobre o que vier (ou não) rotulado no corpo do e-mail.
  const rdrFromSubject = extractBacenRdrFromSubject(subject || '');
  const idDemanda = rdrFromSubject || idBacen || idReclamacao;
  const protocoloBacen = buildProtocoloBacen(idDemanda, dataDemandaIso);
  const prazoIso = extractBacenPrazoIsoFromSubject(subject || '');

  const parsed: ParsedBacenRdrInboundEmail = {
    nome: nome || footer.nomeFooter,
    cpf: cpf || footer.cpfFooter,
    email,
    telefone,
    endereco,
    cidade: localidade.cidade,
    uf: localidade.uf,
    idBacen: idDemanda,
    idReclamacao,
    descricaoHeader,
    tipo,
    mensagem,
    descricao,
    assunto,
    motivo,
    contrato,
    dataDemandaIso,
    prazoIso,
    protocoloBacen,
    idDemanda,
    isValid() {
      return Boolean(
        parsed.nome
        && parsed.cpf.length === 11
        && parsed.idDemanda
        && parsed.mensagem,
      );
    },
  };

  return parsed;
}
