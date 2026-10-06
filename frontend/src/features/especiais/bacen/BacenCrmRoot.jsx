/**
 * BacenCrmRoot — shell CRM Bacen (fila + lista + ticket + sidebar)
 * VERSION: v1.1.0 | DATE: 2026-08-18
 * — Busca rápida dual (chamados_n1 + chamados_reclamacoes)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext';
import { useBcNovaDemandaModals } from '../../../hooks/useBcNovaDemandaModals';
import { BC_GROUPS } from '../../../services/especiais/bacenData';
import { loadDemandas, searchDemandasFromApi } from '../../../services/especiais/bacenStore';
import {
  bcTicketHasAgentReply,
  buildBcInitialGreetingMessage,
  fetchBcTicketView,
  loadBacenTicketsFromApi,
  sendBcWaMessage,
} from '../../../services/especiais/bacenTicketService';
import { isInitialMessageAnswered, markInitialMessageAnswered } from '../../../services/especiais/initialMessagePrompt';
import { getAgentName } from '../../../services/clientDb';
import { useEspeciaisTicketCommit } from '../shared/useEspeciaisTicketCommit';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import BcQueuePanel from './BcQueuePanel';
import BcTicketList from './BcTicketList';
import BcTicketMain from './BcTicketMain';
import BcTicketSide from './BcTicketSide';

export default function BacenCrmRoot() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeGroup, setActiveGroup] = useState(BC_GROUPS[0]?.id || 'vencendo-hoje');
  const [appliedSearch] = useState('');
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [activeSort, setActiveSort] = useState('data');
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => localStorage.getItem('velodeskBcQueueCollapsed') === '1',
  );
  const [listCollapsed, setListCollapsed] = useState(
    () => localStorage.getItem('velodeskBcListCollapsed') === '1',
  );
  const [listVersion, setListVersion] = useState(0);
  const syncedOnceRef = useRef(false);

  const searchFn = useCallback((q) => searchDemandasFromApi(q), []);
  const { remoteItems, isRemoteSearch } = useEspeciaisDualSearch({
    queueQuery: appliedSearch,
    listQuery: listSearchDraft,
    searchFn,
  });

  useEffect(() => {
    const refreshFromApi = () => {
      loadBacenTicketsFromApi().catch(() => {}).finally(() => {
        syncedOnceRef.current = true;
      });
    };
    refreshFromApi();
    const bumpList = () => setListVersion((v) => v + 1);
    window.addEventListener('velodesk:bacen-sync', bumpList);
    window.addEventListener('velodesk:refresh-tickets', refreshFromApi);
    return () => {
      window.removeEventListener('velodesk:bacen-sync', bumpList);
      window.removeEventListener('velodesk:refresh-tickets', refreshFromApi);
    };
  }, []);

  const { openNovaDemandaFlow, modals: demandaModals } = useBcNovaDemandaModals({ navigate });

  const [ticketLoading, setTicketLoading] = useState(true);
  const [bcItem, setBcItem] = useState(null);
  const [ticket, setTicket] = useState(null);
  const [redirectTo, setRedirectTo] = useState(null);
  const [waChatOpen, setWaChatOpen] = useState(false);
  const [waComposeText, setWaComposeText] = useState('');
  const [composeMode, setComposeMode] = useState('public');
  const [composeText, setComposeText] = useState('');
  const [internalText, setInternalText] = useState('');
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [classificacaoDraft, setClassificacaoDraft] = useState({ produto: '', motivo: '' });
  const [initialMessageBusy, setInitialMessageBusy] = useState(false);
  const [initialMessageAnsweredLocally, setInitialMessageAnsweredLocally] = useState(false);

  const allItems = useMemo(() => {
    if (isRemoteSearch && remoteItems) return remoteItems;
    return loadDemandas({});
  }, [isRemoteSearch, remoteItems, listVersion]);

  const groupCounts = useMemo(() => {
    const counts = {};
    const base = isRemoteSearch && remoteItems ? remoteItems : loadDemandas({});
    BC_GROUPS.forEach((g) => {
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
        (a, b) => new Date(a.prazoLegal || 0).getTime() - new Date(b.prazoLegal || 0).getTime(),
      );
    } else {
      items = [...items].sort(
        (a, b) => new Date(b.dataDemanda || 0).getTime() - new Date(a.dataDemanda || 0).getTime(),
      );
    }
    return items;
  }, [allItems, activeGroup, activeSort, listSearchDraft, isRemoteSearch]);

  const reloadTicket = useCallback(async (silent = false) => {
    if (!id) {
      setBcItem(null);
      setTicket(null);
      setTicketLoading(false);
      setRedirectTo(null);
      return;
    }

    if (!silent) setTicketLoading(true);
    setRedirectTo(null);
    try {
      const view = await fetchBcTicketView(id);
      if (!view?.bcItem) {
        if (!syncedOnceRef.current) {
          // ainda sincronizando com a API — mantém o loading e tenta de novo quando os dados chegarem
          return;
        }
        setBcItem(null);
        setTicket(null);
        setTicketLoading(false);
        setRedirectTo('/especiais/bacen');
        return;
      }
      if (!view.bcItem.ticketId) {
        setTicketLoading(false);
        setRedirectTo(`/especiais/bacen/registro/${view.bcItem.id}`);
        return;
      }
      setBcItem(view.bcItem);
      setTicket(view.ticket);
      if (view.bcItem.groupKey) {
        setActiveGroup(view.bcItem.groupKey);
      }
      if (!silent) setTicketLoading(false);
    } catch {
      if (silent) return;
      showNotification('Não foi possível carregar o ticket.', 'error');
      setBcItem(null);
      setTicket(null);
      setTicketLoading(false);
    }
  }, [id, showNotification]);

  // listVersion sobe tanto por navegação real (troca de ticket) quanto por sincronizações de
  // fundo (mensagem WhatsApp enviada, salvar/finalizar) — só a primeira precisa do spinner de
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
    setComposeAttachments([]);
    setClassificacaoDraft({ produto: '', motivo: '' });
    setInitialMessageAnsweredLocally(false);
  }, [id]);

  const composeSession = useMemo(() => ({
    composeText,
    internalText,
    composeAttachments,
    classificacaoDraft,
    clearCompose: (fields = {}) => {
      if (fields.composeText) setComposeText('');
      if (fields.internalText) setInternalText('');
      if (fields.composeAttachments) setComposeAttachments([]);
      if (fields.classificacao) setClassificacaoDraft({ produto: '', motivo: '' });
    },
  }), [composeText, internalText, composeAttachments, classificacaoDraft]);

  const handleCommitSaved = useCallback((result) => {
    setTicket(result.ticket);
    if (result.channelItem) setBcItem(result.channelItem);
    setListVersion((v) => v + 1);
  }, []);

  const handleCommitFinalized = useCallback((result) => {
    setTicket(result.ticket);
    if (result.channelItem) setBcItem(result.channelItem);
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
    channelId: 'bc',
    channelItem: bcItem,
    ticket,
    composeSession,
    onTicketSaved: handleCommitSaved,
    onFinalized: handleCommitFinalized,
    showNotification,
  });

  const handleSelectItem = useCallback((bcId) => {
    navigate(`/especiais/bacen/ticket/${bcId}`, { replace: true });
  }, [navigate]);

  const handleTicketUpdated = useCallback((updatedTicket) => {
    setTicket(updatedTicket);
    setListVersion((v) => v + 1);
  }, []);

  const handleClassificacaoDraftChange = useCallback((draft) => {
    setClassificacaoDraft(draft);
  }, []);

  const handleBcItemUpdated = useCallback((updated) => {
    if (updated) setBcItem(updated);
    setListVersion((v) => v + 1);
  }, []);

  const handleOpenChat = useCallback(() => {
    setWaChatOpen(true);
  }, []);

  const handleCloseChat = useCallback(() => {
    setWaChatOpen(false);
  }, []);

  const showInitialMessagePrompt = Boolean(bcItem?.ticketId)
    && !initialMessageAnsweredLocally
    && !isInitialMessageAnswered('Bc', bcItem?.ticketId)
    && !bcTicketHasAgentReply(ticket);

  const handleSendInitialMessage = useCallback(async () => {
    const ticketId = bcItem?.ticketId;
    if (!ticketId) return;

    setInitialMessageBusy(true);
    try {
      const text = buildBcInitialGreetingMessage({
        agentName: getAgentName(),
      });
      const updated = await sendBcWaMessage(ticketId, text, ticket);
      if (updated) setTicket(updated);
      markInitialMessageAnswered('Bc', ticketId);
      setInitialMessageAnsweredLocally(true);
      showNotification('Mensagem inicial enviada ao cliente.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    } finally {
      setInitialMessageBusy(false);
    }
  }, [bcItem?.ticketId, ticket, showNotification]);

  const handleQueueCollapse = useCallback((collapsed) => {
    setQueueCollapsed(collapsed);
    localStorage.setItem('velodeskBcQueueCollapsed', collapsed ? '1' : '0');
    if (!collapsed) {
      setListCollapsed(false);
      localStorage.setItem('velodeskBcListCollapsed', '0');
    }
  }, []);

  const handleListCollapse = useCallback((collapsed) => {
    setListCollapsed(collapsed);
    localStorage.setItem('velodeskBcListCollapsed', collapsed ? '1' : '0');
  }, []);

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="ra-crm-shell" id="bacenCrmRoot">
      <BcQueuePanel
        activeGroup={activeGroup}
        collapsed={queueCollapsed}
        groupCounts={groupCounts}
        onSelectGroup={setActiveGroup}
        onCollapse={() => handleQueueCollapse(true)}
        onExpand={() => handleQueueCollapse(false)}
        onNovaReclamacao={openNovaDemandaFlow}
      />

      <BcTicketList
        activeGroup={activeGroup}
        activeBcId={id}
        activeSort={activeSort}
        items={listItems}
        searchActive={!!appliedSearch.trim() || isRemoteSearch}
        listSearchQuery={listSearchDraft}
        collapsed={listCollapsed}
        onSelectItem={handleSelectItem}
        onSortChange={setActiveSort}
        onListSearchChange={setListSearchDraft}
        onListSearchSubmit={() => setListSearchDraft((v) => v.trim())}
        onCollapse={() => handleListCollapse(true)}
        onExpand={() => handleListCollapse(false)}
        onReload={() => setListVersion((v) => v + 1)}
      />

      <BcTicketMain
        bcItem={bcItem}
        ticket={ticket}
        loading={ticketLoading}
        waChatOpen={waChatOpen}
        waComposeText={waComposeText}
        onWaComposeTextChange={setWaComposeText}
        onTicketUpdated={handleTicketUpdated}
        composeMode={composeMode}
        onComposeModeChange={setComposeMode}
        composeText={composeText}
        onComposeTextChange={setComposeText}
        internalText={internalText}
        onInternalTextChange={setInternalText}
        composeAttachments={composeAttachments}
        onComposeAttachmentsChange={setComposeAttachments}
      />

      <BcTicketSide
        bcItem={bcItem}
        ticket={ticket}
        waChatOpen={waChatOpen}
        onOpenChat={handleOpenChat}
        onCloseChat={handleCloseChat}
        onTicketUpdated={handleTicketUpdated}
        onSave={handleSaveTicket}
        onFinalize={handleFinalizeTicket}
        sendStatus={ticket?.status}
        onCommitStatus={handleCommitStatus}
        saving={committing}
        disabled={readOnly || finalized}
        finalized={finalized}
        onClassificacaoDraftChange={handleClassificacaoDraftChange}
        onBcItemUpdated={handleBcItemUpdated}
        initialMessagePrompt={showInitialMessagePrompt
          ? { onSend: handleSendInitialMessage, busy: initialMessageBusy }
          : null}
      />

      {demandaModals}
    </div>
  );
}
