/**
 * ticketsStorage v1.4.6 — export discardDraftTicketFromCache
 * VERSION: v1.4.6 | DATE: 2026-08-21
 */
import {
  getCachedColumns,
  setCachedColumns,
  loadBoxesFromApi,
  updateTicketViaApi,
  commitTicketViaApi,
  addMessageViaApi,
  sendWhatsAppMessageViaApi,
  createTicketViaApi,
  createDraftTicketInCache,
  persistDraftTicket,
  isDraftTicket,
  isApiMode,
  claimTicketResponsavelViaApi,
  clearBoxesLocalCache,
  appendInternalNoteToCachedTicket,
  discardDraftTicketFromCache,
} from './ticketsCache';
import { apiTicketToCockpit } from '../api/adapters/ticketAdapter';

export async function refreshTicketsFromApi(userEmail = '') {
  return loadBoxesFromApi(userEmail);
}

export function getTicketColumns() {
  return getCachedColumns();
}

export function saveTicketColumns(nextColumns) {
  setCachedColumns(nextColumns);
}

export function findTicketEntry(ticketId) {
  const id = String(ticketId);
  const cols = getTicketColumns();
  for (let i = 0; i < cols.length; i++) {
    const box = cols[i];
    const t = (box.tickets || []).find((x) => String(x.id) === id || String(x._id) === id);
    if (t) return { ticket: t, boxId: box.id, box, queueId: mapTicketQueueId(t, box.id) };
  }
  return null;
}

export function getAllCockpitTickets() {
  const cols = getTicketColumns();
  const list = [];
  cols.forEach((box) => {
    (box.tickets || []).forEach((t) => {
      list.push({ ticket: t, boxId: box.id, queueId: mapTicketQueueId(t, box.id) });
    });
  });
  return list;
}

const QUEUE_MAP = {
  novos: ['novos', 'novo'],
  'em-andamento': ['em-andamento', 'em-aberto'],
  pendente: ['em-espera', 'pendentes', 'pendente'],
  /** Resolvidos = resolvido + fechado. Cancelado tem bucket próprio — nunca conta nem aparece aqui. */
  resolvidos: ['resolvidos', 'resolvido', 'fechado'],
  cancelados: ['cancelado'],
};

import { loadCustomQueues } from './desk/customQueueBoxes';

export function mapTicketQueueId(ticket, boxId) {
  const custom = loadCustomQueues().find((item) => item.id === boxId || item.boxes?.includes(boxId));
  if (custom) return custom.id;

  const normalizedBox = String(boxId || ticket?.boxId || '').trim();
  if (normalizedBox === 'resolvidos' || normalizedBox === 'meus-resolvidos') return 'resolvidos';
  if (normalizedBox === 'novos' || normalizedBox === 'meus-novos') return 'novos';
  if (
    normalizedBox === 'em-espera'
    || normalizedBox === 'pendentes'
    || normalizedBox === 'pendente'
    || normalizedBox === 'meus-pendente'
  ) return 'pendente';
  if (
    normalizedBox === 'em-andamento'
    || normalizedBox === 'em-aberto'
    || normalizedBox === 'meus-em-andamento'
    || normalizedBox === 'meus-em-aberto'
  ) return 'em-andamento';

  const status = String(ticket?.status || '').trim().toLowerCase();
  const entries = Object.entries(QUEUE_MAP);
  for (let i = 0; i < entries.length; i++) {
    const [queueId, boxes] = entries[i];
    if (boxes.indexOf(status) >= 0) return queueId;
  }
  if (normalizedBox === 'novos') return 'novos';
  if (normalizedBox === 'resolvidos') return 'resolvidos';
  if (normalizedBox === 'pendentes' || normalizedBox === 'em-espera') return 'pendente';
  return 'em-andamento';
}

export async function updateTicketInCache(ticketId, updater) {
  return updateTicketViaApi(ticketId, updater);
}

export { commitTicketViaApi, sendWhatsAppMessageViaApi };

export async function sendTicketMessage(ticketId, text, author) {
  return addMessageViaApi(ticketId, { text, internal: false, author });
}

export async function sendInternalNote(ticketId, text, author) {
  return addMessageViaApi(ticketId, { text, internal: true, author });
}

export async function sendTicketRegistroEntry(ticketId, { text = '', internalText = '', author } = {}) {
  return addMessageViaApi(ticketId, {
    text,
    internalText,
    internal: false,
    author,
  });
}

export async function addTicketToBox(boxId, ticket) {
  if (isApiMode() && localStorage.getItem('velodesk_token')) {
    const payload = {
      ...ticket,
      status: ticket.status || 'novo',
      boxId,
    };
    const created = await createTicketViaApi(payload);
    return created ? apiTicketToCockpit(created) : null;
  }

  const cols = getTicketColumns();
  const box = cols.find((c) => c.id === boxId);
  if (!box) return null;
  if (!box.tickets) box.tickets = [];
  const normalized = apiTicketToCockpit(ticket);
  box.tickets.unshift(normalized);
  setCachedColumns(cols);
  return normalized;
}

export {
  createDraftTicketInCache,
  persistDraftTicket,
  isDraftTicket,
  claimTicketResponsavelViaApi,
  clearBoxesLocalCache,
  appendInternalNoteToCachedTicket,
  discardDraftTicketFromCache,
};

export { loadTicketDetailFromApi, patchTicketInCache } from './ticketsCache';
