/**
 * DeskWhatsAppChat v1.14.0 — Verificando… só em mídia inbound (outbound = skipped)
 * VERSION: v1.14.0 | DATE: 2026-08-21
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { uploadsApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import WhatsAppEmojiPicker from './WhatsAppEmojiPicker';
import {
  formatWaTime,
  formatWaDateSeparator,
} from '../../../services/desk/utils';
import {
  attachmentKindIcon,
  attachmentLabelFromUrl,
  classifyAttachmentKind,
  downloadObjectUrl,
  fetchAuthenticatedAttachment,
  loadAttachmentForPreview,
  shouldOpenPreviewModal,
} from '../../../services/desk/attachmentPreview';
import DeskAttachmentPreviewModal from './DeskAttachmentPreviewModal';

/** Limite de caracteres por mensagem de texto livre do WhatsApp (Twilio/Meta). */
export const WA_TEXT_MAX_LENGTH = 1600;
/** Contador só aparece perto do limite — abaixo disso fica oculto, sem poluir a tela. */
const WA_TEXT_COUNTER_SHOW_AT = 1500;

function attachmentLabel(url) {
  return attachmentLabelFromUrl(url);
}

function mediaKind(contentType, url) {
  const kind = classifyAttachmentKind(contentType, attachmentLabel(url));
  if (kind === 'image' || kind === 'audio' || kind === 'video') return kind;
  return 'document';
}

