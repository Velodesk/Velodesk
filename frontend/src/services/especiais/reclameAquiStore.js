/**
 * reclameAquiStore v1.3.1 — produto sem fallback hardcoded
 */
import {
  RA_GROUPS,
  RA_STATUS,
  RA_WHATSAPP_DEFAULT_MSG,
  computeIniciais,
} from './reclameAquiData';
import { reclamacoesApi } from '../../api/client';
import {
  applyTicketStatusToEspeciaisItem,
  isEspeciaisItemFinalizada,
  normalizeEspeciaisItemGroup,
  passesGestaoListFilter,
  resolveEspeciaisGroupKey,
} from './especiaisGroupKey';

const STORAGE_KEY = 'velodesk_reclame_aqui_items';
export const RA_LIST_PAGE_SIZE = 50;

const GROUP_OPTS = {
  statusField: 'statusRa',
  naoRespondidaStatus: RA_STATUS.NAO_RESPONDIDA,
  prazoField: 'prazoRa',
};

let memoryCache = null;

function ensureNormalizedCache(items) {
  const normalized = items.map((item) => normalizeEspeciaisItemGroup(item, GROUP_OPTS));
  const changed = normalized.some(
    (n, i) => n.groupKey !== items[i].groupKey || n.aberta !== items[i].aberta,
  );
  if (changed) writeAll(normalized);
  memoryCache = normalized;
  return normalized;
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeAll(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function normalizeApiItem(row) {
  const statusRa = row.statusRa || row.statusCanal || RA_STATUS.NAO_RESPONDIDA;
  const base = {
    ...row,
    id: row.id || row._id,
    ticketId: row.ticketId || row.chamadoId,
    statusRa,
    idReclamacaoRa: row.idReclamacaoRa || row.idDemanda || '',
    protocoloRa: row.protocoloRa || row.idReclamacaoRa || row.idDemanda || '',
    prazoRa: row.prazoRa || row.prazoLegal || '',
    passivelNota: Boolean(row.passivelNota),
    ticketStatus: row.ticketStatus || row.statusTicket,
    respostaAction: row.respostaAction || 'responder',
    tabulacao: row.tabulacao || row.produto || row.motivo || '—',
    atendente: row.atendente || row.responsavel || '—',
  };
  return {
    ...base,
    groupKey: resolveEspeciaisGroupKey(base, {
      statusField: 'statusRa',
      naoRespondidaStatus: RA_STATUS.NAO_RESPONDIDA,
      prazoField: 'prazoRa',
    }),
  };
}

export async function refreshReclamacoesFromApi() {
  const all = [];
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    const data = await reclamacoesApi.list('reclame-aqui', { limit: RA_LIST_PAGE_SIZE, skip });
    const batch = (data?.items ?? []).map(normalizeApiItem);
    total = Number.isFinite(Number(data?.total)) ? Number(data.total) : skip + batch.length;
    all.push(...batch);
    if (!batch.length || batch.length < RA_LIST_PAGE_SIZE) break;
    skip += RA_LIST_PAGE_SIZE;
  }
  memoryCache = all;
  writeAll(all);
  return all;
}

/** Busca em chamados_reclamacoes + chamados_n1; faz merge no cache local. */
export async function searchReclamacoesFromApi(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = await reclamacoesApi.search('reclame-aqui', q, { limit: 100 });
  const found = (data?.items ?? []).map(normalizeApiItem);
  found.forEach((item) => {
    try {
      patchReclamacao(item);
    } catch {
      // fail-soft: resultado da busca ainda é retornado
    }
  });
  return found.map((item) => getReclamacaoById(item.id) || getReclamacaoByTicketId(item.ticketId) || item);
}

export function loadAllReclamacoes() {
  if (memoryCache) return ensureNormalizedCache(memoryCache);
  const stored = readAll();
  if (stored) return ensureNormalizedCache(stored);
  return [];
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function matchesSearch(item, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    item.consumidor.toLowerCase().includes(q)
    || item.assunto.toLowerCase().includes(q)
    || item.tabulacao.toLowerCase().includes(q)
    || (item.atendente && item.atendente.toLowerCase().includes(q))
  );
}

function matchesChip(item, chipId) {
  if (!chipId) return true;
  if (chipId !== 'finalizadas' && isEspeciaisItemFinalizada(item)) return false;
  switch (chipId) {
    case 'nao-respondidas':
      return item.statusRa === RA_STATUS.NAO_RESPONDIDA || item.groupKey === 'nao-respondidas';
    case 'abertas':
      return item.aberta;
    case 'passivel-nota':
      return item.passivelNota;
    case 'vencendo-hoje':
      return item.groupKey === 'vencendo-hoje';
    case 'finalizadas':
      return isEspeciaisItemFinalizada(item);
    default:
      return true;
  }
}

export function loadReclamacoes({ search = '', activeChips = [], gestaoView = false } = {}) {
  const items = loadAllReclamacoes();
  return items.filter((item) => {
    if (!matchesSearch(item, search)) return false;
    if (gestaoView && !passesGestaoListFilter(item, activeChips)) return false;
    if (activeChips.length && !activeChips.every((chip) => matchesChip(item, chip))) return false;
    return true;
  });
}

export function getReclameAquiKpis(items = loadAllReclamacoes()) {
  const operational = items.filter((i) => !isEspeciaisItemFinalizada(i));
  const today = new Date();
  const vencendoHoje = operational.filter((i) => {
    const d = new Date(i.prazoRa);
    return isSameDay(d, today) && i.aberta;
  }).length;
  const naoRespondidas = operational.filter((i) =>
    i.statusRa === RA_STATUS.NAO_RESPONDIDA || i.groupKey === 'nao-respondidas',
  ).length;
  const respondidas = operational.filter((i) =>
    i.statusRa === RA_STATUS.RESPONDIDA || i.statusRa === RA_STATUS.AGUARD_AVALIACAO,
  ).length;
  const passivelNota = operational.filter((i) => i.passivelNota).length;
  const notas = operational.filter((i) => typeof i.nota === 'number').map((i) => i.nota);
  const notaMedia = notas.length
    ? (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1)
    : '—';
  const respondidasComPrazo = operational.filter((i) => !i.aberta);
  const noPrazo = respondidasComPrazo.filter((i) => i.slaPct >= 80).length;
  const pctNoPrazo = respondidasComPrazo.length
    ? Math.round((noPrazo / respondidasComPrazo.length) * 100)
    : 0;

  return [
    { id: 'vencendo', label: 'Vencendo hoje', value: String(vencendoHoje), tone: 'danger', icon: 'ti-clock-exclamation' },
    { id: 'nao-resp', label: 'Não respondidas', value: String(naoRespondidas), tone: 'warning', icon: 'ti-message-exclamation' },
    { id: 'respondidas', label: 'Respondidas', value: String(respondidas), tone: 'info', icon: 'ti-message-check' },
    { id: 'passivel', label: 'Passível de nota', value: String(passivelNota), tone: 'purple', icon: 'ti-star' },
    { id: 'nota', label: 'Nota média', value: String(notaMedia), tone: 'success', icon: 'ti-star' },
    { id: 'prazo', label: 'Respondidas no prazo', value: `${pctNoPrazo}%`, tone: 'yellow', icon: 'ti-percentage' },
  ];
}

export function groupReclamacoesByStatus(items) {
  return RA_GROUPS.map((group) => ({
    ...group,
    items: items.filter((i) => i.groupKey === group.id),
  })).filter((g) => g.items.length > 0);
}

export function getKanbanColumns(items) {
  return RA_GROUPS.map((col) => ({
    ...col,
    items: items.filter((i) => i.groupKey === col.id),
  })).filter((c) => c.items.length > 0 || c.id === 'nao-respondidas');
}

export function formatPrazoRa(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

export function getCalendarEvents(items, year, month) {
  return items.filter((item) => {
    const d = new Date(item.prazoRa);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

export function getReportSeries(items = loadAllReclamacoes()) {
  const operational = items.filter((i) => !isEspeciaisItemFinalizada(i));
  const byStatus = {
    'Não respondida': operational.filter((i) => i.statusRa === RA_STATUS.NAO_RESPONDIDA).length,
    Respondida: operational.filter((i) => i.statusRa === RA_STATUS.RESPONDIDA).length,
    'Aguard. avaliação': operational.filter((i) => i.statusRa === RA_STATUS.AGUARD_AVALIACAO).length,
  };
  const slaBuckets = {
    'No prazo (≥80%)': operational.filter((i) => i.slaPct >= 80).length,
    'Atenção (50–79%)': operational.filter((i) => i.slaPct >= 50 && i.slaPct < 80).length,
    'Crítico (<50%)': operational.filter((i) => i.slaPct < 50).length,
  };
  const notas = operational.filter((i) => typeof i.nota === 'number');
  const notaDistrib = [1, 2, 3, 4, 5].map((n) => ({
    label: `${n} estrela${n > 1 ? 's' : ''}`,
    value: notas.filter((i) => i.nota === n).length,
  }));
  return { byStatus, slaBuckets, notaDistrib, total: operational.length };
}

export function getFooterSummary(items, selectedCount = 0) {
  const naoResp = items.filter((i) => i.statusRa === RA_STATUS.NAO_RESPONDIDA).length;
  const sel = selectedCount > 0 ? ` · ${selectedCount} selecionada${selectedCount > 1 ? 's' : ''}` : '';
  return `${items.length} reclamações · ${naoResp} não respondidas${sel}`;
}

function computeSlaFromPrazo(prazoRa) {
  const diff = new Date(prazoRa).getTime() - Date.now();
  const totalMs = 3 * 24 * 60 * 60 * 1000;
  const pct = Math.max(0, Math.min(100, Math.round((diff / totalMs) * 100)));
  let tone = 'green';
  if (pct < 50) tone = 'red';
  else if (pct < 80) tone = 'yellow';
  return { slaPct: pct, slaTone: tone };
}

export function generateProtocolo() {
  return '';
}

export function buildRegistroDefaults(item = {}) {
  const prazoRa = item.prazoRa || '';
  const sla = prazoRa ? computeSlaFromPrazo(prazoRa) : { slaPct: 0, slaTone: 'green' };
  return {
    protocoloRa: item.protocoloRa || item.idReclamacaoRa || '',
    consumidor: item.consumidor || '',
    iniciais: item.iniciais || computeIniciais(item.consumidor || ''),
    cpf: item.cpf || '',
    email: item.email || '',
    telefoneWhatsapp: item.telefoneWhatsapp || '',
    assunto: item.assunto || '',
    descricao: item.descricao || '',
    idReclamacaoRa: item.idReclamacaoRa || '',
    // Nunca cair pra "now" aqui: esta função roda a cada releitura do item (F5, troca de ticket,
    // poll de fundo), não só na criação. Um fallback vivo faria a data "andar" pra hora atual a
    // cada visita em vez de ficar congelada na hora real de entrada/criação do ticket — quem
    // precisa de "now" na criação de um rascunho novo é createEmptyReclamacao, uma única vez.
    dataReclamacao: item.dataReclamacao || '',
    produto: item.produto || '',
    tipo: item.tipo || 'Reclamação',
    motivo: item.motivo || '',
    respostaPublica: item.respostaPublica || '',
    whatsappMensagem: item.whatsappMensagem || RA_WHATSAPP_DEFAULT_MSG,
    urlRa: item.urlRa || '',
    ticketId: item.ticketId || null,
    chamadoProtocolo: item.chamadoProtocolo || '',
    passivelNota: item.passivelNota === true,
    statusRa: item.statusRa || RA_STATUS.NAO_RESPONDIDA,
    prazoRa,
    slaPct: item.slaPct ?? sla.slaPct,
    slaTone: item.slaTone || sla.slaTone,
    tabulacao: item.tabulacao || item.produto || item.motivo || '—',
    atendente: item.atendente || '—',
    groupKey: resolveEspeciaisGroupKey(item, {
      statusField: 'statusRa',
      naoRespondidaStatus: RA_STATUS.NAO_RESPONDIDA,
      prazoField: 'prazoRa',
    }),
    ticketStatus: item.ticketStatus || item.statusTicket || '',
    respostaAction: item.respostaAction || 'responder',
    aberta: item.aberta !== false,
    isDraft: item.isDraft ?? false,
  };
}

export function createEmptyReclamacao() {
  const id = `ra-${Date.now()}`;
  return {
    ...buildRegistroDefaults({
      protocoloRa: '',
      idReclamacaoRa: '',
      prazoRa: '',
      // "now" só nasce aqui, uma vez, na criação do rascunho — depois disso o valor persiste e
      // buildRegistroDefaults não o sobrescreve mais em releituras.
      dataReclamacao: new Date().toISOString(),
      passivelNota: false,
      isDraft: true,
    }),
    id,
  };
}

export function getReclamacaoByTicketId(ticketId) {
  if (!ticketId) return null;
  const id = String(ticketId);
  const items = loadAllReclamacoes();
  const found = items.find((i) => String(i.ticketId || '') === id);
  if (!found) return null;
  return { ...found, ...buildRegistroDefaults(found) };
}

export function updateReclamacaoGroupFromTicket(ticket) {
  const ticketId = String(ticket?.id || ticket?._id || '');
  if (!ticketId) return null;
  const item = getReclamacaoByTicketId(ticketId);
  if (!item) return null;
  const updated = applyTicketStatusToEspeciaisItem(item, ticket, {
    statusField: 'statusRa',
    naoRespondidaStatus: RA_STATUS.NAO_RESPONDIDA,
    prazoField: 'prazoRa',
  });
  return upsertReclamacao(updated);
}

export function getReclamacaoById(id) {
  const items = loadAllReclamacoes();
  const found = items.find((i) => i.id === id);
  if (!found) return null;
  return { ...found, ...buildRegistroDefaults(found) };
}

function upsertReclamacao(item) {
  const items = loadAllReclamacoes();
  const idx = items.findIndex((i) => i.id === item.id);
  const normalized = {
    ...buildRegistroDefaults(item),
    ...item,
    iniciais: computeIniciais(item.consumidor || ''),
  };
  if (idx >= 0) {
    items[idx] = normalized;
  } else {
    items.unshift(normalized);
  }
  writeAll(items);
  return normalized;
}

export function patchReclamacao(item) {
  return upsertReclamacao(item);
}

export function saveReclamacaoDraft(item) {
  return upsertReclamacao({ ...item, isDraft: true });
}

export function registerReclamacao(item) {
  const prazoRa = item.prazoRa || '';
  const sla = prazoRa ? computeSlaFromPrazo(prazoRa) : { slaPct: 0, slaTone: 'green' };
  return upsertReclamacao({
    ...item,
    isDraft: false,
    statusRa: RA_STATUS.NAO_RESPONDIDA,
    groupKey: 'nao-respondidas',
    aberta: true,
    respostaAction: 'responder',
    prazoRa,
    slaPct: sla.slaPct,
    slaTone: sla.slaTone,
  });
}
