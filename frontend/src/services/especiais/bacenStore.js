/**
 * bacenStore v1.2.0 — demandas Bacen via API + busca dual n1/reclamacoes
 */
import {
  BC_GROUPS,
  BC_STATUS,
  BC_WHATSAPP_DEFAULT_MSG,
  computeIniciais,
} from './bacenData';
import { reclamacoesApi } from '../../api/client';
import {
  applyTicketStatusToEspeciaisItem,
  isEspeciaisItemFinalizada,
  normalizeEspeciaisItemGroup,
  passesGestaoListFilter,
  resolveEspeciaisGroupKey,
} from './especiaisGroupKey';

const STORAGE_KEY = 'velodesk_bacen_items';

const GROUP_OPTS = {
  statusField: 'statusBc',
  naoRespondidaStatus: BC_STATUS.NAO_RESPONDIDA,
  prazoField: 'prazoLegal',
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

function daysFromNow(days, hour = 18) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
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
  const statusBc = row.statusBc || row.statusCanal || BC_STATUS.NAO_RESPONDIDA;
  const base = {
    ...row,
    id: row.id || row._id,
    ticketId: row.ticketId || row.chamadoId,
    statusBc,
    ticketStatus: row.ticketStatus || row.statusTicket,
    respostaAction: row.respostaAction || 'responder',
    // row.workflow pode vir como o snapshot bruto do workflow (objeto, ver IReclamacaoWorkflow
    // no backend) em vez de um rótulo de exibição — só usar a string quando já for uma.
    workflow: typeof row.workflow === 'string' && row.workflow
      ? row.workflow
      : (row.workflowAtivo ? 'Ativo' : '—'),
    tabulacao: row.tabulacao || row.produto || '—',
    atendente: row.atendente || row.responsavel || '—',
  };
  return {
    ...base,
    groupKey: resolveEspeciaisGroupKey(base, {
      statusField: 'statusBc',
      naoRespondidaStatus: BC_STATUS.NAO_RESPONDIDA,
      prazoField: 'prazoLegal',
    }),
  };
}

export async function refreshDemandasFromApi() {
  const data = await reclamacoesApi.list('bacen');
  const items = (data?.items ?? []).map(normalizeApiItem);
  memoryCache = items;
  writeAll(items);
  return items;
}

/** Busca em chamados_reclamacoes + chamados_n1; faz merge no cache local. */
export async function searchDemandasFromApi(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const data = await reclamacoesApi.search('bacen', q, { limit: 100 });
  const found = (data?.items ?? []).map(normalizeApiItem);
  found.forEach((item) => {
    try {
      patchDemanda(item);
    } catch {
      // fail-soft
    }
  });
  return found.map((item) => getDemandaById(item.id) || getDemandaByTicketId(item.ticketId) || item);
}

export function loadAllDemandas() {
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
    String(item.consumidor || '').toLowerCase().includes(q)
    || String(item.assunto || '').toLowerCase().includes(q)
    || String(item.tabulacao || '').toLowerCase().includes(q)
    || String(item.orgaoBacen || '').toLowerCase().includes(q)
    || (item.atendente && item.atendente.toLowerCase().includes(q))
  );
}

function matchesChip(item, chipId) {
  if (!chipId) return true;
  if (chipId !== 'finalizadas' && isEspeciaisItemFinalizada(item)) return false;
  switch (chipId) {
    case 'nao-respondidas':
      return item.statusBc === BC_STATUS.NAO_RESPONDIDA || item.groupKey === 'nao-respondidas';
    case 'abertas':
      return item.aberta;
    case 'workflow-ativo':
      return item.workflowAtivo;
    case 'vencendo-hoje':
      return item.groupKey === 'vencendo-hoje';
    case 'finalizadas':
      return isEspeciaisItemFinalizada(item);
    default:
      return true;
  }
}

export function loadDemandas({ search = '', activeChips = [], gestaoView = false } = {}) {
  const items = loadAllDemandas();
  return items.filter((item) => {
    if (!matchesSearch(item, search)) return false;
    if (gestaoView && !passesGestaoListFilter(item, activeChips)) return false;
    if (activeChips.length && !activeChips.every((chip) => matchesChip(item, chip))) return false;
    return true;
  });
}

