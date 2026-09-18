/**
 * CgTicketMain — coluna central do ticket Consumidor Gov (layout desk agente)
 */
import React, { useCallback, useMemo, useState } from 'react';
import EspeciaisDeskTicketView from '../shared/EspeciaisDeskTicketView';
import { mapChannelStatusToBadgeClass } from '../shared/especiaisStatusBadge';
import { useNotifications } from '../../../context/NotificationContext';
import { lookupClient } from '../../../services/clientDb';
import { mergeTicketInto } from '../../../services/desk/ticketMergeService';
import { isDraftTicket } from '../../../services/ticketsCache';
import { getStatusLabel } from '../../../services/especiais/consumidorGovData';
import {
  formatCgDeadlineLabel,
  publishCgPublicResponse,
  saveCgInternalNote,
  sendCgWaMessage,
} from '../../../services/especiais/consumidorGovTicketService';

export default function CgTicketMain({
  cgItem,
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
    statusLabel: cgItem ? getStatusLabel(cgItem.statusGov) : '—',
    statusClass: mapChannelStatusToBadgeClass(cgItem?.statusGov),
    deadlineLabel: cgItem ? formatCgDeadlineLabel(cgItem.prazoLegal) : '',
    deadlinePrefix: 'Prazo de resposta no Consumidor.gov',
    onPublishPublic: publishCgPublicResponse,
    onSaveInternal: saveCgInternalNote,
  }), [cgItem]);

  const handleWaSend = useCallback(async () => {
    const text = waComposeText.trim();
    if (!text || !cgItem?.ticketId) {
      showNotification('Escreva uma mensagem antes de enviar.', 'warning');
      return;
    }
    try {
      const updated = await sendCgWaMessage(cgItem.ticketId, text, ticket);
      onWaComposeTextChange?.('');
      onTicketUpdated?.(updated);
      showNotification('Mensagem enviada.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    }
  }, [waComposeText, cgItem?.ticketId, ticket, onWaComposeTextChange, onTicketUpdated, showNotification]);

  const handleSelectHistoryTicket = useCallback((ticketId) => {
    if (typeof window.openTicket === 'function') {
      window.openTicket(ticketId);
      return;
    }
    showNotification('Abra o Desk para visualizar o ticket selecionado.', 'info');
  }, [showNotification]);

  const handleFundirTickets = useCallback(async ({ activeId, inactiveIds }) => {
    if (!activeId || mergeInProgress || !ticket?.id) return;
    if (isDraftTicket(ticket)) {
      showNotification('Salve o ticket antes de mesclar.', 'warning');
      return;
    }
    const targetId = inactiveIds?.[0] || activeId;
    setMergeInProgress(true);
    try {
      const result = await mergeTicketInto(ticket.id, targetId);
      onTicketUpdated?.(result.target);
      if (typeof window.openTicket === 'function') {
        window.openTicket(targetId);
      }
      showNotification('Tickets mesclados com sucesso.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível mesclar os tickets.';
      showNotification(msg, 'error');
      throw err;
    } finally {
      setMergeInProgress(false);
    }
  }, [ticket, mergeInProgress, onTicketUpdated, showNotification]);

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
      ticketId={cgItem?.ticketId}
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
