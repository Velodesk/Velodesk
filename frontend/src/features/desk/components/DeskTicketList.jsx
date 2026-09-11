/**
 * DeskTicketList v2.4.0 — badge verde para workflow concluído
 * VERSION: v2.4.0 | DATE: 2026-08-18
 */
import React, { useEffect, useState } from 'react';
import {
  formatTicketListDate,
  formatTicketListTime,
  getDeskSearchInferredLabel,
  getSlaClass,
  getTicketQueueEntryAt,
  getTicketTitle,
  isClienteRespondeuRead,
  isClienteRespondeuTicket,
  isTicketInWorkflow,
  isTicketWorkflowFinished,
  normalizeTicketForDeskV2,
} from '../../../services/desk/utils';
import { useTicketPresenceMap } from '../../../context/TicketPresenceContext';

export default function DeskTicketList({
  activeTicketId,
  activeSort,
  entries,
  searchActive,
  searchQuery = '',
  collapsed,
  entrySortOldestFirst,
  onSelectTicket,
  onSortChange,
  onToggleEntrySort,
  onSearchChange,
  onSearchSubmit,
  onCollapse,
  onExpand,
  onReload,
  refreshing = false,
  showSkeleton = false,
}) {
  const [query, setQuery] = useState(searchQuery);
  const skeletonItems = [1, 2, 3, 4, 5, 6];
  const detectedLabel = getDeskSearchInferredLabel(query);
  const presenceByTicketId = useTicketPresenceMap();

  useEffect(() => {
    setQuery(searchQuery);
  }, [searchQuery]);

  const handleQueryChange = (value) => {
    setQuery(value);
    onSearchChange?.(value);
  };

  return (
    <aside className={'ticket-list-panel' + (collapsed ? ' is-collapsed' : '')} id="crmTicketListPanel">
      <div className="ticket-list-panel__inner">
        <header className="ticket-list-header">
          <div className="ticket-list-header__row">
            <div className="ticket-list-header__title-wrap">
              <h2 className="ticket-list-header__title" id="ticketListTitle">
                Fila de atendimento
              </h2>
            </div>
            <div className="ticket-list-header__actions">
              <button
                type="button"
                className="crm-panel-retract"
                id="btnCollapseTickets"
                onClick={onCollapse}
                title="Recolher lista"
                aria-expanded={!collapsed}
              >
                <i className="ti ti-chevron-left" />
              </button>
              <button
                type="button"
                className={'crm-icon-btn' + (refreshing ? ' is-refreshing' : '')}
                id="refreshTicketsBtn"
                data-testid="btnRefresh"
                onClick={() => onReload?.()}
                title="Atualizar tickets"
                aria-label="Atualizar tickets"
                disabled={refreshing}
              >
                <i className="ti ti-refresh" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div
            className="queue-search queue-search--ticket-list"
            role="search"
          >
            <i className="ti ti-search" aria-hidden="true" />
            <input
              type="text"
              id="crmQueueSearch"
              name="crmQueueSearch"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              placeholder="Buscar por CPF ou protocolo…"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSearchSubmit?.();
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

          <div className="ticket-list-tabs-bar">
            <div className="ticket-list-tabs" role="tablist" aria-label="Ordenar tickets">
              {['data', 'sla'].map((sort) => (
                <button
                  key={sort}
                  type="button"
                  role="tab"
                  aria-selected={activeSort === sort}
                  className={'ticket-list-tab' + (activeSort === sort ? ' is-active' : '')}
                  onClick={() => onSortChange(sort)}
                >
                  {sort === 'data' ? 'Data' : 'SLA'}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={'ticket-list-entry-sort' + (entrySortOldestFirst ? ' is-active' : '')}
              onClick={onToggleEntrySort}
              title={entrySortOldestFirst ? 'Entrada: mais antigos primeiro' : 'Ordenar por entrada na caixa (mais antigos primeiro)'}
              aria-label="Ordenar por entrada na caixa"
              aria-pressed={entrySortOldestFirst}
            >
              <i className="ti ti-sort-ascending" aria-hidden="true" />
            </button>
          </div>

          {searchActive ? (
            <p className="ticket-list-header__search-hint">Busca · {entries.length} ticket(s)</p>
          ) : null}
        </header>

        <ul className="ticket-cards" id="ticketCards">
          {showSkeleton ? (
            skeletonItems.map((key) => (
              <li key={`sk-${key}`} className="crm-ticket-card crm-ticket-card--skeleton" aria-hidden="true">
                <div className="crm-ticket-card__content">
                  <div className="crm-ticket-card__row-top">
                    <span className="desk-skeleton desk-skeleton--text desk-skeleton--name" />
                    <span className="desk-skeleton desk-skeleton--text desk-skeleton--time" />
                  </div>
                  <div className="crm-ticket-card__row-bottom">
                    <span className="desk-skeleton desk-skeleton--text desk-skeleton--subject" />
                  </div>
                </div>
              </li>
            ))
          ) : entries.length === 0 ? (
            <li className="crm-empty-state" style={{ padding: 16 }}>
              {searchActive ? 'Nenhum ticket encontrado na busca' : 'Nenhum ticket nesta fila'}
            </li>
          ) : entries.map(({ ticket: t }) => {
            normalizeTicketForDeskV2(t);
            const inWorkflow = isTicketInWorkflow(t);
            const workflowFinished = isTicketWorkflowFinished(t);
            const isActive = String(t.id) === String(activeTicketId);
            const entryAt = getTicketQueueEntryAt(t);
            const slaCritical = getSlaClass(t) === 'critical';
            const clienteRespondeu = isClienteRespondeuTicket(t) && !isClienteRespondeuRead(t);
            const emailDeliveryFailures = Array.isArray(t.emailDeliveryFailures) ? t.emailDeliveryFailures : [];
            const lastEmailDeliveryFailure = emailDeliveryFailures[emailDeliveryFailures.length - 1];
            const emailDeliveryFailedTitle = lastEmailDeliveryFailure
              ? `Falha no envio de e-mail em ${new Date(lastEmailDeliveryFailure.em).toLocaleString('pt-BR')}${lastEmailDeliveryFailure.destinatario ? ` para ${lastEmailDeliveryFailure.destinatario}` : ''}`
              : '';
            const presentAgents = presenceByTicketId[String(t.id)] || [];
            const agentActiveTitle = presentAgents.length
              ? `${presentAgents.map((agent) => agent.name).join(', ')} ${presentAgents.length > 1 ? 'estão atuando' : 'está atuando'} neste ticket`
              : '';

            return (
              <li
                key={t.id}
                className={'crm-ticket-card' + (isActive ? ' is-active' : '')}
                data-ticket-id={t.id}
                aria-selected={isActive}
                onClick={() => onSelectTicket(t.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onSelectTicket(t.id)}
              >
                {slaCritical ? (
                  <span
                    className="crm-ticket-card__dot crm-ticket-card__dot--sla-critical"
                    title="SLA crítico — fora do prazo"
                    aria-label="SLA crítico — fora do prazo"
                  />
                ) : null}
                {clienteRespondeu ? (
                  <span
                    className="crm-ticket-card__dot crm-ticket-card__dot--cliente-respondeu"
                    title="Cliente respondeu"
                    aria-label="Cliente respondeu"
                  />
                ) : null}
                {agentActiveTitle ? (
                  <span
                    className="crm-ticket-card__dot crm-ticket-card__dot--agent-active"
                    title={agentActiveTitle}
                    aria-label={agentActiveTitle}
                  />
                ) : null}
                {emailDeliveryFailedTitle ? (
                  <span
                    className="crm-ticket-card__dot crm-ticket-card__dot--email-failed"
                    title={emailDeliveryFailedTitle}
                    aria-label={emailDeliveryFailedTitle}
                  />
                ) : null}
                <div className="crm-ticket-card__content">
                  <div className="crm-ticket-card__row-top">
                    <span className="crm-ticket-card__name">
                      {t.clientName || t.solicitante || 'Cliente'}
                    </span>
                    <span className="crm-ticket-card__meta-time">
                      <span className="crm-ticket-card__date">
                        {formatTicketListDate(entryAt)}
                      </span>
                      <time className="crm-ticket-card__time" dateTime={entryAt}>
                        {formatTicketListTime(entryAt)}
                      </time>
                    </span>
                  </div>
                  <div className="crm-ticket-card__row-bottom">
                    <span className="crm-ticket-card__subject" title={getTicketTitle(t)}>
                      {getTicketTitle(t)}
                    </span>
                    {inWorkflow ? (
                      <span className={`crm-tag crm-tag--workflow${workflowFinished ? ' is-finished' : ''}`}>
                        {workflowFinished ? 'Workflow concluído' : 'Workflow'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      {collapsed && (
        <button
          type="button"
          className="crm-panel-expand-tab crm-panel-expand-tab--tickets"
          id="btnExpandTickets"
          onClick={onExpand}
          title="Expandir lista"
        >
          <i className="ti ti-chevron-right" /><span>LISTA</span>
        </button>
      )}
    </aside>
  );
}
