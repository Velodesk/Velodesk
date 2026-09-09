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
  getFooterSummary,
  getReclameAquiKpis,
  getReportSeries,
  groupReclamacoesByStatus,
  loadReclamacoes,
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

function buildView(items) {
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

  const searchFn = useCallback((q) => searchReclamacoesFromApi(q), []);
  const { remoteItems, isRemoteSearch } = useEspeciaisDualSearch({
    queueQuery: search,
    listQuery: '',
    searchFn,
  });

  useEffect(() => {
    const refreshFromApi = () => {
      loadReclameAquiTicketsFromApi().catch(() => {});
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

  const view = useMemo(() => {
    if (isRemoteSearch && remoteItems) {
      if (!activeChips.length) return buildView(remoteItems);
      const chipIds = new Set(
        loadReclamacoes({ search: '', activeChips, gestaoView: true })
          .map((i) => String(i.id)),
      );
      return buildView(remoteItems.filter((i) => chipIds.has(String(i.id))));
    }
    return buildView(loadReclamacoes({ search: '', activeChips, gestaoView: true }));
  }, [activeChips, listVersion, isRemoteSearch, remoteItems]);

  const footerText = getFooterSummary(view.items, selectedIds.length);
  const totalPages = Math.max(1, Math.ceil(view.items.length / RA_LIST_PAGE_SIZE));
  const pagedItems = view.items.slice((page - 1) * RA_LIST_PAGE_SIZE, page * RA_LIST_PAGE_SIZE);
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
