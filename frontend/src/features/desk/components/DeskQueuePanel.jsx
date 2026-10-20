/**
 * DeskQueuePanel v1.5.0 — contadores via queueCounts (Mongo, não lista cacheada)
 * VERSION: v1.5.0 | DATE: 2026-08-07
 */
import React from 'react';
import { countByQueue } from '../../../services/desk/utils';

export default function DeskQueuePanel({
  queueStatuses,
  activeQueue,
  collapsed,
  onSelectQueue,
  onCollapse,
  onExpand,
  onCreateTicket,
  refreshKey = 0,
}) {
  void refreshKey;
  return (
    <aside
      className={'queue-panel' + (collapsed ? ' is-collapsed' : '')}
      id="crmQueuePanel"
    >
      <div className="queue-panel__inner">
        <div className="queue-panel__header">
          <div className="queue-panel__header-top">
            <h2 className="queue-panel__title">Fila de atendimento</h2>
            <button
              type="button"
              className="crm-panel-retract"
              id="btnCollapseQueue"
              onClick={onCollapse}
              title="Recolher fila"
              aria-expanded={!collapsed}
            >
              <i className="ti ti-chevron-left" />
            </button>
          </div>
        </div>
        <ul className="queue-status-list" id="queueStatusList">
          {queueStatuses.map((s) => (
            <li
              key={s.id}
              className={'queue-status-item' + (activeQueue === s.id ? ' is-active' : '')}
              data-queue={s.id}
              onClick={() => onSelectQueue(s.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectQueue(s.id)}
            >
              <span className="queue-status-item__dot" style={{ background: s.dot }} />
              <span className="queue-status-item__name">{s.name}</span>
              <span className="queue-status-item__count">{countByQueue(s.id)}</span>
            </li>
          ))}
        </ul>
        <div className="queue-panel__footer">
          <button type="button" className="queue-btn queue-btn--primary" id="crmNewTicket" onClick={onCreateTicket}>
            <i className="ti ti-plus" /> Criar ticket
          </button>
        </div>
      </div>
      {collapsed && (
        <button type="button" className="crm-panel-expand-tab crm-panel-expand-tab--queue" id="btnExpandQueue" onClick={onExpand} title="Expandir fila">
          <i className="ti ti-chevron-right" /><span>FILA</span>
        </button>
      )}
    </aside>
  );
}
