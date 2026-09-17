/**
 * ticketsCache v1.21.2 — pruneTicketsAbsentFromApi não fecha mais a aba aberta
 * VERSION: v1.21.2 | DATE: 2026-08-24 | AUTHOR: VeloHub Development Team
 * — ausência na resposta de /boxes (fila sem coluna pra status terminal) não é 404: só
 *   evictTicketFromCache (404/410 real) deve fechar a aba
 */
import { boxesApi, ticketsApi } from '../api/client';
import { isBackendJwtUsable } from '../utils/backendJwt';
import deskLog from '../utils/deskDebugLog';
import {
  adaptColumnsFromApi,
  apiTicketToCockpit,
  cockpitTicketToApi,
  buildCreatePayload,
  isDraftTicket,
} from '../api/adapters/ticketAdapter';
import { readDeskProfileId, shouldUseMeusChamadosFila, ticketBelongsInAgentNovosQueue, ticketAssignedToCurrentAgent, ticketAtribuidoToCurrentAgent } from './desk/responsavelSegmentation';
import { isEspeciaisDeskExcludedTicket } from './especiais/especiaisChannelDetection';
import { getAgentName } from './clientDb';
import { loadProconTicketsFromApi } from './especiais/proconTicketService';
import {
  hasPendingWorkflowPersist,
  mergeApiTicketPreservingPendingWorkflow,
} from './desk/pendingWorkflowStart';
import { loadConsumidorGovTicketsFromApi } from './especiais/consumidorGovTicketService';
import { loadBacenTicketsFromApi } from './especiais/bacenTicketService';
import { syncEspeciaisGroupFromTicket } from './especiais/especiaisTicketGroupSync';
import { sanitizeResponsavel } from './tabulationConfig';

const BOXES_CACHE_KEY = 'velodesk_boxes_cache_v2';
const BOXES_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let columns = [];
let useApi = true;

const DEFAULT_BOXES = [
  { id: 'novos', name: 'Novos', tickets: [] },
  { id: 'em-andamento', name: 'Em Andamento', tickets: [] },
  { id: 'em-espera', name: 'Pendente', tickets: [] },
  { id: 'pendentes', name: 'Aguardando retorno', tickets: [] },
  { id: 'resolvidos', name: 'Resolvidos', tickets: [] },
];

function ensureDefaultColumns() {
  if (!columns.length) {
    columns = DEFAULT_BOXES.map((box) => ({ ...box, tickets: [...(box.tickets || [])] }));
  }
  return columns;
}

function collectDraftTickets(cols) {
  const drafts = [];
  (cols || []).forEach((box) => {
    (box.tickets || []).forEach((t) => {
      if (isDraftTicket(t)) drafts.push({ ticket: t, boxId: box.id });
    });
  });
  return drafts;
}

function injectDraftTickets(cols, drafts) {
  if (!drafts.length) return cols;
  const next = cols.map((box) => ({ ...box, tickets: [...(box.tickets || [])] }));
  drafts.forEach(({ ticket, boxId }) => {
    const id = String(ticket.id || ticket._id);
    next.forEach((box) => {
      box.tickets = (box.tickets || []).filter(
        (t) => String(t.id) !== id && String(t._id) !== id
      );
    });
    const target = next.find((b) => b.id === boxId) || next.find((b) => b.id === 'novos') || next[0];
    if (target) {
      if (!target.tickets) target.tickets = [];
      target.tickets.unshift(ticket);
    }
  });
  return next;
}

function mergeDraftSnapshots(...lists) {
  const byId = new Map();
  lists.flat().forEach((item) => {
    if (!item?.ticket) return;
    const id = String(item.ticket.id || item.ticket._id);
    if (!id) return;
    byId.set(id, item);
  });
  return [...byId.values()];
}

let loadBoxesFromApiChain = Promise.resolve();
const detailLoadInFlight = new Set();
const mergeProtectedTicketIds = new Set();
const detailLoadChains = new Map();

function collectTicketIdsFromColumns(cols) {
  const ids = new Set();
  (cols || []).forEach((box) => {
    (box.tickets || []).forEach((ticket) => {
      const id = ticketIdKey(ticket);
      if (id) ids.add(id);
    });
  });
  return ids;
}

/**
 * Após GET /boxes: remove do cache tickets que a API não devolveu (ex.: apagados no Mongo).
 * Mantém rascunhos locais e workflow pendente de persistência.
 */
function pruneTicketsAbsentFromApi(mergedCols, apiCols) {
  const apiIds = collectTicketIdsFromColumns(apiCols);
  const evictedIds = [];
  const pruned = (mergedCols || []).map((box) => ({
    ...box,
    tickets: (box.tickets || []).filter((ticket) => {
      if (isDraftTicket(ticket)) return true;
      if (hasPendingWorkflowPersist(ticket)) return true;
      // Mesmo critério de mergePreservedDetails — sem isso, essa função remove no mesmo
      // ciclo o ticket que a outra tinha acabado de reinserir por estar aberto/com detalhe
      // carregado, e ele "some" da coluna a cada poll em que a query de /boxes não o trouxer.
      if (shouldPreserveTicketDetail(ticket)) return true;
      const id = ticketIdKey(ticket);
      if (!id) return false;
      if (apiIds.has(id)) return true;
      // Ticket com aba aberta (ativa ou em segundo plano — setMergeProtectedTicketIds cobre
      // todas): não remove só por estar ausente desta resposta pontual de /boxes. Sem isso,
      // uma aba em segundo plano perde silenciosamente o ticket do cache (e a próxima edição
      // do agente) até ele reativar a aba. Deleção real de verdade é tratada só via 404/410
      // (evictTicketFromCache), não por ausência aqui.
      if (mergeProtectedTicketIds.has(id)) return true;
      evictedIds.push(id);
      mergeProtectedTicketIds.delete(id);
      detailLoadInFlight.delete(id);
      detailLoadChains.delete(id);
      return false;
    }),
  }));
  if (evictedIds.length) {
    deskLog.tickets('pruneTicketsAbsentFromApi → fantasmas removidos', {
      count: evictedIds.length,
      ids: evictedIds,
      apiTickets: apiIds.size,
    });
    // NÃO despacha 'ticket-evicted' aqui (fecharia a aba aberta do ticket). Ausência na
    // resposta de /boxes só significa "não está no quadro ativo desta fila" — ex.: ticket
    // virou Cancelado/Resolvido e a fila de equipe aberta não tem coluna pra status terminal.
    // Isso não indica que o ticket foi apagado. O fechamento de aba fica só pro 404/410 real
    // (evictTicketFromCache, chamado em loadTicketDetailFromApi/commitTicketViaApi).
  }
  return pruned;
}

