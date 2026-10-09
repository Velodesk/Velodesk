/**
 * ComposeFormatToolbar v1.3.0 — remove o botão "Anexar imagem" (imagem inline no editor)
 * VERSION: v1.3.0 | DATE: 2026-10-09
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { applyFormatAction, resolveFormatShortcut } from '../../../services/desk/composeTextFormat';

const EMPTY_FORMAT_STATE = {
  bold: false,
  italic: false,
  underline: false,
  bulletList: false,
  numberedList: false,
};

const TOOLBAR_ACTIONS = [
  { id: 'bold', label: 'Negrito', icon: 'ti ti-bold', shortcut: 'Ctrl+B' },
  { id: 'italic', label: 'Itálico', icon: 'ti ti-italic', shortcut: 'Ctrl+I' },
  { id: 'underline', label: 'Sublinhado', icon: 'ti ti-underline', shortcut: 'Ctrl+U' },
  { id: 'bulletList', label: 'Lista com marcadores', icon: 'ti ti-list', shortcut: null },
  { id: 'numberedList', label: 'Lista numerada', icon: 'ti ti-list-numbers', shortcut: null },
];

function restoreSelection(textarea, selectionStart, selectionEnd) {
  if (!textarea) return;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
  });
}

export function useComposeFormat({
  textareaRef,
  richEditorRef,
  mode = 'rich',
  value,
  onValueChange,
}) {
  const [activeFormats, setActiveFormats] = useState(EMPTY_FORMAT_STATE);

  const handleFormatStateChange = useCallback((nextState) => {
    setActiveFormats({ ...EMPTY_FORMAT_STATE, ...nextState });
  }, []);

  const refreshFormatState = useCallback(() => {
    if (mode !== 'rich') return;
    const state = richEditorRef?.current?.getFormatState?.();
    if (state) setActiveFormats({ ...EMPTY_FORMAT_STATE, ...state });
  }, [mode, richEditorRef]);

  const applyAction = useCallback((action) => {
    if (mode === 'rich') {
      richEditorRef?.current?.execFormat(action);
      requestAnimationFrame(() => refreshFormatState());
      return;
    }
    const textarea = textareaRef?.current;
    if (!textarea) return;
    const result = applyFormatAction(
      value ?? '',
      textarea.selectionStart,
      textarea.selectionEnd,
      action,
    );
    onValueChange?.(result.value);
    restoreSelection(textarea, result.selectionStart, result.selectionEnd);
  }, [mode, richEditorRef, textareaRef, value, onValueChange, refreshFormatState]);

  const handleKeyDown = useCallback((event) => {
    const action = resolveFormatShortcut(event);
    if (!action) return false;
    event.preventDefault();
    applyAction(action);
    return true;
  }, [applyAction]);

  const beginLink = useCallback(() => {
    if (mode !== 'rich') return null;
    return richEditorRef?.current?.beginLink?.() || null;
  }, [mode, richEditorRef]);

  const applyLink = useCallback((context, url, label) => {
    if (mode !== 'rich') return false;
    const ok = richEditorRef?.current?.applyLink?.(context, url, label);
    requestAnimationFrame(() => refreshFormatState());
    return ok;
  }, [mode, richEditorRef, refreshFormatState]);

  const removeLink = useCallback((context) => {
    if (mode !== 'rich') return false;
    const ok = richEditorRef?.current?.removeLink?.(context);
    requestAnimationFrame(() => refreshFormatState());
    return ok;
  }, [mode, richEditorRef, refreshFormatState]);

  return {
    applyAction,
    handleKeyDown,
    activeFormats,
    handleFormatStateChange,
    refreshFormatState,
    beginLink,
    applyLink,
    removeLink,
  };
}

function ComposeLinkPopover({ beginLink, applyLink, removeLink, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(null);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [popoverPos, setPopoverPos] = useState(null);
  const [openToken, setOpenToken] = useState(0);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const urlInputRef = useRef(null);

  const updatePosition = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 6, left: rect.left, anchorTop: rect.top, anchorBottom: rect.bottom });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  // Depois de medir a altura real do popover, vira para cima do botão se não couber
  // abaixo (compose fica perto do fim da tela) e mantém dentro da largura da viewport.
  useLayoutEffect(() => {
    if (!open || !popoverPos) return;
    const el = popoverRef.current;
    if (!el) return;
    const popRect = el.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;

    let top = popoverPos.anchorBottom + 6;
    if (top + popRect.height > viewportH - 8) {
      top = Math.max(8, popoverPos.anchorTop - popRect.height - 6);
    }
    let left = popoverPos.left;
    if (left + popRect.width > viewportW - 8) {
      left = Math.max(8, viewportW - popRect.width - 8);
    }

    if (Math.abs(top - popoverPos.top) > 0.5 || Math.abs(left - popoverPos.left) > 0.5) {
      setPopoverPos((prev) => (prev ? { ...prev, top, left } : prev));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openToken]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => urlInputRef.current?.focus());
  }, [open]);

  if (!beginLink || !applyLink) return null;

  const handleTriggerClick = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const ctx = beginLink();
    setContext(ctx);
    setUrl(ctx?.href || '');
    setLabel(ctx?.label || '');
    updatePosition();
    setOpenToken((t) => t + 1);
    setOpen(true);
  };

  const handleApply = () => {
    if (!url.trim()) return;
    applyLink(context, url, label);
    setOpen(false);
  };

  const handleRemove = () => {
    removeLink?.(context);
    setOpen(false);
  };

  const handleFieldKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="crm-compose-toolbar__link-wrap" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="toolbar-btn crm-compose-toolbar__btn"
        title="Inserir link"
        aria-label="Inserir link"
        aria-haspopup="true"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleTriggerClick}
      >
        <i className="ti ti-link" aria-hidden="true" />
      </button>
      {open && popoverPos ? createPortal(
        <div
          ref={popoverRef}
          className="crm-compose-toolbar__link-popover crm-compose-toolbar__link-popover--floating"
          style={{ top: popoverPos.top, left: popoverPos.left }}
          role="dialog"
          aria-label="Inserir link"
        >
          <label className="crm-compose-toolbar__link-field">
            <span>Texto exibido</span>
            <input
              type="text"
              value={label}
              placeholder="Texto do link"
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={handleFieldKeyDown}
            />
          </label>
          <label className="crm-compose-toolbar__link-field">
            <span>URL</span>
            <input
              ref={urlInputRef}
              type="text"
              value={url}
              placeholder="https://exemplo.com"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleFieldKeyDown}
            />
          </label>
          <div className="crm-compose-toolbar__link-actions">
            {context?.anchor ? (
              <button type="button" className="crm-compose-toolbar__link-remove" onClick={handleRemove}>
                Remover link
              </button>
            ) : null}
            <button type="button" className="crm-compose-toolbar__link-cancel" onClick={() => setOpen(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="crm-compose-toolbar__link-apply"
              disabled={!url.trim()}
              onClick={handleApply}
            >
              Aplicar
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

export default function ComposeFormatToolbar({
  applyAction,
  activeFormats = EMPTY_FORMAT_STATE,
  variant = 'public',
  embedded = false,
  attachDisabled = false,
  beginLink,
  applyLink,
  removeLink,
}) {

  return (
    <div
      className={
        'crm-compose-toolbar response-toolbar'
        + (variant === 'internal' ? ' crm-compose-toolbar--internal' : '')
        + (embedded ? ' crm-compose-toolbar--embedded' : '')
      }
      role="toolbar"
      aria-label="Formatação de texto"
    >
      {TOOLBAR_ACTIONS.map((action, index) => (
        <React.Fragment key={action.id}>
          {index === 3 ? <span className="crm-compose-toolbar__sep" aria-hidden="true" /> : null}
          <button
            type="button"
            className={
              'toolbar-btn crm-compose-toolbar__btn'
              + (activeFormats[action.id] ? ' crm-compose-toolbar__btn--active' : '')
            }
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
            aria-label={action.label}
            aria-pressed={Boolean(activeFormats[action.id])}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyAction(action.id)}
          >
            <i className={action.icon} aria-hidden="true" />
          </button>
        </React.Fragment>
      ))}
      <ComposeLinkPopover
        beginLink={beginLink}
        applyLink={applyLink}
        removeLink={removeLink}
        disabled={attachDisabled}
      />
    </div>
  );
}
