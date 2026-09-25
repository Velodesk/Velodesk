/**
 * useEspeciaisTicketCommit — handlers Salvar / Enviar como (status) / Finalizar compartilhados
 * nos CrmRoots
 */
import { useCallback, useState } from 'react';
import { isEspeciaisItemFinalizada } from '../../../services/especiais/especiaisGroupKey';
import { isTicketReadOnly } from '../../../services/desk/utils';
import { commitEspeciaisTicket } from './especiaisTicketCommitService';

export function useEspeciaisTicketCommit({
  channelId,
  channelItem,
  ticket,
  composeSession,
  onTicketSaved,
  onFinalized,
  showNotification,
}) {
  const [committing, setCommitting] = useState(false);

  const clearComposeIfNeeded = useCallback((result, clearCompose) => {
    if (!clearCompose) return;
    if (result.hadPublicPayload) {
      clearCompose({ composeText: true, composeAttachments: true });
    }
    if (result.hadInternalPayload) {
      clearCompose({ internalText: true });
    }
    if (result.hadClientePayload) {
      clearCompose({ clienteText: true });
    }
  }, []);

  const handleSaveTicket = useCallback(async () => {
    if (!ticket || committing) return;
    if (isTicketReadOnly(ticket) || isEspeciaisItemFinalizada(channelItem)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }

    setCommitting(true);
    try {
      const result = await commitEspeciaisTicket({
        channelId,
        ticket,
        channelItem,
        session: composeSession,
        finalize: false,
      });
      onTicketSaved?.(result);
      clearComposeIfNeeded(result, composeSession?.clearCompose);
      showNotification(
        result.hadPublicPayload || result.hadInternalPayload
          ? 'Ticket enviado e salvo.'
          : 'Ticket salvo.',
        'success',
      );
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao salvar ticket.';
      showNotification(msg, 'error');
    } finally {
      setCommitting(false);
    }
  }, [
    channelId,
    channelItem,
    ticket,
    composeSession,
    committing,
    onTicketSaved,
    clearComposeIfNeeded,
    showNotification,
  ]);

  const handleCommitStatus = useCallback(async (statusId) => {
    if (!ticket || committing) return;
    if (isTicketReadOnly(ticket) || isEspeciaisItemFinalizada(channelItem)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }

    setCommitting(true);
    try {
      const result = await commitEspeciaisTicket({
        channelId,
        ticket,
        channelItem,
        session: composeSession,
        status: statusId,
      });
      if (result.isFinalizing) {
        onFinalized?.(result);
      } else {
        onTicketSaved?.(result);
      }
      clearComposeIfNeeded(result, composeSession?.clearCompose);
      showNotification('Ticket enviado.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao enviar ticket.';
      showNotification(msg, 'error');
    } finally {
      setCommitting(false);
    }
  }, [
    channelId,
    channelItem,
    ticket,
    composeSession,
    committing,
    onTicketSaved,
    onFinalized,
    clearComposeIfNeeded,
    showNotification,
  ]);

  const handleFinalizeTicket = useCallback(async () => {
    if (!ticket || committing) return;
    if (isTicketReadOnly(ticket) || isEspeciaisItemFinalizada(channelItem)) {
      showNotification('Este ticket já está finalizado.', 'info');
      return;
    }

    setCommitting(true);
    try {
      const result = await commitEspeciaisTicket({
        channelId,
        ticket,
        channelItem,
        session: composeSession,
        finalize: true,
      });
      onFinalized?.(result);
      clearComposeIfNeeded(result, composeSession?.clearCompose);
      showNotification('Ticket finalizado.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao finalizar ticket.';
      showNotification(msg, 'error');
    } finally {
      setCommitting(false);
    }
  }, [
    channelId,
    channelItem,
    ticket,
    composeSession,
    committing,
    onFinalized,
    clearComposeIfNeeded,
    showNotification,
  ]);

  return {
    committing,
    handleSaveTicket,
    handleCommitStatus,
    handleFinalizeTicket,
    finalized: isEspeciaisItemFinalizada(channelItem),
    readOnly: isTicketReadOnly(ticket),
  };
}