/** Limpa cache local de filas (localStorage + memória) — útil após purge no Mongo. */
export function clearBoxesLocalCache() {
  columns = DEFAULT_BOXES.map((box) => ({ ...box, tickets: [] }));
  mergeProtectedTicketIds.clear();
  detailLoadInFlight.clear();
  detailLoadChains.clear();
  try {
    localStorage.removeItem(BOXES_CACHE_KEY);
  } catch {
    /* ignore */
  }
  deskLog.tickets('clearBoxesLocalCache → cache de filas zerado');
  try {
    window.dispatchEvent(new CustomEvent('velodesk:tickets-cache-cleared'));
  } catch {
    /* ignore */
  }
}

export { isDraftTicket };

/** Protege tickets abertos/em carga contra wipe do GET /boxes durante mergePreservedDetails. */
export function setMergeProtectedTicketIds(ids) {
  mergeProtectedTicketIds.clear();
  (ids || []).forEach((id) => {
    const normalized = String(id || '').trim();
    if (normalized) mergeProtectedTicketIds.add(normalized);
  });
}

export function isApiMode() {
  return useApi;
}

export function setApiMode(enabled) {
  useApi = enabled;
}

export function getCachedColumns() {
  return columns;
}

/**
 * Assinatura das filas (id + status + updatedAt por box) — poll silencioso só re-renderiza se mudou.
 * updatedAt cobre mudanças que não alteram `status` (ex.: encaminhar para workflow), que senão
 * ficavam invisíveis para o refresh silencioso até uma ação não-silenciosa forçar o re-render.
 */
export function fingerprintQueueColumns(cols) {
  return (cols || [])
    .map((box) => {
      const sig = (box.tickets || [])
        .map((t) => `${String(t.id || t._id)}:${String(t.status || 'novo').trim().toLowerCase()}:${String(t.updatedAt || '')}`)
        .sort()
        .join(',');
      return `${box.id}=${sig}`;
    })
    .join('|');
}

function stripDraftsFromColumns(cols) {
  return (cols || []).map((box) => ({
    ...box,
    tickets: (box.tickets || [])
      .filter((ticket) => !isDraftTicket(ticket))
      .map(sanitizeTicketDetailFlags),
  }));
}

function readAutorOrigemForMerge(autor) {
  const normalized = String(autor || '').trim().toLowerCase();
  if (normalized.startsWith('responsavel:')) return 'responsavel';
  if (normalized.startsWith('wf:')) return 'workflow';
  return null;
}

function buildComunicacaoResumoForMerge(thread = []) {
  if (!thread.length) return undefined;
  const temRespostaAgente = thread.some(
    (item) => readAutorOrigemForMerge(item.autor) === 'responsavel',
  );
  const last = thread[thread.length - 1];
  return {
    ultimaOrigem: readAutorOrigemForMerge(last.autor),
    ultimaData: last.data || null,
    temRespostaAgente,
  };
}

function mergeTicketWorkflow(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const nextStatus = String(next.workflowStatus || '').trim().toLowerCase();
  const nextFinished = nextStatus === 'finished' || nextStatus === 'cancel' || Boolean(next.completedAt);
  // Poll/list sem active não pode apagar WF recém-iniciado
  const preserveActive = nextFinished ? Boolean(next.active) : Boolean(next.active || prev.active);

  if (!next.requisicao) {
    return {
      ...prev,
      ...next,
      active: preserveActive,
      requisicao: prev.requisicao,
    };
  }
  const prevReq = prev.requisicao || {};
  const nextReq = next.requisicao || {};
  const hasNextComunicacao = Array.isArray(nextReq.comunicacaoWorkflow);
  const comunicacaoWorkflow = hasNextComunicacao
    ? nextReq.comunicacaoWorkflow
    : (prevReq.comunicacaoWorkflow || []);
  const comunicacaoResumo = nextReq.comunicacaoResumo
    ?? prevReq.comunicacaoResumo
    ?? buildComunicacaoResumoForMerge(comunicacaoWorkflow);
  return {
    ...prev,
    ...next,
    active: preserveActive,
    requisicao: {
      ...prevReq,
      ...nextReq,
      valores: nextReq.valores ?? prevReq.valores,
      comunicacaoWorkflow,
      comunicacaoResumo,
      comunicacaoPendente: nextReq.comunicacaoPendente
        ?? prevReq.comunicacaoPendente
        ?? comunicacaoWorkflow.length > 0,
    },
  };
}

function normalizeContactStringList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (raw?.lista) {
    return (raw.lista || []).map((item) => String(item || '').trim()).filter(Boolean);
  }
  return [];
}

function mergeContactListField(prevVal, nextVal) {
  const prevList = normalizeContactStringList(prevVal);
  const nextList = normalizeContactStringList(nextVal);
  if (nextList.length > 0) return nextVal;
  if (prevList.length > 0) return prevVal;
  return nextVal;
}

function mergeLateralFormPreservingWorkflow(prevLf = {}, nextLf = {}) {
  const merged = { ...prevLf, ...nextLf };
  merged.clienteEmail = mergeContactListField(prevLf.clienteEmail, nextLf.clienteEmail);
  merged.clienteTelefone = mergeContactListField(prevLf.clienteTelefone, nextLf.clienteTelefone);
  if (!String(nextLf.clienteTelefoneWhatsapp || '').trim() && String(prevLf.clienteTelefoneWhatsapp || '').trim()) {
    merged.clienteTelefoneWhatsapp = prevLf.clienteTelefoneWhatsapp;
  }
  if (!String(nextLf.clienteNome || '').trim() && String(prevLf.clienteNome || '').trim()) {
    merged.clienteNome = prevLf.clienteNome;
  }
  if (!String(nextLf.clienteEmailResposta || '').trim() && String(prevLf.clienteEmailResposta || '').trim()) {
    merged.clienteEmailResposta = prevLf.clienteEmailResposta;
  }
  const nextCpf = String(nextLf.clienteCpf || nextLf.cpf || '').trim();
  const prevCpf = String(prevLf.clienteCpf || prevLf.cpf || '').trim();
  if (!nextCpf && prevCpf) {
    merged.clienteCpf = prevLf.clienteCpf || prevLf.cpf;
    merged.cpf = prevLf.cpf || prevLf.clienteCpf;
  }
  if (!nextLf.clienteId && prevLf.clienteId) {
    merged.clienteId = prevLf.clienteId;
  }
  const prevWf = prevLf.workflow || {};
  const nextWf = nextLf.workflow;
  if (!nextWf) {
    merged.workflow = prevLf.workflow;
    return merged;
  }
  merged.workflow = {
    ...prevWf,
    ...nextWf,
    requisicao: mergeTicketWorkflow(
      { requisicao: prevWf.requisicao },
      { requisicao: nextWf.requisicao },
    ).requisicao,
  };
  return merged;
}

