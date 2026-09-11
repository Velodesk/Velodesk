/**
 * WorkflowConfigStepsTimeline v2.2.0 — reutilizável recursivamente (uma instância
 * por ramo, dentro de cada card Aprovar/Reprovar, via WorkflowRoutesEditor)
 * VERSION: v2.2.0 | DATE: 2026-09-10
 */
import React, { useEffect, useMemo, useState } from 'react';
import WorkflowStepEditor from './WorkflowStepEditor';
import {
  findPassoEnvelopeIndex,
  normalizePassosOrdem,
  passosToDisplaySteps,
} from './workflowConfigData';

function WorkflowConfigStepItem({
  step,
  isLast,
  expanded,
  onToggle,
  children,
}) {
  return (
    <li className={'wf-config-step' + (isLast ? ' wf-config-step--last' : '') + (expanded ? ' is-expanded' : '')}>
      <div className={'wf-config-step__icon wf-config-step__icon--' + (step.iconTone || 'start')}>
        <i className={'ti ' + step.icon} aria-hidden="true" />
      </div>
      <div className="wf-config-step__body">
        <button type="button" className="wf-config-step__head-btn" onClick={onToggle}>
          <div className="wf-config-step__head-main">
            <h4 className="wf-config-step__title">{step.title || 'Etapa'}</h4>
            {step.badges?.length && !expanded ? (
              <div className="wf-config-step__badges">
                {step.badges.map((badge) => (
                  <span
                    key={badge.label}
                    className={'wf-config-step__badge wf-config-step__badge--' + (badge.tone || 'neutral')}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <i
            className={'wf-config-step__chevron ti ' + (expanded ? 'ti-chevron-up' : 'ti-chevron-down')}
            aria-hidden="true"
          />
        </button>
        {!expanded ? (
          <p className="wf-config-step__desc">{step.description}</p>
        ) : null}
        {expanded ? children : null}
      </div>
    </li>
  );
}

export default function WorkflowConfigStepsTimeline({
  passos,
  grupos,
  onPassosChange,
  onAddStep,
  expandStepId = null,
  onExpandHandled,
}) {
  const [expandedId, setExpandedId] = useState(null);
  const displaySteps = useMemo(() => passosToDisplaySteps(passos || []), [passos]);

  useEffect(() => {
    if (!expandStepId) return;
    setExpandedId(expandStepId);
    onExpandHandled?.();
  }, [expandStepId, onExpandHandled]);

  const applyPassosChange = (nextPassos) => {
    onPassosChange?.(normalizePassosOrdem(nextPassos));
  };

  const handleUpdateEnvelope = (envelope, updated) => {
    const index = findPassoEnvelopeIndex(passos || [], envelope);
    if (index < 0) return;
    const next = [...(passos || [])];
    next[index] = updated;
    applyPassosChange(next);
  };

  const handleRemove = (envelope) => {
    const index = findPassoEnvelopeIndex(passos || [], envelope);
    if (index < 0) return;
    const next = (passos || []).filter((_, i) => i !== index);
    applyPassosChange(next);
    setExpandedId(null);
  };

  return (
    <section className="wf-config-steps">
      <div className="wf-config-steps__head">
        <h3 className="wf-config-steps__title">Etapas do workflow</h3>
        <button type="button" className="wf-config-steps__add" onClick={onAddStep}>
          <i className="ti ti-plus" aria-hidden="true" />
          Nova etapa
        </button>
      </div>
      <ol className="wf-config-steps__timeline">
        {displaySteps.map((step, index) => (
          <WorkflowConfigStepItem
            key={step.id}
            step={step}
            isLast={index === displaySteps.length - 1}
            expanded={expandedId === step.id}
            onToggle={() => setExpandedId((prev) => (prev === step.id ? null : step.id))}
          >
            <WorkflowStepEditor
              envelope={step.envelope}
              grupos={grupos}
              onChange={(env) => handleUpdateEnvelope(step.envelope, env)}
              onRemove={() => handleRemove(step.envelope)}
              canRemove={displaySteps.length > 1}
            />
          </WorkflowConfigStepItem>
        ))}
      </ol>
    </section>
  );
}
