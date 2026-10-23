/**
 * ReclameAquiCrmRoot v1.2.0 — lista paginada 50
 * VERSION: v1.2.0 | DATE: 2026-08-19
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext';
import { useRaNovaReclamacaoModals } from '../../../hooks/useRaNovaReclamacaoModals';
import { RA_GROUPS } from '../../../services/especiais/reclameAquiData';
import {
  fetchRaPage,
  getRaServerCounts,
  loadReclamacoes,
  refreshServerCounts,
  searchReclamacoesFromApi,
  RA_LIST_PAGE_SIZE,
} from '../../../services/especiais/reclameAquiStore';
import {
  buildRaInitialGreetingMessage,
  fetchRaTicketView,
  raTicketHasAgentReply,
  sendRaWaMessage,
} from '../../../services/especiais/reclameAquiTicketService';
import { isRaInitialMessageAnswered, markRaInitialMessageAnswered } from '../../../services/especiais/raInitialMessagePrompt';
import { getAgentName } from '../../../services/clientDb';
import { useEspeciaisTicketCommit } from '../shared/useEspeciaisTicketCommit';
import { publishLiveTicket } from '../../../services/especiais/liveTicketStore';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import RaQueuePanel from './RaQueuePanel';
import RaTicketList from './RaTicketList';
import RaTicketMain from './RaTicketMain';
import RaTicketSide from './RaTicketSide';
import { sortOldestFirst } from '../../../services/especiais/especiaisSort';
import {
  ESPECIAIS_LIST_NARROW_QUERY,
  ESPECIAIS_QUEUE_NARROW_QUERY,
  readCollapsedPreference,
  useNarrowAutoCollapse,
} from '../shared/useNarrowAutoCollapse';

export default function ReclameAquiCrmRoot() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeGroup, setActiveGroup] = useState(RA_GROUPS[0]?.id || 'vencendo-hoje');
  const [appliedSearch] = useState('');
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [activeSort, setActiveSort] = useState('data');
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => readCollapsedPreference('velodeskRaQueueCollapsed', ESPECIAIS_QUEUE_NARROW_QUERY),
  );
  const [listCollapsed, setListCollapsed] = useState(
    () => readCollapsedPreference('velodeskRaListCollapsed', ESPECIAIS_LIST_NARROW_QUERY),
  );
  useNarrowAutoCollapse(ESPECIAIS_QUEUE_NARROW_QUERY, 'velodeskRaQueueCollapsed', setQueueCollapsed);
  useNarrowAutoCollapse(ESPECIAIS_LIST_NARROW_QUERY, 'velodeskRaListCollapsed', setListCollapsed);
  const [listVersion, setListVersion] = useState(0);
  const [listPage, setListPage] = useState(1);
  const [countsVersion, setCountsVersion] = useState(0);
  const [pageState, setPageState] = useState({ items: [], total: 0, loading: true });
  const syncedOnceRef = useRef(true);

  const searchFn = useCallback((q) => searchReclamacoesFromApi(q), []);
  const { remoteItems, isRemoteSearch } = useEspeciaisDualSearch({
    queueQuery: appliedSearch,
    listQuery: listSearchDraft,
    searchFn,
  });

  useEffect(() => {
    // Cards vêm do servidor (contagens) e a lista busca só a página do grupo ativo — nada de
    // baixar a base inteira. ra-counts só atualiza os cards, sem refazer a lista.
    void refreshServerCounts();
    const bumpList = () => setListVersion((v) => v + 1);
    const bumpCounts = () => setCountsVersion((v) => v + 1);
    const refreshAll = () => {
      void refreshServerCounts();
      bumpList();
    };
    window.addEventListener('velodesk:ra-sync', bumpList);
    window.addEventListener('velodesk:ra-counts', bumpCounts);
    window.addEventListener('velodesk:refresh-tickets', refreshAll);
    return () => {
      window.removeEventListener('velodesk:ra-sync', bumpList);
      window.removeEventListener('velodesk:ra-counts', bumpCounts);
      window.removeEventListener('velodesk:refresh-tickets', refreshAll);
    };
  }, []);

  const { openNovaFlow, modals: novaModals } = useRaNovaReclamacaoModals({
    navigate,
    onImported: () => setListVersion((v) => v + 1),
  });

  const [ticketLoading, setTicketLoading] = useState(true);
  const [raItem, setRaItem] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [redirectTo, setRedirectTo] = useState(null);
  const [waChatOpen, setWaChatOpen] = useState(false);
  const [waComposeText, setWaComposeText] = useState('');
  const [composeMode, setComposeMode] = useState('public');
  const [composeText, setComposeText] = useState('');
  const [internalText, setInternalText] = useState('');
  const [clienteText, setClienteText] = useState('');
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [classificacaoDraft, setClassificacaoDraft] = useState({ produto: '', motivo: '' });
  const [initialMessageBusy, setInitialMessageBusy] = useState(false);
  const [initialMessageAnsweredLocally, setInitialMessageAnsweredLocally] = useState(false);

  const allItems = useMemo(() => {
    if (isRemoteSearch && remoteItems) return remoteItems;
    return loadReclamacoes({});
  }, [isRemoteSearch, remoteItems, listVersion]);

  const groupCounts = useMemo(() => {
    const serverCounts = !isRemoteSearch ? getRaServerCounts() : null;
    if (serverCounts?.grupos) return { ...serverCounts.grupos };
    const counts = {};
    const base = isRemoteSearch && remoteItems ? remoteItems : loadReclamacoes({});
    RA_GROUPS.forEach((g) => {
      counts[g.id] = base.filter((i) => i.groupKey === g.id).length;
    });
    return counts;
  }, [isRemoteSearch, remoteItems, listVersion, countsVersion]);

  const listItems = useMemo(() => {
    const listQuery = listSearchDraft.trim();
    let items = (listQuery || isRemoteSearch)
      ? allItems
      : allItems.filter((i) => i.groupKey === activeGroup);
    if (activeSort === 'sla') {
      items = [...items].sort(
        (a, b) => new Date(a.prazoRa || 0).getTime() - new Date(b.prazoRa || 0).getTime(),
      );
    } else {
      items = sortOldestFirst(items, 'dataReclamacao');
    }
    return items;
  }, [allItems, activeGroup, activeSort, listSearchDraft, isRemoteSearch]);

  useEffect(() => {
    if (listVersion > 0) void refreshServerCounts();
  }, [listVersion]);

  const usingServerPage = !listSearchDraft.trim() && !isRemoteSearch;
  const listTotalCount = usingServerPage ? pageState.total : listItems.length;
  const listTotalPages = Math.max(1, Math.ceil(listTotalCount / RA_LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);
  const pagedListItems = usingServerPage
    ? pageState.items
    : listItems.slice((safeListPage - 1) * RA_LIST_PAGE_SIZE, safeListPage * RA_LIST_PAGE_SIZE);

  useEffect(() => {
    if (!usingServerPage) return undefined;
    let cancelled = false;
    setPageState((prev) => ({ ...prev, loading: true }));
    fetchRaPage({ grupo: activeGroup, sort: activeSort, page: listPage })
      .then((res) => {
        if (!cancelled) setPageState({ items: res.items, total: res.total, loading: false });
      })
      .catch(() => {
        if (!cancelled) setPageState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [usingServerPage, activeGroup, activeSort, listPage, listVersion]);

  useEffect(() => {
    setListPage(1);
  }, [activeGroup, listSearchDraft, isRemoteSearch]);

  // Refresh de fundo nunca deve mexer na tela: só aplica dado novo quando o conteúdo realmente
  // mudou (mantém a mesma referência senão) e jamais redireciona/limpa o ticket em atendimento.
  const ticketRef = useRef(null);
  const raItemRef = useRef(null);
  const sameData = (a, b) => {
    if (a === b) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  };

  // Campos que mudam quando chega mensagem/nota nova: vão só pela store externa (re-render restrito
  // à lista de mensagens), nunca por setTicket — que re-renderizaria o ticket inteiro.
  const withoutThread = (tk) => {
    if (!tk) return tk;
    const { messages, internalNotes, registroHistorico, updatedAt, ...rest } = tk;
    return rest;
  };

  const applyTicket = useCallback((next) => {
    if (!next) return;
    const prev = ticketRef.current;
    publishLiveTicket(next);
    if (prev && String(prev.id) === String(next.id) && sameData(withoutThread(prev), withoutThread(next))) {
      ticketRef.current = next;
      return;
    }
    ticketRef.current = next;
    setTicket(next);
  }, []);

  const reloadTicket = useCallback(async (silent = false) => {
    if (!id) {
      setRaItem(null);
      setTicket(null);
      setTicketLoading(false);
      setRedirectTo(null);
      return;
    }

    if (!silent) {
      setTicketLoading(true);
      setRedirectTo(null);
    }
    try {
      const view = await fetchRaTicketView(id);
      if (!view?.raItem) {
        if (silent || !syncedOnceRef.current) {
          // ainda sincronizando com a API — mantém o loading e tenta de novo quando os dados chegarem
          return;
        }
        setRaItem(null);
        setTicket(null);
        setTicketLoading(false);
        setRedirectTo('/especiais/reclame-aqui');
        return;
      }
      if (!view.raItem.ticketId) {
        if (silent) return;
        setTicketLoading(false);
        setRedirectTo(`/especiais/reclame-aqui/registro/${view.raItem.id}`);
        return;
      }
      applyTicket(view.ticket);
      if (!sameData(raItemRef.current, view.raItem)) {
        raItemRef.current = view.raItem;
        setRaItem(view.raItem);
      }
      if (!silent && view.raItem.groupKey) {
        setActiveGroup(view.raItem.groupKey);
      }
      setTicketLoading(false);
    } catch {
      if (silent) return;
      showNotification('Não foi possível carregar o ticket.', 'error');
      setRaItem(null);
      setTicket(null);
      setTicketLoading(false);
    }
  }, [id, showNotification, applyTicket]);

  // listVersion sobe tanto por navegação real (troca de ticket) quanto por sincronizações de
  // fundo (poll do Agente 5, sininhos, salvar/finalizar) — só a primeira precisa do spinner de
  // tela cheia; as demais devem atualizar os dados sem re-exibir "Carregando ticket...".
  useEffect(() => { ticketRef.current = ticket; }, [ticket]);
  useEffect(() => { raItemRef.current = raItem; }, [raItem]);

  const lastLoadedIdRef = useRef(null);
  useEffect(() => {
    const isSameTicket = lastLoadedIdRef.current === id;
    lastLoadedIdRef.current = id;
    reloadTicket(isSameTicket);
  }, [reloadTicket, listVersion, id]);

  // Tempo real do ticket aberto: puxa o ticket em silêncio; mensagem nova entra pela store externa
  // (sem re-render do ticket). Pausa com a aba oculta e nunca sobrepõe duas buscas.
  useEffect(() => {
    if (!id) return undefined;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        await reloadTicket(true);
      } finally {
        busy = false;
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [id, reloadTicket]);

  useEffect(() => {
    setWaChatOpen(false);
    setWaComposeText('');
    setComposeMode('public');
    setComposeText('');
    setInternalText('');
    setClienteText('');
    setComposeAttachments([]);
    setClassificacaoDraft({ produto: '', motivo: '' });
    setInitialMessageAnsweredLocally(false);
  }, [id]);

  const composeSession = useMemo(() => ({
    composeText,
    internalText,
    clienteText,
    composeAttachments,
    classificacaoDraft,
    clearCompose: (fields = {}) => {
      if (fields.composeText) setComposeText('');
      if (fields.internalText) setInternalText('');
      if (fields.clienteText) setClienteText('');
      if (fields.composeAttachments) setComposeAttachments([]);
      if (fields.classificacao) setClassificacaoDraft({ produto: '', motivo: '' });
    },
  }), [composeText, internalText, clienteText, composeAttachments, classificacaoDraft]);

  const handleCommitSaved = useCallback((result) => {
    applyTicket(result.ticket);
    if (result.channelItem) setRaItem(result.channelItem);
    setListVersion((v) => v + 1);
  }, []);

  const handleCommitFinalized = useCallback((result) => {
    applyTicket(result.ticket);
    if (result.channelItem) setRaItem(result.channelItem);
    setActiveGroup('finalizadas');
    setListVersion((v) => v + 1);
  }, []);

  const {
    committing,
    handleSaveTicket,
    handleCommitStatus,
    handleFinalizeTicket,
    finalized,
    readOnly,
  } = useEspeciaisTicketCommit({
    channelId: 'ra',
    channelItem: raItem,
    ticket,
    composeSession,
    onTicketSaved: handleCommitSaved,
    onFinalized: handleCommitFinalized,
    showNotification,
  });

  const handleSelectItem = useCallback((raId) => {
    navigate(`/especiais/reclame-aqui/ticket/${raId}`, { replace: true });
  }, [navigate]);

  const handleTicketUpdated = useCallback((updatedTicket) => {
    applyTicket(updatedTicket);
    setListVersion((v) => v + 1);
  }, []);

  const handleModeracaoSaved = useCallback((updatedRaItem) => {
    if (updatedRaItem) setRaItem(updatedRaItem);
    setListVersion((v) => v + 1);
  }, []);

  const showInitialMessagePrompt = Boolean(raItem?.ticketId)
    && !initialMessageAnsweredLocally
    && !isRaInitialMessageAnswered(raItem?.ticketId)
    && !raTicketHasAgentReply(ticket);

  const handleSendInitialMessage = useCallback(async () => {
    const ticketId = raItem?.ticketId;
    if (!ticketId) return;

    setInitialMessageBusy(true);
    try {
      const text = buildRaInitialGreetingMessage({
        agentName: getAgentName(),
      });
      const updated = await sendRaWaMessage(ticketId, text, ticket);
      if (updated) applyTicket(updated);
      markRaInitialMessageAnswered(ticketId);
      setInitialMessageAnsweredLocally(true);
      showNotification('Mensagem inicial enviada ao cliente.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    } finally {
      setInitialMessageBusy(false);
    }
  }, [raItem?.ticketId, ticket, showNotification]);

  const handleClassificacaoDraftChange = useCallback((draft) => {
    setClassificacaoDraft(draft);
  }, []);

  const handleOpenChat = useCallback(() => {
    setWaChatOpen(true);
  }, []);

  const handleCloseChat = useCallback(() => {
    setWaChatOpen(false);
  }, []);

  const handleQueueCollapse = useCallback((collapsed) => {
    setQueueCollapsed(collapsed);
    localStorage.setItem('velodeskRaQueueCollapsed', collapsed ? '1' : '0');
    if (!collapsed) {
      setListCollapsed(false);
      localStorage.setItem('velodeskRaListCollapsed', '0');
    }
  }, []);

  const handleListCollapse = useCallback((collapsed) => {
    setListCollapsed(collapsed);
    localStorage.setItem('velodeskRaListCollapsed', collapsed ? '1' : '0');
  }, []);

  const initialMessagePrompt = useMemo(
    () => (showInitialMessagePrompt
      ? { onSend: handleSendInitialMessage, busy: initialMessageBusy }
      : null),
    [showInitialMessagePrompt, handleSendInitialMessage, initialMessageBusy],
  );

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="ra-crm-shell" id="reclameAquiCrmRoot">
      <RaQueuePanel
        activeGroup={activeGroup}
        collapsed={queueCollapsed}
        groupCounts={groupCounts}
        onSelectGroup={setActiveGroup}
        onCollapse={() => handleQueueCollapse(true)}
        onExpand={() => handleQueueCollapse(false)}
        onNovaReclamacao={openNovaFlow}
      />

      <RaTicketList
        activeGroup={activeGroup}
        activeRaId={id}
        activeSort={activeSort}
        items={pagedListItems}
        searchActive={!!appliedSearch.trim() || isRemoteSearch}
        listSearchQuery={listSearchDraft}
        collapsed={listCollapsed}
        page={safeListPage}
        totalPages={listTotalPages}
        totalCount={listTotalCount}
        onPageChange={setListPage}
        onSelectItem={handleSelectItem}
        onSortChange={setActiveSort}
        onListSearchChange={setListSearchDraft}
        onListSearchSubmit={() => setListSearchDraft((v) => v.trim())}
        onCollapse={() => handleListCollapse(true)}
        onExpand={() => handleListCollapse(false)}
        onReload={() => setListVersion((v) => v + 1)}
      />

      <RaTicketMain
        raItem={raItem}
        ticket={ticket}
        loading={ticketLoading}
        waChatOpen={waChatOpen}
        waComposeText={waComposeText}
        onWaComposeTextChange={setWaComposeText}
        onOpenWaChat={handleOpenChat}
        onTicketUpdated={handleTicketUpdated}
        onModeracaoSaved={handleModeracaoSaved}
        composeMode={composeMode}
        onComposeModeChange={setComposeMode}
        composeText={composeText}
        onComposeTextChange={setComposeText}
        internalText={internalText}
        onInternalTextChange={setInternalText}
        composeAttachments={composeAttachments}
        onComposeAttachmentsChange={setComposeAttachments}
        clienteText={clienteText}
        onClienteTextChange={setClienteText}
      />

      <RaTicketSide
        raItem={raItem}
        ticket={ticket}
        waChatOpen={waChatOpen}
        onOpenChat={handleOpenChat}
        onCloseChat={handleCloseChat}
        onTicketUpdated={handleTicketUpdated}
        onRaItemUpdated={handleModeracaoSaved}
        onSave={handleSaveTicket}
        onFinalize={handleFinalizeTicket}
        sendStatus={ticket?.status}
        onCommitStatus={handleCommitStatus}
        saving={committing}
        disabled={readOnly || finalized}
        finalized={finalized}
        onClassificacaoDraftChange={handleClassificacaoDraftChange}
        initialMessagePrompt={initialMessagePrompt}
      />

      {novaModals}
    </div>
  );
}