function ticketHasDetailContent(ticket) {
  if (!ticket) return false;
  return (ticket.messages?.length || 0) > 0
    || (ticket.internalNotes?.length || 0) > 0
    || (ticket.registroHistorico?.length || 0) > 0;
}

function ticketHasClientContactData(ticket) {
  if (!ticket) return false;
  const lf = ticket.lateralForm || {};
  return normalizeContactStringList(lf.clienteEmail).length > 0
    || normalizeContactStringList(lf.clienteTelefone).length > 0
    || Boolean(String(lf.clienteNome || ticket.clientName || '').trim())
    || Boolean(String(ticket.clientEmail || '').trim());
}

/**
 * Ticket preservado (detalhe carregado, workflow pendente, draft ou load em andamento) que
 * ficou ausente da resposta mais recente de /boxes — mesmo critério de shouldPreserveTicketDetail.
 * Ausência em /boxes (fila sem coluna pra status terminal, corte de limite da query, etc.) nunca
 * é motivo pra remover um ticket do cache local; só evictTicketFromCache (404/410 real) fecha a
 * aba. Sem isso, o ticket some silenciosamente e a próxima edição do usuário falha sem erro.
 */
function shouldReinsertPreservedTicket(ticket) {
  return shouldPreserveTicketDetail(ticket);
}

function dispatchTicketEvicted(ticketId) {
  try {
    window.dispatchEvent(new CustomEvent('velodesk:ticket-evicted', {
      detail: { ticketId: String(ticketId) },
    }));
  } catch {
    /* ignore */
  }
}

/** Remove ticket do cache local (Mongo apagou ou 404) — some das filas/caixas personalizadas. */
export function evictTicketFromCache(ticketId, userEmail = '') {
  const id = String(ticketId || '').trim();
  if (!id || isDraftTicket({ id })) return false;
  if (!findInColumns(id)) return false;
  removeTicketFromColumns(id);
  mergeProtectedTicketIds.delete(id);
  detailLoadInFlight.delete(id);
  detailLoadChains.delete(id);
  persistColumnsToStorage(columns, userEmail);
  dispatchTicketEvicted(id);
  deskLog.tickets('evictTicketFromCache → removido', { ticketId: id });
  return true;
}

export function isTicketMissingFromApiError(err) {
  const status = err?.response?.status;
  return status === 404 || status === 410;
}

function ticketIdKey(ticket) {
  return String(ticket?.id || ticket?._id || '').trim();
}

function shouldPreserveTicketDetail(ticket) {
  if (!ticket || isDraftTicket(ticket)) return false;
  const id = ticketIdKey(ticket);
  if (id && (detailLoadInFlight.has(id) || mergeProtectedTicketIds.has(id))) return true;
  if (hasPendingWorkflowPersist(ticket)) return true;
  if (!ticket._detailLoaded) return false;
  return ticketHasDetailContent(ticket) || ticketHasClientContactData(ticket);
}

function sanitizeTicketDetailFlags(ticket) {
  if (!ticket || isDraftTicket(ticket)) return ticket;
  if (!ticket._detailLoaded || ticketHasDetailContent(ticket)) return ticket;
  return {
    ...ticket,
    _detailLoaded: false,
    listOnly: true,
    messages: [],
    internalNotes: [],
    registroHistorico: [],
  };
}

function mergePreservedDetails(prevCols, nextCols) {
  const preserved = new Map();
  (prevCols || []).forEach((box) => {
    (box.tickets || []).forEach((ticket) => {
      if (!shouldPreserveTicketDetail(ticket)) return;
      preserved.set(String(ticket.id || ticket._id), ticket);
    });
  });
  if (!preserved.size) return nextCols;

  const merged = nextCols.map((box) => ({
    ...box,
    tickets: (box.tickets || []).map((ticket) => {
      const id = String(ticket.id || ticket._id);
      const prev = preserved.get(id);
      if (!prev) return ticket;
      return {
        ...prev,
        status: ticket.status,
        updatedAt: ticket.updatedAt,
        createdAt: ticket.createdAt,
        boxId: ticket.boxId,
        clientName: ticket.clientName ?? prev.clientName,
        clientEmail: prev.clientEmail || ticket.clientEmail,
        clientPhone: prev.clientPhone || ticket.clientPhone,
        clienteId: prev.clienteId || ticket.clienteId,
        responsibleAgent: ticket.responsibleAgent ?? prev.responsibleAgent,
        slaBreached: ticket.slaBreached ?? prev.slaBreached,
        // `null` é um valor válido pra slaTone/slaRemainingMinutes (status não rastreado) —
        // por isso não usa `??` aqui: cairia pro valor antigo do cache até num ticket que
        // acabou de sair de "em-andamento" e legitimamente não tem mais SLA ativo.
        slaTone: ticket.slaTone !== undefined ? ticket.slaTone : prev.slaTone,
        slaRemainingMinutes: ticket.slaRemainingMinutes !== undefined
          ? ticket.slaRemainingMinutes
          : prev.slaRemainingMinutes,
        messages: (prev.messages?.length || 0) >= (ticket.messages?.length || 0)
          ? prev.messages
          : (ticket.messages?.length ? ticket.messages : prev.messages),
        internalNotes: (prev.internalNotes?.length || 0) >= (ticket.internalNotes?.length || 0)
          ? prev.internalNotes
          : (ticket.internalNotes?.length ? ticket.internalNotes : prev.internalNotes),
        registroHistorico: (prev.registroHistorico?.length || 0) >= (ticket.registroHistorico?.length || 0)
          ? prev.registroHistorico
          : (ticket.registroHistorico?.length ? ticket.registroHistorico : prev.registroHistorico),
        workflow: prev.workflow?.pendingPersist
          ? prev.workflow
          : mergeTicketWorkflow(prev.workflow, ticket.workflow),
        lateralForm: prev.workflow?.pendingPersist
          ? {
            ...mergeLateralFormPreservingWorkflow(prev.lateralForm, ticket.lateralForm),
            workflow: prev.lateralForm?.workflow,
          }
          : mergeLateralFormPreservingWorkflow(prev.lateralForm, ticket.lateralForm),
        _pendingWorkflowStart: prev._pendingWorkflowStart,
        listOnly: false,
        _detailLoaded: true,
      };
    }),
  }));

  const presentIds = new Set();
  merged.forEach((box) => {
    (box.tickets || []).forEach((ticket) => {
      presentIds.add(String(ticket.id || ticket._id));
    });
  });

  preserved.forEach((ticket, id) => {
    if (presentIds.has(id)) return;
    if (!shouldReinsertPreservedTicket(ticket)) return;
    const boxId = resolveBoxIdForTicketStatus(ticket.status);
    const box = merged.find((col) => col.id === boxId) || merged[0];
    if (!box) return;
    if (!box.tickets) box.tickets = [];
    box.tickets.unshift(ticket);
    presentIds.add(id);
  });

  return merged;
}