export function getBacenKpis(items = loadAllDemandas()) {
  const operational = items.filter((i) => !isEspeciaisItemFinalizada(i));
  const today = new Date();
  const vencendoHoje = operational.filter((i) => {
    const d = new Date(i.prazoLegal);
    return isSameDay(d, today) && i.aberta;
  }).length;
  const naoRespondidas = operational.filter((i) =>
    i.statusBc === BC_STATUS.NAO_RESPONDIDA || i.groupKey === 'nao-respondidas',
  ).length;
  const respondidas = operational.filter((i) =>
    i.statusBc === BC_STATUS.RESPONDIDA || i.statusBc === BC_STATUS.AGUARDANDO_AUDIENCIA,
  ).length;
  const workflowAtivo = operational.filter((i) => i.workflowAtivo).length;
  const respondidasComPrazo = operational.filter((i) => !i.aberta);
  const noPrazo = respondidasComPrazo.filter((i) => i.slaPct >= 80).length;
  const pctNoPrazo = respondidasComPrazo.length
    ? Math.round((noPrazo / respondidasComPrazo.length) * 100)
    : 0;

  return [
    { id: 'vencendo', label: 'Vencendo hoje', value: String(vencendoHoje), tone: 'danger', icon: 'ti-clock-exclamation' },
    { id: 'nao-resp', label: 'Não respondidas', value: String(naoRespondidas), tone: 'warning', icon: 'ti-message-exclamation' },
    { id: 'respondidas', label: 'Respondidas', value: String(respondidas), tone: 'info', icon: 'ti-message-check' },
    { id: 'workflow', label: 'Workflow ativo', value: String(workflowAtivo), tone: 'purple', icon: 'ti-arrows-exchange' },
    { id: 'prazo', label: 'Respondidas no prazo', value: `${pctNoPrazo}%`, tone: 'yellow', icon: 'ti-percentage' },
    { id: 'orgaos', label: 'Órgãos distintos', value: String(new Set(operational.map((i) => i.orgaoBacen).filter(Boolean)).size), tone: 'success', icon: 'ti-building-community' },
  ];
}

export function groupDemandasByStatus(items) {
  return BC_GROUPS.map((group) => ({
    ...group,
    items: items.filter((i) => i.groupKey === group.id),
  })).filter((g) => g.items.length > 0);
}

export function getKanbanColumns(items) {
  const extra = { id: 'workflow-ativo', label: 'Workflow ativo', tone: 'purple' };
  const cols = [...BC_GROUPS.filter((g) => g.id !== 'respondidas'), extra, BC_GROUPS.find((g) => g.id === 'respondidas')];
  return cols.map((col) => {
    let colItems = [];
    if (col.id === 'workflow-ativo') {
      colItems = items.filter((i) => i.workflowAtivo && i.groupKey !== 'respondidas' && i.groupKey !== 'finalizadas');
    } else {
      colItems = items.filter((i) => i.groupKey === col.id);
    }
    return { ...col, items: colItems };
  }).filter((c) => c.items.length > 0 || c.id === 'nao-respondidas');
}

export function formatPrazoLegal(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const date = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
}

export function getCalendarEvents(items, year, month) {
  return items.filter((item) => {
    const d = new Date(item.prazoLegal);
    return d.getFullYear() === year && d.getMonth() === month;
  });
}

