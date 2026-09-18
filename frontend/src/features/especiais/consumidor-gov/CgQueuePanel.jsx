/**
 * CgQueuePanel — filas ConsumidorGov (layout CRM)
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { CG_GROUPS } from '../../../services/especiais/consumidorGovData';

const GROUP_DOTS = {
  danger: '#ef4444',
  warning: '#f59e0b',
  success: '#22c55e',
  neutral: '#94a3b8',
};

export default function CgQueuePanel({
  activeGroup,
  collapsed,
  groupCounts,
  onSelectGroup,
  onCollapse,
  onExpand,
  onNovaReclamacao,
}) {
  const navigate = useNavigate();

  return (
    <aside
      className={`ra-crm-queue${collapsed ? ' is-collapsed' : ''}`}
      id="pcCrmQueuePanel"
    >
      <div className="ra-crm-queue__inner">
        <div className="ra-crm-queue__header">
          <div className="ra-crm-queue__header-top">
            <h2 className="ra-crm-queue__title">Filas Consumidor.Gov</h2>
            <button
              type="button"
              className="ra-crm-panel-retract"
              onClick={onCollapse}
              title="Recolher fila"
              aria-expanded={!collapsed}
            >
              <i className="ti ti-chevron-left" aria-hidden="true" />
            </button>
          </div>
        </div>

        <ul className="ra-crm-queue-list">
          {CG_GROUPS.map((group) => (
            <li
              key={group.id}
              className={`ra-crm-queue-item${activeGroup === group.id ? ' is-active' : ''}`}
              onClick={() => onSelectGroup(group.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectGroup(group.id)}
            >
              <span
                className="ra-crm-queue-item__dot"
                style={{ background: GROUP_DOTS[group.tone] || GROUP_DOTS.neutral }}
              />
              <span className="ra-crm-queue-item__name">{group.label}</span>
              <span className="ra-crm-queue-item__count">{groupCounts[group.id] || 0}</span>
            </li>
          ))}
        </ul>

        <div className="ra-crm-queue__footer">
          <button
            type="button"
            className="ra-crm-queue-btn ra-crm-queue-btn--secondary"
            onClick={() => navigate('/especiais/consumidor-gov')}
          >
            <i className="ti ti-table" aria-hidden="true" />
            Gestão
          </button>
          <button
            type="button"
            className="ra-crm-queue-btn ra-crm-queue-btn--primary"
            onClick={() => (onNovaReclamacao ? onNovaReclamacao() : navigate('/especiais/consumidor-gov/nova'))}
          >
            <i className="ti ti-plus" aria-hidden="true" />
            Nova demanda
          </button>
        </div>
      </div>

      {collapsed ? (
        <button
          type="button"
          className="ra-crm-panel-expand ra-crm-panel-expand--queue"
          onClick={onExpand}
          title="Expandir fila"
        >
          <i className="ti ti-chevron-right" aria-hidden="true" />
          <span>FILA</span>
        </button>
      ) : null}
    </aside>
  );
}