function persistColumnsToStorage(cols, userEmail = '') {
  try {
    const payload = {
      savedAt: Date.now(),
      userEmail: String(userEmail || '').trim().toLowerCase(),
      columns: stripDraftsFromColumns(cols),
    };
    localStorage.setItem(BOXES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota ou modo privado */
  }
}

export function hydrateColumnsFromStorage(expectedEmail = '') {
  try {
    const raw = localStorage.getItem(BOXES_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.columns?.length) return false;
    if (Date.now() - Number(parsed.savedAt || 0) > BOXES_CACHE_MAX_AGE_MS) return false;
    const normalizedExpected = String(expectedEmail || '').trim().toLowerCase();
    const normalizedStored = String(parsed.userEmail || '').trim().toLowerCase();
    if (normalizedExpected && normalizedStored && normalizedExpected !== normalizedStored) return false;
    columns = parsed.columns.map((box) => ({
      ...box,
      tickets: (box.tickets || []).map(sanitizeTicketDetailFlags),
    }));
    return true;
  } catch {
    return false;
  }
}

export function setCachedColumns(next, userEmail = '') {
  columns = next;
  persistColumnsToStorage(next, userEmail);
}

function resolveBoxIdForTicketStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'em-aberto' || normalized === 'em-andamento') return 'em-andamento';
  if (normalized === 'pendente' || normalized === 'em-espera') return 'em-espera';
  if (normalized === 'resolvido' || normalized === 'fechado') return 'resolvidos';
  if (normalized === 'cancelado') return 'cancelados';
  return 'novos';
}

function insertTicketIntoColumnsIfMissing(ticket, userEmail = '') {
  const id = String(ticket?.id || ticket?._id || '').trim();
  if (!id) return false;
  if (findInColumns(id)) return false;

  const cols = ensureDefaultColumns();
  const boxId = resolveBoxIdForTicketStatus(ticket.status);
  const box = cols.find((c) => c.id === boxId) || cols[0];
  if (!box) return false;
  if (!box.tickets) box.tickets = [];
  box.tickets.unshift(ticket);
  columns = cols;
  persistColumnsToStorage(cols, userEmail);
  return true;
}

export function patchTicketInCache(ticketId, nextTicket, userEmail = '') {
  const entry = findInColumns(ticketId);
  if (!entry) return false;
  // Substitui o item no array — entry.ticket = x só muda o wrapper local e não atualiza columns.
  entry.box.tickets[entry.index] = nextTicket;
  persistColumnsToStorage(columns, userEmail);
  try {
    syncEspeciaisGroupFromTicket(nextTicket);
  } catch {
    /* ignore sync errors */
  }
  return true;
}

async function loadTicketDetailFromApiOnce(ticketId) {
  assertApiReady('carregar ticket');
  const id = String(ticketId || '').trim();
  detailLoadInFlight.add(id);
  deskLog.tickets('loadTicketDetailFromApi → início', { ticketId: id });
  try {
    const raw = await ticketsApi.get(id);
    if (raw?.listOnly === true) {
      throw new Error('API retornou listagem resumida em vez do detalhe completo');
    }
    const prevEntry = findInColumns(id);
    const prevTicket = prevEntry?.ticket;
    let full = apiTicketToCockpit(raw);
    if (!full?.id && !full?._id) {
      throw new Error('Ticket inválido na resposta da API');
    }
    if (prevTicket && hasPendingWorkflowPersist(prevTicket)) {
      full = mergeApiTicketPreservingPendingWorkflow(prevTicket, full);
    }
    full.listOnly = false;
    full._detailLoaded = true;
    const patched = patchTicketInCache(id, full);
    if (!patched) {
      insertTicketIntoColumnsIfMissing(full);
    }
    try {
      window.dispatchEvent(new CustomEvent('velodesk:ticket-detail-changed', {
        detail: { ticketId: id },
      }));
    } catch {
      /* ignore */
    }
    try {
      syncEspeciaisGroupFromTicket(full);
    } catch {
      /* ignore sync errors */
    }
    deskLog.tickets('loadTicketDetailFromApi → ok', {
      ticketId: id,
      messages: full?.messages?.length || 0,
      internalNotes: full?.internalNotes?.length || 0,
      registroHistorico: full?.registroHistorico?.length || 0,
      requisicao: full?.workflow?.requisicao?.valores || {},
      listOnly: full.listOnly,
    });
    return full;
  } catch (err) {
    if (isTicketMissingFromApiError(err)) {
      evictTicketFromCache(id);
      return null;
    }
    deskLog.error('TICKETS', 'loadTicketDetailFromApi → falhou', {
      ticketId: id,
      status: err?.response?.status,
      message: err?.response?.data?.message || err?.message,
    });
    throw err;
  } finally {
    detailLoadInFlight.delete(id);
  }
}

export async function loadTicketDetailFromApi(ticketId) {
  const id = String(ticketId || '').trim();
  if (!id) return null;
  if (isDraftTicket({ id })) {
    deskLog.tickets('loadTicketDetailFromApi → ignorado (rascunho local)', { ticketId: id });
    return findInColumns(id)?.ticket || null;
  }
  const run = () => loadTicketDetailFromApiOnce(id);
  const prev = detailLoadChains.get(id) || Promise.resolve();
  const next = prev.then(run, run);
  detailLoadChains.set(id, next);
  try {
    return await next;
  } finally {
    if (detailLoadChains.get(id) === next) {
      detailLoadChains.delete(id);
    }
  }
}

function assertApiReady(action = 'salvar ticket') {
  if (!useApi) {
    throw new Error(`Modo offline: não foi possível ${action}. Ative a integração com o backend.`);
  }
  if (!localStorage.getItem('velodesk_token')) {
    throw new Error(`Sessão do backend indisponível. Recarregue a página para reconectar antes de ${action}.`);
  }
}

// Ticket com aba aberta/em carga não pode ser expulso do cache por ser "especial" — mesmo
// critério de proteção usado em pruneTicketsAbsentFromApi/shouldPreserveTicketDetail. Sem
// isso, o próximo poll de /boxes reaplica o filtro, o ticket some de `columns`, e o efeito de
// sincronização de abas em TicketsContext derruba a aba sozinho (ticket "abre e fecha" na
// hora — a classificação errada como Reclame Aqui/Bacen/etc. é bug à parte, mas mesmo uma
// classificação correta não deveria fechar uma aba que o agente já tem aberta).
function isEspeciaisExcludedAndUnprotected(ticket, profileId) {
  if (!isEspeciaisDeskExcludedTicket(ticket, profileId)) return false;
  const id = ticketIdKey(ticket);
  return !(id && mergeProtectedTicketIds.has(id));
}

