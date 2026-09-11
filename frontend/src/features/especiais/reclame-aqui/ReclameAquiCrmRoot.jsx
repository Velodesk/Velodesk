/**
 * ReclameAquiCrmRoot v1.2.0 — lista paginada 50
 * VERSION: v1.2.0 | DATE: 2026-08-19
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext';
import { useRaNovaReclamacaoModals } from '../../../hooks/useRaNovaReclamacaoModals';
import { RA_GROUPS } from '../../../services/especiais/reclameAquiData';
import { loadReclamacoes, searchReclamacoesFromApi, RA_LIST_PAGE_SIZE } from '../../../services/especiais/reclameAquiStore';
import {
  buildRaInitialGreetingMessage,
  fetchRaTicketView,
  loadReclameAquiTicketsFromApi,
  raTicketHasAgentReply,
  sendRaWaMessage,
} from '../../../services/especiais/reclameAquiTicketService';
import { isRaInitialMessageAnswered, markRaInitialMessageAnswered } from '../../../services/especiais/raInitialMessagePrompt';
import { getAgentName } from '../../../services/clientDb';
import { useEspeciaisTicketCommit } from '../shared/useEspeciaisTicketCommit';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import RaQueuePanel from './RaQueuePanel';
import RaTicketList from './RaTicketList';
import RaTicketMain from './RaTicketMain';
import RaTicketSide from './RaTicketSide';

export default function ReclameAquiCrmRoot() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeGroup, setActiveGroup] = useState(RA_GROUPS[0]?.id || 'vencendo-hoje');
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [activeSort, setActiveSort] = useState('data');
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => localStorage.getItem('velodeskRaQueueCollapsed') === '1',
  );
  const [listCollapsed, setListCollapsed] = useState(
    () => localStorage.getItem('velodeskRaListCollapsed') === '1',
  );
  const [listVersion, setListVersion] = useState(0);
  const [listPage, setListPage] = useState(1);
  const syncedOnceRef = useRef(false);

  const searchFn = useCallback((q) => searchReclamacoesFromApi(q), []);
  const { remoteItems, isRemoteSearch } = useEspeciaisDualSearch({
    queueQuery: appliedSearch,
    listQuery: listSearchDraft,
    searchFn,
  });

  useEffect(() => {
    const refreshFromApi = () => {
      loadReclameAquiTicketsFromApi().catch(() => {}).finally(() => {
        syncedOnceRef.current = true;
      });
    };
    refreshFromApi();
    const bumpList = () => setListVersion((v) => v + 1);
    window.addEventListener('velodesk:ra-sync', bumpList);
    window.addEventListener('velodesk:refresh-tickets', refreshFromApi);
    return () => {
      window.removeEventListener('velodesk:ra-sync', bumpList);
      window.removeEventListener('velodesk:refresh-tickets', refreshFromApi);
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
    const counts = {};
    const base = isRemoteSearch && remoteItems ? remoteItems : loadReclamacoes({});
    RA_GROUPS.forEach((g) => {
      counts[g.id] = base.filter((i) => i.groupKey === g.id).length;
    });
    return counts;
  }, [isRemoteSearch, remoteItems, listVersion]);

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
      items = [...items].sort(
        (a, b) => new Date(b.dataReclamacao || 0).getTime() - new Date(a.dataReclamacao || 0).getTime(),
      );
    }
    return items;
  }, [allItems, activeGroup, activeSort, listSearchDraft, isRemoteSearch]);

  const listTotalPages = Math.max(1, Math.ceil(listItems.length / RA_LIST_PAGE_SIZE));
  const safeListPage = Math.min(listPage, listTotalPages);
  const pagedListItems = listItems.slice((safeListPage - 1) * RA_LIST_PAGE_SIZE, safeListPage * RA_LIST_PAGE_SIZE);

  useEffect(() => {
    setListPage(1);
  }, [activeGroup, listSearchDraft, isRemoteSearch]);

  const reloadTicket = useCallback(async (silent = false) => {
    if (!id) {
      setRaItem(null);
      setTicket(null);
      setTicketLoading(false);
      setRedirectTo(null);
      return;
    }

    if (!silent) setTicketLoading(true);
    setRedirectTo(null);
    try {
      const view = await fetchRaTicketView(id);
      if (!view?.raItem) {
        if (!syncedOnceRef.current) {
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
        setTicketLoading(false);
        setRedirectTo(`/especiais/reclame-aqui/registro/${view.raItem.id}`);
        return;
      }
      setRaItem(view.raItem);
      setTicket(view.ticket);
      if (view.raItem.groupKey) {
        setActiveGroup(view.raItem.groupKey);
      }
      if (!silent) setTicketLoading(false);
    } catch {
      if (silent) return;
      showNotification('Não foi possível carregar o ticket.', 'error');
      setRaItem(null);
      setTicket(null);
      setTicketLoading(false);
    }
  }, [id, showNotification]);

  // listVersion sobe tanto por navegação real (troca de ticket) quanto por sincronizações de
  // fundo (poll do Agente 5, sininhos, salvar/finalizar) — só a primeira precisa do spinner de
  // tela cheia; as demais devem atualizar os dados sem re-exibir "Carregando ticket...".
  const lastLoadedIdRef = useRef(null);
  useEffect(() => {
    const isSameTicket = lastLoadedIdRef.current === id;
    lastLoadedIdRef.current = id;
    reloadTicket(isSameTicket);
  }, [reloadTicket, listVersion, id]);

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
    setTicket(result.ticket);
    if (result.channelItem) setRaItem(result.channelItem);
    setListVersion((v) => v + 1);
  }, []);

  const handleCommitFinalized = useCallback((result) => {
    setTicket(result.ticket);
    if (result.channelItem) setRaItem(result.channelItem);
    setActiveGroup('finalizadas');
    setListVersion((v) => v + 1);
  }, []);

  const {
    committing,
    handleSaveTicket,
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

  const handleSearchSubmit = useCallback(() => {
    setAppliedSearch(searchDraft.trim());
  }, [searchDraft]);

  const handleSelectItem = useCallback((raId) => {
    navigate(`/especiais/reclame-aqui/ticket/${raId}`, { replace: true });
  }, [navigate]);

  const handleTicketUpdated = useCallback((updatedTicket) => {
    setTicket(updatedTicket);
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
        clientName: raItem?.consumidor,
        agentName: getAgentName(),
        complaintId: raItem?.idReclamacaoRa,
      });
      const updated = await sendRaWaMessage(ticketId, text, ticket);
      if (updated) setTicket(updated);
      markRaInitialMessageAnswered(ticketId);
      setInitialMessageAnsweredLocally(true);
      showNotification('Mensagem inicial enviada ao cliente.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    } finally {
      setInitialMessageBusy(false);
    }
  }, [raItem?.ticketId, raItem?.consumidor, raItem?.idReclamacaoRa, ticket, showNotification]);

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

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="ra-crm-shell" id="reclameAquiCrmRoot">
      <RaQueuePanel
        activeGroup={activeGroup}
        searchQuery={searchDraft}
        collapsed={queueCollapsed}
        groupCounts={groupCounts}
        onSearchChange={setSearchDraft}
        onSearchSubmit={handleSearchSubmit}
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
        totalCount={listItems.length}
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
        saving={committing}
        disabled={readOnly || finalized}
        finalized={finalized}
        onClassificacaoDraftChange={handleClassificacaoDraftChange}
        initialMessagePrompt={showInitialMessagePrompt
          ? { onSend: handleSendInitialMessage, busy: initialMessageBusy }
          : null}
      />

      {novaModals}
    </div>
  );
}
