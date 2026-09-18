/**
 * BcTicketMain — coluna central do ticket Bacen (layout desk agente)
 */
import React, { useCallback, useMemo, useState } from 'react';
import EspeciaisDeskTicketView from '../shared/EspeciaisDeskTicketView';
import { mapChannelStatusToBadgeClass } from '../shared/especiaisStatusBadge';
import { useNotifications } from '../../../context/NotificationContext';
import { lookupClient } from '../../../services/clientDb';
import { fundirTickets } from '../../../services/desk/ticketFusaoService';
import { getStatusLabel } from '../../../services/especiais/bacenData';
import {
  formatBcDeadlineLabel,
  publishBcPublicResponse,
  saveBcInternalNote,
  sendBcWaMessage,
} from '../../../services/especiais/bacenTicketService';

export default function BcTicketMain({
  bcItem,
  ticket,
  loading,
  waChatOpen = false,
  waComposeText = '',
  onWaComposeTextChange,
  onTicketUpdated,
  composeMode,
  onComposeModeChange,
  composeText,
  onComposeTextChange,
  internalText,
  onInternalTextChange,
  composeAttachments,
  onComposeAttachmentsChange,
}) {
  const { showNotification } = useNotifications();
  const [mergeInProgress, setMergeInProgress] = useState(false);

  const client = useMemo(() => {
    if (!ticket) return null;
    const cpf = ticket.lateralForm?.cpf || ticket.lateralForm?.clienteCpf || ticket.clientCPF;
    return lookupClient(cpf);
  }, [ticket]);

  const channelConfig = useMemo(() => ({
    statusLabel: bcItem ? getStatusLabel(bcItem.statusBc) : '—',
    statusClass: mapChannelStatusToBadgeClass(bcItem?.statusBc),
    deadlineLabel: bcItem ? formatBcDeadlineLabel(bcItem.prazoLegal) : '',
    deadlinePrefix: 'Prazo de resposta no Bacen',
    onPublishPublic: publishBcPublicResponse,
    onSaveInternal: saveBcInternalNote,
  }), [bcItem]);

  const handleWaSend = useCallback(async () => {
    const text = waComposeText.trim();
    if (!text || !bcItem?.ticketId) {
      showNotification('Escreva uma mensagem antes de enviar.', 'warning');
      return;
    }
    try {
      const updated = await sendBcWaMessage(bcItem.ticketId, text, ticket);
      onWaComposeTextChange?.('');
      onTicketUpdated?.(updated);
      showNotification('Mensagem enviada.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    }
  }, [waComposeText, bcItem?.ticketId, ticket, onWaComposeTextChange, onTicketUpdated, showNotification]);

  const handleSelectHistoryTicket = useCallback((ticketId) => {
    if (typeof window.openTicket === 'function') {
      window.openTicket(ticketId);
      return;
    }
    showNotification('Abra o Desk para visualizar o ticket selecionado.', 'info');
  }, [showNotification]);

  const handleFundirTickets = useCallback(async ({ activeId, inactiveIds, cpf }) => {
    if (!activeId || mergeInProgress) return;
    setMergeInProgress(true);
    try {
      const result = await fundirTickets({ activeId, inactiveIds, cpf });
      onTicketUpdated?.(result.active);
      if (typeof window.openTicket === 'function') {
        window.openTicket(activeId);
      }
      showNotification('Mesclagem registrada com sucesso.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível mesclar os tickets.';
      showNotification(msg, 'error');
      throw err;
    } finally {
      setMergeInProgress(false);
    }
  }, [mergeInProgress, onTicketUpdated, showNotification]);

  if (loading) {
    return (
      <div className="ra-crm-main ra-crm-main--loading">
        <p>Carregando ticket...</p>
      </div>
    );
  }

  return (
    <EspeciaisDeskTicketView
      ticket={ticket}
      client={client}
      ticketId={bcItem?.ticketId}
      channelConfig={channelConfig}
      emptyMessage="Selecione uma demanda na lista ao lado"
      waChatOpen={waChatOpen}
      waComposeText={waComposeText}
      onWaComposeTextChange={onWaComposeTextChange}
      onWaSend={handleWaSend}
      onTicketUpdated={onTicketUpdated}
      onSelectHistoryTicket={handleSelectHistoryTicket}
      onFundirTickets={handleFundirTickets}
      merging={mergeInProgress}
      composeMode={composeMode}
      onComposeModeChange={onComposeModeChange}
      composeText={composeText}
      onComposeTextChange={onComposeTextChange}
      internalText={internalText}
      onInternalTextChange={onInternalTextChange}
      composeAttachments={composeAttachments}
      onComposeAttachmentsChange={onComposeAttachmentsChange}
    />
  );
}