function filterColumnsForAgent(columns) {
  const profileId = readDeskProfileId();
  // CE nunca entra no módulo Tickets (exclusão absoluta; ver_todos não libera) — precisa
  // rodar mesmo quando shouldUseMeusChamadosFila() é false, senão sessões com ver_todos/
  // gestão/workflow ficam sem esse filtro no cache local.
  if (!shouldUseMeusChamadosFila()) {
    return (columns || []).map((box) => ({
      ...box,
      tickets: (box.tickets || []).filter((ticket) => !isEspeciaisExcludedAndUnprotected(ticket, profileId)),
    }));
  }
  return (columns || []).map((box) => ({
    ...box,
    tickets: (box.tickets || []).filter((ticket) => {
      if (isEspeciaisExcludedAndUnprotected(ticket, profileId)) return false;
      if (box.id === 'resolvidos') return true;
      // Novos: responsável do agente + órfãos
      if (box.id === 'novos') return ticketBelongsInAgentNovosQueue(ticket);
      // Em andamento / Pendente: dono = responsável (WF não troca responsável).
      // Atribuído colaborador individual também enxerga; funcao:/grupo: não.
      return ticketAssignedToCurrentAgent(ticket) || ticketAtribuidoToCurrentAgent(ticket);
    }),
  }));
}

export function upsertDeskSearchTicketsInCache(apiTicket) {
  const ticket = apiTicketToCockpit(apiTicket);
  insertTicketIntoColumnsIfMissing(ticket);
  return ticket;
}

export async function loadBoxesFromApi(userEmail = '') {
  const run = async () => loadBoxesFromApiOnce(userEmail);
  loadBoxesFromApiChain = loadBoxesFromApiChain.then(run, run);
  return loadBoxesFromApiChain;
}

async function loadBoxesFromApiOnce(userEmail = '') {
  const token = localStorage.getItem('velodesk_token');
  if (!useApi || !isBackendJwtUsable(token)) {
    deskLog.tickets('loadBoxesFromApi → skip (sem API/token)', { useApi, hasToken: Boolean(token) });
    return columns;
  }
  const draftsBeforeFetch = collectDraftTickets(columns);
  deskLog.tickets('loadBoxesFromApi → início', { userEmail, drafts: draftsBeforeFetch.length });
  try {
    const profileId = readDeskProfileId();
    const params = shouldUseMeusChamadosFila(profileId) ? { fila: 'meus-chamados' } : undefined;
    const data = await boxesApi.list(params);
    const draftsAfterFetch = collectDraftTickets(columns);
    const drafts = mergeDraftSnapshots(draftsBeforeFetch, draftsAfterFetch);
    const nextCols = injectDraftTickets(
      adaptColumnsFromApi(data, { fila: params?.fila }),
      drafts,
    );
    // Usa columns no momento do merge (não snapshot no início) — evita apagar detalhe
    // carregado via GET /:id enquanto a listagem /boxes ainda estava em voo.
    columns = filterColumnsForAgent(
      pruneTicketsAbsentFromApi(
        mergePreservedDetails(columns, nextCols),
        nextCols,
      ),
    );
    persistColumnsToStorage(columns, userEmail);
    const ticketCount = columns.reduce((n, box) => n + (box.tickets?.length || 0), 0);
    const withRequisicao = columns.flatMap((b) => b.tickets || [])
      .filter((t) => t?.workflow?.requisicao?.valores && Object.keys(t.workflow.requisicao.valores).length);
    deskLog.tickets('loadBoxesFromApi → ok', {
      boxes: columns.length,
      tickets: ticketCount,
      comRequisicao: withRequisicao.length,
      amostraRequisicao: withRequisicao.slice(0, 3).map((t) => ({
        id: t.id,
        valores: t.workflow.requisicao.valores,
      })),
    });
    const cockpitEntries = columns.flatMap((box) =>
      (box.tickets || []).map((ticket) => ({ ticket, boxId: box.id })),
    );
    void loadProconTicketsFromApi();
    void loadConsumidorGovTicketsFromApi();
    void loadBacenTicketsFromApi();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('velodesk:procon-sync'));
      window.dispatchEvent(new CustomEvent('velodesk:consumidor-gov-sync'));
      window.dispatchEvent(new CustomEvent('velodesk:bacen-sync'));
    }
  } catch (err) {
    const message = err?.response?.data?.message || err?.message || 'Erro desconhecido';
    deskLog.error('TICKETS', 'loadBoxesFromApi → falhou', {
      status: err?.response?.status,
      message,
    });
    console.warn('ticketsCache: falha ao carregar boxes', message);
    throw err;
  }
  return columns;
}

export function addCustomBox(box) {
  const cols = ensureDefaultColumns();
  if (cols.some((col) => col.id === box.id)) {
    return cols.find((col) => col.id === box.id);
  }
  const nextBox = { id: box.id, name: box.name, action: box.action, tickets: [] };
  columns = [...cols, nextBox];
  return nextBox;
}

function findInColumns(ticketId) {
  const id = String(ticketId);
  for (let i = 0; i < columns.length; i++) {
    const box = columns[i];
    if (!Array.isArray(box.tickets)) continue;
    const index = box.tickets.findIndex(
      (x) => String(x.id) === id || String(x._id) === id,
    );
    if (index >= 0) {
      return { ticket: box.tickets[index], box, boxId: box.id, index };
    }
  }
  return null;
}

function removeTicketFromColumns(ticketId) {
  const id = String(ticketId);
  columns.forEach((box) => {
    if (!box.tickets) return;
    box.tickets = box.tickets.filter((t) => String(t.id) !== id && String(t._id) !== id);
  });
}

/** Aplica resposta do PUT no cache local; realoca entre filas se status/box mudou. */
function syncTicketAfterApiUpdate(ticketId, mergedTicket, userEmail = '') {
  const id = String(ticketId);
  const entry = findInColumns(id);
  const targetBoxId = mergedTicket.boxId || resolveBoxIdForTicketStatus(mergedTicket.status);

  if (entry && entry.boxId === targetBoxId) {
    patchTicketInCache(id, mergedTicket, userEmail);
  } else {
    removeTicketFromColumns(id);
    const cols = ensureDefaultColumns();
    const box = cols.find((c) => c.id === targetBoxId) || cols[0];
    if (box) {
      if (!box.tickets) box.tickets = [];
      const idx = box.tickets.findIndex(
        (t) => String(t.id) === id || String(t._id) === id,
      );
      if (idx >= 0) box.tickets[idx] = mergedTicket;
      else box.tickets.unshift(mergedTicket);
    }
    columns = cols;
    persistColumnsToStorage(cols, userEmail);
    try {
      syncEspeciaisGroupFromTicket(mergedTicket);
    } catch {
      /* ignore */
    }
  }

  dispatchTicketDetailChanged(id);
  return mergedTicket;
}

