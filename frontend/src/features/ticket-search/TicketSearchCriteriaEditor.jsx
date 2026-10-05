/**
 * Editor multi-critério da Busca de Tickets (linhas ilimitadas)
 * VERSION: v1.0.2 | DATE: 2026-08-04
 */
import React from 'react';
import { useTabulation } from '../../context/TabulationContext';
import CriteriaMultiSelect from '../preferencias/components/CriteriaMultiSelect';
import {
  ATRIBUIDO_SHORTCUTS,
  CANAL_OPTIONS,
  OPERATOR_LABELS,
  PENDING_DECISION_OPTIONS,
  PRIORIDADE_OPTIONS,
  SEARCH_FIELD_CATALOG,
  SLA_OPTIONS,
  STATUS_OPTIONS,
  WORKFLOW_OPTIONS,
  createEmptyCriterio,
  criterioValores,
  getFieldDef,
  patchValores,
} from './ticketSearchCriteria';

export default function TicketSearchCriteriaEditor({
  criterios = [],
  onChange,
  showLegadoToggle = false,
  incluirLegadoOcta = false,
  onIncluirLegadoOctaChange,
}) {
  const {
    getProdutoNames,
    getTipoChamadoOptions,
    resolveMotivoOptions,
    resolveDetalheOptions,
  } = useTabulation();

  const list = Array.isArray(criterios) ? criterios : [];

  const updateRow = (index, patch) => {
    onChange?.(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const updateRowValores = (index, valores) => {
    updateRow(index, patchValores(list[index], valores));
  };

  const removeRow = (index) => {
    onChange?.(list.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange?.([...list, createEmptyCriterio()]);
  };

  const changeCampo = (index, campo) => {
    const def = getFieldDef(campo);
    const operador = def.operators[0] || 'equals';
    let valores = [];
    if (campo === 'status') valores = ['em-andamento'];
    if (campo === 'workflow') valores = ['ativo'];
    if (campo === 'sla') valores = ['ok'];
    if (campo === 'atribuido') valores = ['__me__'];
    if (campo === 'prioridade') valores = ['media'];
    if (campo === 'canal') valores = ['digital'];
    updateRow(index, patchValores({ campo, operador }, valores));
  };

  const tabOptionsFor = (campo, rows) => {
    const produtoRows = rows.filter((r) => r.campo === 'produto');
    const produtoValores = produtoRows.flatMap((r) => criterioValores(r));
    const produto = produtoValores[0] || '';
    const motivoRows = rows.filter((r) => r.campo === 'motivo');
    const motivoValores = motivoRows.flatMap((r) => criterioValores(r));
    const motivo = motivoValores[0] || '';
    switch (campo) {
      case 'tipoChamado':
        return (getTipoChamadoOptions?.() || []).map((value) => ({ value, label: value }));
      case 'produto':
        return (getProdutoNames?.() || []).map((value) => ({ value, label: value }));
      case 'motivo':
        return (resolveMotivoOptions?.(produto) || []).map((value) => ({ value, label: value }));
      case 'detalhe':
        return (resolveDetalheOptions?.(produto, motivo) || []).map((value) => ({ value, label: value }));
      default:
        return [];
    }
  };

  const renderValor = (row, index) => {
    const def = getFieldDef(row.campo);
    const op = row.operador || 'equals';

    if (op === 'not_empty') {
      return (
        <span className="ticket-search-criteria__hint">Qualquer valor preenchido</span>
      );
    }

    if (def.input === 'date') {
      if (op === 'between') {
        const vals = criterioValores(row);
        return (
          <div className="ticket-search-criteria__dates">
            <input
              type="date"
              className="ticket-search-criteria__control"
              value={vals[0] || ''}
              onChange={(e) => updateRowValores(index, [e.target.value, vals[1] || ''])}
              aria-label="Data inicial"
            />
            <span className="ticket-search-criteria__hint">até</span>
            <input
              type="date"
              className="ticket-search-criteria__control"
              value={vals[1] || ''}
              onChange={(e) => updateRowValores(index, [vals[0] || '', e.target.value])}
              aria-label="Data final"
            />
          </div>
        );
      }
      return (
        <input
          type="date"
          className="ticket-search-criteria__control"
          value={criterioValores(row)[0] || ''}
          onChange={(e) => updateRowValores(index, [e.target.value])}
          aria-label="Data"
        />
      );
    }

    if (row.campo === 'status') {
      return (
        <CriteriaMultiSelect
          options={STATUS_OPTIONS}
          values={criterioValores(row)}
          onChange={(next) => updateRowValores(index, next)}
          placeholder="Selecione status…"
          ariaLabel="Status"
        />
      );
    }

    if (row.campo === 'canal') {
      return (
        <CriteriaMultiSelect
          options={CANAL_OPTIONS}
          values={criterioValores(row)}
          onChange={(next) => updateRowValores(index, next)}
          placeholder="Selecione canal…"
          ariaLabel="Canal"
        />
      );
    }

    if (row.campo === 'prioridade') {
      return (
        <CriteriaMultiSelect
          options={PRIORIDADE_OPTIONS}
          values={criterioValores(row)}
          onChange={(next) => updateRowValores(index, next)}
          placeholder="Selecione prioridade…"
          ariaLabel="Prioridade"
        />
      );
    }

    if (row.campo === 'sla') {
      return (
        <CriteriaMultiSelect
          options={SLA_OPTIONS}
          values={criterioValores(row)}
          onChange={(next) => updateRowValores(index, next)}
          placeholder="Selecione SLA…"
          ariaLabel="SLA"
        />
      );
    }

    if (row.campo === 'workflow') {
      return (
        <CriteriaMultiSelect
          options={WORKFLOW_OPTIONS}
          values={criterioValores(row)}
          onChange={(next) => updateRowValores(index, next)}
          placeholder="Selecione workflow…"
          ariaLabel="Workflow"
        />
      );
    }

    if (row.campo === 'pendingDecision') {
      return (
        <CriteriaMultiSelect
          options={PENDING_DECISION_OPTIONS}
          values={criterioValores(row)}
          onChange={(next) => updateRowValores(index, next)}
          placeholder="Selecione decisão…"
          ariaLabel="Decisão pendente"
        />
      );
    }

    if (row.campo === 'atribuido') {
      return (
        <div className="ticket-search-criteria__atribuido">
          <CriteriaMultiSelect
            options={ATRIBUIDO_SHORTCUTS}
            values={criterioValores(row).filter((v) => v === '__me__' || v === '__empty__')}
            onChange={(next) => {
              const shortcuts = next.filter((v) => v === '__me__' || v === '__empty__');
              if (shortcuts.length) {
                updateRowValores(index, [shortcuts[shortcuts.length - 1]]);
              } else {
                updateRowValores(index, []);
              }
            }}
            placeholder="Atalhos…"
            ariaLabel="Atalhos de atribuído"
          />
          <input
            type="text"
            className="ticket-search-criteria__control"
            value={
              criterioValores(row).some((v) => v === '__me__' || v === '__empty__')
                ? ''
                : criterioValores(row).join(', ')
            }
            onChange={(e) => {
              const parts = String(e.target.value || '')
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean);
              updateRowValores(index, parts);
            }}
            placeholder="Ou digite o atribuído…"
            aria-label="Valor de atribuído"
          />
        </div>
      );
    }

    if (def.input === 'tabulacao') {
      const options = tabOptionsFor(row.campo, list);
      if (options.length) {
        return (
          <CriteriaMultiSelect
            options={options}
            values={criterioValores(row)}
            onChange={(next) => updateRowValores(index, next)}
            placeholder={`Selecione ${def.label.toLowerCase()}…`}
            ariaLabel={def.label}
          />
        );
      }
    }

    return (
      <input
        type="text"
        className="ticket-search-criteria__control"
        value={criterioValores(row).join(', ')}
        onChange={(e) => {
          const parts = String(e.target.value || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
          updateRowValores(index, parts);
        }}
        placeholder="Valor (múltiplos separados por vírgula)"
        aria-label={def.label}
      />
    );
  };

  return (
    <div className="ticket-search-criteria">
      {list.length > 0 ? (
        <ul className="ticket-search-criteria__list">
          {list.map((row, index) => {
            const def = getFieldDef(row.campo);
            return (
              <li key={`search-crit-${index}`} className="ticket-search-criteria__row">
                <div className="ticket-search-criteria__cols">
                  <select
                    className="ticket-search-criteria__control ticket-search-criteria__control--campo"
                    value={row.campo || 'protocolo'}
                    onChange={(e) => changeCampo(index, e.target.value)}
                    aria-label="Campo do filtro"
                  >
                    {SEARCH_FIELD_CATALOG.map((f) => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>

                  <select
                    className="ticket-search-criteria__control ticket-search-criteria__control--op"
                    value={row.operador || def.operators[0]}
                    onChange={(e) => updateRow(index, { operador: e.target.value })}
                    aria-label="Operador"
                  >
                    {def.operators.map((op) => (
                      <option key={op} value={op}>{OPERATOR_LABELS[op] || op}</option>
                    ))}
                  </select>

                  <div className="ticket-search-criteria__valor">
                    {renderValor(row, index)}
                  </div>

                  <button
                    type="button"
                    className="ticket-search-criteria__remove"
                    onClick={() => removeRow(index)}
                    aria-label="Remover filtro"
                    title="Remover filtro"
                    disabled={list.length <= 1}
                  >
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ticket-search-criteria__empty">
          Nenhum filtro. Adicione ao menos um critério (combinados com E; múltiplos valores na mesma linha usam OU).
        </p>
      )}

      <div className="ticket-search-criteria__footer">
        <button type="button" className="btn-secondary ticket-search-criteria__add" onClick={addRow}>
          <i className="ti ti-plus" aria-hidden="true" />
          Adicionar filtro
        </button>
        {showLegadoToggle ? (
          <label
            className="ticket-search-criteria__legado"
            title="Inclui o arquivo do Octadesk (tickets e WhatsApp) na busca. Desligado, só os tickets do Desk são consultados."
          >
            <input
              type="checkbox"
              role="switch"
              className="ticket-search-criteria__legado-input"
              checked={Boolean(incluirLegadoOcta)}
              onChange={(e) => onIncluirLegadoOctaChange?.(e.target.checked)}
            />
            <span className="ticket-search-criteria__legado-track" aria-hidden="true" />
            <span className="ticket-search-criteria__legado-label">Incluir Legado Octa</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
