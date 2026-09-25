/**
 * BacenPanel — painel operacional Bacen
 * VERSION: v1.1.0 | DATE: 2026-08-18
 * — Toolbar usa busca dual n1 + reclamacoes
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext';
import { useBcNovaDemandaModals } from '../../../hooks/useBcNovaDemandaModals';
import {
  getFooterSummary,
  getBacenKpis,
  getReportSeries,
  groupDemandasByStatus,
  loadDemandas,
  searchDemandasFromApi,
} from '../../../services/especiais/bacenStore';
import { loadBacenTicketsFromApi, ensureBcTicketForRespond } from '../../../services/especiais/bacenTicketService';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import BacenTopBar from './BacenTopBar';
import BacenPageHeader from './BacenPageHeader';
import BacenToolbar from './BacenToolbar';
import BacenKpiRow from './BacenKpiRow';
import BacenTableView from './BacenTableView';
import BacenReportsView from './BacenReportsView';

function buildView(items) {
  return {
    items,
    kpis: getBacenKpis(items),
    groups: groupDemandasByStatus(items),
    series: getReportSeries(items),
  };
}

export default function BacenPanel() {
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeTab, setActiveTab] = useState('tabela');
  const [search, setSearch] = useState('');
  const [activeChips, setActiveChips] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [listVersion, setListVersion] = useState(0);
  const [respondingId, setRespondingId] = useState(null);

  const searchFn = useCallback((q) => searchDemandasFromApi(q), []);
  const { remoteItems, isRemoteSearch } = useEspeciaisDualSearch({
    queueQuery: search,
    listQuery: '',
    searchFn,
  });

  useEffect(() => {
    const refreshFromApi = () => {
      loadBacenTicketsFromApi().catch(() => {});
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

  const view = useMemo(() => {
    if (isRemoteSearch && remoteItems) {
      if (!activeChips.length) return buildView(remoteItems);
      const chipIds = new Set(
        loadDemandas({ search: '', activeChips, gestaoView: true }).map((i) => String(i.id)),
      );
      return buildView(remoteItems.filter((i) => chipIds.has(String(i.id))));
    }
    return buildView(loadDemandas({ search: '', activeChips, gestaoView: true }));
  }, [activeChips, listVersion, isRemoteSearch, remoteItems]);

  const footerText = getFooterSummary(view.items, selectedIds.length);

  const handleToggleChip = useCallback((chipId) => {
    setActiveChips((prev) =>
      prev.includes(chipId) ? prev.filter((c) => c !== chipId) : [...prev, chipId],
    );
    setPage(1);
  }, []);

  const handleToolbarAction = useCallback((action) => {
    if (action === 'nova') {
      openNovaDemandaFlow();
      return;
    }
    const messages = {
      filtrar: 'Filtros avançados em breve.',
      ordenar: 'Ordenação em breve.',
      exportar: 'Exportação em breve.',
    };
    showNotification(messages[action] || 'Em breve.', 'info');
  }, [openNovaDemandaFlow, showNotification]);

  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleToggleSelectAll = useCallback((ids, select) => {
    setSelectedIds(select ? [...ids] : []);
  }, []);

  const handleBulkApplied = useCallback(() => {
    setSelectedIds([]);
    setListVersion((v) => v + 1);
  }, []);

  const handleRowAction = useCallback(async (action, item) => {
    if (action === 'responder' && item?.id) {
      setRespondingId(item.id);
      try {
        const ensured = await ensureBcTicketForRespond(item);
        setListVersion((v) => v + 1);
        navigate(`/especiais/bacen/ticket/${ensured.bcItem.id}`);
      } catch (err) {
        showNotification(err?.message || 'Não foi possível abrir o ticket.', 'error');
      } finally {
        setRespondingId(null);
      }
      return;
    }
    showNotification('Ação em breve.', 'info');
  }, [navigate, showNotification]);

  return (
    <div className="ra-panel" id="bacenPanel">
      <BacenTopBar />

      <div className="ra-panel__body">
        <button
          type="button"
          className="ra-panel__back"
          onClick={() => navigate('/workspace')}
        >
          <i className="ti ti-arrow-left" aria-hidden="true" />
          Trocar canal
        </button>

        <BacenPageHeader activeTab={activeTab} onTabChange={setActiveTab} />

        <BacenToolbar
          search={search}
          onSearchChange={setSearch}
          activeChips={activeChips}
          onToggleChip={handleToggleChip}
          onAction={handleToolbarAction}
        />

        <BacenKpiRow kpis={view.kpis} />

        <div className="ra-panel__content">
          {activeTab === 'tabela' && (
            <BacenTableView
              groups={view.groups}
              selectedIds={selectedIds}
              respondingId={respondingId}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onRowAction={handleRowAction}
              onBulkApplied={handleBulkApplied}
            />
          )}
          {activeTab === 'relatorios' && (
            <BacenReportsView series={view.series} kpis={view.kpis} />
          )}
        </div>

        {activeTab === 'tabela' ? (
          <footer className="ra-panel__footer">
            <div className="ra-panel__footer-left">
              <span>{footerText}</span>
            </div>
            <div className="ra-panel__pagination">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
                <i className="ti ti-chevron-left" />
              </button>
              <span>{page} de 2 páginas</span>
              <button type="button" disabled={page >= 2} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
                <i className="ti ti-chevron-right" />
              </button>
            </div>
          </footer>
        ) : null}
      </div>

      {demandaModals}
    </div>
  );
}
