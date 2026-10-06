/**
 * legadoOctaSearch.service v1.0.0 — critérios da Busca de Tickets aplicados ao arquivo Legado Octa
 *
 * Só entra na busca quando o usuário liga "Incluir Legado Octa". Os critérios são combinados com E,
 * como na busca do Desk: se qualquer critério não existir numa collection do legado (ex.: status,
 * tabulação, responsável), aquela collection não pode satisfazer a busca e é pulada — nunca
 * ignoramos o critério, que traria resultados que o usuário filtrou fora.
 *
 * Igualdade e prefixo usam índice; "contém" em texto livre (título, nome, e-mail) faz varredura e
 * por isso tem maxTimeMS curto.
 */
import { connectLegacyOcta } from '../config/legacyOctaConnection';
import { getTicketLegadoOctaModel } from '../models/TicketLegadoOcta';
import { getWhatsappLegadoOctaModel } from '../models/WhatsappLegadoOcta';

export interface LegadoSearchCriterio {
  campo: string;
  operador?: string;
  valor?: string;
  valores?: string[];
}

export interface LegadoSearchTicketDto {
  _id: string;
  id: string;
  origem: 'legado-octa-ticket' | 'legado-octa-whatsapp';
  /** Rota relativa a /legado-octa para abrir o registro. */
  legadoPath: string;
  chamadoProtocolo: string;
  title: string;
  clientName: string;
  clientCPF: string;
  status: string;
  responsibleAgent: string;
  updatedAt: Date | null;
}

export interface LegadoSearchResult {
  tickets: LegadoSearchTicketDto[];
  /** Quando preenchido, explica por que parte do legado não foi consultada. */
  aviso?: string;
}

const SEARCH_TIMEOUT_MS = 15_000;

