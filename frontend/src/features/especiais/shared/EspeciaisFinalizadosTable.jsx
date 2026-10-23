/**
 * EspeciaisFinalizadosTable — layout de tabela (Número/Título/Responsável/Finalização) igual
 * ao "Resolvidos" do Desk normal (DeskResolvedTicketTable.jsx), reaproveitado pelos 4 canais de
 * Casos Especiais (Reclame Aqui, Bacen, Procon, Consumidor.gov) no grupo "finalizadas". Assim
 * como no Desk, ocupa a largura cheia da tela (substitui a lista estreita + o painel de
 * detalhe) enquanto nenhum item estiver aberto — ver uso em XxCrmRoot.jsx.
 *
 * Paginação/busca: por padrão o componente cuida disso sozinho, de forma simples, sobre
 * `items` (uso do Bacen/Procon/Consumidor.gov, que já carregam a lista inteira no cliente).
 * O Reclame Aqui pagina/busca no servidor (nem todo o grupo "finalizadas" existe localmente de
 * uma vez) — por isso aceita `pagination`/`search` para passar a direção pro mecanismo que
 * ele já tem (RaCrmRoot), em vez de reimplementar outra paginação por cima.
 *
 * A data de Finalização só é buscada pros itens da página atual (nunca pra fila inteira, que
 * pode ter milhares de itens) — via loadTicketDetailFromApi (mesma fonte que o Desk usa), já
 * que o item de Casos Especiais não guarda essa data, só o ticketId vinculado. Por isso ordenar
 * por "Título" reordena a fila inteira (o assunto já vem no item), mas ordenar por
 * "Finalização" só reordena o que já carregou na página atual — ordenar a fila inteira por essa
 * data exigiria buscar todos os tickets de uma vez, o que evitamos de propósito.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { loadTicketDetailFromApi } from '../../../services/ticketsCache';
import {
  formatResolvedDateShort,
  getDeskSearchInferredLabel,
  getTicketResolvedAt,
} from '../../../services/desk/utils';
import { sanitizeResponsavel } from '../../../services/tabulationConfig';
import { formatResponsavelForDisplay } from '../../../services/desk/responsavelDisplay';

const PAGE_SIZE = 20;

function normalizeDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export default function EspeciaisFinalizadosTable({
  items = [],
  getProtocol,
  onSelectItem,
  onReload,
  pagination, // opcional: { page, totalPages, totalCount, onPageChange } — paginação externa (RA)
  search, // opcional: { query, onChange, onSubmit } — busca externa (RA)
}) {
  const [internalPage, setInternalPage] = useState(1);
  const [internalSearchQuery, setInternalSearchQuery] = useState('');
  // sortField: null (ordem de chegada) | 'titulo' (fila inteira) | 'finalizacao' (só a página atual)
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDir('asc');
  };

  const searchQuery = search ? search.query : internalSearchQuery;
  const setSearchQuery = search ? search.onChange : setInternalSearchQuery;
  const detectedLabel = getDeskSearchInferredLabel(searchQuery);

  const filteredItems = useMemo(() => {
    if (search) return items; // já filtrado pelo mecanismo de busca do canal
    const q = searchQuery.trim();
    if (!q) return items;
    const qDigits = normalizeDigits(q);
    const qLower = q.toLowerCase();
    return items.filter((item) => {
      const protocol = String(getProtocol(item) || '');
      if (qDigits && normalizeDigits(protocol).includes(qDigits)) return true;
      if (qDigits && normalizeDigits(item.cpf).includes(qDigits)) return true;
      return String(item.consumidor || '').toLowerCase().includes(qLower);
    });
  }, [items, searchQuery, getProtocol, search]);

  const sortedItems = useMemo(() => {
    if (sortField !== 'titulo') return filteredItems;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filteredItems].sort(
      (a, b) => dir * String(a.assunto || '').localeCompare(String(b.assunto || ''), 'pt-BR', { sensitivity: 'base' }),
    );
  }, [filteredItems, sortField, sortDir]);

  const totalPages = pagination ? pagination.totalPages : Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE));
  const page = pagination ? pagination.page : Math.min(internalPage, totalPages);
  const setPage = pagination ? pagination.onPageChange : setInternalPage;
  const totalCount = pagination ? pagination.totalCount : sortedItems.length;
  const pageItems = pagination ? sortedItems : sortedItems.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // ticketId -> 'loading' | { label, time } — time em ms, só pra poder ordenar por Finalização.
  const [resolvedDates, setResolvedDates] = useState({});

  useEffect(() => {
    if (pagination || search) return;
    setInternalPage(1);
  }, [searchQuery, items, sortField, sortDir, pagination, search]);

  useEffect(() => {
    pageItems.forEach((item) => {
      const ticketId = item?.ticketId;
      if (!ticketId || resolvedDates[ticketId] !== undefined) return;
      setResolvedDates((prev) => ({ ...prev, [ticketId]: 'loading' }));
      loadTicketDetailFromApi(ticketId)
        .then((ticket) => {
          const resolvedAt = ticket ? getTicketResolvedAt(ticket) : null;
          const entry = resolvedAt
            ? { label: formatResolvedDateShort(resolvedAt), time: new Date(resolvedAt).getTime() }
            : { label: '—', time: 0 };
          setResolvedDates((prev) => ({ ...prev, [ticketId]: entry }));
        })
        .catch(() => {
          setResolvedDates((prev) => ({ ...prev, [ticketId]: { label: '—', time: 0 } }));
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageItems]);

  // Ordena só o que já está na tela — a data de cada item só existe depois que carrega (ver
  // acima), então não dá pra ordenar a fila inteira por ela sem buscar tudo de uma vez.
  const displayedItems = useMemo(() => {
    if (sortField !== 'finalizacao') return pageItems;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...pageItems].sort((a, b) => {
      const aTime = a.ticketId ? resolvedDates[a.ticketId]?.time ?? 0 : 0;
      const bTime = b.ticketId ? resolvedDates[b.ticketId]?.time ?? 0 : 0;
      return dir * (aTime - bTime);
    });
  }, [pageItems, sortField, sortDir, resolvedDates]);

  const pageStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, totalCount);

  return (
    <div className="ra-crm-finalizados-panel">
      <header className="ra-crm-finalizados-panel__header">
        <div className="ra-crm-finalizados-panel__title-row">
          <h2 className="ra-crm-finalizados-panel__title">Finalizados</h2>
          <div className="queue-search queue-search--resolved-table" role="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder="Buscar por CPF ou protocolo…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (search && e.key === 'Enter') {
                  e.preventDefault();
                  search.onSubmit?.();
                }
              }}
              aria-label="Buscar por CPF ou protocolo"
            />
            <span
              className="queue-search__mode queue-search__mode--detected"
              title={`Busca detectada: ${detectedLabel}`}
              aria-live="polite"
            >
              {detectedLabel}
            </span>
          </div>
        </div>
        <div className="ra-crm-finalizados-panel__header-actions">
          <span className="ra-crm-finalizados-panel__range">
            {totalCount === 0 ? '0 itens' : `${pageStart} - ${pageEnd} de ${totalCount} itens`}
          </span>
          {totalPages > 1 ? (
            <div className="ra-crm-finalizados-panel__pagination">
              <button
                type="button"
                className="ra-crm-finalizados-panel__page-btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="Página anterior"
              >
                <i className="ti ti-chevron-left" aria-hidden="true" />
              </button>
              <span>{page} de {totalPages}</span>
              <button
                type="button"
                className="ra-crm-finalizados-panel__page-btn"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                aria-label="Próxima página"
              >
                <i className="ti ti-chevron-right" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {onReload ? (
            <button
              type="button"
              className="ra-crm-icon-btn"
              onClick={() => onReload()}
              title="Atualizar"
              aria-label="Atualizar"
            >
              <i className="ti ti-refresh" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="ra-crm-finalizados-table-wrap">
        <table className="ra-crm-finalizados-table">
          <thead>
            <tr>
              <th className="ra-crm-finalizados-table__th-num">Número</th>
              <th className="ra-crm-finalizados-table__th-title">
                <button
                  type="button"
                  className={'ra-crm-finalizados-table__sort' + (sortField === 'titulo' ? ' is-active' : '')}
                  onClick={() => handleSort('titulo')}
                >
                  Título
                  <i
                    className={'ti ' + (sortField === 'titulo' && sortDir === 'asc' ? 'ti-chevron-up' : 'ti-chevron-down')}
                    aria-hidden="true"
                  />
                </button>
              </th>
              <th className="ra-crm-finalizados-table__th-resp">Responsável</th>
              <th className="ra-crm-finalizados-table__th-date">
                <button
                  type="button"
                  className={'ra-crm-finalizados-table__sort' + (sortField === 'finalizacao' ? ' is-active' : '')}
                  onClick={() => handleSort('finalizacao')}
                >
                  Finalização
                  <i
                    className={'ti ' + (sortField === 'finalizacao' && sortDir === 'asc' ? 'ti-chevron-up' : 'ti-chevron-down')}
                    aria-hidden="true"
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayedItems.length === 0 ? (
              <tr>
                <td colSpan={4} className="ra-crm-finalizados-table__empty">
                  {searchQuery.trim() ? 'Nenhuma reclamação encontrada na busca' : 'Nenhuma reclamação finalizada'}
                </td>
              </tr>
            ) : displayedItems.map((item) => {
              const responsavel = formatResponsavelForDisplay(sanitizeResponsavel(item.responsavel || item.atendente));
              const dateState = item.ticketId ? resolvedDates[item.ticketId] : undefined;
              const dateLabel = dateState === 'loading' ? '…' : (dateState?.label || '—');
              return (
                <tr
                  key={item.id}
                  className="ra-crm-finalizados-table__row"
                  onClick={() => onSelectItem(item.id)}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectItem(item.id)}
                  role="button"
                  tabIndex={0}
                >
                  <td className="ra-crm-finalizados-table__num">{getProtocol(item) || '—'}</td>
                  <td className="ra-crm-finalizados-table__title-cell" title={item.assunto}>{item.assunto || '—'}</td>
                  <td className="ra-crm-finalizados-table__resp">{responsavel || '—'}</td>
                  <td className="ra-crm-finalizados-table__date">{dateLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
