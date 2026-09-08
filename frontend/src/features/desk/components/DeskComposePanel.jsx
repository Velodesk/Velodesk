/**
 * DeskComposePanel v1.18.0 — remove integração legada de correção ortográfica
 * VERSION: v1.18.0 | DATE: 2026-08-21
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadsApi } from '../../../api/client';
import { getSendStatusOptions } from '../../../services/desk/constants';
import { useProfile } from '../../../context/ProfileContext';
import { shouldViewAllDeskTickets } from '../../../services/desk/responsavelSegmentation';
import { useAuth } from '../../../context/AuthContext';
import { useNotifications } from '../../../context/NotificationContext';
import { getDeskDisplayName } from '../../../utils/userDisplayName';
import { htmlToPlainText, htmlHasComposeContent, normalizePlainToHtml, COMPOSE_IMAGE_MAX_BYTES } from '../../../services/desk/composeRichEditor';
import ComposeRichEditor from './ComposeRichEditor';
import ComposeFormatToolbar, { useComposeFormat } from './ComposeFormatToolbar';
import ComposeRefinarModal from './ComposeRefinarModal';
import { stripComposerOpening, wrapComposerOpeningForTicket, wrapComposerOpeningForTicketHtml } from '../../../services/desk/clientMessageEnvelope';
import { fetchActiveMacrosCached } from '../../../services/desk/macrosCache';
import {
  attachmentKindIcon,
  classifyAttachmentKind,
  downloadObjectUrl,
  loadAttachmentForPreview,
  shouldOpenPreviewModal,
} from '../../../services/desk/attachmentPreview';
import DeskAttachmentPreviewModal from './DeskAttachmentPreviewModal';

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

async function attachImageToEditor(editorRef, file, showNotification) {
  if (!file?.type?.startsWith('image/')) {
    showNotification('Selecione um arquivo de imagem (PNG, JPG, GIF ou WebP).', 'warning');
    return;
  }
  if (file.size > COMPOSE_IMAGE_MAX_BYTES) {
    showNotification('Imagem muito grande. Tamanho máximo: 4 MB.', 'warning');
    return;
  }
  try {
    const dataUrl = await readImageFileAsDataUrl(file);
    const inserted = editorRef.current?.insertImage?.(dataUrl, file.name);
    if (!inserted) {
      showNotification('Não foi possível inserir a imagem no editor.', 'warning');
    }
  } catch {
    showNotification('Não foi possível anexar a imagem.', 'error');
  }
}

export function DeskStatusCommitButton({
  sendStatus,
  onCommitStatus,
  variant = 'compose',
  disabled = false,
  menuDisabledReason = '',
  isOptionDisabled = null,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const { profileId } = useProfile();
  const { showNotification } = useNotifications();
  const sendStatusOptions = useMemo(() => {
    if (shouldViewAllDeskTickets(profileId)) return getSendStatusOptions('gestao');
    return getSendStatusOptions(profileId);
  }, [profileId]);
  const currentStatus = sendStatusOptions.find((o) => o.id === sendStatus) || sendStatusOptions[0];
  const triggerTitle = disabled
    ? (menuDisabledReason || 'Complete os requisitos antes de enviar')
    : undefined;

  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    if (disabled) setMenuOpen(false);
  }, [disabled]);

  const isPanel = variant === 'panel';

  return (
    <div
      className={'crm-send-status' + (isPanel ? ' crm-send-status--panel' : '') + (disabled ? ' crm-send-status--disabled' : '')}
      id="crmSendStatus"
      ref={menuRef}
    >
      <button
        type="button"
        className={
          (isPanel
            ? 'rp-footer-btn rp-footer-btn--primary crm-send-status__trigger-panel'
            : 'crm-send-status__trigger crm-send-status__trigger--' + currentStatus.cls)
          + (disabled ? ' is-disabled' : '')
        }
        id="crmStatusDropdown"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        aria-disabled={disabled}
        title={triggerTitle}
        onClick={() => {
          if (disabled) {
            showNotification(menuDisabledReason || 'Complete os requisitos antes de enviar.', 'warning');
            return;
          }
          setMenuOpen((v) => !v);
        }}
      >
        {isPanel ? (
          <>
            <i className="ti ti-send" />
            Enviar como
            <i className="ti ti-chevron-down" />
          </>
        ) : (
          <>
            {currentStatus.label} <i className="ti ti-chevron-down" />
          </>
        )}
      </button>
      <div className="crm-send-status__menu" id="crmStatusMenu" role="listbox" hidden={!menuOpen || disabled}>
        {sendStatusOptions.map((opt) => {
          const optionGate = typeof isOptionDisabled === 'function'
            ? isOptionDisabled(opt.id)
            : { disabled: false, reason: '' };
          const optionBlocked = disabled || optionGate.disabled;
          return (
            <button
              key={opt.id}
              type="button"
              className={'crm-send-status__option crm-send-status__option--' + opt.cls + (optionBlocked ? ' is-disabled' : '')}
              role="option"
              aria-disabled={optionBlocked}
              title={optionGate.reason || undefined}
              onClick={() => {
                if (optionBlocked) {
                  showNotification(
                    optionGate.reason || menuDisabledReason || 'Complete os requisitos antes de enviar.',
                    'warning',
                  );
                  return;
                }
                setMenuOpen(false);
                onCommitStatus(opt.id);
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** @deprecated use DeskStatusCommitButton */
export const DeskComposeFooter = DeskStatusCommitButton;