function onlyDigits(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * clientPhone vem do wa_id do Octadesk (DDI 55 + DDD + número, às vezes sem o 9º dígito).
 * Gera as variações com/sem 55 e com/sem o 9 para casar com o que o usuário digitar.
 */
export function phoneVariants(digits: string): string[] {
  const base = digits.length >= 12 && digits.startsWith('55') ? digits.slice(2) : digits;
  if (base.length !== 10 && base.length !== 11) return [digits];
  const ddd = base.slice(0, 2);
  const rest = base.slice(2);
  const sem9 = rest.length === 9 && rest[0] === '9' ? rest.slice(1) : rest;
  const com9 = rest.length === 8 ? `9${rest}` : rest;
  const out = new Set<string>();
  for (const n of [sem9, com9]) {
    out.add(`${ddd}${n}`);
    out.add(`55${ddd}${n}`);
  }
  out.add(digits);
  return [...out];
}

type Clause = Record<string, unknown>;

function valoresOf(c: LegadoSearchCriterio): string[] {
  const list = Array.isArray(c.valores) && c.valores.length ? c.valores : [c.valor ?? ''];
  return list.map((v) => String(v).trim()).filter(Boolean);
}

/** OU entre os valores da mesma linha (mesma semântica do Desk). */
function orOf(clauses: Clause[]): Clause | null {
  if (!clauses.length) return null;
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

function textClause(path: string, operador: string, valores: string[]): Clause | null {
  if (operador === 'not_empty') return { [path]: { $exists: true, $nin: ['', null] } };
  const parts = valores.map((v) => (
    operador === 'contains'
      ? { [path]: { $regex: escapeRegex(v), $options: 'i' } }
      : { [path]: { $regex: `^${escapeRegex(v)}$`, $options: 'i' } }
  ));
  return orOf(parts);
}

/** CPF: igualdade exata e "contém" como prefixo — ambos usam o índice de CPF. */
function digitsClause(path: string, operador: string, valores: string[]): Clause | null {
  if (operador === 'not_empty') return { [path]: { $exists: true, $nin: ['', null] } };
  const parts = valores
    .map(onlyDigits)
    .filter(Boolean)
    .map((d) => (operador === 'contains' ? { [path]: { $regex: `^${d}` } } : { [path]: d }));
  return orOf(parts);
}

function dateClause(path: string, operador: string, valores: string[]): Clause | null {
  const dates = valores.map((v) => new Date(v)).filter((d) => !Number.isNaN(d.getTime()));
  if (operador === 'not_empty') return { [path]: { $ne: null } };
  if (!dates.length) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  if (operador === 'between' && dates.length >= 2) {
    return { [path]: { $gte: startOfDay(dates[0]), $lte: endOfDay(dates[1]) } };
  }
  if (operador === 'gte') return { [path]: { $gte: startOfDay(dates[0]) } };
  if (operador === 'lte') return { [path]: { $lte: endOfDay(dates[0]) } };
  return { [path]: { $gte: startOfDay(dates[0]), $lte: endOfDay(dates[0]) } };
}

type FieldBuilder = (c: LegadoSearchCriterio) => Clause | null;

const TICKET_FIELDS: Record<string, FieldBuilder> = {
  protocolo: (c) => {
    const valores = valoresOf(c);
    if ((c.operador || 'equals') === 'not_empty') return textClause('protocoloExibicao', 'not_empty', []);
    const parts = valores.map((v) => {
      const d = onlyDigits(v);
      const ors: Clause[] = [{ protocoloExibicao: d ? d.padStart(10, '0') : v.toUpperCase() }];
      if (d && Number(d)) ors.push({ octadeskNumber: Number(d) });
      return orOf(ors) as Clause;
    });
    return orOf(parts);
  },
  id: (c) => TICKET_FIELDS.protocolo(c),
  titulo: (c) => textClause('summary', (c.operador || 'equals'), valoresOf(c)),
  cpf: (c) => digitsClause('requesterCpf', (c.operador || 'equals'), valoresOf(c)),
  clienteNome: (c) => textClause('requesterName', (c.operador || 'equals'), valoresOf(c)),
  email: (c) => textClause('requesterMail', (c.operador || 'equals'), valoresOf(c)),
  createdAt: (c) => dateClause('openDate', (c.operador || 'equals'), valoresOf(c)),
  updatedAt: (c) => dateClause('openDate', (c.operador || 'equals'), valoresOf(c)),
};

const WHATSAPP_FIELDS: Record<string, FieldBuilder> = {
  protocolo: (c) => {
    if ((c.operador || 'equals') === 'not_empty') return textClause('protocoloExibicao', 'not_empty', []);
    return orOf(valoresOf(c).map((v) => ({ protocoloExibicao: v.toUpperCase() })));
  },
  id: (c) => WHATSAPP_FIELDS.protocolo(c),
  // Conversas de WhatsApp não têm CPF no registro de forma geral — quando existe, é igualdade.
  cpf: (c) => digitsClause('clientCpf', (c.operador || 'equals'), valoresOf(c)),
  clienteNome: (c) => textClause('clientName', (c.operador || 'equals'), valoresOf(c)),
  telefone: (c) => {
    if ((c.operador || 'equals') === 'not_empty') return textClause('clientPhone', 'not_empty', []);
    const parts = valoresOf(c).map(onlyDigits).filter(Boolean).map((d) => (
      (c.operador || 'equals') === 'contains' && d.length < 10
        ? { clientPhone: { $regex: `${d}$` } }
        : { clientPhone: { $in: phoneVariants(d) } }
    ));
    return orOf(parts);
  },
  createdAt: (c) => dateClause('startedAt', (c.operador || 'equals'), valoresOf(c)),
  updatedAt: (c) => dateClause('lastMessageAt', (c.operador || 'equals'), valoresOf(c)),
};

/** Monta o filtro AND ou devolve null se algum critério não existe na collection. */
function buildFilter(
  criterios: LegadoSearchCriterio[],
  fields: Record<string, FieldBuilder>,
): Clause | null {
  const clauses: Clause[] = [];
  for (const c of criterios) {
    const builder = fields[String(c.campo || '').trim()];
    if (!builder) return null;
    const clause = builder(c);
    if (!clause) return null;
    clauses.push(clause);
  }
  return clauses.length ? { $and: clauses } : null;
}

export async function searchLegadoOcta(
  criterios: LegadoSearchCriterio[],
  limit: number,
): Promise<LegadoSearchResult> {
  // SLA não existe no legado e o Desk também o trata fora do filtro de banco.
  const efetivos = criterios.filter((c) => String(c.campo || '').trim().toLowerCase() !== 'sla');
  if (!efetivos.length) return { tickets: [] };

  const ticketFilter = buildFilter(efetivos, TICKET_FIELDS);
  const whatsappFilter = buildFilter(efetivos, WHATSAPP_FIELDS);

  if (!ticketFilter && !whatsappFilter) {
    return {
      tickets: [],
      aviso: 'Legado Octa não consultado: algum filtro (ex.: status, tipo, responsável) não existe no legado.',
    };
  }

  await connectLegacyOcta();
  const tickets: LegadoSearchTicketDto[] = [];

  const [ticketDocs, whatsappDocs] = await Promise.all([
    ticketFilter
      ? getTicketLegadoOctaModel()
        .find(ticketFilter, {
          octadeskNumber: 1, protocoloExibicao: 1, summary: 1, requesterName: 1, requesterCpf: 1, openDate: 1,
        })
        .sort({ openDate: -1 })
        .limit(limit)
        .maxTimeMS(SEARCH_TIMEOUT_MS)
        .lean()
      : Promise.resolve([]),
    whatsappFilter
      ? getWhatsappLegadoOctaModel()
        .find(whatsappFilter, {
          octadeskRoomId: 1, protocoloExibicao: 1, clientName: 1, clientCpf: 1, clientPhone: 1, lastMessageAt: 1,
        })
        .sort({ lastMessageAt: -1 })
        .limit(limit)
        .maxTimeMS(SEARCH_TIMEOUT_MS)
        .lean()
      : Promise.resolve([]),
  ]);

  for (const t of ticketDocs) {
    tickets.push({
      _id: `legado-ticket-${t.octadeskNumber}`,
      id: `legado-ticket-${t.octadeskNumber}`,
      origem: 'legado-octa-ticket',
      legadoPath: `tickets/ticket/${t.octadeskNumber}`,
      chamadoProtocolo: String(t.protocoloExibicao || ''),
      title: String(t.summary || ''),
      clientName: String(t.requesterName || ''),
      clientCPF: String(t.requesterCpf || ''),
      status: 'Legado Octa',
      responsibleAgent: '',
      updatedAt: t.openDate ?? null,
    });
  }
  for (const w of whatsappDocs) {
    tickets.push({
      _id: `legado-whatsapp-${w.octadeskRoomId}`,
      id: `legado-whatsapp-${w.octadeskRoomId}`,
      origem: 'legado-octa-whatsapp',
      legadoPath: `whatsapp/${w.octadeskRoomId}`,
      chamadoProtocolo: String(w.protocoloExibicao || ''),
      title: w.clientPhone ? `WhatsApp ${w.clientPhone}` : 'Conversa de WhatsApp',
      clientName: String(w.clientName || ''),
      clientCPF: String(w.clientCpf || ''),
      status: 'Legado Octa',
      responsibleAgent: '',
      updatedAt: w.lastMessageAt ?? null,
    });
  }

  tickets.sort((a, b) => (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0));
  return { tickets: tickets.slice(0, limit) };
}
