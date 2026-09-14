/**
 * WorkflowApprovalDetail v1.8.0 — remove stepper do topo do console de aprovações
 * VERSION: v1.8.0 | DATE: 2026-08-21
 */
import React from 'react';
import WorkflowApprovalEssentials from './WorkflowApprovalEssentials';
import WorkflowComunicacaoPanel from './WorkflowComunicacaoPanel';
import WorkflowApprovalFooter from './WorkflowApprovalFooter';

export default function WorkflowApprovalDetail({
  detail,
  teamId,
  busy,
  onApprove,
  onFeito,
  onReject,
  onRequestInfoSubmit,
}) {
  if (!detail) {
    return (
      <section className="wf-approval-detail wf-approval-detail--empty">
        <div className="wf-approval-detail__empty">
          <p>Selecione um ticket da fila ou aguarde novos encaminhamentos.</p>
        </div>
      </section>
    );
  }

  const badgeClass = detail.awaitingDecision
    ? 'wf-approval-badge--pending'
    : detail.teamStepActive
      ? 'wf-approval-badge--active'
      : 'wf-approval-badge--muted';

  const handleFeito = () => (onFeito || onApprove)?.();

  return (
    <section className="wf-approval-detail wf-approval-detail--clean" aria-label={detail.title}>
      <header className="wf-approval-detail__head wf-approval-detail__head--compact">
        <div className="wf-approval-detail__title-row">
          <div>
            <h1>{detail.essentials?.clientName || detail.title}</h1>
            <p className="wf-approval-detail__meta wf-approval-detail__meta--compact">
              {detail.metaLine || (detail.essentials?.protocol ? `Ticket #${detail.essentials.protocol}` : null)}
            </p>
          </div>
          <span className={`wf-approval-badge ${badgeClass}`}>{detail.statusBadge}</span>
        </div>
        {detail.statusMessage ? (
          <p className="wf-approval-detail__status-msg">{detail.statusMessage}</p>
        ) : null}
      </header>

      <div className="wf-approval-detail__body">
        <WorkflowApprovalEssentials
          essentials={detail.essentials}
          slaLabel={detail.slaLabel}
        />
        <div className="wf-approval-detail__side">
          <WorkflowComunicacaoPanel
            ticket={detail.ticket}
            responsibleAgent={detail.responsibleAgent}
            busy={busy}
            onSubmit={onRequestInfoSubmit}
          />
          <WorkflowApprovalFooter
            teamId={teamId}
            awaitingDecision={detail.awaitingDecision}
            actions={detail.actions}
            actionLabels={detail.actionLabels}
            busy={busy}
            onFeito={handleFeito}
            onApprove={onApprove}
            onReject={onReject}
            onMarkPending={onRequestInfoSubmit}
          />
        </div>
      </div>
    </section>
  );
}