function ComposeMacrosMenu({ onSelect, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [macros, setMacros] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open || macros !== null) return;
    let cancelled = false;
    fetchActiveMacrosCached()
      .then((list) => { if (!cancelled) setMacros(list); })
      .catch(() => { if (!cancelled) setMacros([]); });
    return () => { cancelled = true; };
  }, [open, macros]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="crm-compose-bottom-bar__macros crm-macros-menu" ref={menuRef}>
      <button
        type="button"
        className="btn-secondary crm-compose-bottom-bar__ai crm-macros-menu__trigger"
        id="btnCrmMacros"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="crm-compose-bottom-bar__ai-label">Macros</span>
        <i className="ti ti-chevron-down" aria-hidden="true" />
      </button>
      <div className="crm-macros-menu__list" role="menu" aria-label="Decisões" hidden={!open}>
        {macros === null ? (
          <span className="crm-macros-menu__empty">Carregando…</span>
        ) : macros.length === 0 ? (
          <span className="crm-macros-menu__empty">Nenhuma macro cadastrada.</span>
        ) : macros.map((item) => (
          <button
            key={item._id}
            type="button"
            role="menuitem"
            className="crm-macros-menu__item"
            onClick={() => {
              setOpen(false);
              onSelect(item.texto);
            }}
          >
            {item.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

function ComposePendingAttachments({ items, onRemove, disabled = false }) {
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
      console.warn('[ComposePendingAttachments] anexo:', err?.message || err);
    } finally {
      setLoadingUrl('');
    }
  }, []);

  if (!items?.length) return null;
  return (
    <>
      <ul className="crm-compose-pending-attachments" aria-label="Anexos pendentes">
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

function ComposeBottomBar({
  formatToolbar,
  showAiAssistant = false,
  onOpenRefinar,
  onAttachFiles,
  attachUploading = false,
  attachDisabled = false,
  showSendInternalNote = false,
  onSendInternalNote,
  sendInternalNoteBusy = false,
  sendInternalNoteDisabled = false,
  onSelectMacro,
  overlay = false,
}) {
  const fileInputRef = useRef(null);

  const handleAttachClick = useCallback(() => {
    if (attachDisabled || attachUploading) return;
    fileInputRef.current?.click();
  }, [attachDisabled, attachUploading]);

  const handleFileChange = useCallback((event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length || !onAttachFiles) return;
    void onAttachFiles(files);
  }, [onAttachFiles]);

  return (
    <div
      className={
        'crm-compose-bottom-bar ticket-response-actions'
        + (overlay ? ' crm-compose-bottom-bar--overlay' : '')
      }
      role="group"
      aria-label="Ferramentas do compose"
    >
      {formatToolbar}
      {showAiAssistant || showSendInternalNote ? (
        <>
          <span className="crm-compose-bottom-bar__sep" aria-hidden="true" />
          <div className="crm-compose-bottom-bar__tools">
            {showAiAssistant ? (
              <>
                {onSelectMacro ? (
                  <ComposeMacrosMenu onSelect={onSelectMacro} disabled={attachDisabled} />
                ) : null}
                <button
                  type="button"
                  className="btn-secondary crm-compose-bottom-bar__attach"
                  id="btnCrmAttachFile"
                  aria-label="Anexar arquivo"
                  title="Anexar arquivo"
                  disabled={attachDisabled || attachUploading}
                  onClick={handleAttachClick}
                >
                  <i className="ti ti-paperclip" aria-hidden="true" />
                  <span className="crm-compose-bottom-bar__attach-label">
                    {attachUploading ? 'Enviando…' : 'Anexo'}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn-secondary crm-compose-bottom-bar__ai"
                  id="btnCrmTextReviewer"
                  aria-label="Revisor de Texto"
                  disabled={attachDisabled}
                  onClick={onOpenRefinar}
                >
                  <span className="crm-compose-bottom-bar__ai-label">Revisor de Texto</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="crm-compose-toolbar__file-input"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={handleFileChange}
                />
              </>
            ) : null}
            {showSendInternalNote ? (
              <>
                <button
                  type="button"
                  className="btn-secondary crm-compose-bottom-bar__attach crm-compose-bottom-bar__attach--layout-slot"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled
                >
                  <i className="ti ti-paperclip" aria-hidden="true" />
                  <span className="crm-compose-bottom-bar__attach-label">Anexo</span>
                </button>
                <button
                  type="button"
                  className="btn-secondary crm-compose-bottom-bar__ai"
                  id="btnCrmSendInternalNote"
                  aria-label="Enviar Nota"
                  title="Persistir anotação interna sem salvar tabulação"
                  disabled={sendInternalNoteDisabled || sendInternalNoteBusy}
                  onClick={onSendInternalNote}
                >
                  <span className="crm-compose-bottom-bar__ai-label">
                    {sendInternalNoteBusy ? 'Enviando…' : 'Enviar Nota'}
                  </span>
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function InternalNoteFields({
  ticketId,
  internalText,
  onInternalTextChange,
  placeholder = 'Digite uma anotação interna...',
  attachDisabled = false,
  showNotification,
  readOnly = false,
  onSendInternalNote,
  sendInternalNoteBusy = false,
  sendInternalNoteDisabled = false,
  includeBottomBar = true,
  overlayFooter = true,
  editorRef: externalEditorRef,
  onFormatStateChange,
}) {
  const tid = String(ticketId);
  const localEditorRef = useRef(null);
  const internalEditorRef = externalEditorRef || localEditorRef;

  const internalFormat = useComposeFormat({
    richEditorRef: internalEditorRef,
    mode: 'rich',
  });
  const internalFormatRef = useRef(internalFormat);
  internalFormatRef.current = internalFormat;

  const notifyInternalFormat = useCallback(() => {
    onFormatStateChange?.(internalFormatRef.current);
  }, [onFormatStateChange]);

  useEffect(() => {
    notifyInternalFormat();
  }, [notifyInternalFormat]);

  const handleInternalFormatStateChange = useCallback((state) => {
    internalFormatRef.current?.handleFormatStateChange?.(state);
    notifyInternalFormat();
  }, [notifyInternalFormat]);

  const handleInternalAttachImage = useCallback((file) => {
    void attachImageToEditor(internalEditorRef, file, showNotification);
  }, [showNotification]);

  const handleInternalChange = useCallback(({ html }) => {
    onInternalTextChange(html);
  }, [onInternalTextChange]);

  const handleInternalKeyDown = (event) => {
    internalFormat.handleKeyDown(event);
  };

  return (
    <div className={
      'crm-compose-editor-zone response-form internal-form crm-notes-compose__form'
      + (overlayFooter ? ' crm-compose-editor-zone--overlay-footer' : '')
    }>
      <div className="crm-notes-compose__header">
        <i className="fas fa-lock" aria-hidden="true" />
        <span>Nota interna — não enviada ao cliente</span>
      </div>
      <ComposeRichEditor
        ref={internalEditorRef}
        id={'internalResponse-' + tid}
        className="response-textarea crm-notes-compose__textarea"
        placeholder={placeholder}
        value={internalText}
        readOnly={readOnly}
        onFormatStateChange={handleInternalFormatStateChange}
        onChange={handleInternalChange}
        onKeyDown={handleInternalKeyDown}
      />
      {includeBottomBar ? (
      <ComposeBottomBar
        overlay
        showSendInternalNote={Boolean(onSendInternalNote) && !readOnly}
        onSendInternalNote={onSendInternalNote}
        sendInternalNoteBusy={sendInternalNoteBusy}
        sendInternalNoteDisabled={sendInternalNoteDisabled}
        formatToolbar={(
          <ComposeFormatToolbar
            applyAction={internalFormat.applyAction}
            activeFormats={internalFormat.activeFormats}
            variant="internal"
            embedded
            onImageSelected={handleInternalAttachImage}
            attachDisabled={attachDisabled || readOnly}
            beginLink={internalFormat.beginLink}
            applyLink={internalFormat.applyLink}
            removeLink={internalFormat.removeLink}
          />
        )}
      />
      ) : null}
    </div>
  );
}

export default function DeskComposePanel({
  ticketId,
  ticket = null,
  composeMode,
  composeText,
  internalText,
  composeAttachments = [],
  onComposeAttachmentsChange,
  onComposeModeChange,
  onComposeTextChange,
  onComposeReviewed,
  onInternalTextChange,
  variant = 'full',
  workflowLocked = false,
  internalComposeLocked = false,
  workflowTeamLabel = '',
  ticketReadOnly = false,
  onSendInternalNote,
  sendInternalNoteBusy = false,
  publicTabLabel = 'Resposta pública',
  internalTabLabel = 'Anotação interna',
  showClienteTab = false,
  clienteTabLabel = 'Mensagem Cliente',
  clienteText = '',
  onClienteTextChange,
}) {
  const tid = String(ticketId);
  const publicEditorRef = useRef(null);
  const internalEditorRef = useRef(null);
  const clienteEditorRef = useRef(null);
  const [internalFormatState, setInternalFormatState] = useState(null);
  const [clienteFormatState, setClienteFormatState] = useState(null);
  const useSharedBottomBar = variant === 'full';
  const composePlainText = useMemo(() => htmlToPlainText(composeText), [composeText]);
  const { user, colaborador } = useAuth();
  const { showNotification } = useNotifications();
  const [refinarOpen, setRefinarOpen] = useState(false);
  const [refinarDraft, setRefinarDraft] = useState('');
  const [attachUploading, setAttachUploading] = useState(false);
  const showPublic = variant === 'full' || variant === 'public-only';
  const showInternal = variant === 'full' || variant === 'internal-only';
  const showCliente = variant === 'full' && showClienteTab;
  const publicComposeLocked = Boolean(workflowLocked || ticketReadOnly);
  const internalLocked = Boolean(internalComposeLocked || ticketReadOnly);
  const publicLocked = publicComposeLocked;
  const sendInternalNoteDisabled = internalLocked || !htmlHasComposeContent(internalText) || sendInternalNoteBusy;

  const internalPlaceholder = ticketReadOnly
    ? 'Ticket fechado — anotações indisponíveis'
    : workflowLocked
      ? `Aguardando ${workflowTeamLabel || 'equipe'} • Você pode adicionar uma nota interna...`
      : 'Digite uma anotação interna...';
  const publicPlaceholder = ticketReadOnly
    ? 'Ticket fechado — resposta pública indisponível'
    : workflowLocked
      ? `Aguardando ${workflowTeamLabel || 'equipe'} • resposta pública indisponível`
      : 'Digite sua resposta ao cliente...';

  const nomeOperador = useMemo(
    () => String(getDeskDisplayName(user, colaborador) || '').trim(),
    [user, colaborador],
  );

  const publicFormat = useComposeFormat({
    richEditorRef: publicEditorRef,
    mode: 'rich',
  });

  const clienteFormat = useComposeFormat({
    richEditorRef: clienteEditorRef,
    mode: 'rich',
  });

  const handlePublicChange = useCallback(({ html }) => {
    onComposeTextChange(html);
  }, [onComposeTextChange]);

  const handleClienteChange = useCallback(({ html }) => {
    onClienteTextChange?.(html);
  }, [onClienteTextChange]);

  const handleClienteFormatStateChange = useCallback((formatState) => {
    setClienteFormatState(formatState);
  }, []);

  const handlePublicKeyDown = (event) => {
    publicFormat.handleKeyDown(event);
  };

  const handleOpenRefinar = () => {
    const texto = stripComposerOpening(composePlainText)
      .replace(/^\s*\[Anexo:[^\]]*\]\s*$/gim, '')
      .trim();
    if (!texto) {
      showNotification('Rascunho não localizado', 'warning');
      return;
    }
    setRefinarDraft(texto);
    setRefinarOpen(true);
  };

  const handleApplyRefinar = useCallback((plainText) => {
    // handleOpenRefinar já manda o Revisor de Texto trabalhar só no núcleo (sem a
    // saudação/apresentação) — precisa recolocar o envelope aqui, senão a resposta
    // revisada substitui o compose sem "Olá, {nome}... Eu sou {agente}...".
    const wrapped = wrapComposerOpeningForTicket({
      nucleo: plainText,
      ticket,
      agentName: nomeOperador,
    });
    const html = normalizePlainToHtml(wrapped);
    onComposeTextChange(html);
    onComposeReviewed?.(html);
  }, [onComposeTextChange, onComposeReviewed, ticket, nomeOperador]);

  const handleApplyMacro = useCallback((macroHtml) => {
    // macroHtml já é HTML rico (pode ter <a href> com links reais cadastrados na macro) — não
    // pode passar por normalizePlainToHtml, que trataria as quebras de linha da saudação como
    // texto puro; wrapComposerOpeningForTicketHtml já devolve a saudação em HTML (<br />).
    const wrapped = wrapComposerOpeningForTicketHtml({
      nucleoHtml: macroHtml,
      ticket,
      agentName: nomeOperador,
    });
    const html = normalizePlainToHtml(wrapped);
    onComposeTextChange(html);
    // Macro já é um texto pronto/revisado — libera o envio sem precisar passar pelo Revisor de Texto de novo.
    onComposeReviewed?.(html);
    showNotification('Macro aplicada à resposta.', 'success');
  }, [onComposeTextChange, onComposeReviewed, ticket, nomeOperador, showNotification]);

  const handlePublicAttachImage = useCallback((file) => {
    void attachImageToEditor(publicEditorRef, file, showNotification);
  }, [showNotification]);

  const handleInternalAttachImage = useCallback((file) => {
    void attachImageToEditor(internalEditorRef, file, showNotification);
  }, [showNotification]);

  const handleInternalFormatStateChange = useCallback((formatState) => {
    setInternalFormatState(formatState);
  }, []);

  const handleRemoveAttachment = useCallback((url) => {
    if (!onComposeAttachmentsChange) return;
    onComposeAttachmentsChange((composeAttachments || []).filter((item) => item.url !== url));
  }, [composeAttachments, onComposeAttachmentsChange]);

  const handleAttachFiles = useCallback(async (files) => {
    if (!onComposeAttachmentsChange || ticketReadOnly || publicLocked) return;
    const ticketKey = String(ticketId || '').trim();
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
      onComposeAttachmentsChange([...(composeAttachments || []), ...nextItems]);
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
    composeAttachments,
    onComposeAttachmentsChange,
    publicLocked,
    showNotification,
    ticketId,
    ticketReadOnly,
  ]);

  const sharedBottomBar = useSharedBottomBar ? (
    <ComposeBottomBar
      overlay
      showAiAssistant={composeMode === 'public' && !ticketReadOnly}
      onOpenRefinar={ticketReadOnly ? undefined : handleOpenRefinar}
      onAttachFiles={composeMode === 'public' && !(ticketReadOnly || publicLocked) ? handleAttachFiles : undefined}
      attachUploading={attachUploading}
      attachDisabled={publicLocked || ticketReadOnly}
      onSelectMacro={composeMode === 'public' && !(ticketReadOnly || publicLocked) ? handleApplyMacro : undefined}
      showSendInternalNote={composeMode === 'internal' && Boolean(onSendInternalNote) && !internalLocked}
      onSendInternalNote={onSendInternalNote}
      sendInternalNoteBusy={sendInternalNoteBusy}
      sendInternalNoteDisabled={sendInternalNoteDisabled}
      formatToolbar={composeMode === 'public' ? (
        <ComposeFormatToolbar
          applyAction={publicFormat.applyAction}
          activeFormats={publicFormat.activeFormats}
          variant="public"
          embedded
          onImageSelected={handlePublicAttachImage}
          attachDisabled={publicLocked || ticketReadOnly}
          beginLink={publicFormat.beginLink}
          applyLink={publicFormat.applyLink}
          removeLink={publicFormat.removeLink}
        />
      ) : composeMode === 'cliente' ? (
        <ComposeFormatToolbar
          applyAction={clienteFormat.applyAction}
          activeFormats={clienteFormat.activeFormats}
          variant="internal"
          embedded
          attachDisabled
          beginLink={clienteFormat.beginLink}
          applyLink={clienteFormat.applyLink}
          removeLink={clienteFormat.removeLink}
        />
      ) : (
        <ComposeFormatToolbar
          applyAction={internalFormatState?.applyAction}
          activeFormats={internalFormatState?.activeFormats}
          variant="internal"
          embedded
          onImageSelected={handleInternalAttachImage}
          attachDisabled={internalLocked}
          beginLink={internalFormatState?.beginLink}
          applyLink={internalFormatState?.applyLink}
          removeLink={internalFormatState?.removeLink}
        />
      )}
    />
  ) : null;

  return (
    <div className={
      'crm-ticket-compose'
      + (variant === 'internal-only' ? ' crm-ticket-compose--notes' : '')
      + (publicComposeLocked ? ' crm-ticket-compose--workflow-locked' : '')
      + (ticketReadOnly ? ' crm-ticket-compose--ticket-closed' : '')
    }>
      <div className="ticket-response octa-comment-panel crm-ticket-response">
        <div className="octa-comment-panel-row">
          <div className="octa-panel-box">
            {variant === 'full' ? (
            <div className="response-tabs octa-nav-tabs">
              <button
                type="button"
                className={'response-tab octa-nav-tab octa-tab-public' + (composeMode === 'public' ? ' active' : '')}
                data-compose="public"
                aria-disabled={publicComposeLocked}
                onClick={() => {
                  if (publicComposeLocked) {
                    showNotification(
                      ticketReadOnly
                        ? 'Ticket fechado — somente leitura.'
                        : 'Sem permissão para resposta pública neste ticket. Use a anotação interna.',
                      'warning',
                    );
                    return;
                  }
                  onComposeModeChange('public');
                }}
              >
                <i className="fas fa-envelope" /> {publicTabLabel}
              </button>
              {showCliente ? (
              <button
                type="button"
                className={'response-tab octa-nav-tab octa-tab-cliente' + (composeMode === 'cliente' ? ' active' : '')}
                data-compose="cliente"
                onClick={() => onComposeModeChange('cliente')}
              >
                <i className="fas fa-comment-dots" /> {clienteTabLabel}
              </button>
              ) : null}
              <button
                type="button"
                className={'response-tab octa-nav-tab octa-tab-internal' + (composeMode === 'internal' ? ' active' : '')}
                data-compose="internal"
                onClick={() => onComposeModeChange('internal')}
              >
                <i className="fas fa-edit" /> {internalTabLabel}
              </button>
            </div>
            ) : null}
            <div className={
              'crm-compose-tab-shell'
              + (useSharedBottomBar ? ' crm-compose-editor-zone crm-compose-editor-zone--overlay-footer' : '')
              + (useSharedBottomBar && composeMode === 'internal' ? ' internal-form' : '')
            }>
            <div className="response-content octa-response-panel-body">
              {showPublic ? (
              <div className={'response-tab-content' + (variant === 'full' && composeMode !== 'public' ? '' : ' active')} id={'public-' + tid}>
                <div className={
                  'crm-compose-editor-zone response-form'
                  + (useSharedBottomBar ? '' : ' crm-compose-editor-zone--overlay-footer')
                }>
                  <ComposeRichEditor
                    ref={publicEditorRef}
                    id={'publicResponse-' + tid}
                    className="response-textarea"
                    placeholder={publicPlaceholder}
                    value={composeText}
                    expandable
                    readOnly={ticketReadOnly || publicLocked}
                    onFormatStateChange={publicFormat.handleFormatStateChange}
                    onChange={handlePublicChange}
                    onKeyDown={handlePublicKeyDown}
                  />
                  <ComposePendingAttachments
                    items={composeAttachments}
                    onRemove={handleRemoveAttachment}
                    disabled={ticketReadOnly || publicLocked}
                  />
                  {useSharedBottomBar ? null : (
                  <ComposeBottomBar
                    overlay
                    showAiAssistant={!ticketReadOnly}
                    onOpenRefinar={ticketReadOnly ? undefined : handleOpenRefinar}
                    onAttachFiles={ticketReadOnly || publicLocked ? undefined : handleAttachFiles}
                    attachUploading={attachUploading}
                    attachDisabled={publicLocked || ticketReadOnly}
                    onSelectMacro={ticketReadOnly || publicLocked ? undefined : handleApplyMacro}
                    formatToolbar={(
                      <ComposeFormatToolbar
                        applyAction={publicFormat.applyAction}
                        activeFormats={publicFormat.activeFormats}
                        variant="public"
                        embedded
                        onImageSelected={handlePublicAttachImage}
                        attachDisabled={publicLocked || ticketReadOnly}
                        beginLink={publicFormat.beginLink}
                        applyLink={publicFormat.applyLink}
                        removeLink={publicFormat.removeLink}
                      />
                    )}
                  />
                  )}
                </div>
                <ComposeRefinarModal
                  open={refinarOpen}
                  onClose={() => setRefinarOpen(false)}
                  draftText={refinarDraft}
                  nomeOperador={nomeOperador}
                  onApply={handleApplyRefinar}
                  onReviewComplete={onComposeReviewed}
                />
              </div>
              ) : null}
              {showCliente ? (
              <div className={'response-tab-content' + (variant === 'full' && composeMode !== 'cliente' ? '' : ' active')} id={'cliente-' + tid}>
                <div className="crm-compose-editor-zone response-form">
                  <ComposeRichEditor
                    ref={clienteEditorRef}
                    id={'clienteMessage-' + tid}
                    className="response-textarea"
                    placeholder={ticketReadOnly ? 'Ticket fechado — indisponível' : 'Transcreva a mensagem do cliente...'}
                    value={clienteText}
                    expandable
                    readOnly={ticketReadOnly}
                    onFormatStateChange={handleClienteFormatStateChange}
                    onChange={handleClienteChange}
                  />
                </div>
              </div>
              ) : null}
              {showInternal ? (
              <div className={'response-tab-content' + (variant === 'full' && composeMode !== 'internal' ? '' : ' active')} id={'internal-' + tid}>
                <InternalNoteFields
                  ticketId={ticketId}
                  internalText={internalText}
                  onInternalTextChange={internalLocked ? () => {} : onInternalTextChange}
                  placeholder={internalPlaceholder}
                  showNotification={showNotification}
                  readOnly={internalLocked}
                  onSendInternalNote={onSendInternalNote}
                  sendInternalNoteBusy={sendInternalNoteBusy}
                  sendInternalNoteDisabled={sendInternalNoteDisabled}
                  includeBottomBar={!useSharedBottomBar}
                  overlayFooter={!useSharedBottomBar}
                  editorRef={useSharedBottomBar ? internalEditorRef : undefined}
                  onFormatStateChange={useSharedBottomBar ? handleInternalFormatStateChange : undefined}
                />
              </div>
              ) : null}
              {sharedBottomBar}
            </div>
            </div>
          </div>
        </div>
      </div>
      {ticketReadOnly ? (
        <div className="desk-workflow-compose-lock desk-workflow-compose-lock--ticket-closed" role="status">
          <i className="ti ti-lock" aria-hidden="true" />
          <span>Ticket fechado — somente leitura</span>
        </div>
      ) : publicComposeLocked ? (
        <div className="desk-workflow-compose-lock" role="status">
          <i className="ti ti-lock" aria-hidden="true" />
          <span>Sem permissão para resposta pública neste ticket • anotação interna disponível</span>
        </div>
      ) : null}
    </div>
  );
}