function WhatsAppMediaAttachments({ attachments, contentTypes, scanStatuses, isOutbound = false }) {
  const items = (attachments || []).map((url, index) => {
    let scanStatus = String(scanStatuses?.[index] || '').trim().toLowerCase();
    if (isOutbound && scanStatus === 'pending') scanStatus = 'skipped';
    return {
      url: String(url || '').trim(),
      contentType: String(contentTypes?.[index] || ''),
      scanStatus,
    };
  }).filter((item) => item.url);
  const fingerprint = items.map((item) => `${item.url}|${item.contentType}|${item.scanStatus}`).join(';;');
  const [inlineUrls, setInlineUrls] = useState({});
  const [errors, setErrors] = useState({});
  const [downloading, setDownloading] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const created = [];
    const inlineItems = items.filter((item) => (
      mediaKind(item.contentType, item.url) !== 'document'
      && item.scanStatus !== 'pending'
      && item.scanStatus !== 'infected'
      && item.scanStatus !== 'unscannable'
    ));
    Promise.all(inlineItems.map(async (item) => {
      try {
        const response = await fetchAuthenticatedAttachment(item.url);
        const objectUrl = URL.createObjectURL(await response.blob());
        created.push(objectUrl);
        if (!cancelled) {
          setInlineUrls((current) => ({ ...current, [item.url]: objectUrl }));
        }
      } catch (err) {
        if (!cancelled) {
          setErrors((current) => ({ ...current, [item.url]: err?.message || 'Anexo indisponível' }));
        }
      }
    }));
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
      setInlineUrls({});
      setErrors({});
      setPreview((current) => {
        if (current?.ownsUrl && current.objectUrl) URL.revokeObjectURL(current.objectUrl);
        return null;
      });
    };
  // fingerprint representa exatamente a lista de anexos da mensagem
  }, [fingerprint]);

  const closePreview = useCallback(() => {
    setPreview((current) => {
      if (current?.ownsUrl && current.objectUrl) URL.revokeObjectURL(current.objectUrl);
      return null;
    });
  }, []);

  const openInlinePreview = (item, src) => {
    const kind = classifyAttachmentKind(item.contentType, attachmentLabel(item.url));
    setPreview({
      kind,
      objectUrl: src,
      filename: attachmentLabel(item.url),
      ownsUrl: false,
    });
  };

  const openDocument = async (item) => {
    setDownloading(item.url);
    setErrors((current) => ({ ...current, [item.url]: '' }));
    try {
      const loaded = await loadAttachmentForPreview(item.url, item.contentType);
      if (shouldOpenPreviewModal(loaded.kind)) {
        setPreview((current) => {
          if (current?.ownsUrl && current.objectUrl) URL.revokeObjectURL(current.objectUrl);
          return { ...loaded, ownsUrl: true };
        });
        return;
      }
      downloadObjectUrl(loaded.objectUrl, loaded.filename);
      window.setTimeout(() => URL.revokeObjectURL(loaded.objectUrl), 60_000);
    } catch (err) {
      setErrors((current) => ({ ...current, [item.url]: err?.message || 'Anexo indisponível' }));
    } finally {
      setDownloading('');
    }
  };

  if (!items.length) return null;
  return (
    <>
      <div className="wa-msg__media-list">
        {items.map((item) => {
          const kind = mediaKind(item.contentType, item.url);
          const previewKind = classifyAttachmentKind(item.contentType, attachmentLabel(item.url));
          const src = inlineUrls[item.url];
          const error = errors[item.url];
          const opening = downloading === item.url;
          const pending = item.scanStatus === 'pending';
          const blocked = item.scanStatus === 'infected' || item.scanStatus === 'unscannable';
          return (
            <div className={`wa-msg__media wa-msg__media--${kind}`} key={item.url}>
              {pending ? (
                <span className="wa-msg__media-loading">Verificando anexo…</span>
              ) : null}
              {blocked ? (
                <span className="wa-msg__media-error" role="alert">Anexo bloqueado por segurança.</span>
              ) : null}
              {kind === 'image' && src && !pending && !blocked ? (
                <button
                  type="button"
                  className="wa-msg__image-button"
                  onClick={() => openInlinePreview(item, src)}
                  aria-label={`Visualizar imagem ${attachmentLabel(item.url)}`}
                >
                  <img src={src} alt={attachmentLabel(item.url)} loading="lazy" />
                </button>
              ) : null}
              {kind === 'audio' && src && !pending && !blocked ? (
                <audio className="wa-msg__audio" controls preload="metadata" src={src}>
                  Seu navegador não conseguiu reproduzir este áudio.
                </audio>
              ) : null}
              {kind === 'video' && src && !pending && !blocked ? (
                <video className="wa-msg__video" controls preload="metadata" src={src}>
                  Seu navegador não conseguiu reproduzir este vídeo.
                </video>
              ) : null}
              {kind !== 'document' && !src && !error && !pending && !blocked ? (
                <span className="wa-msg__media-loading">Carregando mídia…</span>
              ) : null}
              {kind === 'document' && !blocked ? (
                <button
                  type="button"
                  className="wa-msg__document"
                  disabled={opening}
                  onClick={() => { void openDocument(item); }}
                >
                  <i className={`ti ${attachmentKindIcon(previewKind)}`} aria-hidden="true" />
                  <span>{opening ? 'Abrindo…' : attachmentLabel(item.url)}</span>
                </button>
              ) : null}
              {error ? <span className="wa-msg__media-error" role="alert">{error}</span> : null}
            </div>
          );
        })}
      </div>
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

function renderDeliveryChecks(msg) {
  if (msg.type !== 'agent') return null;

  const status = String(msg.deliveryStatus || 'sent').toLowerCase();
  const errorMessage = String(msg.deliveryErrorMessage || '').trim();

  if (status === 'failed' || status === 'undelivered') {
    return (
      <i
        className="ti ti-alert-circle wa-msg__checks wa-msg__checks--failed"
        aria-hidden="true"
        title={errorMessage || 'Falha na entrega'}
      />
    );
  }

  if (status === 'queued' || status === 'sending') {
    return (
      <i
        className="ti ti-clock wa-msg__checks wa-msg__checks--pending"
        aria-hidden="true"
        title="Enviando…"
      />
    );
  }

  if (status === 'sent') {
    return (
      <i
        className="ti ti-check wa-msg__checks wa-msg__checks--sent"
        aria-hidden="true"
        title="Enviada"
      />
    );
  }

  if (status === 'delivered') {
    return (
      <i
        className="ti ti-checks wa-msg__checks wa-msg__checks--delivered"
        aria-hidden="true"
        title="Entregue"
      />
    );
  }

  return (
    <i
      className="ti ti-checks wa-msg__checks wa-msg__checks--read"
      aria-hidden="true"
      title="Lida"
    />
  );
}

function WaPendingAttachments({ items, onRemove, disabled = false }) {
  const [loadingUrl, setLoadingUrl] = useState('');
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

  const openPendingAttachment = useCallback(async (url) => {
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
      console.warn('[WaPendingAttachments] anexo:', err?.message || err);
    } finally {
      setLoadingUrl('');
    }
  }, []);

  if (!items?.length) return null;
  return (
    <>
      <ul className="crm-compose-pending-attachments wa-chat__pending-attachments" aria-label="Anexos pendentes">
        {items.map((item) => {
          const isLoading = loadingUrl === item.url;
          const kind = classifyAttachmentKind('', item.name);
          return (
            <li key={item.url} className="crm-compose-pending-attachments__chip">
              <button
                type="button"
                className="crm-compose-pending-attachments__preview-btn"
                onClick={() => openPendingAttachment(item.url)}
                disabled={isLoading}
                title={`Ver prévia de ${item.name}`}
              >
                <i className={`ti ${attachmentKindIcon(kind)}`} aria-hidden="true" />
                <span className="crm-compose-pending-attachments__name" title={item.name}>
                  {isLoading ? 'Abrindo…' : item.name}
                </span>
              </button>
              {!disabled ? (
                <button
                  type="button"
                  className="crm-compose-pending-attachments__remove"
                  aria-label={`Remover anexo ${item.name}`}
                  onClick={() => onRemove(item.url)}
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
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

export default function DeskWhatsAppChat({
  ticket,
  client,
  messages,
  composeText,
  onComposeTextChange,
  composeAttachments = [],
  onComposeAttachmentsChange,
  onUseIaReply,
  onSend,
  onSendInitial,
  onRequestAudioTranscription,
  waUiState,
  initialSendBusy = false,
  sendBusy = false,
  iaReply = '',
  iaReplyLoading = false,
  iaWaitingMessage = '',
  iaShowBar = false,
  iaHasSuggestion = false,
  iaError = '',
}) {
  const { showNotification } = useNotifications();
  const [iaVisible, setIaVisible] = useState(true);
  const [transcriptionBusyId, setTranscriptionBusyId] = useState('');
  const [attachUploading, setAttachUploading] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiAnchorRef = useRef(null);
  const lastIaReplyRef = useRef('');
  const prevSendBusyRef = useRef(false);
  const chatMessages = messages || [];
  const dateIso = chatMessages[0]?.timestamp || ticket.createdAt;
  const pendingAttachments = composeAttachments || [];
  const hasPendingAttachments = pendingAttachments.length > 0;

  const composeEnabled = waUiState?.composeEnabled !== false;
  const needsInitial = Boolean(waUiState?.needsInitial);
  const needsReopen = Boolean(waUiState?.needsReopen);
  const awaitingClient = Boolean(waUiState?.awaitingClient);
  const isOverTextLimit = composeText.length > WA_TEXT_MAX_LENGTH;

  useEffect(() => {
    setIaVisible(true);
    lastIaReplyRef.current = '';
  }, [ticket?.id]);

  useEffect(() => {
    if (!iaHasSuggestion || !iaReply || iaReply === lastIaReplyRef.current) return;
    setIaVisible(true);
  }, [iaReply, iaHasSuggestion]);

  // Mantém o cursor no campo após cada envio (Enter ou botão)
  useEffect(() => {
    if (prevSendBusyRef.current && !sendBusy && composeEnabled) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
    prevSendBusyRef.current = sendBusy;
  }, [sendBusy, composeEnabled]);

  // Foco inicial ao abrir conversa com texto livre liberado
  useEffect(() => {
    if (!composeEnabled) return;
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [ticket?.id, composeEnabled]);

  const displayText = iaError
    ? iaError
    : iaReplyLoading || !iaHasSuggestion
      ? (iaWaitingMessage || 'Gerando sugestão com base nos POPs…')
      : iaReply;

  const canUseReply = iaHasSuggestion && !iaReplyLoading && Boolean(iaReply) && !iaError;

  const handleUseIaReply = () => {
    if (!canUseReply) return;
    onUseIaReply(iaReply);
    lastIaReplyRef.current = iaReply;
    setIaVisible(false);
  };

  const handleEditIa = () => {
    if (!canUseReply) return;
    onUseIaReply(iaReply);
    lastIaReplyRef.current = iaReply;
    setIaVisible(false);
    inputRef.current?.focus();
  };

  const handleSend = async () => {
    if (!composeEnabled || sendBusy || isOverTextLimit) return;
    if (!composeText.trim() && !hasPendingAttachments) return;
    const result = onSend?.();
    if (result && typeof result.then === 'function') {
      await result;
    }
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  useEffect(() => {
    if (!emojiPickerOpen) return undefined;
    const onPointerDown = (event) => {
      if (emojiAnchorRef.current?.contains(event.target)) return;
      setEmojiPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [emojiPickerOpen]);

  useEffect(() => {
    setEmojiPickerOpen(false);
  }, [ticket?.id]);

  const insertEmoji = useCallback((emoji) => {
    const input = inputRef.current;
    const current = String(composeText || '');
    if (!input) {
      onComposeTextChange(current + emoji);
      setEmojiPickerOpen(false);
      return;
    }
    const start = input.selectionStart ?? current.length;
    const end = input.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${emoji}${current.slice(end)}`;
    onComposeTextChange(next);
    const caret = start + emoji.length;
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(caret, caret);
    });
    setEmojiPickerOpen(false);
  }, [composeText, onComposeTextChange]);

  const toggleEmojiPicker = useCallback(() => {
    if (!composeEnabled || sendBusy || attachUploading) return;
    setEmojiPickerOpen((open) => !open);
  }, [attachUploading, composeEnabled, sendBusy]);

  const handleAttachClick = useCallback(() => {
    if (!composeEnabled || attachUploading || sendBusy) return;
    fileInputRef.current?.click();
  }, [attachUploading, composeEnabled, sendBusy]);

  const handleRemoveAttachment = useCallback((url) => {
    if (!onComposeAttachmentsChange) return;
    onComposeAttachmentsChange(pendingAttachments.filter((item) => item.url !== url));
  }, [onComposeAttachmentsChange, pendingAttachments]);

  const handleAttachFiles = useCallback(async (files) => {
    if (!onComposeAttachmentsChange || !composeEnabled || attachUploading || sendBusy) return;
    const ticketKey = String(ticket?.id || ticket?._id || '').trim();
    if (!ticketKey) {
      showNotification('Salve o ticket antes de anexar arquivos.', 'warning');
      return;
    }
    setAttachUploading(true);
    try {
      const result = await uploadsApi.uploadSent(ticketKey, files);
      const uploaded = Array.isArray(result?.attachments) ? result.attachments : [];
      const nextItems = uploaded.map((item, index) => ({
        url: String(item?.url || result?.urls?.[index] || '').trim(),
        name: String(item?.filename || files[index]?.name || 'Anexo').trim(),
      })).filter((item) => item.url);
      if (!nextItems.length) {
        showNotification('Não foi possível enviar o anexo.', 'error');
        return;
      }
      onComposeAttachmentsChange([...pendingAttachments, ...nextItems]);
      showNotification(
        nextItems.length === 1 ? 'Anexo adicionado.' : `${nextItems.length} anexos adicionados.`,
        'success',
      );
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Falha ao enviar anexo.';
      showNotification(msg, 'error');
    } finally {
      setAttachUploading(false);
    }
  }, [
    attachUploading,
    composeEnabled,
    onComposeAttachmentsChange,
    pendingAttachments,
    sendBusy,
    showNotification,
    ticket?._id,
    ticket?.id,
  ]);

  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    void handleAttachFiles(files);
  }, [handleAttachFiles]);

  const handleRequestTranscription = async (msg) => {
    if (!msg?.id || !onRequestAudioTranscription || transcriptionBusyId) return;
    setTranscriptionBusyId(msg.id);
    try {
      await onRequestAudioTranscription(msg.id);
    } finally {
      setTranscriptionBusyId('');
    }
  };

  const clientLabel = String(
    client?.name
    || ticket?.clientName
    || ticket?.lateralForm?.clienteNome
    || 'cliente',
  ).trim();

  return (
    <div className="wa-chat" id="waChatView">
      <div className="conversation wa-chat__body" id="conversation">
        {needsInitial && (
          <div className="wa-chat__initial-card" role="region" aria-label="Iniciar conversa WhatsApp">
            <div className="wa-chat__initial-card-icon" aria-hidden="true">
              <i className="ti ti-brand-whatsapp" />
            </div>
            <h3 className="wa-chat__initial-card-title">Iniciar conversa WhatsApp</h3>
            <p className="wa-chat__initial-card-text">
              Para falar com <strong>{clientLabel}</strong> pela primeira vez, envie a mensagem inicial
              aprovada pela Meta (template Velotax com nome e protocolo do chamado).
            </p>
            <button
              type="button"
              className="wa-chat__initial-card-btn"
              onClick={onSendInitial}
              disabled={initialSendBusy || sendBusy}
            >
              {initialSendBusy ? 'Enviando…' : 'Enviar Mensagem Inicial'}
            </button>
          </div>
        )}

        {needsReopen && (
          <div className="wa-chat__initial-card" role="region" aria-label="Reabrir conversa WhatsApp">
            <div className="wa-chat__initial-card-icon" aria-hidden="true">
              <i className="ti ti-brand-whatsapp" />
            </div>
            <h3 className="wa-chat__initial-card-title">Reabrir conversa WhatsApp</h3>
            <p className="wa-chat__initial-card-text">
              Já se passaram mais de 24h desde a última resposta de <strong>{clientLabel}</strong> — o
              WhatsApp exige uma nova mensagem de template (aprovada pela Meta) pra reabrir a conversa
              antes de liberar o texto livre de novo.
            </p>
            <button
              type="button"
              className="wa-chat__initial-card-btn"
              onClick={onSendInitial}
              disabled={initialSendBusy || sendBusy}
            >
              {initialSendBusy ? 'Enviando…' : 'Reabrir Conversa'}
            </button>
          </div>
        )}

        {awaitingClient && !needsInitial && !needsReopen && (
          <div className="wa-chat__awaiting-banner" role="status">
            Mensagem inicial enviada. Aguardando resposta de <strong>{clientLabel}</strong> para liberar o texto livre (janela 24h).
          </div>
        )}

        {dateIso && chatMessages.length > 0 && (
          <div className="wa-chat__date-sep">{formatWaDateSeparator(dateIso)}</div>
        )}

        {chatMessages.length === 0 && !needsInitial ? (
          <div className="crm-empty-state conversation-empty">
            <p>Nenhuma mensagem WhatsApp neste atendimento.</p>
          </div>
        ) : (
          chatMessages.map((msg, i) => {
            const isOut = msg.type === 'agent' || msg.type === 'internal';
            const bubbleClass = msg.type === 'internal'
              ? ' wa-msg__bubble--internal'
              : (isOut ? ' wa-msg__bubble--out' : ' wa-msg__bubble--in');
            return (
            <div
              key={msg.id || i}
              className={'wa-msg' + (isOut ? ' wa-msg--out' : ' wa-msg--in')}
            >
              <div className={'wa-msg__bubble' + bubbleClass}>
                <WhatsAppMediaAttachments
                  attachments={msg.attachments}
                  contentTypes={msg.mediaContentTypes}
                  scanStatuses={msg.attachmentScanStatuses}
                  isOutbound={isOut}
                />
                <span className="wa-msg__text">{msg.text}</span>
                {msg.transcriptionStatus === 'processing' || msg.transcriptionStatus === 'pending' ? (
                  <span className="wa-msg__transcription-status">
                    <i className="ti ti-loader-2" aria-hidden="true" />
                    Transcrevendo áudio…
                  </span>
                ) : null}
                {msg.transcriptionStatus === 'available' || msg.transcriptionStatus === 'failed' ? (
                  <button
                    type="button"
                    className="wa-msg__transcription-button"
                    disabled={Boolean(transcriptionBusyId)}
                    onClick={() => { void handleRequestTranscription(msg); }}
                  >
                    <i className="ti ti-file-text-ai" aria-hidden="true" />
                    {transcriptionBusyId === msg.id
                      ? 'Solicitando…'
                      : (msg.transcriptionStatus === 'failed' ? 'Tentar transcrever novamente' : 'Transcrever áudio')}
                  </button>
                ) : null}
                <span className="wa-msg__time">
                  {formatWaTime(msg.timestamp)}
                  {renderDeliveryChecks(msg)}
                </span>
              </div>
            </div>
            );
          })
        )}

        {composeEnabled && iaVisible && iaShowBar && (
          <div className={'wa-ia-card' + (iaReplyLoading ? ' wa-ia-card--loading' : '') + (iaError ? ' wa-ia-card--error' : '')} id="iaSuggestionBar">
            <div className="wa-ia-card__head">
              <i className="ti ti-sparkles" aria-hidden="true" />
              <span className="wa-ia-card__label">SUGESTÃO</span>
            </div>
            <p className="wa-ia-card__text" id="iaReplyText">{displayText}</p>
            <div className="wa-ia-card__actions">
              <button
                type="button"
                className="wa-ia-card__btn wa-ia-card__btn--primary"
                disabled={!canUseReply}
                onClick={handleUseIaReply}
              >
                Usar resposta
              </button>
              <button
                type="button"
                className="wa-ia-card__btn wa-ia-card__btn--outline"
                disabled={!canUseReply}
                onClick={handleEditIa}
              >
                Editar
              </button>
              <button
                type="button"
                className="wa-ia-card__btn wa-ia-card__btn--outline"
                onClick={() => setIaVisible(false)}
              >
                Ignorar
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className={'wa-chat__footer' + (composeEnabled ? '' : ' wa-chat__footer--locked')}>
        {!composeEnabled && (
          <p className="wa-chat__session-hint" role="status">
            {needsInitial
              ? 'Use o botão acima para enviar a mensagem inicial. O campo de texto será liberado após a resposta do cliente.'
              : needsReopen
                ? 'Janela de 24h fechada. Use o botão acima para reabrir a conversa.'
                : 'Aguardando resposta do cliente para continuar a conversa.'}
          </p>
        )}
        <div className="wa-chat__input-bar">
          <div className="wa-chat__emoji-anchor" ref={emojiAnchorRef}>
            <button
              type="button"
              className={'wa-chat__input-icon' + (emojiPickerOpen ? ' wa-chat__input-icon--active' : '')}
              aria-label="Emoji"
              aria-expanded={emojiPickerOpen}
              title="Emojis"
              disabled={!composeEnabled || sendBusy || attachUploading}
              onClick={toggleEmojiPicker}
            >
              <i className="far fa-smile" />
            </button>
            {emojiPickerOpen ? (
              <WhatsAppEmojiPicker onSelect={insertEmoji} />
            ) : null}
          </div>
          <div className="wa-chat__input-wrap">
            <WaPendingAttachments
              items={pendingAttachments}
              onRemove={handleRemoveAttachment}
              disabled={!composeEnabled || sendBusy || attachUploading}
            />
            <input
              ref={inputRef}
              type="text"
              className="wa-chat__input"
              placeholder={composeEnabled ? 'Escreva uma mensagem...' : 'Disponível após resposta do cliente'}
              spellCheck
              lang="pt-BR"
              autoCorrect="on"
              autoCapitalize="sentences"
              value={composeText}
              disabled={!composeEnabled || sendBusy}
              onChange={(e) => onComposeTextChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            {composeText.length > WA_TEXT_COUNTER_SHOW_AT ? (
              <span
                className={'wa-chat__char-counter' + (isOverTextLimit ? ' wa-chat__char-counter--over' : '')}
              >
                {composeText.length}/{WA_TEXT_MAX_LENGTH}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            className="wa-chat__input-icon"
            aria-label="Anexar"
            title={attachUploading ? 'Enviando anexo…' : 'Anexar arquivo'}
            disabled={!composeEnabled || sendBusy || attachUploading || !onComposeAttachmentsChange}
            onClick={handleAttachClick}
          >
            <i className="fas fa-paperclip" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="crm-compose-toolbar__file-input"
            tabIndex={-1}
            aria-hidden="true"
            accept="image/png,image/jpeg,image/gif,image/webp,audio/*,video/mp4,video/webm,application/pdf"
            onChange={handleFileChange}
          />
        </div>
        <button
          type="button"
          className="wa-chat__send"
          aria-label="Enviar mensagem"
          disabled={!composeEnabled || sendBusy || attachUploading || isOverTextLimit || (!composeText.trim() && !hasPendingAttachments)}
          title={isOverTextLimit ? `Reduza o texto para até ${WA_TEXT_MAX_LENGTH} caracteres para enviar.` : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { void handleSend(); }}
        >
          <i className="fas fa-paper-plane" aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}