function mergePutResponseIntoCachedTicket(prevTicket, apiResponse) {
  const fromApi = apiTicketToCockpit(apiResponse);
  fromApi.listOnly = false;
  fromApi._detailLoaded = prevTicket?._detailLoaded !== false;
  return mergeApiTicketPreservingPendingWorkflow(prevTicket, fromApi);
}

/** Assumir ticket — payload mínimo (só responsável); sem GET /boxes + detalhe bloqueantes. */
export async function claimTicketResponsavelViaApi(ticketId, agentName) {
  const apiId = String(ticketId);
  const entry = findInColumns(apiId);
  if (!entry) return null;

  assertApiReady('assumir ticket');
  const prevTicket = entry.ticket;
  const responsavel = sanitizeResponsavel(agentName);
  const author = getAgentName() || responsavel;

  deskLog.tickets('claimTicketResponsavelViaApi → PUT', { ticketId: apiId });
  const apiResponse = await ticketsApi.update(apiId, {
    responsibleAgent: responsavel,
    lateralForm: { responsavel },
    author,
  });

  const merged = mergePutResponseIntoCachedTicket(prevTicket, apiResponse);
  syncTicketAfterApiUpdate(apiId, merged);
  void loadBoxesFromApi().catch(() => {});
  return merged;
}

export async function updateTicketViaApi(ticketId, updater) {
  const entry = findInColumns(ticketId);
  if (!entry) return null;

  const draft = { ...entry.ticket };
  const updated = typeof updater === 'function' ? updater(draft) : updater;
  const apiId = updated._id || updated.id;

  if (useApi && apiId && !isDraftTicket(updated)) {
    assertApiReady('atualizar ticket');
    const prevTicket = entry.ticket;
    const apiResponse = await ticketsApi.update(apiId, cockpitTicketToApi(updated));
    const merged = mergePutResponseIntoCachedTicket(prevTicket, apiResponse);
    syncTicketAfterApiUpdate(apiId, merged);
    void loadBoxesFromApi().catch(() => {});
    return merged;
  }

  entry.box.tickets[entry.index] = updated;
  return updated;
}

export async function commitTicketViaApi(ticketId, payload) {
  const apiId = String(ticketId);
  if (useApi && !isDraftTicket({ id: apiId })) {
    assertApiReady('salvar ticket');
    const prevTicket = findInColumns(apiId)?.ticket;
    const hadPendingWorkflow = hasPendingWorkflowPersist(prevTicket);
    try {
      await ticketsApi.commit(apiId, payload);
      deskLog.action('commitTicketViaApi → ok', {
        ticketId: apiId,
        sendStatus: payload?.status,
        hasText: Boolean(payload?.text),
        hasInternal: Boolean(payload?.internalText),
      });
    } catch (err) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message || err?.message || 'Erro ao salvar ticket';
      if (isTicketMissingFromApiError(err)) {
        evictTicketFromCache(apiId);
      }
      deskLog.error('TICKETS', 'commitTicketViaApi → falhou', {
        ticketId: apiId,
        status,
        message,
        sendStatus: payload?.status,
      });
      console.warn(`[VeloDesk] commit falhou (${status || '?'}): ${message}`, {
        ticketId: apiId,
        status: payload?.status,
      });
      throw err;
    }
    const detailed = await loadTicketDetailFromApi(apiId);
    void loadBoxesFromApi()
      .then(() => {
        if (!hadPendingWorkflow || !prevTicket) return;
        const entry = findInColumns(apiId);
        if (entry?.ticket) {
          entry.box.tickets[entry.index] = mergeApiTicketPreservingPendingWorkflow(
            prevTicket,
            entry.ticket,
          );
          persistColumnsToStorage(columns);
        }
      })
      .catch(() => {});
    return detailed || findInColumns(apiId)?.ticket;
  }
  return updateTicketViaApi(ticketId, () => apiTicketToCockpit(payload));
}

function dispatchTicketDetailChanged(ticketId) {
  try {
    window.dispatchEvent(new CustomEvent('velodesk:ticket-detail-changed', {
      detail: { ticketId: String(ticketId) },
    }));
  } catch {
    /* ignore */
  }
}

function cockpitMessageFromApiDto(dto) {
  if (!dto) return null;
  const isInternal = dto.type === 'internal';
  const rawTime = dto.timestamp || dto.time || new Date();
  const timestamp = rawTime instanceof Date ? rawTime.toISOString() : String(rawTime);
  return {
    ...dto,
    id: String(dto.id || `${Date.now()}-${isInternal ? 'int' : 'pub'}`),
    text: String(dto.text || ''),
    sender: dto.sender || (isInternal ? 'me' : 'them'),
    origin: dto.origin || (isInternal ? 'agente' : 'cliente'),
    author: dto.author || '',
    type: isInternal ? 'internal' : (dto.type || 'agent'),
    timestamp,
    time: timestamp,
    attachments: Array.isArray(dto.attachments) ? dto.attachments.filter(Boolean) : [],
    fromClient: !isInternal && (dto.origin === 'cliente' || dto.sender === 'them'),
  };
}

/** Mescla view=light sobre ticket em cache (threads + responsável/status). */
function mergeLightTicketIntoCached(prev, light) {
  if (!light || !prev) return prev;
  const lf = light.lateralForm || {};
  return {
    ...prev,
    messages: light.messages ?? prev.messages,
    internalNotes: light.internalNotes ?? prev.internalNotes,
    registroHistorico: light.registroHistorico ?? prev.registroHistorico,
    status: light.status ?? prev.status,
    updatedAt: light.updatedAt ?? prev.updatedAt,
    queueEntryAt: light.queueEntryAt ?? prev.queueEntryAt,
    responsibleAgent: light.responsibleAgent ?? prev.responsibleAgent,
    lateralForm: {
      ...(prev.lateralForm || {}),
      ...(lf.responsavel ? { responsavel: lf.responsavel } : {}),
    },
    _detailLoaded: true,
    listOnly: false,
  };
}

