/**
 * DashboardWorkflowCard v1.1.0 — todas as pendências de workflow por área, clicáveis.
 *
 * v1.1.0: expansão agora mostra TODAS as pendências da área (atrasadas primeiro, depois
 * no prazo, depois sem prazo), cada linha clicável abre o ticket no Desk. Antes só os
 * atrasados eram expostos.
 */
import React, { useMemo, useState } from 'react';

const AREA_LABEL_OVERRIDES = {
  financeiro: 'Financeiro',
  produtos: 'Produtos',
  atendimento: 'Atendimento',
  n2: 'N2',
  n1: 'N1',
  suporte: 'Suporte',
  __colaborador__: 'Colaborador nomeado',
  __responsavel_ticket__: 'Responsável do próprio ticket',
  __nao_identificado__: 'Área não identificada',
};

function labelForArea(slug) {
  if (!slug) return '—';
  if (AREA_LABEL_OVERRIDES[slug]) return AREA_LABEL_OVERRIDES[slug];
  return String(slug)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function fmtMinutes(min) {
  const n = Math.max(0, Math.round(min || 0));
  if (n < 60) return `${n}min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function StatusBadge({ classificacao }) {
  if (classificacao === 'atrasado') {
    return <span className="dashop-workflow__badge dashop-workflow__badge--crit">Atrasado</span>;
  }
  if (classificacao === 'no-prazo') {
    return <span className="dashop-workflow__badge dashop-workflow__badge--ok">No prazo</span>;
  }
  return <span className="dashop-workflow__badge dashop-workflow__badge--muted">Sem prazo</span>;
}

function TempoCell({ ticket }) {
  if (ticket.classificacao === 'atrasado') {
    return (
      <span className="dashop-num is-crit">−{fmtMinutes(ticket.atrasoMin)}</span>
    );
  }
  if (ticket.classificacao === 'no-prazo') {
    return (
      <span className="dashop-num is-ok">{fmtMinutes(ticket.restanteMin)}</span>
    );
  }
  return <span className="dashop-num is-muted">—</span>;
}

export default function DashboardWorkflowCard({ workflow, onOpenTicket }) {
  const [expandedArea, setExpandedArea] = useState(null);

  const areas = workflow?.porArea ?? [];
  const total = workflow?.total ?? 0;

  const legenda = useMemo(() => {
    const parts = [];
    if (workflow?.noPrazo != null) parts.push(`${workflow.noPrazo} no prazo`);
    if (workflow?.atrasados != null) parts.push(`${workflow.atrasados} atrasados`);
    if (workflow?.semPrazo != null) parts.push(`${workflow.semPrazo} sem prazo`);
    return parts.join(' · ');
  }, [workflow]);

  return (
    <article className="dashop-card dashop-workflow">
      <header className="dashop-card__head">
        <h3 className="dashop-card__title">Pendências de workflow</h3>
        <span className="dashop-card__meta">
          {total > 0 ? `${total} pendências · ${legenda}` : 'Nenhuma pendência ativa'}
        </span>
      </header>

      {total === 0 ? (
        <p className="dashop-card__empty">Nenhum ticket em workflow ativo no momento.</p>
      ) : (
        <div className="dashop-workflow__list">
          <div className="dashop-workflow__row dashop-workflow__row--head">
            <span>Área responsável</span>
            <span>Total</span>
            <span>No prazo</span>
            <span>Atrasados</span>
            <span>Sem prazo</span>
            <span aria-hidden="true" />
          </div>

          {areas.map((area) => {
            const isExpanded = expandedArea === area.area;
            const canExpand = (area.tickets?.length ?? 0) > 0;
            const isCrit = area.atrasados > 0;
            return (
              <React.Fragment key={area.area}>
                <div className={'dashop-workflow__row' + (canExpand ? ' is-clickable' : '')}
                  onClick={canExpand ? () => setExpandedArea(isExpanded ? null : area.area) : undefined}
                  role={canExpand ? 'button' : undefined}
                  tabIndex={canExpand ? 0 : undefined}
                  onKeyDown={canExpand ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedArea(isExpanded ? null : area.area);
                    }
                  } : undefined}
                >
                  <span className="dashop-workflow__area">{labelForArea(area.area)}</span>
                  <span className="dashop-num">{area.total}</span>
                  <span className={'dashop-num ' + (area.noPrazo > 0 ? 'is-ok' : 'is-muted')}>
                    {area.noPrazo}
                  </span>
                  <span className={'dashop-num ' + (area.atrasados > 0 ? 'is-crit' : 'is-muted')}>
                    {area.atrasados}
                  </span>
                  <span className="dashop-num is-muted">{area.semPrazo}</span>
                  <span className="dashop-workflow__chevron" aria-hidden="true">
                    {canExpand ? (isExpanded ? '▾' : '▸') : ''}
                  </span>
                </div>

                {isExpanded && canExpand ? (
                  <div className={'dashop-workflow__detail' + (isCrit ? ' is-crit' : '')}>
                    <div className="dashop-workflow__detail-head">
                      <strong>
                        {area.total} pendência{area.total === 1 ? '' : 's'} em {labelForArea(area.area)}
                      </strong>
                      {area.ticketsExibidos < area.total ? (
                        <span className="dashop-workflow__detail-meta">
                          mostrando {area.ticketsExibidos} mais críticas
                        </span>
                      ) : null}
                    </div>
                    <table className="dashop-workflow__detail-table">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Passo atual</th>
                          <th>Status</th>
                          <th style={{ textAlign: 'right' }}>Tempo</th>
                          <th aria-hidden="true" />
                        </tr>
                      </thead>
                      <tbody>
                        {area.tickets.map((t) => (
                          <tr
                            key={t.id}
                            className="dashop-table__row is-clickable"
                            onClick={() => onOpenTicket?.(t.id)}
                          >
                            <td>
                              <div className="dashop-ticket-title">{t.subject || 'Ticket'}</div>
                              <div className="dashop-ticket-meta">{t.protocolo || t.id}</div>
                            </td>
                            <td>{t.passoNome || '—'}</td>
                            <td><StatusBadge classificacao={t.classificacao} /></td>
                            <td style={{ textAlign: 'right' }}>
                              <TempoCell ticket={t} />
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                type="button"
                                className="dashop-btn dashop-btn--ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenTicket?.(t.id);
                                }}
                              >
                                Abrir
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      )}
    </article>
  );
}
