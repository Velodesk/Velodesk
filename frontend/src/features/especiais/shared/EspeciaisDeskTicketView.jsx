/**
 * EspeciaisDeskTicketView — coluna central alinhada ao layout agente desk.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DeskClientProfileBar from '../../desk/components/DeskClientProfileBar';
import DeskConversation from '../../desk/components/DeskConversation';
import DeskComposePanel from '../../desk/components/DeskComposePanel';
import DeskConsultasPanel from '../../desk/components/DeskConsultasPanel';
import DeskEventsPanel from '../../desk/components/DeskEventsPanel';
import DeskInternalNotesPanel from '../../desk/components/DeskInternalNotesPanel';
import DeskWhatsAppChat from '../../desk/components/DeskWhatsAppChat';
import ClientTicketHistoryModal from '../../desk/components/ClientTicketHistoryModal';
import TicketFusaoStatusControls from '../../desk/components/TicketFusaoStatusControls';
import { useNotifications } from '../../../context/NotificationContext';
import { buildRegistroThread, isTicketReadOnly } from '../../../services/desk/utils';
import { saveEspeciaisTicketContact } from './especiaisSaveContact';

export default function EspeciaisDeskTicketView({
  ticket,
  client,
  ticketId,
  channelConfig,
  emptyMessage = 'Selecione um ticket na lista ao lado',
  waChatOpen = false,
  waComposeText = '',
  onWaComposeTextChange,
  onWaSend,
  onTicketUpdated,
  onSelectHistoryTicket,
  onFundirTickets,
  merging = false,
  composeMode = 'public',
  onComposeModeChange,
  composeText = '',
  onComposeTextChange,
  internalText = '',
  onInternalTextChange,
  composeAttachments = [],
  onComposeAttachmentsChange,
  extraTab,
  publicTabLabel,
  internalTabLabel,
  showClienteTab = false,
  clienteTabLabel,
  clienteText = '',
  onClienteTextChange,
}) {
  const { showNotification } = useNotifications();
  const [mainTab, setMainTab] = useState('conversa');
  const [historyOpen, setHistoryOpen] = useState(false);

  const convMsgs = useMemo(
    () => (ticket ? buildRegistroThread(ticket) : []),
    [ticket],
  );

  const ticketReadOnly = isTicketReadOnly(ticket);
  const statusClass = channelConfig?.statusClass || 'novo';
  const statusLabel = channelConfig?.statusLabel || '—';

  useEffect(() => {
    setMainTab('conversa');
  }, [ticketId]);

  const handleSaveContact = useCallback(async (draft) => {
    if (!ticket) return;
    try {
      const updated = await saveEspeciaisTicketContact(ticket, draft);
      onTicketUpdated?.(updated);
      showNotification('Contato atualizado.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao salvar contato.';
      showNotification(msg, 'error');
      throw err;
    }
  }, [ticket, onTicketUpdated, showNotification]);

  if (!ticketId) {
    return (
      <div className="ra-crm-main">
        <div className="ra-crm-empty-state ra-crm-empty-state--main">{emptyMessage}</div>
      </div>
    );
  }

  return (
    <div className="ra-crm-main">
      <div className="crm-ticket-view desk-crm-ticket-scope">
        <DeskClientProfileBar
          ticket={ticket}
          client={client}
          onSaveContact={handleSaveContact}
          onOpenHistory={() => setHistoryOpen(true)}
        />

        <nav className="tabs-top" aria-label="Navegação do ticket">
          <div className="tabs-top__tabs">
            <button
              type="button"
              className={'tab-btn' + (mainTab === 'conversa' ? ' is-active' : '')}
              onClick={() => setMainTab('conversa')}
            >
              <i className="ti ti-message-2" /> Conversa
            </button>
            <button
              type="button"
              className={'tab-btn' + (mainTab === 'notas' ? ' is-active' : '')}
              onClick={() => setMainTab('notas')}
            >
              <i className="ti ti-file-text" /> Notas
            </button>
            <button
              type="button"
              className={'tab-btn' + (mainTab === 'eventos' ? ' is-active' : '')}
              onClick={() => setMainTab('eventos')}
            >
              <i className="ti ti-timeline" /> Eventos
            </button>
            <button
              type="button"
              className={'tab-btn' + (mainTab === 'consultas' ? ' is-active' : '')}
              onClick={() => setMainTab('consultas')}
            >
              <i className="ti ti-search" /> Consultas
            </button>
            {extraTab ? (
              <button
                type="button"
                className={'tab-btn' + (mainTab === extraTab.id ? ' is-active' : '')}
                onClick={() => setMainTab(extraTab.id)}
              >
                <i className={extraTab.icon || 'ti ti-shield-check'} /> {extraTab.label}
              </button>
            ) : null}
          </div>
          <div className="tabs-top__status-group">
            <TicketFusaoStatusControls ticket={ticket} />
            <span className={'status-badge tabs-top__status status-badge--' + statusClass}>
              {statusLabel}
            </span>
          </div>
        </nav>

        <ClientTicketHistoryModal
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          ticket={ticket}
          client={client}
          onSelectTicket={onSelectHistoryTicket}
          sourceTicketId={ticket?.id || ticket?._id}
          onFundirTickets={onFundirTickets}
          merging={merging}
          enableSimilarSubject
        />

        <div className={'crm-conversation-wrap' + (waChatOpen ? ' crm-conversation-wrap--wa' : '')}>
          {mainTab === 'conversa' && waChatOpen ? (
            <div className="tab-panel is-active" data-panel="conversa">
              <DeskWhatsAppChat
                key={ticket?.id || ticketId}
                ticket={ticket}
                client={client}
                messages={convMsgs}
                composeText={waComposeText}
                onComposeTextChange={onWaComposeTextChange}
                onUseIaReply={onWaComposeTextChange}
                onSend={onWaSend}
                iaShowBar={false}
              />
            </div>
          ) : (
            <div
              className={
                'tab-panel is-active'
                + (mainTab === 'notas' ? ' tab-panel--notes' : '')
                + (mainTab === 'eventos' ? ' tab-panel--eventos' : '')
                + (mainTab === 'consultas' ? ' tab-panel--consultas' : '')
                + (extraTab && mainTab === extraTab.id ? ' tab-panel--extra' : '')
              }
              data-panel={mainTab}
            >
              {extraTab && mainTab === extraTab.id ? extraTab.content : mainTab === 'conversa' ? (
                <>
                  {channelConfig?.deadlineLabel ? (
                    <div className="especiais-deadline-callout" role="status">
                      <i className="ti ti-clock" aria-hidden="true" />
                      {channelConfig.deadlinePrefix}
                      {': '}
                      <strong>{channelConfig.deadlineLabel}</strong>
                    </div>
                  ) : null}
                  <DeskConversation
                    ticket={ticket}
                    messages={convMsgs}
                    iaShowBar={false}
                  />
                  <DeskComposePanel
                    ticketId={ticket?.id || ticketId}
                    ticket={ticket}
                    variant="full"
                    composeMode={composeMode}
                    composeText={composeText}
                    internalText={internalText}
                    composeAttachments={composeAttachments}
                    onComposeAttachmentsChange={onComposeAttachmentsChange}
                    onComposeModeChange={onComposeModeChange}
                    onComposeTextChange={onComposeTextChange}
                    onInternalTextChange={onInternalTextChange}
                    ticketReadOnly={ticketReadOnly}
                    {...(publicTabLabel ? { publicTabLabel } : {})}
                    {...(internalTabLabel ? { internalTabLabel } : {})}
                    showClienteTab={showClienteTab}
                    {...(clienteTabLabel ? { clienteTabLabel } : {})}
                    clienteText={clienteText}
                    onClienteTextChange={onClienteTextChange}
                  />
                </>
              ) : mainTab === 'notas' ? (
                <DeskInternalNotesPanel ticket={ticket} client={client} />
              ) : mainTab === 'eventos' ? (
                <DeskEventsPanel ticket={ticket} client={client} />
              ) : (
                <DeskConsultasPanel
                  ticket={ticket}
                  client={client}
                  active={mainTab === 'consultas'}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
