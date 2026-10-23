/**
 * Store externa do ticket aberto: atualizações de fundo (mensagem nova do WhatsApp etc.) são
 * publicadas aqui e só os componentes assinados via useLiveTicket renderizam — o ticket em
 * atendimento nunca re-renderiza inteiro por refresh/polling.
 */
import { useSyncExternalStore } from 'react';

const tickets = new Map();
const listeners = new Map();
const subscribers = new Map();

const keyOf = (ticket) => String(ticket?.id || ticket?._id || '');

export function publishLiveTicket(ticket) {
  const key = keyOf(ticket);
  if (!key) return;
  tickets.set(key, ticket);
  listeners.get(key)?.forEach((cb) => cb());
}

// função de subscribe estável por chave (useSyncExternalStore reassina se a identidade mudar)
function subscriberFor(key) {
  if (!subscribers.has(key)) {
    subscribers.set(key, (cb) => {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(cb);
      return () => listeners.get(key)?.delete(cb);
    });
  }
  return subscribers.get(key);
}

export function useLiveTicket(ticketId, fallback) {
  const key = String(ticketId || '');
  const live = useSyncExternalStore(subscriberFor(key), () => tickets.get(key));
  return live || fallback;
}
