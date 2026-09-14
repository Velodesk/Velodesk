/**
 * DeskClientProfileBar v1.16.0 — stepper abre o modal de progresso para o agente responsável
 * VERSION: v1.16.0 | DATE: 2026-08-20
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clientsApi } from '../../../api/client';
import { mapClienteDocToContact } from '../../../api/adapters/clienteAdapter';
import {
  isClientIdentifiedForHistory,
  clientHasOtherActiveTickets,
  getClientContactFields,
  getClientActiveProducts,
  getProductTagClass,
  getTicketProtocolLabel,
  isTicketInWorkflow,
  isTicketReadOnly,
  isValidCpfDigits,
  maskCpfInput,
  normalizeCpf,
} from '../../../services/desk/utils';
import { useNotifications } from '../../../context/NotificationContext';
import { useTickets } from '../../../context/TicketsContext';
import { useTicketPresence } from '../../../context/TicketPresenceContext';
import TicketWorkflowStepper from './TicketWorkflowStepper';
import WorkflowProgressModal from './WorkflowProgressModal';
import ClientContactFieldsEditor, {
  buildContactDraftFromFields,
  validateClientContactDraft,
} from './ClientContactFieldsEditor';
import TicketPresenceAvatars from '../../../components/TicketPresenceAvatars';

function resolveProtocolLabel(ticket) {
  const protocol = getTicketProtocolLabel(ticket);
  if (protocol) return protocol;
  if (ticket?.isDraft || String(ticket?.id || '').startsWith('draft-')) return 'Rascunho';
  return '—';
}

export default function DeskClientProfileBar({
  ticket,
  client,
  onSaveContact,
  onOpenHistory,
  onAdvanceWorkflow,
  onCancelWorkflow,
  advancingWorkflow = false,
  cancelingWorkflow = false,
  canAdvanceWorkflow = false,
  canManageWorkflow = false,
  canDecideWorkflow = false,
  decidingWorkflow = false,
  onApproveWorkflow,
  onRejectWorkflow,
  onWorkflowRequestInfo,
  hydratingContact = false,
}) {
  const { showNotification } = useNotifications();
  const { refreshKey } = useTickets();
  const [editOpen, setEditOpen] = useState(false);
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [cpfLookupLoading, setCpfLookupLoading] = useState(false);
  const lastLookupCpfRef = useRef('');
  const [draft, setDraft] = useState({
    cpf: '',
    name: '',
    emails: [''],
    phones: [''],
    replyEmail: '',
    whatsappPhone: '',
    clienteId: '',
  });
  const [emailErrors, setEmailErrors] = useState({});
  const contact = getClientContactFields(ticket, client);
  const cadastroNaoEncontrado = Boolean(contact.cpf) && (!contact.name || !contact.email);
  const presentAgents = useTicketPresence(ticket?.id || ticket?._id);
  const agentActiveTitle = presentAgents.length
    ? `${presentAgents.map((agent) => agent.name).join(', ')} ${presentAgents.length > 1 ? 'estão atuando' : 'está atuando'} neste ticket`
    : '';
  const activeProducts = getClientActiveProducts(ticket, client);
  const protocolLabel = resolveProtocolLabel(ticket);
  const inWorkflow = isTicketInWorkflow(ticket);
  const ticketReadOnly = isTicketReadOnly(ticket);
  const clientIdentified = isClientIdentifiedForHistory(contact.cpf);
  const historyWarnActive = useMemo(
    () => clientIdentified
      && clientHasOtherActiveTickets(
        contact.cpf,
        contact.name,
        ticket?.id || ticket?._id,
      ),
    [clientIdentified, contact.cpf, contact.name, ticket?.id, ticket?._id, refreshKey],
  );
  const historyTitle = !clientIdentified
    ? 'Informe o CPF do cliente para consultar o histórico'
    : historyWarnActive
      ? 'Cliente possui outro ticket em aberto, em andamento ou pendente'
      : 'Histórico de tickets do cliente (por CPF)';

  const openEdit = () => {
    if (ticketReadOnly) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }
    const nextDraft = buildContactDraftFromFields({
      ...contact,
      clienteId: ticket?.clienteId || ticket?.lateralForm?.clienteId || '',
    });
    lastLookupCpfRef.current = normalizeCpf(nextDraft.cpf);
    setDraft(nextDraft);
    setEmailErrors({});
    setEditOpen(true);
  };

  const lookupClienteByCpf = useCallback(async (digits) => {
    if (!isValidCpfDigits(digits) || lastLookupCpfRef.current === digits) return;
    lastLookupCpfRef.current = digits;
    setCpfLookupLoading(true);
    try {
      const cliente = await clientsApi.getByCpf(digits);
      const mapped = mapClienteDocToContact(cliente);
      if (!mapped) return;
      setDraft({
        cpf: maskCpfInput(digits),
        name: mapped.clientName,
        emails: mapped.emails.length ? mapped.emails : [''],
        phones: mapped.phones.length ? mapped.phones : [''],
        replyEmail: mapped.replyEmail || '',
        whatsappPhone: mapped.whatsappPhone,
        clienteId: mapped.clienteId || '',
      });
      showNotification('Dados preenchidos a partir do cadastro.', 'success');
    } catch (err) {
      if (err?.response?.status === 404) {
        setDraft((prev) => ({
          ...prev,
          cpf: maskCpfInput(digits),
          clienteId: '',
        }));
        return;
      }
      const msg = err?.response?.data?.message || 'Não foi possível consultar o CPF.';
      showNotification(msg, 'error');
    } finally {
      setCpfLookupLoading(false);
    }
  }, [showNotification]);

  const handleCpfChange = (value) => {
    const masked = maskCpfInput(value);
    const digits = normalizeCpf(masked);
    if (digits.length < 11) {
      lastLookupCpfRef.current = '';
    }
    setDraft((prev) => ({ ...prev, cpf: masked, clienteId: digits.length < 11 ? '' : prev.clienteId }));
    if (isValidCpfDigits(digits)) {
      void lookupClienteByCpf(digits);
    }
  };

  const saveEdit = async () => {
    if (!onSaveContact || savingContact) return;
    const validation = validateClientContactDraft(draft);
    if (!validation.ok) {
      if (validation.emailIndex != null) {
        setEmailErrors({ [validation.emailIndex]: true });
      }
      showNotification(validation.message, 'error');
      return;
    }
    setSavingContact(true);
    try {
      await onSaveContact({
        cpf: validation.cpf,
        name: validation.nome,
        emails: validation.emailList,
        phones: validation.phoneList,
        replyEmail: validation.replyEmail,
        whatsappPhone: validation.whatsappPhone,
        clienteId: draft.clienteId,
      });
      setEditOpen(false);
    } catch {
      // notificação tratada no DeskV2Root
    } finally {
      setSavingContact(false);
    }
  };

  useEffect(() => {
    if (!editOpen) return undefined;

    const handleKey = (e) => {
      if (e.key === 'Escape') setEditOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [editOpen]);

  const showInlineAdvance = canAdvanceWorkflow;
  const historyButton = (
    <button
      type="button"
      className={
        'btn-secondary btn-sm ticket-client-history-btn'
        + (historyWarnActive ? ' ticket-client-history-btn--active-client' : '')
      }
      id="btnClientHistory"
      onClick={onOpenHistory}
      disabled={!clientIdentified}
      title={historyTitle}
      aria-label={historyTitle}
      aria-disabled={!clientIdentified}
    >
      <i className="fas fa-history" /> Histórico
    </button>
  );

  return (
    <div className={'crm-client-profile-bar' + (inWorkflow ? ' crm-client-profile-bar--with-workflow' : '')}>
      <section
        className={
          'ticket-client-profile ticket-client-profile--compact ticket-client-profile--header-grid'
          + (inWorkflow ? ' ticket-client-profile--header-grid--with-workflow' : '')
        }
        id="ticketClientProfile"
        aria-label="Perfil do cliente"
      >
        <div className="ticket-client-profile__client-main ticket-client-profile__cell-client" id="headerInfo">
          {hydratingContact ? (
            <span className="ticket-client-profile__hydrating" aria-live="polite">
              <i className="ti ti-loader-2 ticket-client-profile__hydrating-spin" aria-hidden="true" />
              Consultando cadastro…
            </span>
          ) : null}
          <span className="ticket-client-profile__field ticket-client-profile__field--name" id="profileName">
            {contact.name || '—'}
          </span>
          <span className="ticket-client-profile__sep" aria-hidden="true">–</span>
          <span className="ticket-client-profile__field ticket-client-profile__field--cpf" id="profileCpf">
            {contact.cpf || '—'}
          </span>
          {cadastroNaoEncontrado ? (
            <span
              className="velo-product-tag velo-tag velo-tag--alert ticket-client-profile__badge-not-found"
              title="CPF sem cadastro encontrado no cadastro local nem na API Velotax"
            >
              CADASTRO NÃO ENCONTRADO
            </span>
          ) : null}
          <span className="ticket-client-profile__sep" aria-hidden="true">–</span>
          <span className="ticket-client-profile__field ticket-client-profile__field--phone" id="profilePhone">
            {contact.phone || '—'}
          </span>
          <span className="ticket-client-profile__sep" aria-hidden="true">–</span>
          <div className="ticket-client-profile__contact-stack">
            <span className="ticket-client-profile__field ticket-client-profile__field--email" id="profileEmail">
              {contact.email || '—'}
            </span>
          </div>
          <span className="ticket-client-profile__edit-wrap">
            <button
              type="button"
              className={'crm-edit-client-btn' + (editOpen ? ' is-active' : '')}
              id="btnEditClient"
              title={ticketReadOnly ? 'Ticket fechado — cadastro somente leitura' : 'Editar cadastro'}
              aria-label="Editar cadastro"
              aria-expanded={editOpen}
              aria-controls="clientEditPopover"
              disabled={ticketReadOnly}
              onClick={openEdit}
            >
              <i className="ti ti-pencil" aria-hidden="true" />
            </button>
            {editOpen && (
              <div className="crm-client-edit-popover crm-client-edit-popover--wide" id="clientEditPopover" role="dialog" aria-labelledby="clientEditPopoverTitle">
                <button type="button" className="crm-client-edit-popover__close" id="btnCloseClientEdit" title="Fechar" aria-label="Fechar" onClick={() => setEditOpen(false)}>
                  <i className="ti ti-x" />
                </button>
                <h3 className="crm-client-edit-popover__title" id="clientEditPopoverTitle">Editar contato</h3>
                <div className="crm-client-edit-popover__fields">
                  <ClientContactFieldsEditor
                    idPrefix="editClient"
                    showCpf
                    cpf={draft.cpf}
                    onCpfChange={handleCpfChange}
                    cpfLookupLoading={cpfLookupLoading}
                    name={draft.name}
                    onNameChange={(value) => setDraft((d) => ({ ...d, name: value }))}
                    emails={draft.emails}
                    onEmailsChange={(emails) => setDraft((d) => ({ ...d, emails }))}
                    replyEmail={draft.replyEmail}
                    onReplyEmailChange={(replyEmail) => setDraft((d) => ({ ...d, replyEmail }))}
                    phones={draft.phones}
                    onPhonesChange={(phones) => setDraft((d) => ({ ...d, phones }))}
                    whatsappPhone={draft.whatsappPhone}
                    onWhatsappPhoneChange={(whatsappPhone) => setDraft((d) => ({ ...d, whatsappPhone }))}
                    emailErrors={emailErrors}
                    onEmailBlur={(index, value) => {
                      const trimmed = String(value || '').trim();
                      setEmailErrors((prev) => {
                        const next = { ...prev };
                        if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) next[index] = true;
                        else delete next[index];
                        return next;
                      });
                    }}
                  />
                </div>
                <div className="crm-client-edit-popover__footer">
                  <button
                    type="button"
                    className="crm-client-edit-popover__save"
                    id="btnSaveClientEdit"
                    onClick={saveEdit}
                    disabled={savingContact}
                  >
                    {savingContact ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </div>
            )}
          </span>
          {agentActiveTitle ? (
            <span
              className="ticket-client-profile__agent-active-dot"
              title={agentActiveTitle}
              aria-label={agentActiveTitle}
            />
          ) : null}
        </div>

        <div className="ticket-client-profile__protocol-row ticket-client-profile__cell-protocol">
          <span className="ticket-client-profile__protocol" id="profileProtocol">
            {protocolLabel}
          </span>
          {activeProducts.length ? (
            <div
              className="ticket-client-profile__products ticket-client-profile__products--protocol"
              id="profileProducts"
              aria-label="Produtos ativos do cliente"
            >
              {activeProducts.map(({ name, contracted }) => (
                <span
                  key={name}
                  className={
                    'velo-product-tag velo-tag '
                    + (contracted ? 'velo-tag--contracted' : getProductTagClass(name))
                  }
                  title={contracted ? `Produto contratado: ${name}` : `Produto informado na tabulação: ${name}`}
                >
                  {name}
                </span>
              ))}
            </div>
          ) : null}
          <TicketPresenceAvatars ticketId={ticket?.id || ticket?._id} />
          {!inWorkflow ? (
            <div className="ticket-client-profile__protocol-actions">
              {historyButton}
            </div>
          ) : null}
        </div>

        {inWorkflow ? (
          <div className="ticket-client-profile__header-side ticket-client-profile__cell-side">
            <div className="ticket-client-profile__header-side-stack">
              <div className="ticket-client-profile__header-stepper">
                <TicketWorkflowStepper
                  ticket={ticket}
                  layout="headerStack"
                  clickable
                  onClick={() => setWorkflowModalOpen(true)}
                />
              </div>
              <div className="ticket-client-profile__header-side-actions">
                {canDecideWorkflow ? (
                  <button
                    type="button"
                    className="btn-primary btn-sm desk-workflow-advance-btn ticket-client-advance-btn"
                    onClick={() => setWorkflowModalOpen(true)}
                  >
                    Decidir
                  </button>
                ) : showInlineAdvance ? (
                  <button
                    type="button"
                    className="btn-primary btn-sm desk-workflow-advance-btn ticket-client-advance-btn"
                    onClick={onAdvanceWorkflow}
                    disabled={advancingWorkflow}
                  >
                    {advancingWorkflow ? 'Avançando…' : 'Avançar'}
                  </button>
                ) : null}
                {historyButton}
              </div>
            </div>
            <WorkflowProgressModal
              open={workflowModalOpen}
              ticket={ticket}
              onClose={() => setWorkflowModalOpen(false)}
              onCancelWorkflow={async () => {
                await onCancelWorkflow?.();
                setWorkflowModalOpen(false);
              }}
              onAdvanceWorkflow={onAdvanceWorkflow}
              canceling={cancelingWorkflow}
              advancing={advancingWorkflow}
              canAdvance={canAdvanceWorkflow}
              canCancel={canManageWorkflow}
              canDecide={canDecideWorkflow}
              deciding={decidingWorkflow}
              onApproveWorkflow={onApproveWorkflow}
              onRejectWorkflow={onRejectWorkflow}
              onWorkflowRequestInfo={onWorkflowRequestInfo}
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
