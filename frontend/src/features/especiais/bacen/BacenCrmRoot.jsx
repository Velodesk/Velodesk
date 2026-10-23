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
import { publishLiveTicket } from '../../../services/especiais/liveTicketStore';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import BcQueuePanel from './BcQueuePanel';
import BcTicketList from './BcTicketList';
import BcTicketMain from './BcTicketMain';
import BcTicketSide from './BcTicketSide';
import { sortOldestFirst } from '../../../services/especiais/especiaisSort';
import {
  ESPECIAIS_LIST_NARROW_QUERY,
  ESPECIAIS_QUEUE_NARROW_QUERY,
  readCollapsedPreference,
  useNarrowAutoCollapse,
} from '../shared/useNarrowAutoCollapse';

export default function BacenCrmRoot() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeGroup, setActiveGroup] = useState(BC_GROUPS[0]?.id || 'vencendo-hoje');
  const [appliedSearch] = useState('');
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [activeSort, setActiveSort] = useState('data');
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => readCollapsedPreference('velodeskBcQueueCollapsed', ESPECIAIS_QUEUE_NARROW_QUERY),
  );
  const [listCollapsed, setListCollapsed] = useState(
    () => readCollapsedPreference('velodeskBcListCollapsed', ESPECIAIS_LIST_NARROW_QUERY),
  );
  useNarrowAutoCollapse(ESPECIAIS_QUEUE_NARROW_QUERY, 'velodeskBcQueueCollapsed', setQueueCollapsed);
  useNarrowAutoCollapse(ESPECIAIS_LIST_NARROW_QUERY, 'velodeskBcListCollapsed', setListCollapsed);
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
      items = sortOldestFirst(items, 'dataDemanda');
    }
    return items;
  }, [allItems, activeGroup, activeSort, listSearchDraft, isRemoteSearch]);

  // Refresh de fundo nunca deve mexer na tela: só aplica dado novo quando o conteúdo realmente
  // mudou (mantém a mesma referência senão) e jamais redireciona/limpa o ticket em atendimento.
  const ticketRef = useRef(null);
  const bcItemRef = useRef(null);
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
      setBcItem(null);
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
      const view = await fetchBcTicketView(id);
      if (!view?.bcItem) {
        if (silent || !syncedOnceRef.current) {
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
        if (silent) return;
        setTicketLoading(false);
        setRedirectTo(`/especiais/bacen/registro/${view.bcItem.id}`);
        return;
      }
      applyTicket(view.ticket);
      if (!sameData(bcItemRef.current, view.bcItem)) {
        bcItemRef.current = view.bcItem;
        setBcItem(view.bcItem);
      }
      if (!silent && view.bcItem.groupKey) {
        setActiveGroup(view.bcItem.groupKey);
      }
      setTicketLoading(false);
    } catch {
      if (silent) return;
      showNotification('Não foi possível carregar o ticket.', 'error');
      setBcItem(null);
      setTicket(null);
      setTicketLoading(false);
    }
  }, [id, showNotification, applyTicket]);

  // listVersion sobe tanto por navegação real (troca de ticket) quanto por sincronizações de
  // fundo (mensagem WhatsApp enviada, salvar/finalizar) — só a primeira precisa do spinner de
  // tela cheia; as demais devem atualizar os dados sem re-exibir "Carregando ticket...".
  useEffect(() => { ticketRef.current = ticket; }, [ticket]);
  useEffect(() => { bcItemRef.current = bcItem; }, [bcItem]);

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
    applyTicket(result.ticket);
    if (result.channelItem) setBcItem(result.channelItem);
    setListVersion((v) => v + 1);
  }, []);

  const handleCommitFinalized = useCallback((result) => {
    applyTicket(result.ticket);
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
    applyTicket(updatedTicket);
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
      if (updated) applyTicket(updated);
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
        initialMessagePrompt={initialMessagePrompt}
      />

      {demandaModals}
    </div>
  );
}