function applyAddMessageResponseToTicket(ticket, response) {
  if (!ticket || !response) return ticket;
  const internalDto = response.internalNote
    || (response.type === 'internal' ? response : null);
  const publicDto = response.publicMessage
    || (response.type && response.type !== 'internal' ? response : null);

  if (!internalDto && !publicDto) return ticket;

  const next = { ...ticket };
  next.updatedAt = new Date().toISOString();

  if (internalDto) {
    const note = cockpitMessageFromApiDto(internalDto);
    const notes = [...(next.internalNotes || [])];
    if (!notes.some((n) => String(n.id) === String(note.id))) {
      notes.push(note);
    }
    next.internalNotes = notes;

    const hist = [...(next.registroHistorico || next.registroAlteracoes || [])];
    const regIdx = note.registroIndex ?? hist.length;
    const histId = `${regIdx}-reg`;
    if (!hist.some((h) => String(h.id) === histId || (
      h.registroIndex === regIdx && String(h.anotacaoInterna || '') === note.text
    ))) {
      hist.push({
        id: histId,
        registroIndex: regIdx,
        time: note.timestamp,
        timestamp: note.timestamp,
        origin: 'agente',
        autor: note.author,
        anotacaoInterna: note.text,
        status: next.status || 'novo',
      });
    }
    next.registroHistorico = hist;
  }

  if (publicDto) {
    const msg = cockpitMessageFromApiDto(publicDto);
    const messages = [...(next.messages || [])];
    if (!messages.some((m) => String(m.id) === String(msg.id))) {
      messages.push(msg);
    }
    next.messages = messages;
  }

  return next;
}

/** Adiciona nota interna só no cache local (rascunho ou patch otimista) — sem GET /boxes. */
export function appendInternalNoteToCachedTicket(ticketId, { text, author } = {}) {
  const apiId = String(ticketId || '').trim();
  const noteText = String(text || '').trim();
  if (!apiId || !noteText) return null;

  const entry = findInColumns(apiId);
  if (!entry?.ticket) return null;

  const regKey = Date.now();
  const ts = new Date().toISOString();
  const noteAuthor = String(author || getAgentName() || '').trim();
  const note = {
    id: `${regKey}-int`,
    type: 'internal',
    origin: 'agente',
    text: noteText,
    timestamp: ts,
    time: ts,
    author: noteAuthor,
    sender: 'me',
    fromClient: false,
  };

  const prev = entry.ticket;
  const notes = [...(prev.internalNotes || []), note];
  const draftOnly = isDraftTicket(prev);
  const next = {
    ...prev,
    internalNotes: notes,
    updatedAt: ts,
    listOnly: false,
    _detailLoaded: true,
  };

  if (!draftOnly) {
    const hist = [...(prev.registroHistorico || prev.registroAlteracoes || [])];
    const regIdx = hist.length;
    hist.push({
      id: `${regIdx}-reg`,
      registroIndex: regIdx,
      time: ts,
      timestamp: ts,
      origin: 'agente',
      autor: noteAuthor,
      anotacaoInterna: noteText,
      status: prev.status || 'novo',
    });
    next.registroHistorico = hist;
  }

  if (!patchTicketInCache(apiId, next)) return null;
  dispatchTicketDetailChanged(apiId);
  return next;
}

/** Sincroniza threads/responsável em background — não bloqueia UI. */
export function refreshTicketLightFromApi(ticketId) {
  const apiId = String(ticketId);
  if (!useApi || isDraftTicket({ id: apiId })) return Promise.resolve(null);
  return ticketsApi.getLight(apiId)
    .then((raw) => {
      const entry = findInColumns(apiId);
      if (!entry?.ticket) return null;
      const light = apiTicketToCockpit(raw);
      const merged = mergeLightTicketIntoCached(entry.ticket, light);
      patchTicketInCache(apiId, merged);
      dispatchTicketDetailChanged(apiId);
      return merged;
    })
    .catch((err) => {
      deskLog.error('TICKETS', 'refreshTicketLightFromApi → falhou', {
        ticketId: apiId,
        message: err?.response?.data?.message || err?.message,
      });
      return null;
    });
}

export async function addMessageViaApi(ticketId, payload) {
  const apiId = String(ticketId);
  if (useApi && !isDraftTicket({ id: apiId })) {
    assertApiReady('enviar mensagem');
    const isInternalOnly = Boolean(payload.internal);
    const response = await ticketsApi.addMessage(apiId, payload);

    const entry = findInColumns(apiId);
    const prevTicket = entry?.ticket;
    if (prevTicket) {
      const patched = applyAddMessageResponseToTicket(prevTicket, response);
      patchTicketInCache(apiId, patched);
      dispatchTicketDetailChanged(apiId);
      void refreshTicketLightFromApi(apiId);
      return patched;
    }

    if (isInternalOnly) {
      const light = await ticketsApi.getLight(apiId);
      const full = apiTicketToCockpit(light);
      full.listOnly = false;
      full._detailLoaded = true;
      insertTicketIntoColumnsIfMissing(full);
      dispatchTicketDetailChanged(apiId);
      return full;
    }

    await loadBoxesFromApi();
    const detailed = await loadTicketDetailFromApi(apiId);
    return detailed || findInColumns(apiId)?.ticket;
  }
  return updateTicketViaApi(ticketId, (t) => {
    const isInternalOnly = Boolean(payload.internal);
    const publicText = isInternalOnly ? '' : String(payload.text ?? '').trim();
    const internalText = isInternalOnly
      ? String(payload.text ?? '').trim()
      : String(payload.internalText ?? payload.anotacaoInterna ?? '').trim();

    if (!publicText && !internalText) return t;

    const regKey = Date.now();
    const ts = new Date().toISOString();
    const author = payload.author || getAgentName() || '';

    if (publicText) {
      if (!t.messages) t.messages = [];
      t.messages.push({
        id: `${regKey}-pub`,
        type: 'agent',
        fromClient: false,
        origin: 'agente',
        text: publicText,
        timestamp: ts,
        author,
      });
    }
    if (internalText) {
      if (!t.internalNotes) t.internalNotes = [];
      t.internalNotes.push({
        id: `${regKey}-int`,
        type: 'internal',
        origin: 'agente',
        text: internalText,
        timestamp: ts,
        author,
      });
    }
    t.updatedAt = ts;
    return t;
  });
}

