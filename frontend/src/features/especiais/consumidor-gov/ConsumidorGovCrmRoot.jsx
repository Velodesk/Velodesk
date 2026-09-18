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
import { fetchCgTicketView, loadConsumidorGovTicketsFromApi } from '../../../services/especiais/consumidorGovTicketService';
import { useEspeciaisTicketCommit } from '../shared/useEspeciaisTicketCommit';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import CgQueuePanel from './CgQueuePanel';
import CgTicketList from './CgTicketList';
import CgTicketMain from './CgTicketMain';
import CgTicketSide from './CgTicketSide';

export default function ConsumidorGovCrmRoot() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeGroup, setActiveGroup] = useState(CG_GROUPS[0]?.id || 'vencendo-hoje');
  const [appliedSearch] = useState('');
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [activeSort, setActiveSort] = useState('data');
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => localStorage.getItem('velodeskCgQueueCollapsed') === '1',
  );
  const [listCollapsed, setListCollapsed] = useState(
    () => localStorage.getItem('velodeskCgListCollapsed') === '1',
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
      items = [...items].sort(
        (a, b) => new Date(b.dataDemanda || 0).getTime() - new Date(a.dataDemanda || 0).getTime(),
      );
    }
    return items;
  }, [allItems, activeGroup, activeSort, listSearchDraft, isRemoteSearch]);

  const reloadTicket = useCallback(async () => {
    if (!id) {
      setCgItem(null);
      setTicket(null);
      setTicketLoading(false);
      setRedirectTo(null);
      return;
    }

    setTicketLoading(true);
    setRedirectTo(null);
    try {
      const view = await fetchCgTicketView(id);
      if (!view?.cgItem) {
        if (!syncedOnceRef.current) {
          // ainda sincronizando com a API — mantém o loading e tenta de novo quando os dados chegarem
          return;
        }
        setCgItem(null);
        setTicket(null);
        setTicketLoading(false);
        setRedirectTo('/especiais/consumidor-gov');
        return;
      }
      if (!view.cgItem.ticketId) {
        setTicketLoading(false);
        setRedirectTo(`/especiais/consumidor-gov/registro/${view.cgItem.id}`);
        return;
      }
      setCgItem(view.cgItem);
      setTicket(view.ticket);
      if (view.cgItem.groupKey) {
        setActiveGroup(view.cgItem.groupKey);
      }
      setTicketLoading(false);
    } catch {
      showNotification('Não foi possível carregar o ticket.', 'error');
      setCgItem(null);
      setTicket(null);
      setTicketLoading(false);
    }
  }, [id, showNotification]);

  useEffect(() => {
    reloadTicket();
  }, [reloadTicket, listVersion]);

  useEffect(() => {
    setWaChatOpen(false);
    setWaComposeText('');
    setComposeMode('public');
    setComposeText('');
    setInternalText('');
    setComposeAttachments([]);
    setClassificacaoDraft({ produto: '', motivo: '' });
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
    if (result.channelItem) setCgItem(result.channelItem);
    setListVersion((v) => v + 1);
  }, []);

  const handleCommitFinalized = useCallback((result) => {
    setTicket(result.ticket);
    if (result.channelItem) setCgItem(result.channelItem);
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
    setTicket(updatedTicket);
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
        saving={committing}
        disabled={readOnly || finalized}
        finalized={finalized}
        onClassificacaoDraftChange={handleClassificacaoDraftChange}
        onCgItemUpdated={handleCgItemUpdated}
      />

      {demandaModals}
    </div>
  );
}
