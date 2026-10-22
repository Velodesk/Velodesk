/**
 * ConsumidorGovCrmRoot — shell CRM Consumidor.Gov (fila + lista + ticket + sidebar)
 * VERSION: v1.1.0 | DATE: 2026-08-18
 * — Busca rápida dual (chamados_n1 + chamados_reclamacoes)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext';
import { useCgNovaDemandaModals } from '../../../hooks/useCgNovaDemandaModals';
import { CG_GROUPS } from '../../../services/especiais/consumidorGovData';
import { loadDemandas, searchDemandasFromApi } from '../../../services/especiais/consumidorGovStore';
import { publishLiveTicket } from '../../../services/especiais/liveTicketStore';
import {
  buildCgInitialGreetingMessage,
  cgTicketHasAgentReply,
  fetchCgTicketView,
  loadConsumidorGovTicketsFromApi,
  sendCgWaMessage,
} from '../../../services/especiais/consumidorGovTicketService';
import { isInitialMessageAnswered, markInitialMessageAnswered } from '../../../services/especiais/initialMessagePrompt';
import { getAgentName } from '../../../services/clientDb';
import { useEspeciaisTicketCommit } from '../shared/useEspeciaisTicketCommit';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import CgQueuePanel from './CgQueuePanel';
import CgTicketList from './CgTicketList';
import CgTicketMain from './CgTicketMain';
import CgTicketSide from './CgTicketSide';
import { sortOldestFirst } from '../../../services/especiais/especiaisSort';
import {
  ESPECIAIS_LIST_NARROW_QUERY,
  ESPECIAIS_QUEUE_NARROW_QUERY,
  readCollapsedPreference,
  useNarrowAutoCollapse,
} from '../shared/useNarrowAutoCollapse';

export default function ConsumidorGovCrmRoot() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeGroup, setActiveGroup] = useState(CG_GROUPS[0]?.id || 'vencendo-hoje');
  const [appliedSearch] = useState('');
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [activeSort, setActiveSort] = useState('data');
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => readCollapsedPreference('velodeskCgQueueCollapsed', ESPECIAIS_QUEUE_NARROW_QUERY),
  );
  const [listCollapsed, setListCollapsed] = useState(
    () => readCollapsedPreference('velodeskCgListCollapsed', ESPECIAIS_LIST_NARROW_QUERY),
  );
  useNarrowAutoCollapse(ESPECIAIS_QUEUE_NARROW_QUERY, 'velodeskCgQueueCollapsed', setQueueCollapsed);
  useNarrowAutoCollapse(ESPECIAIS_LIST_NARROW_QUERY, 'velodeskCgListCollapsed', setListCollapsed);
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
      loadConsumidorGovTicketsFromApi().catch(() => {}).finally(() => {
        syncedOnceRef.current = true;
      });
    };
    refreshFromApi();
    const bumpList = () => setListVersion((v) => v + 1);
    window.addEventListener('velodesk:consumidor-gov-sync', bumpList);
    window.addEventListener('velodesk:refresh-tickets', refreshFromApi);
    return () => {
      window.removeEventListener('velodesk:consumidor-gov-sync', bumpList);
      window.removeEventListener('velodesk:refresh-tickets', refreshFromApi);
    };
  }, []);

  const { openNovaDemandaFlow, modals: demandaModals } = useCgNovaDemandaModals({ navigate });

  const [ticketLoading, setTicketLoading] = useState(true);
  const [cgItem, setCgItem] = useState(null);
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
    CG_GROUPS.forEach((g) => {
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
  const cgItemRef = useRef(null);
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
  const withoutThread = (t) => {
    if (!t) return t;
    const { messages, internalNotes, registroHistorico, updatedAt, ...rest } = t;
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
      setCgItem(null);
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
      const view = await fetchCgTicketView(id);
      if (!view?.cgItem) {
        if (silent || !syncedOnceRef.current) {
          // sync de fundo (ou ainda sincronizando): mantém o que está na tela
          return;
        }
        setCgItem(null);
        setTicket(null);
        setTicketLoading(false);
        setRedirectTo('/especiais/consumidor-gov');
        return;
      }
      if (!view.cgItem.ticketId) {
        if (silent) return;
        setTicketLoading(false);
        setRedirectTo(`/especiais/consumidor-gov/registro/${view.cgItem.id}`);
        return;
      }
      applyTicket(view.ticket);
      if (!silent || !sameData(cgItemRef.current, view.cgItem)) {
        cgItemRef.current = view.cgItem;
        setCgItem(view.cgItem);
      }
      if (!silent && view.cgItem.groupKey) {
        setActiveGroup(view.cgItem.groupKey);
      }
      setTicketLoading(false);
    } catch {
      if (silent) return;
      showNotification('Não foi possível carregar o ticket.', 'error');
      setCgItem(null);
      setTicket(null);
      setTicketLoading(false);
    }
  }, [id, showNotification, applyTicket]);

  // listVersion sobe tanto por navegação real (troca de ticket) quanto por sincronizações de
  // fundo (mensagem WhatsApp enviada, salvar/finalizar) — só a primeira precisa do spinner de
  // tela cheia; as demais devem atualizar os dados sem re-exibir "Carregando ticket...".
  useEffect(() => { ticketRef.current = ticket; }, [ticket]);
  useEffect(() => { cgItemRef.current = cgItem; }, [cgItem]);

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
    if (result.channelItem) setCgItem(result.channelItem);
    setListVersion((v) => v + 1);
  }, []);

  const handleCommitFinalized = useCallback((result) => {
    applyTicket(result.ticket);
    if (result.channelItem) setCgItem(result.channelItem);
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
    channelId: 'gov',
    channelItem: cgItem,
    ticket,
    composeSession,
    onTicketSaved: handleCommitSaved,
    onFinalized: handleCommitFinalized,
    showNotification,
  });

  const handleSelectItem = useCallback((cgId) => {
    navigate(`/especiais/consumidor-gov/ticket/${cgId}`, { replace: true });
  }, [navigate]);

  const handleTicketUpdated = useCallback((updatedTicket) => {
    applyTicket(updatedTicket);
    setListVersion((v) => v + 1);
  }, []);

  const handleClassificacaoDraftChange = useCallback((draft) => {
    setClassificacaoDraft(draft);
  }, []);

  const handleCgItemUpdated = useCallback((updated) => {
    if (updated) setCgItem(updated);
    setListVersion((v) => v + 1);
  }, []);

  const handleOpenChat = useCallback(() => {
    setWaChatOpen(true);
  }, []);

  const handleCloseChat = useCallback(() => {
    setWaChatOpen(false);
  }, []);

  const showInitialMessagePrompt = Boolean(cgItem?.ticketId)
    && !initialMessageAnsweredLocally
    && !isInitialMessageAnswered('Cg', cgItem?.ticketId)
    && !cgTicketHasAgentReply(ticket);

  const handleSendInitialMessage = useCallback(async () => {
    const ticketId = cgItem?.ticketId;
    if (!ticketId) return;

    setInitialMessageBusy(true);
    try {
      const text = buildCgInitialGreetingMessage({
        agentName: getAgentName(),
      });
      const updated = await sendCgWaMessage(ticketId, text, ticket);
      if (updated) applyTicket(updated);
      markInitialMessageAnswered('Cg', ticketId);
      setInitialMessageAnsweredLocally(true);
      showNotification('Mensagem inicial enviada ao cliente.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    } finally {
      setInitialMessageBusy(false);
    }
  }, [cgItem?.ticketId, ticket, showNotification]);

  const initialMessagePrompt = useMemo(
    () => (showInitialMessagePrompt
      ? { onSend: handleSendInitialMessage, busy: initialMessageBusy }
      : null),
    [showInitialMessagePrompt, handleSendInitialMessage, initialMessageBusy],
  );

  const handleQueueCollapse = useCallback((collapsed) => {
    setQueueCollapsed(collapsed);
    localStorage.setItem('velodeskCgQueueCollapsed', collapsed ? '1' : '0');
    if (!collapsed) {
      setListCollapsed(false);
      localStorage.setItem('velodeskCgListCollapsed', '0');
    }
  }, []);

  const handleListCollapse = useCallback((collapsed) => {
    setListCollapsed(collapsed);
    localStorage.setItem('velodeskCgListCollapsed', collapsed ? '1' : '0');
  }, []);

  if (redirectTo) {
    return <Navigate to={redirectTo} replace />;
  }

  return (
    <div className="ra-crm-shell" id="consumidorGovCrmRoot">
      <CgQueuePanel
        activeGroup={activeGroup}
        collapsed={queueCollapsed}
        groupCounts={groupCounts}
        onSelectGroup={setActiveGroup}
        onCollapse={() => handleQueueCollapse(true)}
        onExpand={() => handleQueueCollapse(false)}
        onNovaReclamacao={openNovaDemandaFlow}
      />

      <CgTicketList
        activeGroup={activeGroup}
        activeCgId={id}
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

      <CgTicketMain
        cgItem={cgItem}
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

      <CgTicketSide
        cgItem={cgItem}
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
        onCgItemUpdated={handleCgItemUpdated}
        initialMessagePrompt={initialMessagePrompt}
      />

      {demandaModals}
    </div>
  );
}
