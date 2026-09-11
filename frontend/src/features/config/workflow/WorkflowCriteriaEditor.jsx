/**
 * WorkflowCriteriaEditor v2.5.0 — legenda E/OU (campos diferentes = E, mesmo campo = OU)
 * VERSION: v2.5.0 | DATE: 2026-09-10
 */
import React, { useMemo } from 'react';
import { useTabulation } from '../../../context/TabulationContext';
import {
  CRITERIO_CAMPOS,
  CRITERIO_CAMPOS_INTEGRACAO,
  CRITERIO_FONTES,
  CRITERIO_OPERADORES,
  GATILHO_CRITERIO_OPCOES,
  criterioOptionKey,
  getIntegracaoValoresForCampo,
  parseCriterioOptionKey,
  resolveGatilhoCascadeContext,
} from './workflowConfigData';

function emptyCriterio(mode) {
  if (mode === 'gatilho') {
    return { fonte: 'tabulacao', campo: '', operador: 'equals', valor: '' };
  }
  return { fonte: 'tabulacao', campo: 'produto', operador: 'contains', valor: '' };
}

function defaultCampoForFonte(fonte) {
  if (fonte === 'integracao') return CRITERIO_CAMPOS_INTEGRACAO[0]?.value || 'statusPagamento';
  return 'produto';
}

function isTabulacaoRow(row) {
  return !row?.fonte || row.fonte === 'tabulacao';
}

function FloatingField({
  label,
  filled,
  children,
  className = '',
}) {
  return (
    <label className={'wf-float-field' + (filled ? ' is-filled' : '') + (className ? ` ${className}` : '')}>
      {children}
      <span className="wf-float-field__label">{label}</span>
    </label>
  );
}

