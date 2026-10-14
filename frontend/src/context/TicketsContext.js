/**
 * TicketsContext v1.8.7 — poll de contagens busca conteúdo de verdade quando muda
 * VERSION: v1.8.7 | DATE: 2026-08-24 | AUTHOR: VeloHub Development Team
 * — antes só forçava re-render do cache antigo (lista ficava presa até refresh não-silencioso)
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { findTicketEntry, getTicketColumns, refreshTicketsFromApi, loadTicketDetailFromApi } from '../services/ticketsStorage';
import { hydrateColumnsFromStorage, patchTicketInCache, fingerprintQueueColumns, isDraftTicket } from '../services/ticketsCache';
import {
  hydrateQueueCountsFromStorage,
  refreshQueueCountsFromApi,
  fingerprintQueueCounts,
  QUEUE_COUNTS_POLL_MS,
} from '../services/desk/queueCounts';
import { getTicketProtocolLabel } from '../services/desk/utils';
import deskLog from '../utils/deskDebugLog';
import deskPlatformTrace from '../utils/deskPlatformTrace';
import { useAuth } from './AuthContext';
import { readCachedPermissions } from '../services/permissions/permissionService';

function listingScopeFingerprint() {
  const tickets = readCachedPermissions()?.permissoes?.tickets || {};
  return JSON.stringify({
    ver_todos: Boolean(tickets.ver_todos),
    ver_meus: Boolean(tickets.ver_meus),
  });
}

const TicketsContext = createContext(null);

function buildTabMeta(entry) {
  const t = entry.ticket;
  const clientName = t.clientName || t.solicitante || 'Cliente';
  const protocol = getTicketProtocolLabel(t);
  const ticketLabel = protocol || (t.isDraft || String(t.id).startsWith('draft-') ? 'Rascunho' : '');
  return {
    id: t.id,
    title: t.title || (protocol ? `Ticket ${protocol}` : 'Ticket'),
    clientName,
    ticketLabel,
  };
}

export function TicketsProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [openTabs, setOpenTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const hydratedRef = useRef(false);
  const refreshInFlightRef = useRef(null);
  const lastExplicitRefreshAtRef = useRef(0);

  const patchTicket = useCallback((ticketId, ticket) => {
    const aplicado = patchTicketInCache(ticketId, ticket);
    if (!aplicado) {
      const detail = { ticketId: String(ticketId), msgs: ticket?.messages?.length ?? null };
      deskPlatformTrace('tickets-cache', 'patchTicket:miss', detail, 'warn');
    }
    if (aplicado) {
      setRefreshKey((k) => k + 1);
      try {
        window.dispatchEvent(new CustomEvent('velodesk:ticket-detail-changed', {
          detail: { ticketId: String(ticketId) },
        }));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const runRefresh = useCallback(async (silent) => {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }
    if (!silent) {
      const now = Date.now();
      if (now - lastExplicitRefreshAtRef.current < 2000) {
        return getTicketColumns();
      }
      lastExplicitRefreshAtRef.current = now;
    }

    const queueBefore = silent ? fingerprintQueueColumns(getTicketColumns()) : null;
    const task = (async () => {
      if (isAuthenticated) {
        if (!silent) setLoading(true);
        deskLog.tickets('TicketsContext.refreshTickets → início', { silent: Boolean(silent) });
        try {
          await refreshTicketsFromApi(user?.email);
          deskLog.tickets('TicketsContext.refreshTickets → ok');
        } catch (err) {
          const status = err?.response?.status;
          const apiMsg = String(err?.response?.data?.message || '').trim();
          deskLog.error('TICKETS', 'TicketsContext.refreshTickets → falhou', {
            status,
            message: apiMsg || err?.message,
            silent: Boolean(silent),
          });
          if (silent) {
            // Atualização de fundo: falha de rede não deve poluir o console do agente
          } else if (status === 401 || status === 403) {
            console.warn('TicketsContext: sessão inválida ao carregar tickets — faça login novamente.');
          } else if (status === 503 || /mongodb|banco/i.test(apiMsg)) {
            console.warn('TicketsContext: backend/Mongo indisponível ao carregar tickets.');
          } else {
            console.warn('TicketsContext: falha ao carregar tickets.', apiMsg || err?.message);
          }
        } finally {
          if (!silent) setLoading(false);
        }
      }
      if (silent) {
        const queueAfter = fingerprintQueueColumns(getTicketColumns());
        if (queueBefore !== queueAfter) {
          setRefreshKey((k) => k + 1);
        }
      } else {
        setRefreshKey((k) => k + 1);
      }
      return getTicketColumns();
    })();

    refreshInFlightRef.current = task;
    try {
      return await task;
    } finally {
      if (refreshInFlightRef.current === task) {
        refreshInFlightRef.current = null;
      }
    }
  }, [isAuthenticated, user?.email]);

  const refreshTickets = useCallback(() => runRefresh(false), [runRefresh]);

  /** Atualização de fundo: sem spinner e sem ruído de log */
  const refreshTicketsSilent = useCallback(() => runRefresh(true), [runRefresh]);

  useEffect(() => {
    if (!isAuthenticated) {
      hydratedRef.current = false;
      return;
    }
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      if (hydrateColumnsFromStorage(user?.email)) {
        deskLog.tickets('TicketsContext: cache local hidratado');
        setRefreshKey((k) => k + 1);
      }
      if (hydrateQueueCountsFromStorage(user?.email)) {
        deskLog.tickets('TicketsContext: contadores de fila hidratados');
        setRefreshKey((k) => k + 1);
      }
    }
    void refreshQueueCountsFromApi(user?.email)
      .catch(() => { /* falha de rede/Mongo — usa cache hidratado */ })
      .finally(() => {
        setRefreshKey((k) => k + 1);
      });
    refreshTickets();
  }, [isAuthenticated, refreshTickets, user?.email, user?.role]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    let inFlight = false;
    const pollQueueCounts = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      const before = fingerprintQueueCounts();
      try {
        await refreshQueueCountsFromApi(user?.email);
        const after = fingerprintQueueCounts();
        if (before !== after) {
          // Contagem mudou → o badge lê o cache de contadores (fora do React): sem este bump a tela só
          // redesenhava se a LISTA mudasse, e o número ficava velho até o F5.
          setRefreshKey((k) => k + 1);
          // Contagem mudou → algum ticket entrou/saiu de uma fila. setRefreshKey sozinho só
          // forçava um re-render do `columns` em memória, que continuava vindo do fetch antigo
          // (a lista visível ficava presa até um refresh não-silencioso, ex.: trocar de tela e
          // voltar). refreshTicketsSilent busca o conteúdo de verdade e já cuida do refreshKey.
          void refreshTicketsSilent();
        }
      } catch {
        /* poll silencioso */
      } finally {
        inFlight = false;
      }
    };

    const onCountsChanged = () => {
      setRefreshKey((k) => k + 1);
      void refreshTicketsSilent();
    };

    const timer = window.setInterval(pollQueueCounts, QUEUE_COUNTS_POLL_MS);
    window.addEventListener('velodesk:queue-counts-changed', onCountsChanged);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('velodesk:queue-counts-changed', onCountsChanged);
    };
  }, [isAuthenticated, user?.email, refreshTicketsSilent]);

  const listingScopeRef = useRef('');

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    listingScopeRef.current = listingScopeFingerprint();
    const reloadOnPermissions = () => {
      const next = listingScopeFingerprint();
      if (next === listingScopeRef.current) {
        deskLog.tickets('TicketsContext: permissões atualizadas — listagem inalterada');
        return;
      }
      listingScopeRef.current = next;
      deskLog.tickets('TicketsContext: permissões atualizadas → recarregar filas');
      void refreshQueueCountsFromApi(user?.email);
      void refreshTicketsSilent();
    };
    const reloadOnQueuesChanged = () => {
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener('velodesk:permissions', reloadOnPermissions);
    window.addEventListener('velodesk:queues-changed', reloadOnQueuesChanged);
    return () => {
      window.removeEventListener('velodesk:permissions', reloadOnPermissions);
      window.removeEventListener('velodesk:queues-changed', reloadOnQueuesChanged);
    };
  }, [isAuthenticated, refreshTicketsSilent, user?.email]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const onTicketEvicted = (event) => {
      const ticketId = String(event?.detail?.ticketId || '').trim();
      if (!ticketId) return;
      deskLog.tickets('TicketsContext: ticket evictado — fechar aba e atualizar filas', { ticketId });
      setOpenTabs((prev) => prev.filter((tab) => String(tab.id) !== ticketId));
      setActiveTabId((current) => (String(current) === ticketId ? null : current));
      setRefreshKey((k) => k + 1);
    };
    window.addEventListener('velodesk:ticket-evicted', onTicketEvicted);
    return () => window.removeEventListener('velodesk:ticket-evicted', onTicketEvicted);
  }, [isAuthenticated]);

  useEffect(() => {
    setOpenTabs((prev) => {
      const next = prev
        .map((tab) => {
          const entry = findTicketEntry(tab.id);
          if (!entry) {
            if (isDraftTicket({ id: tab.id }) || String(tab.id).startsWith('draft-')) {
              return tab;
            }
            return null;
          }
          return { ...tab, ...buildTabMeta(entry) };
        })
        .filter(Boolean);
      setActiveTabId((current) => {
        if (!current) return current;
        if (next.some((tab) => String(tab.id) === String(current))) return current;
        return next.length ? next[next.length - 1].id : null;
      });
      return next;
    });
  }, [refreshKey]);

  const openTicket = useCallback((ticketId) => {
    const id = String(ticketId || '').trim();
    if (!id) return;
    deskLog.action('openTicket', { ticketId: id });

    const applyOpen = () => {
      const entry = findTicketEntry(id);
      if (!entry) return false;
      const meta = buildTabMeta(entry);
      setOpenTabs((prev) => {
        const idx = prev.findIndex((t) => String(t.id) === id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...meta };
          return next;
        }
        return [...prev, meta];
      });
      setActiveTabId(id);
      return true;
    };

    if (applyOpen()) return;

    void loadTicketDetailFromApi(id)
      .then((loaded) => {
        if (!loaded) return;
        if (applyOpen()) return;
        setRefreshKey((k) => k + 1);
        applyOpen();
      })
      .catch((err) => {
        deskLog.error('TICKETS', 'openTicket: falha ao carregar detalhe', {
          ticketId: id,
          status: err?.response?.status,
          message: err?.response?.data?.message || err?.message,
        });
      });
  }, [refreshKey]);

  const closeTicketTab = useCallback((ticketId) => {
    setOpenTabs((prev) => {
      const next = prev.filter((t) => String(t.id) !== String(ticketId));
      setActiveTabId((current) => {
        if (String(current) !== String(ticketId)) return current;
        return next.length ? next[next.length - 1].id : null;
      });
      return next;
    });
  }, []);

  const selectTicketFromModal = useCallback((ticketId, navigateFn) => {
    openTicket(ticketId);
    if (navigateFn) navigateFn('/tickets?desk=v2');
  }, [openTicket]);

  const replaceOpenTabId = useCallback((oldId, newId, meta = {}) => {
    setOpenTabs((prev) =>
      prev.map((tab) =>
        String(tab.id) === String(oldId)
          ? { ...tab, id: newId, ...meta }
          : tab
      )
    );
    setActiveTabId((current) => (String(current) === String(oldId) ? newId : current));
  }, []);

  return (
    <TicketsContext.Provider value={{
      openTabs,
      activeTabId,
      refreshKey,
      loading,
      openTicket,
      closeTicketTab,
      replaceOpenTabId,
      setActiveTabId,
      refreshTickets,
      refreshTicketsSilent,
      selectTicketFromModal,
      getTicketColumns,
      patchTicket,
    }}>
      {children}
    </TicketsContext.Provider>
  );
}

export function useTickets() {
  const ctx = useContext(TicketsContext);
  if (!ctx) throw new Error('useTickets requires TicketsProvider');
  return ctx;
}