export function getReportSeries(items = loadAllDemandas()) {
  const operational = items.filter((i) => !isEspeciaisItemFinalizada(i));
  const byStatus = {
    'Não respondida': operational.filter((i) => i.statusBc === BC_STATUS.NAO_RESPONDIDA).length,
    'Workflow ativo': operational.filter((i) => i.workflowAtivo).length,
    Respondida: operational.filter((i) => i.statusBc === BC_STATUS.RESPONDIDA).length,
    'Aguard. audiência': operational.filter((i) => i.statusBc === BC_STATUS.AGUARDANDO_AUDIENCIA).length,
  };
  const slaBuckets = {
    'No prazo (≥80%)': operational.filter((i) => i.slaPct >= 80).length,
    'Atenção (50–79%)': operational.filter((i) => i.slaPct >= 50 && i.slaPct < 80).length,
    'Crítico (<50%)': operational.filter((i) => i.slaPct < 50).length,
  };
  const byOrgao = operational.reduce((acc, item) => {
    const orgao = item.orgaoBacen || 'Não informado';
    acc[orgao] = (acc[orgao] || 0) + 1;
    return acc;
  }, {});
  return { byStatus, slaBuckets, byOrgao, total: operational.length };
}

export function getFooterSummary(items, selectedCount = 0) {
  const naoResp = items.filter((i) => i.statusBc === BC_STATUS.NAO_RESPONDIDA).length;
  const sel = selectedCount > 0 ? ` · ${selectedCount} selecionada${selectedCount > 1 ? 's' : ''}` : '';
  return `${items.length} demandas · ${naoResp} não respondidas${sel}`;
}

function computeSlaFromPrazo(prazoLegal) {
  const diff = new Date(prazoLegal).getTime() - Date.now();
  const totalMs = 10 * 24 * 60 * 60 * 1000;
  const pct = Math.max(0, Math.min(100, Math.round((diff / totalMs) * 100)));
  let tone = 'green';
  if (pct < 50) tone = 'red';
  else if (pct < 80) tone = 'yellow';
  return { slaPct: pct, slaTone: tone };
}

export function generateProtocolo() {
  const year = new Date().getFullYear();
  const items = loadAllDemandas();
  const nums = items
    .map((i) => i.protocoloBacen)
    .filter(Boolean)
    .map((p) => parseInt(String(p).split('-').pop(), 10))
    .filter((n) => !Number.isNaN(n));
  const next = Math.max(12001, ...nums, 0) + 1;
  return `BC-${year}-${String(next).padStart(8, '0')}`;
}

export function buildRegistroDefaults(item = {}) {
  // Nunca cair pra "now"/daysFromNow aqui: esta função roda a cada releitura do item (F5, troca
  // de ticket, poll de fundo), não só na criação. Um fallback vivo faria data/prazo "andarem"
  // pra hora atual a cada visita em vez de ficarem congelados no momento real de criação — quem
  // precisa desses defaults na criação de uma demanda nova é createEmptyDemanda, uma única vez.
  const prazoLegal = item.prazoLegal || '';
  const sla = prazoLegal ? computeSlaFromPrazo(prazoLegal) : { slaPct: 0, slaTone: 'green' };
  return {
    protocoloBacen: item.protocoloBacen || generateProtocolo(),
    consumidor: item.consumidor || '',
    iniciais: item.iniciais || computeIniciais(item.consumidor || ''),
    cpf: item.cpf || '',
    email: item.email || '',
    telefoneWhatsapp: item.telefoneWhatsapp || '',
    assunto: item.assunto || '',
    descricao: item.descricao || '',
    idDemanda: item.idDemanda || '',
    dataDemanda: item.dataDemanda || '',
    orgaoBacen: item.orgaoBacen || '',
    cidade: item.cidade || '',
    uf: item.uf || '',
    produto: item.produto || '',
    tipo: item.tipo || 'Reclamação',
    motivo: item.motivo || '',
    respostaPublica: item.respostaPublica || '',
    whatsappMensagem: item.whatsappMensagem || BC_WHATSAPP_DEFAULT_MSG,
    ticketId: item.ticketId || null,
    chamadoProtocolo: item.chamadoProtocolo || '',
    statusBc: item.statusBc || BC_STATUS.NAO_RESPONDIDA,
    prazoLegal,
    slaPct: item.slaPct ?? sla.slaPct,
    slaTone: item.slaTone || sla.slaTone,
    workflow: typeof item.workflow === 'string' && item.workflow ? item.workflow : '—',
    tabulacao: item.tabulacao || item.produto || '—',
    atendente: item.atendente || '—',
    groupKey: resolveEspeciaisGroupKey(item, {
      statusField: 'statusBc',
      naoRespondidaStatus: BC_STATUS.NAO_RESPONDIDA,
      prazoField: 'prazoLegal',
    }),
    ticketStatus: item.ticketStatus || item.statusTicket || '',
    respostaAction: item.respostaAction || 'responder',
    aberta: item.aberta !== false,
    workflowAtivo: item.workflowAtivo || false,
    isDraft: item.isDraft ?? false,
  };
}