export default function WorkflowCriteriaEditor({
  criterios = [],
  onChange,
  compact = false,
  mode = 'step',
  hideAddButton = false,
}) {
  const {
    getProdutoNames,
    getTipoChamadoOptions,
    getCanalContatoOptions,
    resolveMotivoOptions,
    resolveDetalheOptions,
  } = useTabulation();
  const list = criterios.length ? criterios : [];
  const cascade = useMemo(() => resolveGatilhoCascadeContext(list), [list]);
  const isGatilho = mode === 'gatilho';

  const getTabulationValueOptions = (campo) => {
    switch (campo) {
      case 'tipoChamado':
        return (getTipoChamadoOptions?.() || []).map((value) => ({ value, label: value }));
      case 'produto':
        return (getProdutoNames?.() || []).map((value) => ({ value, label: value }));
      case 'motivo':
        return (resolveMotivoOptions?.(cascade.produto) || []).map((value) => ({ value, label: value }));
      case 'detalhe':
        return (resolveDetalheOptions?.(cascade.produto, cascade.motivo) || []).map((value) => ({
          value,
          label: value,
        }));
      case 'canal':
        return (getCanalContatoOptions?.() || []).map((value) => ({ value, label: value }));
      default:
        return [];
    }
  };

  const updateRow = (index, patch) => {
    const next = list.map((row, i) => {
      if (i !== index) return row;
      const merged = { ...row, ...patch };
      if (isGatilho) merged.operador = 'equals';
      return merged;
    });
    onChange?.(next);
  };

  const removeRow = (index) => {
    onChange?.(list.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange?.([...list, emptyCriterio(mode)]);
  };

  const renderGatilhoCampoSelect = (row, index) => {
    const key = row.campo ? criterioOptionKey(row.fonte, row.campo) : '';
    return (
      <FloatingField label="Campo" filled={Boolean(key)}>
        <select
          className="wf-float-field__control"
          value={key}
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw) {
              updateRow(index, { fonte: 'tabulacao', campo: '', operador: 'equals', valor: '' });
              return;
            }
            const { fonte, campo } = parseCriterioOptionKey(raw);
            updateRow(index, { fonte, campo, operador: 'equals', valor: '' });
          }}
        >
          <option value="" disabled hidden />
          {GATILHO_CRITERIO_OPCOES.map((option) => (
            <option key={criterioOptionKey(option.fonte, option.campo)} value={criterioOptionKey(option.fonte, option.campo)}>
              {option.label}
            </option>
          ))}
        </select>
      </FloatingField>
    );
  };

  const renderGatilhoValorSelect = (row, index, options, emptyLabel = 'Selecione…') => (
    <FloatingField label="Valor" filled={Boolean(row.valor)}>
      <select
        className="wf-float-field__control"
        value={row.valor || ''}
        onChange={(e) => updateRow(index, { valor: e.target.value, operador: 'equals' })}
      >
        <option value="">{emptyLabel}</option>
        {options.map((item) => (
          <option key={item.value} value={item.value}>{item.label}</option>
        ))}
      </select>
    </FloatingField>
  );

  const renderGatilhoValorField = (row, index) => {
    if (!row.campo) {
      return renderGatilhoValorSelect(row, index, [], 'Selecione um campo');
    }

    if (row.fonte === 'integracao') {
      const options = getIntegracaoValoresForCampo(row.campo);
      if (options.length) {
        return renderGatilhoValorSelect(
          row,
          index,
          options.map((item) => ({ value: item.value, label: item.label })),
        );
      }
    }

    if (isTabulacaoRow(row)) {
      const options = getTabulationValueOptions(row.campo);
      if (['tipoChamado', 'produto', 'motivo', 'detalhe', 'canal'].includes(row.campo)) {
        return renderGatilhoValorSelect(row, index, options);
      }
    }

    return (
      <FloatingField label="Valor" filled={Boolean(row.valor)}>
        <input
          type="text"
          className="wf-float-field__control"
          value={row.valor || ''}
          onChange={(e) => updateRow(index, { valor: e.target.value, operador: 'equals' })}
        />
      </FloatingField>
    );
  };

  const renderIntegracaoValorSelect = (row, index, options) => (
    <select
      value={row.valor || ''}
      onChange={(e) => updateRow(index, { valor: e.target.value })}
      aria-label="Valor da integração"
    >
      <option value="">Selecione…</option>
      {options.map((item) => (
        <option key={item.value} value={item.value}>{item.label}</option>
      ))}
    </select>
  );

  const renderTabulationValorSelect = (row, index, options) => (
    <select
      value={row.valor || ''}
      onChange={(e) => updateRow(index, { valor: e.target.value })}
      aria-label="Valor"
    >
      <option value="">Selecione…</option>
      {options.map((item) => (
        <option key={item.value} value={item.value}>{item.label}</option>
      ))}
    </select>
  );

  const renderValorInput = (row, index) => {
    if (row.operador === 'not_empty') {
      return <span className="wf-criteria-editor__spacer" aria-hidden="true" />;
    }

    if (row.fonte === 'integracao' && row.operador !== 'in') {
      const options = getIntegracaoValoresForCampo(row.campo);
      if (options.length) {
        return renderIntegracaoValorSelect(row, index, options);
      }
    }

    if (isTabulacaoRow(row)) {
      const options = getTabulationValueOptions(row.campo);
      if (['tipoChamado', 'produto', 'motivo', 'detalhe'].includes(row.campo)) {
        return renderTabulationValorSelect(row, index, options);
      }
    }

    return (
      <input
        type="text"
        value={row.valor || ''}
        onChange={(e) => updateRow(index, { valor: e.target.value })}
        placeholder={row.fonte === 'integracao' ? 'Valor da integração' : 'Valor'}
        aria-label="Valor"
      />
    );
  };

  const renderStepFonteCampo = (row, index) => (
    <>
      <select
        value={row.fonte || 'tabulacao'}
        onChange={(e) => {
          const fonte = e.target.value;
          updateRow(index, { fonte, campo: defaultCampoForFonte(fonte), valor: '' });
        }}
        aria-label="Fonte do critério"
      >
        {CRITERIO_FONTES.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {row.fonte === 'integracao' ? (
        <select
          value={row.campo || 'statusPagamento'}
          onChange={(e) => updateRow(index, { campo: e.target.value, valor: '' })}
          aria-label="Campo de integração"
        >
          {CRITERIO_CAMPOS_INTEGRACAO.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      ) : (
        <select
          value={row.campo || 'produto'}
          onChange={(e) => updateRow(index, { campo: e.target.value, valor: '' })}
          aria-label="Campo"
        >
          {CRITERIO_CAMPOS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      )}
    </>
  );

  const rootClass = [
    'wf-criteria-editor',
    compact ? 'wf-criteria-editor--compact' : '',
    isGatilho ? 'wf-criteria-editor--gatilho' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {list.length > 0 ? (
        <ul className="wf-criteria-editor__list">
          {list.map((row, index) => (
            <li key={`crit-${index}`} className="wf-criteria-editor__row">
              {isGatilho ? (
                <>
                  {renderGatilhoCampoSelect(row, index)}
                  {renderGatilhoValorField(row, index)}
                </>
              ) : (
                <>
                  {renderStepFonteCampo(row, index)}
                  <select
                    value={row.operador || 'equals'}
                    onChange={(e) => updateRow(index, { operador: e.target.value })}
                    aria-label="Operador"
                  >
                    {CRITERIO_OPERADORES.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {renderValorInput(row, index)}
                </>
              )}

              <button
                type="button"
                className="config-action-btn config-action-btn--delete wf-criteria-editor__remove"
                onClick={() => removeRow(index)}
                aria-label="Remover critério"
              >
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : !isGatilho ? (
        <p className="wf-criteria-editor__empty">Nenhum critério.</p>
      ) : null}

      {!hideAddButton && (
        <button type="button" className="wf-criteria-editor__add" onClick={addRow}>
          <i className="ti ti-plus" aria-hidden="true" />
          Adicionar critério
        </button>
      )}

      {isGatilho && list.length > 0 ? (
        <p className="config-placeholder-msg wf-criteria-editor__hint">
          Critérios de campos diferentes entram com E. Vários critérios do mesmo campo entram com OU.
        </p>
      ) : null}
    </div>
  );
}
