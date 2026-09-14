/**
 * WorkflowFinalizadosShell — fila read-only de solicitações concluídas
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTickets } from '../../../context/TicketsContext';
import { usePermissionsOptional } from '../../../context/PermissionContext';
import { findTicketEntry, loadTicketDetailFromApi } from '../../../services/ticketsStorage';
import { hasWorkflowPortalAccess, resolveWorkflowTeamQueueForUser } from '../../../services/permissions/permissionService';
import {
  computeWorkflowFinalizadosQueue,
  getWorkflowFinalizadoDetail,
} from '../../../services/workflow/workflowApprovalData';
import { ticketBelongsToWorkflowTeam } from '../../../services/workflow/workflowTeamQueues';
import WorkflowApprovalQueue from './WorkflowApprovalQueue';
import WorkflowApprovalDetail from './WorkflowApprovalDetail';

export default function WorkflowFinalizadosShell() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { refreshKey } = useTickets();
  const permsCtx = usePermissionsOptional();
  const [selectedId, setSelectedId] = useState(null);
  const [detailRevision, setDetailRevision] = useState(0);

  const hasWorkflowAccess = useMemo(
    () => hasWorkflowPortalAccess(permsCtx?.permissions),
    [permsCtx?.permissions, refreshKey],
  );

  const teamQueueId = useMemo(
    () => (hasWorkflowAccess ? resolveWorkflowTeamQueueForUser(permsCtx?.permissions) : null),
    [hasWorkflowAccess, permsCtx?.permissions, refreshKey],
  );

  const queueData = useMemo(() => {
    if (!hasWorkflowAccess) {
      return { queueLabel: 'Finalizados', queue: [], summary: { totalCount: 0 }, teamId: null };
    }
    return computeWorkflowFinalizadosQueue(teamQueueId);
  }, [hasWorkflowAccess, teamQueueId, refreshKey]);

  const detail = useMemo(
    () => (selectedId && hasWorkflowAccess ? getWorkflowFinalizadoDetail(selectedId, teamQueueId) : null),
    [selectedId, teamQueueId, hasWorkflowAccess, refreshKey, detailRevision],
  );

  useEffect(() => {
    if (!selectedId || !hasWorkflowAccess) return undefined;

    const entry = findTicketEntry(selectedId);
    const ticket = entry?.ticket;
    const needsDetail = !ticket || ticket.listOnly === true || !ticket._detailLoaded;

    if (!needsDetail) return undefined;

    let cancelled = false;
    void loadTicketDetailFromApi(selectedId)
      .then(() => {
        if (!cancelled) setDetailRevision((v) => v + 1);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [selectedId, hasWorkflowAccess, refreshKey]);

  useEffect(() => {
    const fromUrl = searchParams.get('ticket');
    const urlId = fromUrl ? String(fromUrl) : null;

    if (!queueData.queue.length) {
      if (urlId && teamQueueId) {
        const entry = findTicketEntry(urlId);
        if (entry?.ticket && ticketBelongsToWorkflowTeam(entry.ticket, teamQueueId)) {
          setSelectedId(urlId);
          return;
        }
      }
      setSelectedId(null);
      return;
    }

    if (urlId && queueData.queue.some((q) => q.id === urlId)) {
      setSelectedId(urlId);
      return;
    }

    const fallbackId = queueData.queue[0].id;
    setSelectedId(fallbackId);
    if (urlId !== fallbackId) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('ticket', fallbackId);
        return next;
      }, { replace: true });
    }
  }, [queueData.queue, searchParams, setSearchParams, teamQueueId]);

  const handleSelectTicket = useCallback((ticketId) => {
    const id = String(ticketId);
    setSelectedId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('ticket', id);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  if (!hasWorkflowAccess) {
    return (
      <div className="wf-approval-shell wf-approval-shell--empty">
        <section className="wf-approval-detail wf-approval-detail--empty wf-approval-detail--full">
          <div className="wf-approval-detail__empty">
            <h2>Visão Workflow indisponível</h2>
            <p>
              Esta visão exige a permissão <strong>Visão Workflow</strong> nos overrides da função do agente.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="wf-approval-shell">
      <WorkflowApprovalQueue
        queueLabel={queueData.queueLabel}
        items={queueData.queue}
        selectedId={selectedId}
        onSelect={handleSelectTicket}
        emptyMessage="Nenhuma solicitação concluída no momento."
      />
      <WorkflowApprovalDetail
        detail={detail}
        teamId={teamQueueId}
        readOnly
        emptyMessage="Selecione uma solicitação concluída da lista."
      />
    </div>
  );
}
