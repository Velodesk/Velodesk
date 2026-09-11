/**
 * WorkflowRoutesEditor v4.0.0 — bifurcação real: cada card (Aprovar/Reprovar)
 * embute sua própria mini-timeline (WorkflowConfigStepsTimeline) apontando pra
 * rota.passos — sem select de "Próximo passo" apontando pra outro lugar de uma
 * lista compartilhada. Ciclo de import com WorkflowConfigStepsTimeline (que
 * importa WorkflowStepEditor, que importa este arquivo) é seguro em ESM/Vite
 * porque o componente só é referenciado dentro de JSX, nunca no nível de módulo
 * — padrão comum de componente de árvore recursivo em React.
 * VERSION: v4.0.0 | DATE: 2026-09-10
 */
import React, { useEffect, useMemo } from 'react';
import {
  ROTA_VARIAVEIS,
  HIDDEN_ROTA_VARIAVEIS,
  normalizeRotas,
  createEmptyPassoEnvelope,
  normalizePassosOrdem,
} from './workflowConfigData';
import WorkflowConfigStepsTimeline from './WorkflowConfigStepsTimeline';

const STATUS_OPTIONS = [
  { value: '', label: '— manter —' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'em-andamento', label: 'Em andamento' },
  { value: 'resolvido', label: 'Resolvido' },
];

const MANDATORY_VARIAVEIS = ['approve', 'reject'];
const NOT_CONFIGURABLE_VARIAVEIS = [...MANDATORY_VARIAVEIS, ...HIDDEN_ROTA_VARIAVEIS];
const CONFIGURABLE_EXTRA_VARIAVEIS = ROTA_VARIAVEIS.filter((v) => !NOT_CONFIGURABLE_VARIAVEIS.includes(v.value));

function nextAvailableExtraRota(list) {
  const used = new Set(list.map((r) => r.variavel));
  const option = CONFIGURABLE_EXTRA_VARIAVEIS.find((v) => !used.has(v.value));
  if (!option) return null;
  return { variavel: option.value, rotulo: option.label, statusTicket: null, passos: [] };
}

function BranchCard({ title, rota, emptyStateLabel, grupos, onChange, onPassosChange }) {
  return (
    <div className={`wf-routes-editor__branch-card wf-routes-editor__branch-card--${rota.variavel}`}>
      <h5 className="wf-routes-editor__branch-title">{title}</h5>
      <label className="wf-routes-editor__branch-field">
        <span>Rótulo do botão</span>
        <input
          type="text"
          value={rota.rotulo || ''}
          onChange={(e) => onChange({ rotulo: e.target.value })}
          placeholder={title}
        />
      </label>
      <label className="wf-routes-editor__branch-field">
        <span>Status do ticket</span>
        <select
          value={rota.statusTicket || ''}
          onChange={(e) => onChange({ statusTicket: e.target.value || null })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value || 'keep'} value={s.value}>{s.label}</option>
          ))}
        </select>
      </label>

      <div className="wf-routes-editor__branch-timeline">
        {rota.passos.length === 0 ? (
          <p className="wf-routes-editor__branch-empty">{emptyStateLabel}</p>
        ) : null}
        <WorkflowConfigStepsTimeline
          passos={rota.passos}
          grupos={grupos}
          onPassosChange={onPassosChange}
          onAddStep={() => onPassosChange(normalizePassosOrdem([
            ...rota.passos,
            createEmptyPassoEnvelope(rota.passos.length),
          ]))}
        />
      </div>
    </div>
  );
}

export default function WorkflowRoutesEditor({ rotas = [], grupos = [], onChange }) {
  const list = useMemo(() => normalizeRotas(rotas), [rotas]);

  // Dados legados sem approve/reject: persiste a normalização assim que detectada.
  useEffect(() => {
    if (list.length !== (rotas || []).length) {
      onChange?.(list);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const updateByVariavel = (variavel, patch) => {
    onChange?.(list.map((row) => (row.variavel === variavel ? { ...row, ...patch } : row)));
  };

  const removeExtraRow = (variavel) => {
    onChange?.(list.filter((row) => row.variavel !== variavel));
  };

  const addExtraRow = () => {
    const next = nextAvailableExtraRota(list);
    if (!next) return;
    onChange?.([...list, next]);
  };

  // list já passou por normalizeRotas, então approve/reject sempre existem aqui.
  const approveRota = list.find((r) => r.variavel === 'approve');
  const rejectRota = list.find((r) => r.variavel === 'reject');
  // "Pedir informação" sempre existe em list (normalizeRotas garante), mas não aparece
  // aqui: função fixa, sem card e sem linha configurável.
  const extraRotas = list.filter((r) => !NOT_CONFIGURABLE_VARIAVEIS.includes(r.variavel));
  const canAddExtra = extraRotas.length < CONFIGURABLE_EXTRA_VARIAVEIS.length;

  return (
    <div className="wf-routes-editor">
      <div className="wf-routes-editor__branch-cards">
        <BranchCard
          title="Aprovar"
          rota={approveRota}
          grupos={grupos}
          emptyStateLabel="Sem etapas — aprovar encerra o workflow."
          onChange={(patch) => updateByVariavel('approve', patch)}
          onPassosChange={(next) => updateByVariavel('approve', { passos: next })}
        />
        <BranchCard
          title="Reprovar"
          rota={rejectRota}
          grupos={grupos}
          emptyStateLabel="Sem etapas — encerra aqui e volta ao responsável."
          onChange={(patch) => updateByVariavel('reject', patch)}
          onPassosChange={(next) => updateByVariavel('reject', { passos: next })}
        />
      </div>

      {(extraRotas.length > 0 || canAddExtra) && (
        <div className="wf-routes-editor__extra">
          <h5 className="wf-routes-editor__extra-title">Outras respostas (opcional)</h5>
          {extraRotas.length > 0 && (
            <table className="config-table wf-routes-editor__table">
              <thead>
                <tr>
                  <th>Variável</th>
                  <th>Rótulo</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {extraRotas.map((row) => (
                  <tr key={row.variavel}>
                    <td>
                      <select
                        value={row.variavel || ''}
                        onChange={(e) => updateByVariavel(row.variavel, { variavel: e.target.value })}
                      >
                        {CONFIGURABLE_EXTRA_VARIAVEIS.map((v) => (
                          <option key={v.value} value={v.value}>{v.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={row.rotulo || ''}
                        onChange={(e) => updateByVariavel(row.variavel, { rotulo: e.target.value })}
                        placeholder="Rótulo do botão"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="config-action-btn config-action-btn--delete"
                        onClick={() => removeExtraRow(row.variavel)}
                        aria-label="Remover rota"
                      >
                        <i className="ti ti-trash" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canAddExtra && (
            <button type="button" className="wf-routes-editor__add" onClick={addExtraRow}>
              <i className="ti ti-plus" aria-hidden="true" />
              Adicionar resposta
            </button>
          )}
        </div>
      )}
    </div>
  );
}