export function createEmptyDemanda() {
  const id = `bc-${Date.now()}`;
  return {
    ...buildRegistroDefaults({
      protocoloBacen: generateProtocolo(),
      // now/prazo só nascem aqui, uma vez, na criação — depois disso o valor persiste e
      // buildRegistroDefaults não o sobrescreve mais em releituras.
      dataDemanda: new Date().toISOString(),
      prazoLegal: daysFromNow(10, 18),
      isDraft: true,
    }),
    id,
  };
}

export function getDemandaById(id) {
  const items = loadAllDemandas();
  const found = items.find((i) => i.id === id);
  if (!found) return null;
  return { ...found, ...buildRegistroDefaults(found) };
}

export function updateDemandaGroupFromTicket(ticket) {
  const ticketId = String(ticket?.id || ticket?._id || '');
  if (!ticketId) return null;
  const item = getDemandaByTicketId(ticketId);
  if (!item) return null;
  const updated = applyTicketStatusToEspeciaisItem(item, ticket, {
    statusField: 'statusBc',
    naoRespondidaStatus: BC_STATUS.NAO_RESPONDIDA,
    prazoField: 'prazoLegal',
  });
  return upsertDemanda(updated);
}

export function getDemandaByTicketId(ticketId) {
  if (!ticketId) return null;
  const id = String(ticketId);
  const items = loadAllDemandas();
  const found = items.find((i) => String(i.ticketId || '') === id);
  if (!found) return null;
  return { ...found, ...buildRegistroDefaults(found) };
}

function upsertDemanda(item) {
  const items = loadAllDemandas();
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

export function patchDemanda(item) {
  return upsertDemanda(item);
}

export function saveDemandaDraft(item) {
  return upsertDemanda({ ...item, isDraft: true });
}

export function registerDemanda(item) {
  const prazoLegal = item.prazoLegal || daysFromNow(10, 18);
  const sla = computeSlaFromPrazo(prazoLegal);
  return upsertDemanda({
    ...item,
    isDraft: false,
    workflowAtivo: true,
    statusBc: BC_STATUS.NAO_RESPONDIDA,
    workflow: typeof item.workflow === 'string' && item.workflow && item.workflow !== '—'
      ? item.workflow
      : 'Tratativa Bacen',
    groupKey: 'nao-respondidas',
    aberta: true,
    respostaAction: 'responder',
    prazoLegal,
    slaPct: sla.slaPct,
    slaTone: sla.slaTone,
  });
}

/** Espelha ticket Bacen externo na caixa sem iniciar workflow. */
export function mirrorDemandaFromTicket(item) {
  const prazoLegal = item.prazoLegal || daysFromNow(10, 18);
  const sla = computeSlaFromPrazo(prazoLegal);
  const base = {
    ...item,
    isDraft: false,
    workflowAtivo: item.workflowAtivo || false,
    statusBc: item.statusBc || BC_STATUS.NAO_RESPONDIDA,
    respostaAction: item.respostaAction || 'responder',
    prazoLegal,
    slaPct: item.slaPct ?? sla.slaPct,
    slaTone: item.slaTone || sla.slaTone,
  };
  const resolved = applyTicketStatusToEspeciaisItem(base, { status: item.ticketStatus }, {
    statusField: 'statusBc',
    naoRespondidaStatus: BC_STATUS.NAO_RESPONDIDA,
    prazoField: 'prazoLegal',
  });
  return upsertDemanda({
    ...resolved,
    groupKey: resolved.groupKey || 'nao-respondidas',
    aberta: resolved.aberta !== false,
  });
}
