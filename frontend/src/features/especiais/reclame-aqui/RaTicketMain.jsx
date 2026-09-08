/**
 * RaTicketMain — coluna central do ticket RA (layout desk agente)
 */
import React, { useCallback, useMemo, useState } from 'react';
import EspeciaisDeskTicketView from '../shared/EspeciaisDeskTicketView';
import RaModeracaoPanel from './RaModeracaoPanel';
import { mapChannelStatusToBadgeClass } from '../shared/especiaisStatusBadge';
import { useNotifications } from '../../../context/NotificationContext';
import { lookupClient } from '../../../services/clientDb';
import { fundirTickets } from '../../../services/desk/ticketFusaoService';
import { getStatusLabel } from '../../../services/especiais/reclameAquiData';
import {
  formatRaDeadlineLabel,
  publishRaPublicResponse,
  saveRaInternalNote,
  sendRaWaMessage,
} from '../../../services/especiais/reclameAquiTicketService';

export default function RaTicketMain({
  raItem,
  ticket,
  loading,
  waChatOpen = false,
  waComposeText = '',
  onWaComposeTextChange,
  onTicketUpdated,
  onModeracaoSaved,
  composeMode,
  onComposeModeChange,
  composeText,
  onComposeTextChange,
  internalText,
  onInternalTextChange,
  composeAttachments,
  onComposeAttachmentsChange,
  clienteText,
  onClienteTextChange,
}) {
  const { showNotification } = useNotifications();
  const [mergeInProgress, setMergeInProgress] = useState(false);

  const client = useMemo(() => {
    if (!ticket) return null;
    const cpf = ticket.lateralForm?.cpf || ticket.lateralForm?.clienteCpf || ticket.clientCPF;
    return lookupClient(cpf);
  }, [ticket]);

  const channelConfig = useMemo(() => ({
    statusLabel: raItem ? getStatusLabel(raItem.statusRa) : '—',
    statusClass: mapChannelStatusToBadgeClass(raItem?.statusRa),
    deadlineLabel: raItem ? formatRaDeadlineLabel(raItem.prazoRa) : '',
    deadlinePrefix: 'Prazo de resposta no Reclame Aqui',
    onPublishPublic: publishRaPublicResponse,
    onSaveInternal: saveRaInternalNote,
  }), [raItem]);

  const handleWaSend = useCallback(async () => {
    const text = waComposeText.trim();
    if (!text || !raItem?.ticketId) {
      showNotification('Escreva uma mensagem antes de enviar.', 'warning');
      return;
    }
    try {
      const updated = await sendRaWaMessage(raItem.ticketId, text);
      onWaComposeTextChange?.('');
      onTicketUpdated?.(updated);
      showNotification('Mensagem enviada.', 'success');
    } catch {
      showNotification('Não foi possível enviar a mensagem.', 'error');
    }
  }, [waComposeText, raItem?.ticketId, onWaComposeTextChange, onTicketUpdated, showNotification]);

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

  const moderacaoTab = {
    id: 'moderacao',
    label: 'Moderação',
    icon: 'ti ti-shield-check',
    content: <RaModeracaoPanel raItem={raItem} onSaved={onModeracaoSaved} />,
  };

  return (
    <EspeciaisDeskTicketView
      ticket={ticket}
      client={client}
      ticketId={raItem?.ticketId}
      channelConfig={channelConfig}
      extraTab={moderacaoTab}
      emptyMessage="Selecione uma reclamação na lista ao lado"
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
      publicTabLabel="Mensagem Agente"
      internalTabLabel="Notas internas"
      showClienteTab
      clienteTabLabel="Mensagem Cliente"
      clienteText={clienteText}
      onClienteTextChange={onClienteTextChange}
    />
  );
}
