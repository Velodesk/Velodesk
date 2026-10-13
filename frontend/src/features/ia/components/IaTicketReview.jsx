/**
 * IaTicketReview v1.0.0 — ticket na Área de IA: cabeçalho, última mensagem do cliente e
 * sugestão de resposta da IA com Editar / Reprovar / Aprovar e enviar (envia como Resolvido).
 * Substitui, só na Área de IA, a barra de abas, o perfil do cliente, as abas Conversa/Notas e a conversa do Desk.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { MessageBubbleText } from '../../desk/components/DeskConversation';
import {
  getAgentName,
  getClientContactFields,
  getTicketProtocolLabel,
  isClientIdentifiedForHistory,
} from '../../../services/desk/utils';
import { wrapComposerOpeningForTicket } from '../../../services/desk/clientMessageEnvelope';

const CHANNEL_ICONS = {
  'e-mail': 'ti-mail',
  email: 'ti-mail',
  whatsapp: 'ti-brand-whatsapp',
  app: 'ti-device-mobile',
  telefone: 'ti-phone',
};

function formatDateBr(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function complianceTone(score) {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  return 'low';
}

function ConversationRow({ msg }) {
  const isRight = msg.type === 'agent' || msg.type === 'internal';
  return (
    <div className={'msg-row' + (isRight ? ' msg-row--agent' : '')}>
      <div className={'msg-avatar msg-avatar--' + (msg.type === 'internal' ? 'agent' : msg.type)}>{msg.initials || '?'}</div>
      <div className="msg-body">
        <div className={'msg-bubble msg-bubble--' + msg.type}>
          <MessageBubbleText
            text={msg.text}
            attachments={msg.attachments}
            scanStatuses={msg.attachmentScanStatuses}
            messageOrigin={msg.origin}
            messageType={msg.type}
          />
        </div>
        {msg.meta ? <div className="msg-meta">{msg.meta}</div> : null}
      </div>
    </div>
  );
}

export default function IaTicketReview({
  ticket,
  client,
  messages = [],
  ticketStatus,
  channelLabel = '',
  onOpenHistory,
  ai,
  onApproveSend,
  onReject,
  sending = false,
  readOnly = false,
}) {
  const contact = getClientContactFields(ticket, client);
  const protocol = getTicketProtocolLabel(ticket);
  const firstName = String(contact.name || '').trim().split(/\s+/)[0] || 'o cliente';
  const channel = String(channelLabel || ticket?.channel || '').trim();
  const channelIcon = CHANNEL_ICONS[channel.toLowerCase()] || 'ti-message';

  const conversation = useMemo(
    () => messages.filter((msg) => msg.type === 'client' || msg.type === 'agent'),
    [messages],
  );
  const lastClientMessage = useMemo(
    () => [...conversation].reverse().find((msg) => msg.type === 'client') || null,
    [conversation],
  );
  const [showFullConversation, setShowFullConversation] = useState(false);

  const suggestedText = useMemo(() => {
    const nucleo = String(ai?.respostaSugerida || '').trim();
    if (!nucleo) return '';
    return wrapComposerOpeningForTicket({ nucleo, ticket, agentName: getAgentName() });
  }, [ai?.respostaSugerida, ticket]);

  const [draft, setDraft] = useState(null);
  const ticketId = String(ticket?.id || ticket?._id || '');
  useEffect(() => {
    setDraft(null);
    setShowFullConversation(false);
  }, [ticketId, suggestedText]);

  const editing = draft !== null;
  const replyText = editing ? draft : suggestedText;
  const hasSuggestion = Boolean(ai?.hasSuggestion && suggestedText);
  const score = typeof ai?.auditScore === 'number' ? Math.max(0, Math.min(100, ai.auditScore)) : null;
  const actionsDisabled = readOnly || sending || !hasSuggestion || !String(replyText || '').trim();

  let suggestionPlaceholder = null;
  if (ai?.loading) suggestionPlaceholder = ai.waitingMessage || 'Gerando sugestão de resposta…';
  else if (ai?.error) suggestionPlaceholder = typeof ai.error === 'string' ? ai.error : 'Não foi possível gerar a sugestão.';
  else if (!hasSuggestion) suggestionPlaceholder = ai?.waitingMessage || 'Aguardando sugestão de resposta da IA.';

  return (
    <div className="ia-review">
      <header className="ia-review__header">
        <div className="ia-review__identity">
          <div className="ia-review__title-row">
            <h1 className="ia-review__name">{contact.name || 'Cliente'}</h1>
            {ticketStatus?.label ? (
              <span className={'status-badge ia-review__status status-badge--' + ticketStatus.cls}>{ticketStatus.label}</span>
            ) : null}
          </div>
          <p className="ia-review__meta">
            <span>Ticket <strong>#{protocol || '—'}</strong></span>
            {contact.cpf ? <span>CPF {contact.cpf}</span> : null}
            {contact.phone ? <span>{contact.phone}</span> : null}
            {contact.email ? <span>{contact.email}</span> : null}
          </p>
          <p className="ia-review__opened">Aberto em {formatDateBr(ticket?.createdAt)}</p>
        </div>
        <div className="ia-review__header-actions">
          <span className="ia-review__stage">Etapa · Revisão da IA</span>
          <button
            type="button"
            className="ia-review__history-btn"
            onClick={onOpenHistory}
            disabled={!isClientIdentifiedForHistory(contact.cpf)}
          >
            <i className="ti ti-history" aria-hidden="true" />
            Histórico
          </button>
        </div>
      </header>

      <div className="ia-review__body">
        <section className="ia-review__card ia-review__client" aria-label="Mensagem do cliente">
          <div className="ia-review__card-head">
            <div className="ia-review__card-title">
              <span className="ia-review__eyebrow">Mensagem do cliente</span>
              {channel ? (
                <span className="ia-review__channel-chip">
                  <i className={'ti ' + channelIcon} aria-hidden="true" />
                  {channel}
                </span>
              ) : null}
            </div>
            {conversation.length > 1 ? (
              <button
                type="button"
                className="ia-review__link"
                onClick={() => setShowFullConversation((open) => !open)}
                aria-expanded={showFullConversation}
              >
                {showFullConversation ? 'Ver só a última mensagem' : `Ver conversa completa (${conversation.length})`}
              </button>
            ) : null}
          </div>
          <div className="conversation ia-review__conversation">
            {showFullConversation
              ? conversation.map((msg, i) => <ConversationRow key={msg.id || i} msg={msg} />)
              : lastClientMessage
                ? <ConversationRow msg={lastClientMessage} />
                : <p className="ia-review__empty">Nenhuma mensagem do cliente neste ticket.</p>}
          </div>
        </section>

        <section className="ia-review__card ia-review__suggestion" aria-label="Sugestão de resposta da IA">
          <div className="ia-review__suggestion-head">
            <span className="ia-review__suggestion-icon" aria-hidden="true"><i className="ti ti-sparkles" /></span>
            <div className="ia-review__suggestion-title">
              <h2>Sugestão de resposta da IA</h2>
              <p>Será enviada{channel ? ` por ${channel}` : ''} para {firstName}</p>
            </div>
            {score != null && hasSuggestion ? (
              <div className={'ia-review__compliance ia-review__compliance--' + complianceTone(score)}>
                <span>Conformidade <strong>{score}%</strong></span>
                <span className="ia-review__compliance-bar" aria-hidden="true">
                  <span style={{ width: score + '%' }} />
                </span>
              </div>
            ) : null}
          </div>

          <div className="ia-review__suggestion-body">
            {suggestionPlaceholder ? (
              <p className={'ia-review__placeholder' + (ai?.error ? ' is-error' : '')}>
                {ai?.loading ? <i className="ti ti-loader-2 ia-review__spin" aria-hidden="true" /> : null}
                {suggestionPlaceholder}
              </p>
            ) : editing ? (
              <textarea
                id="iaReviewDraft"
                className="ia-review__editor"
                value={draft}
                rows={Math.min(14, Math.max(5, draft.split('\n').length + 1))}
                onChange={(e) => setDraft(e.target.value)}
                disabled={sending}
                aria-label="Editar resposta da IA"
              />
            ) : (
              <p className="ia-review__reply">{replyText}</p>
            )}
          </div>

          <footer className="ia-review__suggestion-foot">
            {editing ? (
              <button type="button" className="ia-review__btn ia-review__btn--ghost" onClick={() => setDraft(null)} disabled={sending}>
                <i className="ti ti-arrow-back-up" aria-hidden="true" />
                Desfazer edição
              </button>
            ) : (
              <button
                type="button"
                className="ia-review__btn ia-review__btn--ghost"
                onClick={() => setDraft(suggestedText)}
                disabled={readOnly || sending || !hasSuggestion}
              >
                <i className="ti ti-pencil" aria-hidden="true" />
                Editar resposta
              </button>
            )}
            <div className="ia-review__decision">
              <button
                type="button"
                className="ia-review__btn ia-review__btn--reject"
                onClick={onReject}
                disabled={readOnly || sending || !hasSuggestion}
              >
                <i className="ti ti-x" aria-hidden="true" />
                Reprovar
              </button>
              <button
                type="button"
                className="ia-review__btn ia-review__btn--approve"
                onClick={() => onApproveSend?.(replyText)}
                disabled={actionsDisabled}
                title="Envia a resposta ao cliente e marca o ticket como Resolvido"
              >
                <i className={'ti ' + (sending ? 'ti-loader-2 ia-review__spin' : 'ti-check')} aria-hidden="true" />
                {sending ? 'Enviando…' : 'Aprovar e enviar'}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}
