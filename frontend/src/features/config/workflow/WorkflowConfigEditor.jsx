/**
 * WorkflowConfigEditor v2.9.0 — remove validação de proximoPassoId (bifurcação em
 * árvore: etapas aninhadas nunca ficam órfãs, não há mais referência solta a validar)
 * VERSION: v2.9.0 | DATE: 2026-09-10
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNotifications } from '../../../context/NotificationContext';
import { useWorkflowConfig } from '../../../context/WorkflowConfigContext';
import WorkflowConfigHeader from './WorkflowConfigHeader';
import WorkflowConfigStepsTimeline from './WorkflowConfigStepsTimeline';
import WorkflowCriteriaEditor from './WorkflowCriteriaEditor';
import WorkflowRequisicaoFieldsEditor from './WorkflowRequisicaoFieldsEditor';
import {
  createEmptyGatilhoCriterio,
  createEmptyPassoEnvelope,
  createEmptyRequisicaoCampo,
  normalizeGatilho,
  normalizePassosOrdem,
  normalizeRequisicao,
} from './workflowConfigData';
import { createRequisicaoCampoClientKey } from '../../../services/workflow/workflowRequisicao';

function cloneDoc(doc) {
  if (!doc) return null;
  const cloned = JSON.parse(JSON.stringify(doc));
  const campos = cloned?.requisicao?.campos;
  if (Array.isArray(campos)) {
    cloned.requisicao.campos = campos.map((campo) => (
      campo._clientKey ? campo : { ...campo, _clientKey: createRequisicaoCampoClientKey() }
    ));
  }
  return cloned;
}

export default function WorkflowConfigEditor({
  workflow: initialWorkflow,
  isNew = false,
  onClose,
  onSave,
}) {
  const { showNotification } = useNotifications();
  const { grupos } = useWorkflowConfig();
  const [draft, setDraft] = useState(() => cloneDoc(initialWorkflow));
  const [expandStepId, setExpandStepId] = useState(null);

  useEffect(() => {
    setDraft(cloneDoc(initialWorkflow));
    setExpandStepId(null);
  }, [initialWorkflow]);

  const handleGatilhoCriteriosChange = useCallback((criterios) => {
    setDraft((prev) => ({
      ...prev,
      gatilho: {
        tipo: 'tabulacao',
        criterios,
      },
    }));
  }, []);

  const handleAddGatilhoCriterio = useCallback(() => {
    const criterios = draft?.gatilho?.criterios || [];
    handleGatilhoCriteriosChange([...criterios, createEmptyGatilhoCriterio()]);
  }, [draft?.gatilho?.criterios, handleGatilhoCriteriosChange]);

  const handleRequisicaoCamposChange = useCallback((campos) => {
    setDraft((prev) => ({ ...prev, requisicao: { campos } }));
  }, []);

  const handleAddRequisicaoCampo = useCallback(() => {
    setDraft((prev) => {
      const campos = prev.requisicao?.campos || [];
      return {
        ...prev,
        requisicao: {
          campos: [...campos, createEmptyRequisicaoCampo(prev.gatilho, campos)],
        },
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    const titulo = String(draft?.titulo || '').trim();
    if (!titulo) {
      showNotification('Informe o nome do workflow.', 'error');
      return;
    }
    const criterios = draft?.gatilho?.criterios || [];
    if (criterios.some((c) => {
      if (!String(c.campo || '').trim()) return true;
      if (c.fonte === 'grupo_responsabilidade' || c.operador === 'not_empty') return false;
      return !String(c.valor || '').trim();
    })) {
      showNotification('Complete os critérios do gatilho antes de salvar.', 'error');
      return;
    }
    try {
      await onSave?.({
        ...draft,
        titulo,
        gatilho: normalizeGatilho(draft.gatilho),
        requisicao: normalizeRequisicao(draft.requisicao, draft.gatilho),
        passos: normalizePassosOrdem(draft.passos || []),
      });
      showNotification(isNew ? 'Workflow criado.' : 'Workflow salvo.', 'success');
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao salvar workflow.', 'error');
    }
  }, [draft, isNew, onSave, showNotification]);

  const handleAddStep = useCallback(() => {
    const newStep = createEmptyPassoEnvelope(draft?.passos?.length || 0);
    setDraft((prev) => ({
      ...prev,
      passos: normalizePassosOrdem([...(prev.passos || []), newStep]),
    }));
    setExpandStepId(String(newStep._id));
    showNotification('Nova etapa adicionada.', 'success');
  }, [draft?.passos?.length, showNotification]);

  const handlePassosChange = useCallback((passos) => {
    setDraft((prev) => ({ ...prev, passos: normalizePassosOrdem(passos) }));
  }, []);

  const handleExpandHandled = useCallback(() => {
    setExpandStepId(null);
  }, []);

  if (!draft) return null;

  return (
    <div className="config-section-body config-editor config-workflow-editor">
      <button type="button" className="config-action-btn config-action-btn--edit forms-editor-back" onClick={onClose}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Voltar à lista
      </button>

      <div className="wf-config-shell">
        <div className="wf-config-main">
          <WorkflowConfigHeader
            title={draft.titulo || 'Workflow'}
            titleEditable
            onTitleChange={(value) => setDraft((prev) => ({ ...prev, titulo: value }))}
            description={draft.descricao || ''}
            descriptionEditable
            onDescriptionChange={(value) => setDraft((prev) => ({ ...prev, descricao: value }))}
            active={draft.ativo !== false}
            onToggleActive={(value) => setDraft((prev) => ({ ...prev, ativo: value }))}
            onHistory={() => showNotification('Histórico de versões — em breve.', 'info')}
            onDuplicate={() => showNotification('Duplicar workflow — em breve.', 'info')}
            onSave={handleSave}
          />

          <div className="wf-config-panel">
            <section className="wf-config-trigger">
              <div className="wf-config-trigger__quadro">
                <div className="wf-config-trigger__head">
                  <h3 className="wf-config-trigger__title">Gatilho de ativação</h3>
                  <button
                    type="button"
                    className="wf-config-trigger__add"
                    onClick={handleAddGatilhoCriterio}
                    aria-label="Adicionar critério"
                    title="Adicionar critério"
                  >
                    <i className="ti ti-plus" aria-hidden="true" />
                  </button>
                </div>
                <WorkflowCriteriaEditor
                  mode="gatilho"
                  hideAddButton
                  criterios={draft.gatilho?.criterios || []}
                  onChange={handleGatilhoCriteriosChange}
                />
              </div>
            </section>

            <section className="wf-config-requisicao-section">
              <div className="wf-config-requisicao__quadro">
                <div className="wf-config-requisicao__head">
                  <h3 className="wf-config-requisicao__title">Form de requisição</h3>
                  <button
                    type="button"
                    className="wf-config-requisicao__add"
                    onClick={handleAddRequisicaoCampo}
                    aria-label="Adicionar campo"
                    title="Adicionar campo complementar"
                  >
                    <i className="ti ti-plus" aria-hidden="true" />
                  </button>
                </div>
                <WorkflowRequisicaoFieldsEditor
                  campos={draft.requisicao?.campos || []}
                  gatilho={draft.gatilho}
                  onChange={handleRequisicaoCamposChange}
                />
              </div>
            </section>

            <WorkflowConfigStepsTimeline
              passos={draft.passos || []}
              grupos={grupos}
              onPassosChange={handlePassosChange}
              onAddStep={handleAddStep}
              expandStepId={expandStepId}
              onExpandHandled={handleExpandHandled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
