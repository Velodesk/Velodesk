/**
 * WorkflowFinalizadosPage — solicitações de workflow concluídas
 */
import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useTickets } from '../../context/TicketsContext';
import { hasWorkflowPortalAccess } from '../../services/permissions/permissionService';
import WorkflowFinalizadosShell from './components/WorkflowFinalizadosShell';

export default function WorkflowFinalizadosPage() {
  const { refreshTickets } = useTickets();

  useEffect(() => {
    const mainContent = document.querySelector('.main-content');
    if (!mainContent) return undefined;

    mainContent.classList.remove('tickets-active');
    mainContent.style.background = 'transparent';
    mainContent.style.display = 'flex';
    mainContent.style.flexDirection = 'column';
    mainContent.style.minHeight = '0';
    mainContent.style.overflow = 'hidden';
    mainContent.style.padding = '0';
    window.syncMainSidebarNav?.('workflow-finalizados');

    void refreshTickets();

    return () => {
      mainContent.style.display = '';
      mainContent.style.flexDirection = '';
      mainContent.style.minHeight = '';
      mainContent.style.overflow = '';
      mainContent.style.padding = '';
    };
  }, [refreshTickets]);

  if (!hasWorkflowPortalAccess()) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <div id="workflow-finalizados" className="page workflow-page eco-page active">
      <div className="eco-page-inner eco-page-inner--workflow">
        <WorkflowFinalizadosShell />
      </div>
    </div>
  );
}
