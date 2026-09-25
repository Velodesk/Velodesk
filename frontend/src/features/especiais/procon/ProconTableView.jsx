/**
 * ProconTableView — tabela agrupada por status Procon
 */
import React, { useRef, useState } from 'react';
import { getStatusLabel } from '../../../services/especiais/proconData';
import { formatPrazoLegal } from '../../../services/especiais/proconStore';
import EspeciaisBulkActionPopover from '../shared/EspeciaisBulkActionPopover';

function RespostaButton({ action, item, onAction, disabled = false }) {
  if (action === 'responder') {
    return (
      <button
        type="button"
        className="ra-table__btn ra-table__btn--primary"
        disabled={disabled}
        onClick={() => onAction?.('responder', item)}
      >
        {disabled ? 'Abrindo…' : 'Responder'}
      </button>
    );
  }
  if (action === 'ver-resposta') {
    return (
      <button type="button" className="ra-table__btn ra-table__btn--ghost" onClick={() => onAction?.('ver-resposta', item)}>
        Ver resposta
      </button>
    );
  }
  if (action === 'avaliacao') {
    return (
      <button type="button" className="ra-table__btn ra-table__btn--ghost" onClick={() => onAction?.('avaliacao', item)}>
        <i className="ti ti-star" aria-hidden="true" /> Avaliação
      </button>
    );
  }
  return null;
}

function SlaBar({ pct, tone }) {
  return (
    <div className="ra-sla">
      <div className="ra-sla__track">
        <div className={`ra-sla__fill ra-sla__fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="ra-sla__pct">{pct}%</span>
    </div>
  );
}

export default function ProconTableView({
  groups,
  selectedIds,
  respondingId = null,
  onToggleSelect,
  onToggleSelectAll,
  onRowAction,
  onBulkApplied,
}) {
  const allItems = groups.flatMap((g) => g.items);
  const allIds = allItems.map((i) => i.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkBtnRef = useRef(null);

  return (
    <div className="ra-table-wrap">
      <table className="ra-table">
        <thead>
          <tr>
            <th className="ra-table__th-check">
              <span className="ra-table__th-check-inner">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleSelectAll?.(allIds, !allSelected)}
                  aria-label="Selecionar todas"
                />
                <button
                  ref={bulkBtnRef}
                  type="button"
                  className={'ra-table__bulk-btn' + (bulkOpen ? ' is-active' : '')}
                  title="Atuação em massa"
                  aria-label="Atuação em massa"
                  aria-expanded={bulkOpen}
                  aria-haspopup="dialog"
                  onClick={() => setBulkOpen((prev) => !prev)}
                >
                  <i className="ti ti-pencil" aria-hidden="true" />
                </button>
                <EspeciaisBulkActionPopover
                  open={bulkOpen}
                  onClose={() => setBulkOpen(false)}
                  anchorRef={bulkBtnRef}
                  channelId="pc"
                  selectedIds={selectedIds}
                  items={allItems}
                  onApplied={() => { setBulkOpen(false); onBulkApplied?.(); }}
                />
              </span>
            </th>
            <th>Consumidor / Assunto</th>
            <th>Status Procon</th>
            <th>SLA</th>
            <th>Prazo legal</th>
            <th>Órgão Procon</th>
            <th>Workflow</th>
            <th>Tabulação</th>
            <th>Atendente</th>
            <th>Resposta pública</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <React.Fragment key={group.id}>
              <tr className={`ra-table__group ra-table__group--${group.tone}`}>
                <td colSpan={10}>
                  <strong>{group.label}</strong>
                  <span className="ra-table__group-count">
                    ({group.items.length} demanda{group.items.length === 1 ? '' : 's'})
                  </span>
                </td>
              </tr>
              {group.items.map((item) => (
                <tr key={item.id} className="ra-table__row">
                  <td className="ra-table__td-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={() => onToggleSelect?.(item.id)}
                      aria-label={`Selecionar ${item.consumidor}`}
                    />
                  </td>
                  <td className="ra-table__consumer">
                    <div className="ra-table__consumer-cell">
                      <span className="ra-avatar">{item.iniciais}</span>
                      <div>
                        <strong>{item.consumidor}</strong>
                        <span className="ra-table__assunto">{item.assunto}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`ra-badge ra-badge--${item.statusPc}`}>
                      {getStatusLabel(item.statusPc)}
                    </span>
                  </td>
                  <td><SlaBar pct={item.slaPct} tone={item.slaTone} /></td>
                  <td>{formatPrazoLegal(item.prazoLegal)}</td>
                  <td>{item.orgaoProcon || '—'}</td>
                  <td>{item.workflow || '—'}</td>
                  <td>{item.tabulacao || '—'}</td>
                  <td>{item.atendente || '—'}</td>
                  <td>
                    <RespostaButton
                      action={item.respostaAction}
                      item={item}
                      onAction={onRowAction}
                      disabled={respondingId === item.id}
                    />
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {!groups.length ? (
        <p className="ra-table__empty">Nenhuma demanda encontrada com os filtros atuais.</p>
      ) : null}
    </div>
  );
}
