/**
 * WorkflowProgressModal v1.2.0 — cancel: passos não cumpridos + selo interrompido
 * VERSION: v1.2.0 | DATE: 2026-08-20
 */
import React, { useEffect, useMemo } from 'react';
import {
  getWorkflowProgress,
  isTicketInWorkflow,
  isTicketWorkflowCancelled,
  isTicketWorkflowFinished,
} from '../../../services/desk/utils';
import { getWorkflowStepSubtitle } from '../../../services/desk/workflowDefinitions';
import { useWorkflowConfig } from '../../../context/WorkflowConfigContext';
import WorkflowApprovalFooter from '../../workflow/components/WorkflowApprovalFooter';

function StepIcon({ step }) {
  if (step.state === 'completed') {
    return <i className="ti ti-check" aria-hidden="true" />;
  }
  if (step.state === 'skipped') {
    return <i className="ti ti-x" aria-hidden="true" />;
  }
  return <i className={'ti ' + step.icon} aria-hidden="true" />;
}

export default function WorkflowProgressModal({
  open,
  ticket,
  onClose,
  onCancelWorkflow,
  onAdvanceWorkflow,
  canceling = false,
  advancing = false,
  canAdvance = false,
  canCancel = true,
  canDecide = false,
  deciding = false,
  onApproveWorkflow,
  onRejectWorkflow,
  onWorkflowRequestInfo,
}) {
  const { workflows } = useWorkflowConfig();
  const progress = useMemo(
    () => (ticket && isTicketInWorkflow(ticket) ? getWorkflowProgress(ticket) : null),
    [ticket, workflows],
  );

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open || !progress) return null;

  const { template, stepsWithState } = progress;
  const workflowFinished = isTicketWorkflowFinished(ticket);
  const workflowCancelled = isTicketWorkflowCancelled(ticket);

  return (
    <div
      className="desk-workflow-modal-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="desk-workflow-modal"
        role="dialog"
        aria-labelledby="deskWorkflowModalTitle"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="desk-workflow-modal__head">
          <h2 id="deskWorkflowModalTitle">{template.title}</h2>
          <button
            type="button"
            className="desk-workflow-modal__close"
            onClick={onClose}
            aria-label="Fechar"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <ol className="desk-workflow-modal__timeline">
          {stepsWithState.map((step, index) => {
            const subtitle = getWorkflowStepSubtitle(step, progress);
            const prevCompleted = stepsWithState[index - 1]?.state === 'completed';
            return (
              <React.Fragment key={step.id}>
                {index > 0 ? (
                  <li
                    className={'desk-workflow-modal__connector' + (prevCompleted ? ' is-completed' : '')}
                    aria-hidden="true"
                  />
                ) : null}
                <li className={'desk-workflow-modal__step desk-workflow-modal__step--' + step.state}>
                  <span className="desk-workflow-modal__circle">
                    <StepIcon step={step} />
                  </span>
                  <div className="desk-workflow-modal__text">
                    <span className="desk-workflow-modal__label">{step.label}</span>
                    {subtitle ? (
                      <span className="desk-workflow-modal__subtitle">{subtitle}</span>
                    ) : null}
                  </div>
                </li>
              </React.Fragment>
            );
          })}
        </ol>

        <footer className="desk-workflow-modal__footer">
          {workflowCancelled ? (
            <span className="desk-workflow-modal__finished desk-workflow-modal__finished--cancelled">
              <i className="ti ti-x" aria-hidden="true" />
              Workflow interrompido
            </span>
          ) : workflowFinished ? (
            <span className="desk-workflow-modal__finished">
              <i className="ti ti-check" aria-hidden="true" />
              Workflow concluído
            </span>
          ) : null}
          {canCancel && !workflowCancelled && !workflowFinished ? (
            <button
              type="button"
              className="btn-danger desk-workflow-modal__btn-cancel"
              onClick={onCancelWorkflow}
              disabled={canceling || advancing}
            >
              {canceling ? 'Interrompendo…' : 'Interromper workflow'}
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
          {canDecide && !workflowCancelled && !workflowFinished ? (
            <div className="desk-workflow-modal__decision">
              <WorkflowApprovalFooter
                awaitingDecision
                actions={['approve', 'reject']}
                busy={deciding}
                onApprove={onApproveWorkflow}
                onReject={onRejectWorkflow}
                onMarkPending={onWorkflowRequestInfo}
              />
            </div>
          ) : canAdvance && !workflowCancelled && !workflowFinished ? (
            <button
              type="button"
              className="btn-primary desk-workflow-modal__btn-advance"
              onClick={onAdvanceWorkflow}
              disabled={canceling || advancing}
            >
              {advancing ? 'Avançando…' : 'Avançar etapa'}
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
