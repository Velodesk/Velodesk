/**
 * DeskConversation v1.11.0 — prop `iaApproveMode`: botões "Usar resposta"/"Não usar" viram "Aprovado" (verde)/"Reprovado" e "Revisar" some; Reprovado chama `onReject` (Área de IA)
 * VERSION: v1.11.0 | DATE: 2026-10-02
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { composeMarkupToSafeHtml, composeTextHasFormatting } from '../../../services/desk/composeFormatPreview';
import { normalizeMessageHtmlForDisplay } from '../../../services/desk/composeRichEditor';
import {
  isClienteRespondeuRead,
  isClienteRespondeuTicket,
  markClienteRespondeuRead,
  markClienteRespondeuUnread,
  shouldHideWorkflowSystemThreadMessage,
} from '../../../services/desk/utils';
import { ticketAssignedToCurrentAgent } from '../../../services/desk/responsavelSegmentation';
import { normalizeMessageDisplayText } from '../../../utils/htmlText.util';
import {
  attachmentKindIcon,
  attachmentLabelFromUrl,
  classifyAttachmentKind,
  downloadObjectUrl,
  loadAttachmentForPreview,
  shouldOpenPreviewModal,
} from '../../../services/desk/attachmentPreview';
import DeskAttachmentPreviewModal from './DeskAttachmentPreviewModal';
import { formatDateTimeBr } from '../../../utils/dateTimeBr';

const AUDIT_MIN_DISPLAY = 70;
const AUDIT_HIGH_GREEN = 90;

function normalizeAuditScore(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isBrandInlineAttachmentUrl(url) {
  const label = attachmentLabelFromUrl(url).toLowerCase();
  return label.includes('simbolo_velotax')
    || label.includes('velotax_ajustada')
    || label.includes('velotax_logo')
    || /velotax.*logo/i.test(label)
    || label.includes('velodesk-brand')
    || /^logo\.(png|jpe?g|gif|webp)$/i.test(label);
}

function isInboundMessageOrigin(origin, msgType) {
  const o = String(origin || '').trim().toLowerCase();
  if (o === 'cliente' || o === 'client') return true;
  if (o === 'agente' || o === 'sistema' || o === 'system') return false;
  return msgType === 'client';
}

function effectiveScanStatus(rawStatus, isInbound) {
  const status = String(rawStatus || '').trim().toLowerCase();
  if (!isInbound && status === 'pending') return 'skipped';
  return status;
}

function MessageAttachments({ attachments, scanStatuses, messageOrigin, messageType }) {
  const inbound = isInboundMessageOrigin(messageOrigin, messageType);
  const items = (attachments || [])
    .map((item, index) => ({
      url: String(item || '').trim(),
      scanStatus: effectiveScanStatus(scanStatuses?.[index], inbound),
    }))
    .filter((item) => item.url)
    .filter((item) => !isBrandInlineAttachmentUrl(item.url));
  const [loadingUrl, setLoadingUrl] = useState('');
  const [errorUrl, setErrorUrl] = useState('');
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);
  previewRef.current = preview;

  useEffect(() => () => {
    if (previewRef.current?.objectUrl) URL.revokeObjectURL(previewRef.current.objectUrl);
  }, []);

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }, []);

  const openAttachment = useCallback(async (url) => {
    setErrorUrl('');
    setLoadingUrl(url);
    try {
      const loaded = await loadAttachmentForPreview(url);
      if (shouldOpenPreviewModal(loaded.kind)) {
        setPreview((current) => {
          if (current?.objectUrl) URL.revokeObjectURL(current.objectUrl);
          return loaded;
        });
        return;
      }
      downloadObjectUrl(loaded.objectUrl, loaded.filename);
      window.setTimeout(() => URL.revokeObjectURL(loaded.objectUrl), 60_000);
    } catch (err) {
      setErrorUrl(url);
      console.warn('[DeskConversation] anexo:', err?.message || err);
    } finally {
      setLoadingUrl('');
    }
  }, []);

  if (!items.length) return null;

  return (
    <>
      <ul className="msg-bubble__attachments">
        {items.map((item) => {
          const url = item.url;
          const isLoading = loadingUrl === url;
          const hasError = errorUrl === url;
          const pending = inbound && item.scanStatus === 'pending';
          const blocked = item.scanStatus === 'infected' || item.scanStatus === 'unscannable';
          const kind = classifyAttachmentKind('', attachmentLabelFromUrl(url));
          return (
            <li key={url}>
              <button
                type="button"
                className={`msg-bubble__attachment-link${hasError || blocked ? ' msg-bubble__attachment-link--error' : ''}${pending ? ' msg-bubble__attachment-link--pending' : ''}`}
                disabled={isLoading || blocked}
                title={pending ? 'Verificação em andamento — clique para tentar abrir' : undefined}
                onClick={() => { openAttachment(url); }}
              >
                <i className={`ti ${blocked ? 'ti-shield-x' : attachmentKindIcon(kind)}`} aria-hidden="true" />
                {blocked ? 'Anexo bloqueado' : pending ? 'Verificando…' : isLoading ? 'Abrindo…' : attachmentLabelFromUrl(url)}
              </button>
              {hasError ? (
                <span className="msg-bubble__attachment-error" role="alert">
                  Anexo indisponível no servidor. Se o e-mail entrou por outro ambiente, o arquivo pode não ter sido sincronizado.
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <DeskAttachmentPreviewModal
        open={Boolean(preview)}
        kind={preview?.kind}
        objectUrl={preview?.objectUrl}
        filename={preview?.filename}
        onClose={closePreview}
      />
    </>
  );
}

export function MessageBubbleText({ text, attachments, scanStatuses, messageOrigin, messageType }) {
  const raw = normalizeMessageDisplayText(text);
  const hasText = Boolean(String(raw || '').trim());

  return (
    <>
      {hasText ? (
        /<[a-z][\s\S]*>/i.test(raw) ? (
          <span
            className="msg-bubble__formatted msg-bubble__formatted--html"
            dangerouslySetInnerHTML={{ __html: normalizeMessageHtmlForDisplay(raw) }}
          />
        ) : !composeTextHasFormatting(raw) ? (
          <span className="msg-bubble__formatted msg-bubble__formatted--plain">{raw}</span>
        ) : (
          <span
            className="msg-bubble__formatted"
            dangerouslySetInnerHTML={{ __html: composeMarkupToSafeHtml(raw) }}
          />
        )
      ) : null}
      <MessageAttachments
        attachments={attachments}
        scanStatuses={scanStatuses}
        messageOrigin={messageOrigin}
        messageType={messageType}
      />
    </>
  );
}

function ClientReplyReadToggle({ ticket }) {
  const [isRead, setIsRead] = useState(() => isClienteRespondeuRead(ticket));

  useEffect(() => {
    setIsRead(isClienteRespondeuRead(ticket));
  }, [ticket?.id, ticket?.status]);

  const handleMark = (read) => {
    if (read) markClienteRespondeuRead(ticket);
    else markClienteRespondeuUnread(ticket);
    setIsRead(read);
  };

  return (
    <div className="msg-client-read-toggle" role="group" aria-label="Marcar resposta do cliente como lida ou não lida">
      <button
        type="button"
        className={'msg-client-read-toggle__btn' + (!isRead ? ' is-active' : '')}
        aria-pressed={!isRead}
        onClick={() => handleMark(false)}
      >
        Não lido
      </button>
      <button
        type="button"
        className={'msg-client-read-toggle__btn' + (isRead ? ' is-active' : '')}
        aria-pressed={isRead}
        onClick={() => handleMark(true)}
      >
        Lido
      </button>
    </div>
  );
}

function formatWaBalloonTime(timestamp) {
  if (!timestamp) return '';
  return formatDateTimeBr(timestamp, { year: false });
}

function WhatsAppPresenceBalloon({ msg, onOpen }) {
  const preview = String(msg.lastText || '').trim();
  const time = formatWaBalloonTime(msg.timestamp);
  return (
    <div className="msg-row msg-row--wa-presence">
      <button
        type="button"
        className="wa-presence-balloon"
        onClick={onOpen}
        title="Abrir a conversa de WhatsApp"
      >
        <span className="wa-presence-balloon__icon">
          <i className="ti ti-brand-whatsapp" aria-hidden="true" />
        </span>
        <span className="wa-presence-balloon__body">
          <span className="wa-presence-balloon__title">
            Conversa de WhatsApp
            <span className="wa-presence-balloon__count">
              {msg.count} {msg.count === 1 ? 'mensagem' : 'mensagens'}
            </span>
          </span>
          {preview ? (
            <span className="wa-presence-balloon__preview">
              {msg.lastType === 'client' ? 'Cliente: ' : 'Agente: '}
              {preview.length > 80 ? `${preview.slice(0, 80)}…` : preview}
            </span>
          ) : null}
          <span className="wa-presence-balloon__hint">
            {time ? `Última mensagem ${time} · ` : ''}Clique para abrir a conversa
          </span>
        </span>
        <i className="ti ti-chevron-right wa-presence-balloon__chevron" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function DeskConversation({
  ticket,
  messages,
  onUseIaReply,
  iaReply = '',
  iaReplyLoading = false,
  iaWaitingMessage = '',
  iaShowBar = false,
  iaHasSuggestion = false,
  iaError = '',
  iaAuditScore = null,
  onRequestRevision,
  onOpenWhatsAppChat,
  iaApproveMode = false,
  onReject,
}) {
  const [iaVisible, setIaVisible] = useState(true);
  const lastIaReplyRef = useRef('');
  const thread = messages || [];
  let lastRealMessageIndex = -1;
  thread.forEach((m, idx) => {
    if (m.type !== 'system' && m.type !== 'whatsapp-thread') lastRealMessageIndex = idx;
  });
  const showClientReadToggle = isClienteRespondeuTicket(ticket) && ticketAssignedToCurrentAgent(ticket);

  useEffect(() => {
    setIaVisible(true);
    lastIaReplyRef.current = '';
  }, [ticket?.id]);

  useEffect(() => {
    if (!iaHasSuggestion || !iaReply || iaReply === lastIaReplyRef.current) return;
    setIaVisible(true);
  }, [iaReply, iaHasSuggestion]);

  const displayText = iaError
    ? iaError
    : iaReplyLoading || !iaHasSuggestion
      ? (iaWaitingMessage || 'Gerando sugestão com base nos POPs…')
      : iaReply;

  const canUseReply = iaHasSuggestion && !iaReplyLoading && Boolean(iaReply) && !iaError;
  const showFooter = !iaError;
  const auditScoreValue = normalizeAuditScore(iaAuditScore);
  const hasAuditScore = auditScoreValue !== null;
  const showCompliance = showFooter && iaHasSuggestion && !iaReplyLoading
    && hasAuditScore && auditScoreValue >= AUDIT_MIN_DISPLAY;
  const complianceTone = hasAuditScore && auditScoreValue >= AUDIT_HIGH_GREEN ? 'high' : 'mid';

  const handleUseIaReply = () => {
    if (!canUseReply) return;
    onUseIaReply(iaReply);
    lastIaReplyRef.current = iaReply;
    setIaVisible(false);
  };

  return (
    <div className="conversation" id="conversation">
      {thread.length === 0 ? (
        <div className="crm-empty-state conversation-empty">
          <p>Nenhuma mensagem pública neste atendimento.</p>
        </div>
      ) : (
        thread.map((msg, i) => {
          if (msg.type === 'whatsapp-thread') {
            return (
              <WhatsAppPresenceBalloon key={i} msg={msg} onOpen={onOpenWhatsAppChat} />
            );
          }
          if (msg.type === 'system') {
            if (shouldHideWorkflowSystemThreadMessage(msg.text)) {
              return null;
            }
            return (
              <div key={i} className="msg-row msg-row--system">
                <div className="msg-body msg-body--system">
                  <div className="msg-bubble msg-bubble--system">
                    <MessageBubbleText text={msg.text} attachments={msg.attachments} scanStatuses={msg.attachmentScanStatuses} messageOrigin={msg.origin} messageType={msg.type} />
                  </div>
                  {msg.meta ? <div className="msg-meta">{msg.meta}</div> : null}
                </div>
              </div>
            );
          }
          const isRight = msg.type === 'agent' || msg.type === 'internal';
          const isLastClientReply = i === lastRealMessageIndex && msg.type === 'client';
          return (
          <div key={i} className={'msg-row' + (isRight ? ' msg-row--agent' : '')}>
            <div className={'msg-avatar msg-avatar--' + (msg.type === 'internal' ? 'agent' : msg.type)}>{msg.initials || '?'}</div>
            <div className="msg-body">
              <div className={'msg-bubble msg-bubble--' + msg.type}>
                <MessageBubbleText text={msg.text} attachments={msg.attachments} scanStatuses={msg.attachmentScanStatuses} messageOrigin={msg.origin} messageType={msg.type} />
              </div>
              <div className="msg-meta">{msg.meta}</div>
            </div>
            {isLastClientReply && showClientReadToggle ? (
              <ClientReplyReadToggle ticket={ticket} />
            ) : null}
          </div>
          );
        })
      )}
      {iaVisible && iaShowBar && (
        <div className={'ia-suggestion-bar' + (iaReplyLoading ? ' ia-suggestion-bar--loading' : '') + (iaError ? ' ia-suggestion-bar--error' : '')} id="iaSuggestionBar">
          <div className="ia-suggestion-bar__content">
            <span className="ia-suggestion-bar__text" id="iaReplyText">{displayText}</span>
          </div>
          {showFooter && (
            <>
              <div className="ia-suggestion-bar__divider" role="separator" aria-hidden="true" />
              <div className="ia-suggestion-bar__footer">
                {showCompliance && (
                  <span
                    className={'ia-suggestion-bar__compliance container-secondary ia-suggestion-bar__compliance--' + complianceTone}
                    title="Conformidade da auditoria"
                  >
                    {auditScoreValue}%
                  </span>
                )}
                <div className="ia-suggestion-bar__actions">
                  <button
                    type="button"
                    className={'ia-suggestion-bar__btn ia-suggestion-bar__btn--use container-secondary' + (iaApproveMode ? ' ia-suggestion-bar__btn--approve' : '')}
                    disabled={!canUseReply}
                    onClick={handleUseIaReply}
                  >
                    {iaApproveMode ? 'Aprovado' : 'Usar resposta'}
                  </button>
                  {onRequestRevision && !iaApproveMode && (
                    <button
                      type="button"
                      className="ia-suggestion-bar__btn ia-suggestion-bar__btn--revise container-secondary"
                      disabled={iaReplyLoading || !iaHasSuggestion}
                      onClick={onRequestRevision}
                    >
                      Revisar
                    </button>
                  )}
                  <button
                    type="button"
                    className="ia-suggestion-bar__btn ia-suggestion-bar__btn--dismiss container-secondary"
                    onClick={iaApproveMode && onReject ? onReject : () => setIaVisible(false)}
                  >
                    {iaApproveMode ? 'Reprovado' : 'Não usar'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
