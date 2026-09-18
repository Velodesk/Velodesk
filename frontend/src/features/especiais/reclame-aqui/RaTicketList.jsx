/**
 * RaTicketList v1.1.0 — paginação 50
 */
import React from 'react';
import { RA_GROUPS, getStatusLabel, formatSlaRestante } from '../../../services/especiais/reclameAquiData';
import { getDeskSearchInferredLabel } from '../../../services/desk/utils';
import {
  formatRaListDate,
  getRaSlaClass,
  getRaSlaLabel,
} from './raTicketFormatters';

export default function RaTicketList({
  activeGroup,
  activeRaId,
  activeSort,
  items,
  searchActive,
  listSearchQuery = '',
  collapsed,
  page = 1,
  totalPages = 1,
  totalCount,
  onPageChange,
  onSelectItem,
  onSortChange,
  onListSearchChange,
  onListSearchSubmit,
  onCollapse,
  onExpand,
  onReload,
}) {
  const groupName = RA_GROUPS.find((g) => g.id === activeGroup)?.label || '';
  const countLabel = totalCount == null ? items.length : totalCount;
  const listTitle = (searchActive || listSearchQuery.trim())
    ? `Busca · ${countLabel}`
    : `${groupName} · ${countLabel}`;
  const detectedLabel = getDeskSearchInferredLabel(listSearchQuery);

  return (
    <aside
      className={`ra-crm-list${collapsed ? ' is-collapsed' : ''}`}
      id="raCrmTicketListPanel"
    >
      <div className="ra-crm-list__inner">
        <div className="ra-crm-list-header">
          <div className="ra-crm-list-header__row">
            <h2 className="ra-crm-list-header__title">{listTitle}</h2>
            <div className="ra-crm-list-header__actions">
              <button
                type="button"
                className="ra-crm-panel-retract ra-crm-panel-retract--list"
                onClick={onCollapse}
                title="Recolher lista"
                aria-expanded={!collapsed}
              >
                <i className="ti ti-chevron-left" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ra-crm-icon-btn"
                onClick={() => onReload?.()}
                title="Atualizar lista"
                aria-label="Atualizar lista"
              >
                <i className="ti ti-refresh" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="queue-search queue-search--ticket-list" role="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              type="text"
              id="raCrmListSearch"
              name="raCrmListSearch"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder="Buscar por CPF ou protocolo…"
              value={listSearchQuery}
              onChange={(e) => onListSearchChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onListSearchSubmit?.();
                }
              }}
              aria-label="Buscar ticket por CPF ou protocolo"
            />
            <span
              className="queue-search__mode queue-search__mode--detected"
              title={`Busca detectada: ${detectedLabel}`}
              aria-live="polite"
            >
              {detectedLabel}
            </span>
          </div>
          <div className="ra-crm-sort-chips">
            {['data', 'sla'].map((sort) => (
              <button
                key={sort}
                type="button"
                className={`ra-crm-sort-chip${activeSort === sort ? ' is-active' : ''}`}
                onClick={() => onSortChange(sort)}
              >
                {sort === 'data' ? 'Data' : 'SLA'}
              </button>
            ))}
          </div>
        </div>

        <ul className="ra-crm-ticket-cards">
          {items.length === 0 ? (
            <li className="ra-crm-empty-state">Nenhuma reclamação nesta fila</li>
          ) : (
            items.map((item) => {
              const isActive = String(item.id) === String(activeRaId);
              const slaClass = getRaSlaClass(item);
              const slaLabel = getRaSlaLabel(item);
              return (
                <li
                  key={item.id}
                  className={`ra-crm-ticket-card${isActive ? ' is-active' : ''}`}
                  onClick={() => onSelectItem(item.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectItem(item.id)}
                  aria-selected={isActive}
                >
                  <div className="ra-crm-ticket-card__top">
                    <span className="ra-crm-ticket-card__name">{item.consumidor || 'Consumidor'}</span>
                    <span className={`ra-badge ra-badge--${item.statusRa}`}>
                      {getStatusLabel(item.statusRa)}
                    </span>
                  </div>
                  <div className="ra-crm-ticket-card__subject">{item.assunto || '—'}</div>
                  <div className="ra-crm-ticket-card__meta">
                    <span>{formatRaListDate(item.dataReclamacao)}</span>
                    <span title={formatSlaRestante(item.prazoRa)}>
                      {formatSlaRestante(item.prazoRa)}
                    </span>
                  </div>
                  <span
                    className={`ra-crm-ticket-card__sla ra-crm-ticket-card__sla--${slaClass}`}
                    title={slaLabel}
                    aria-label={slaLabel}
                  >
                    {slaLabel}
                  </span>
                </li>
              );
            })
          )}
        </ul>
        {totalPages > 1 ? (
          <div className="ra-panel__pagination">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange?.(page - 1)}
              aria-label="Página anterior"
            >
              <i className="ti ti-chevron-left" />
            </button>
            <span>{page} de {totalPages}</span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange?.(page + 1)}
              aria-label="Próxima página"
            >
              <i className="ti ti-chevron-right" />
            </button>
          </div>
        ) : null}
      </div>

      {collapsed ? (
        <button
          type="button"
          className="ra-crm-panel-expand ra-crm-panel-expand--list"
          onClick={onExpand}
          title="Expandir lista"
        >
          <i className="ti ti-chevron-right" aria-hidden="true" />
          <span>LISTA</span>
        </button>
      ) : null}
    </aside>
  );
}