export async function sendWhatsAppMessageViaApi(ticketId, payload) {
  const apiId = String(ticketId);
  const initialTemplate = payload?.initialTemplate === true;
  const text = String(payload?.text ?? '').trim();
  const attachments = Array.isArray(payload?.attachments)
    ? payload.attachments.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  if (!initialTemplate && !text && !attachments.length) return null;

  if (isDraftTicket({ id: apiId })) {
    return {
      ticket: null,
      twilio: { sent: false, reason: 'Ticket em rascunho — salve antes de enviar WhatsApp' },
    };
  }

  if (useApi) {
    assertApiReady('enviar WhatsApp');
    const result = await ticketsApi.sendWhatsAppMessage(apiId, {
      text: text || undefined,
      initialTemplate: initialTemplate || undefined,
      waChatId: payload?.waChatId,
      attachments: payload?.attachments,
    });
    if (result?.ticket) {
      const full = apiTicketToCockpit(result.ticket);
      full.listOnly = false;
      full._detailLoaded = true;
      patchTicketInCache(apiId, full);
      try {
        window.dispatchEvent(new CustomEvent('velodesk:ticket-detail-changed', {
          detail: { ticketId: apiId },
        }));
      } catch {
        /* ignore */
      }
      return { ticket: full, twilio: result.twilio ?? null };
    }
    return { ticket: null, twilio: result?.twilio ?? null };
  }

  const local = await updateTicketViaApi(ticketId, (t) => {
    const ts = new Date().toISOString();
    const author = payload?.author || getAgentName() || '';
    if (!t.messages) t.messages = [];
    t.messages.push({
      id: `wa-${Date.now()}`,
      type: 'agent',
      channel: 'whatsapp',
      fromClient: false,
      origin: 'agente',
      text,
      timestamp: ts,
      time: ts,
      author,
    });
    t.updatedAt = ts;
    return t;
  });
  return { ticket: local, twilio: { sent: false, reason: 'Modo offline — mensagem só no cache local' } };
}

export function createDraftTicketInCache(form) {
  const cols = ensureDefaultColumns();
  const boxId = form.boxId || 'novos';
  const box = cols.find((col) => col.id === boxId) || cols[0];
  const now = new Date().toISOString();
  const id = `draft-${Date.now()}`;
  const payload = buildCreatePayload(form);
  const ticket = apiTicketToCockpit({
    ...payload,
    ...form,
    id,
    _id: id,
    isDraft: true,
    status: 'novo',
    createdAt: now,
    updatedAt: now,
    messages: [],
    internalNotes: [],
  });

  if (ticket.lateralForm && !String(ticket.lateralForm.produto || '').trim()) {
    ticket.lateralForm.produto = '';
    ticket.lateralForm.motivo = '';
    ticket.lateralForm.detalhe = '';
  }

  if (!box.tickets) box.tickets = [];
  box.tickets.unshift(ticket);
  columns = cols;
  return ticket;
}

/** Remove rascunho local ao fechar aba — não persiste após descarte. */
export function discardDraftTicketFromCache(ticketId, userEmail = '') {
  const id = String(ticketId || '').trim();
  if (!id || !isDraftTicket({ id })) return false;
  removeTicketFromColumns(id);
  persistColumnsToStorage(columns, userEmail);
  dispatchTicketDetailChanged(id);
  return true;
}

export async function persistDraftTicket(ticket, messageOptions = {}) {
  const draftId = String(ticket._id || ticket.id);
  assertApiReady('registrar o ticket no MongoDB');

  const opts = typeof messageOptions === 'string'
    ? { publicText: messageOptions }
    : (messageOptions || {});
  const author = opts.author || getAgentName() || undefined;

  // Um rascunho pode acumular várias mensagens/notas antes do 1º salvamento (ex.: "Enviar
  // Nota" usado para gerar o contexto da sugestão IA, depois a resposta pública enviada).
  // O endpoint de criação só aceita UM registro inicial — juntamos tudo numa linha do
  // tempo e repetimos o restante via addMessage logo após criar, senão só o último envio
  // sobrevive e o resto vira uma nota/mensagem "fantasma" que nunca chegou ao Mongo.
  const pending = [
    ...(ticket.messages || [])
      .filter((m) => m?.type === 'agent')
      .map((m) => ({
        kind: 'public',
        text: String(m.text || ''),
        attachments: Array.isArray(m.attachments) ? m.attachments.filter(Boolean) : [],
        timestamp: m.timestamp || m.time || '',
        author: m.author || author,
      })),
    ...(ticket.internalNotes || []).map((n) => ({
      kind: 'internal',
      text: String(n.text || ''),
      attachments: [],
      timestamp: n.timestamp || n.time || '',
      author: n.author || author,
    })),
  ]
    .filter((entry) => entry.text.trim() || entry.attachments.length)
    .sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  const [first, ...rest] = pending;

  const payload = cockpitTicketToApi(ticket);
  delete payload.text;
  delete payload.description;
  if (author) payload.author = author;

  if (first) {
    if (first.kind === 'public') {
      payload.text = first.text;
      if (first.text) payload.description = first.text;
      if (first.attachments.length) payload.attachments = first.attachments;
    } else {
      payload.internal = true;
      payload.text = first.text;
    }
  }

  const created = await ticketsApi.create(payload);
  const persistedId = String(created._id || created.id);

  for (const entry of rest) {
    try {
      await ticketsApi.addMessage(persistedId, {
        text: entry.text,
        internal: entry.kind === 'internal',
        ...(entry.kind === 'public' && entry.attachments.length ? { attachments: entry.attachments } : {}),
        author: entry.author,
      });
    } catch (err) {
      console.error('[persistDraftTicket] falha ao repetir registro acumulado do rascunho:', err);
    }
  }

  const finalTicket = rest.length
    ? await ticketsApi.get(persistedId).catch(() => created)
    : created;

  const persisted = apiTicketToCockpit(finalTicket);
  persisted.listOnly = false;
  persisted._detailLoaded = true;
  removeTicketFromColumns(draftId);
  insertTicketIntoColumnsIfMissing(persisted);
  void loadBoxesFromApi().catch(() => {});
  return persisted;
}

export async function createTicketViaApi(payload) {
  assertApiReady('criar ticket');
  const created = await ticketsApi.create(cockpitTicketToApi(buildCreatePayload(payload)));
  await loadBoxesFromApi();
  return apiTicketToCockpit(created);
}

export function replaceDraftIdInColumns(oldId, newTicket) {
  removeTicketFromColumns(oldId);
  const cols = ensureDefaultColumns();
  const status = newTicket.status || 'novo';
  let boxId = 'novos';
  if (status === 'em-aberto' || status === 'em-andamento') boxId = 'em-andamento';
  else if (status === 'pendente' || status === 'em-espera') boxId = 'em-espera';
  else if (status === 'resolvido' || status === 'fechado') boxId = 'resolvidos';
  else if (status === 'cancelado') boxId = 'cancelados';
  const box = cols.find((c) => c.id === boxId) || cols[0];
  if (box) {
    if (!box.tickets) box.tickets = [];
    box.tickets.unshift(apiTicketToCockpit(newTicket));
    columns = cols;
  }
}
