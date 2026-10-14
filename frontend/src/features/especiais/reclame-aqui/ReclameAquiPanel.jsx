/**
 * ReclameAquiPanel v1.2.0 — paginação 50; KPIs sem workflow
 * VERSION: v1.2.0 | DATE: 2026-08-19
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../../../context/NotificationContext';
import { reclamacoesApi } from '../../../api/client';
import { useRaNovaReclamacaoModals } from '../../../hooks/useRaNovaReclamacaoModals';
import {
  fetchRaPage,
  getFooterSummary,
  getRaServerCounts,
  getReclameAquiKpis,
  getReportSeries,
  groupReclamacoesByStatus,
  loadReclamacoes,
  refreshServerCounts,
  searchReclamacoesFromApi,
  RA_LIST_PAGE_SIZE,
} from '../../../services/especiais/reclameAquiStore';
import { loadReclameAquiTicketsFromApi } from '../../../services/especiais/reclameAquiTicketService';
import { useEspeciaisDualSearch } from '../shared/useEspeciaisDualSearch';
import ReclameAquiTopBar from './ReclameAquiTopBar';
import ReclameAquiPageHeader from './ReclameAquiPageHeader';
import ReclameAquiToolbar from './ReclameAquiToolbar';
import ReclameAquiKpiRow from './ReclameAquiKpiRow';
import ReclameAquiTableView from './ReclameAquiTableView';
import ReclameAquiReportsView from './ReclameAquiReportsView';
import { sortOldestFirst } from '../../../services/especiais/especiaisSort';

function buildView(rawItems) {
  const items = sortOldestFirst(rawItems, 'dataReclamacao');
  return {
    items,
    kpis: getReclameAquiKpis(items),
    groups: groupReclamacoesByStatus(items),
    series: getReportSeries(items),
  };
}

export default function ReclameAquiPanel() {
  const navigate = useNavigate();
  const { showNotification } = useNotifications();

  const [activeTab, setActiveTab] = useState('tabela');
  const [search, setSearch] = useState('');
  const [activeChips, setActiveChips] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [page, setPage] = useState(1);
  const [listVersion, setListVersion] = useState(0);
  const [countsVersion, setCountsVersion] = useState(0);
  const [pageState, setPageState] = useState({ items: [], total: 0, loading: true });

  const searchFn = useCallback((q) => searchReclamacoesFromApi(q), []);
  const { remoteItems, isRemoteSearch } = useEspeciaisDualSearch({
    queueQuery: search,
    listQuery: '',
    searchFn,
  });

  // Tabela: uma página por vez, paginada e filtrada no servidor. Os cards vêm da contagem do
  // servidor. A base inteira só é baixada se a aba Relatórios for aberta (calcula no front).
  useEffect(() => {
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

  useEffect(() => {
    if (activeTab === 'relatorios') loadReclameAquiTicketsFromApi().catch(() => {});
  }, [activeTab]);

  const { openNovaFlow, modals: novaModals } = useRaNovaReclamacaoModals({
    navigate,
    onImported: () => setListVersion((v) => v + 1),
  });

  const usingServerPage = !(isRemoteSearch && remoteItems);

  useEffect(() => {
    if (!usingServerPage || activeTab === 'relatorios') return undefined;
    let cancelled = false;
    setPageState((prev) => ({ ...prev, loading: true }));
    fetchRaPage({ gestao: true, chips: activeChips, page })
      .then((res) => {
        if (!cancelled) setPageState({ items: res.items, total: res.total, loading: false });
      })
      .catch(() => {
        if (!cancelled) setPageState((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [usingServerPage, activeTab, activeChips, page, listVersion]);

  const view = useMemo(() => {
    if (usingServerPage) {
      const items = pageState.items;
      const reportItems = activeTab === 'relatorios' ? loadReclamacoes({ search: '', activeChips, gestaoView: true }) : items;
      return {
        items,
        kpis: getReclameAquiKpis(reportItems),
        groups: groupReclamacoesByStatus(items),
        series: getReportSeries(reportItems),
      };
    }
    if (isRemoteSearch && remoteItems) {
      if (!activeChips.length) return buildView(remoteItems);
      const chipIds = new Set(
        loadReclamacoes({ search: '', activeChips, gestaoView: true })
          .map((i) => String(i.id)),
      );
      return buildView(remoteItems.filter((i) => chipIds.has(String(i.id))));
    }
    return buildView(loadReclamacoes({ search: '', activeChips, gestaoView: true }));
  }, [activeChips, listVersion, countsVersion, isRemoteSearch, remoteItems, usingServerPage, pageState, activeTab]);

  const totalCount = usingServerPage ? pageState.total : view.items.length;
  const naoRespCount = getRaServerCounts()?.kpis?.naoRespondidas;
  const footerText = usingServerPage
    ? `${totalCount} reclamações${naoRespCount != null && !activeChips.length ? ` · ${naoRespCount} não respondidas` : ''}${selectedIds.length ? ` · ${selectedIds.length} selecionada${selectedIds.length > 1 ? 's' : ''}` : ''}`
    : getFooterSummary(view.items, selectedIds.length);
  const totalPages = Math.max(1, Math.ceil(totalCount / RA_LIST_PAGE_SIZE));
  const pagedItems = usingServerPage
    ? view.items
    : view.items.slice((page - 1) * RA_LIST_PAGE_SIZE, page * RA_LIST_PAGE_SIZE);
  const pagedGroups = groupReclamacoesByStatus(pagedItems);

  // Contagem por CPF em toda a lista filtrada (não só a página atual), pra sinalizar cliente
  // recorrente mesmo quando as outras reclamações dele caíram numa página diferente.
  const clientRepeatCounts = useMemo(() => {
    const counts = new Map();
    view.items.forEach((item) => {
      const cpf = String(item.cpf || '').trim();
      if (!cpf) return;
      counts.set(cpf, (counts.get(cpf) || 0) + 1);
    });
    return counts;
  }, [view.items]);

  // Cruzamento com Procon/Bacen/Consumidor.Gov — só pros CPFs visíveis na página atual, pra
  // não sobrecarregar o backend com todo o filtro de uma vez.
  const [casosEspeciaisByCpf, setCasosEspeciaisByCpf] = useState({});
  const pagedCpfsKey = useMemo(() => {
    const cpfs = new Set();
    pagedItems.forEach((item) => {
      const cpf = String(item.cpf || '').trim();
      if (cpf) cpfs.add(cpf);
    });
    return Array.from(cpfs).sort().join(',');
  }, [pagedItems]);

  useEffect(() => {
    const cpfs = pagedCpfsKey ? pagedCpfsKey.split(',') : [];
    if (!cpfs.length) {
      setCasosEspeciaisByCpf({});
      return undefined;
    }
    let cancelled = false;
    reclamacoesApi.casosEspeciaisPorCpf(cpfs)
      .then((res) => {
        if (!cancelled) setCasosEspeciaisByCpf(res?.byCpf || {});
      })
      .catch(() => {
        if (!cancelled) setCasosEspeciaisByCpf({});
      });
    return () => { cancelled = true; };
  }, [pagedCpfsKey]);

  const handleToggleChip = useCallback((chipId) => {
    setActiveChips((prev) =>
      prev.includes(chipId) ? prev.filter((c) => c !== chipId) : [...prev, chipId],
    );
    setPage(1);
  }, []);

  const handleToolbarAction = useCallback((action) => {
    if (action === 'nova') {
      openNovaFlow();
      return;
    }
    const messages = {
      filtrar: 'Filtros avançados em breve.',
      ordenar: 'Ordenação em breve.',
      exportar: 'Exportação em breve.',
    };
    showNotification(messages[action] || 'Em breve.', 'info');
  }, [openNovaFlow, showNotification]);

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
    void refreshServerCounts();
    setListVersion((v) => v + 1);
  }, []);

  const handleRowAction = useCallback((action, item) => {
    if (action === 'responder' && item?.id) {
      if (item.ticketId) {
        navigate(`/especiais/reclame-aqui/ticket/${item.id}`);
      } else {
        navigate(`/especiais/reclame-aqui/registro/${item.id}`);
      }
      return;
    }
    showNotification('Ação em breve.', 'info');
  }, [navigate, showNotification]);

  return (
    <div className="ra-panel" id="reclameAquiPanel">
      <ReclameAquiTopBar />

      <div className="ra-panel__body">
        <button
          type="button"
          className="ra-panel__back"
          onClick={() => navigate('/workspace')}
        >
          <i className="ti ti-arrow-left" aria-hidden="true" />
          Trocar canal
        </button>

        <ReclameAquiPageHeader activeTab={activeTab} onTabChange={setActiveTab} />

        <ReclameAquiToolbar
          search={search}
          onSearchChange={setSearch}
          activeChips={activeChips}
          onToggleChip={handleToggleChip}
          onAction={handleToolbarAction}
        />

        <ReclameAquiKpiRow kpis={view.kpis} />

        <div className="ra-panel__content">
          {activeTab === 'tabela' && (
            <ReclameAquiTableView
              groups={pagedGroups}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onRowAction={handleRowAction}
              onBulkApplied={handleBulkApplied}
              clientRepeatCounts={clientRepeatCounts}
              casosEspeciaisByCpf={casosEspeciaisByCpf}
            />
          )}
          {activeTab === 'relatorios' && (
            <ReclameAquiReportsView series={view.series} kpis={view.kpis} />
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
              <span>{page} de {totalPages} página{totalPages === 1 ? '' : 's'}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
                <i className="ti ti-chevron-right" />
              </button>
            </div>
          </footer>
        ) : null}
      </div>

      {novaModals}
    </div>
  );
}
