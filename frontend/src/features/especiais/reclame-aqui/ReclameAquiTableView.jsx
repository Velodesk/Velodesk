/**
 * ReclameAquiTableView v1.1.0 — sem coluna de workflow
 */
import React from 'react';
import { getStatusLabel } from '../../../services/especiais/reclameAquiData';

const ORGAO_LABELS = {
  bacen: 'Bacen',
  procon: 'Procon',
  consumidor_gov: 'Consumidor.Gov',
};

function RespostaButton({ action, item, onAction }) {
  if (action === 'responder') {
    return (
      <button type="button" className="ra-table__btn ra-table__btn--primary" onClick={() => onAction?.('responder', item)}>
        Responder
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

function RaRepeatIndicator({ item, clientRepeatCounts }) {
  const cpf = String(item.cpf || '').trim();
  const count = cpf ? (clientRepeatCounts?.get(cpf) || 0) : 0;
  if (count < 2) return null;
  return (
    <span
      className="ra-table__repeat-count"
      title={`Cliente possui ${count} reclamações no Reclame Aqui`}
    >
      {count}
    </span>
  );
}

function CasosEspeciaisIndicator({ item, casosEspeciaisByCpf }) {
  const cpf = String(item.cpf || '').trim();
  const entries = cpf ? (casosEspeciaisByCpf?.[cpf] || []) : [];
  const total = entries.reduce((sum, e) => sum + (e.count || 0), 0);
  if (!total) return null;
  const breakdown = entries
    .map((e) => `${ORGAO_LABELS[e.orgao] || e.orgao} (${e.count})`)
    .join(' · ');
  return (
    <span
      className="ra-table__repeat-count ra-table__repeat-count--especiais"
      title={`Cliente também tem caso em: ${breakdown}`}
    >
      {total}
    </span>
  );
}

export default function ReclameAquiTableView({
  groups,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onRowAction,
  clientRepeatCounts,
  casosEspeciaisByCpf,
}) {
  const allIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));

  return (
    <div className="ra-table-wrap">
      <table className="ra-table">
        <thead>
          <tr>
            <th className="ra-table__th-check">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleSelectAll?.(allIds, !allSelected)}
                aria-label="Selecionar todas"
              />
            </th>
            <th>Consumidor / Assunto</th>
            <th>Status RA</th>
            <th>RA</th>
            <th>Casos Especiais</th>
            <th>Passível nota</th>
            <th>Motivo</th>
            <th>Atendente</th>
            <th>Resposta pública</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <React.Fragment key={group.id}>
              <tr className={`ra-table__group ra-table__group--${group.tone}`}>
                <td colSpan={9}>
                  <strong>{group.label}</strong>
                  <span className="ra-table__group-count">
                    ({group.items.length} reclamaç{group.items.length === 1 ? 'ão' : 'ões'})
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
                    <span className={`ra-badge ra-badge--${item.statusRa}`}>
                      {getStatusLabel(item.statusRa)}
                    </span>
                  </td>
                  <td className="ra-table__td-repeat">
                    <RaRepeatIndicator item={item} clientRepeatCounts={clientRepeatCounts} />
                  </td>
                  <td className="ra-table__td-repeat">
                    <CasosEspeciaisIndicator item={item} casosEspeciaisByCpf={casosEspeciaisByCpf} />
                  </td>
                  <td>{item.passivelNota ? 'Sim' : 'Não'}</td>
                  <td>{item.motivo || item.tabulacao || '—'}</td>
                  <td>{item.atendente || '—'}</td>
                  <td>
                    <RespostaButton action={item.respostaAction} item={item} onAction={onRowAction} />
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      {!groups.length ? (
        <p className="ra-table__empty">Nenhuma reclamação encontrada com os filtros atuais.</p>
      ) : null}
    </div>
  );
}
