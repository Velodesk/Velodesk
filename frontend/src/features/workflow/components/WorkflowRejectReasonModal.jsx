/**
 * WorkflowRejectReasonModal v1.1.0 — remove subtítulo explicativo e contador de caracteres
 * VERSION: v1.1.0 | DATE: 2026-09-16
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const MIN_CHARS = 10;

export default function WorkflowRejectReasonModal({
  open,
  busy = false,
  onClose,
  onConfirm,
}) {
  const [motivo, setMotivo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setMotivo('');
    setSubmitting(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy && !submitting) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, submitting, onClose]);

  if (!open) return null;

  const locked = busy || submitting;
  const trimmed = motivo.trim();
  const canConfirm = trimmed.length >= MIN_CHARS && !locked;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm?.(trimmed);
    } finally {
      setSubmitting(false);
    }
  };

  const modal = (
    <div className="wf-comunicacao-modal__backdrop" role="presentation" onClick={() => !locked && onClose?.()}>
      <div
        className="wf-comunicacao-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-reject-reason-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="wf-comunicacao-modal__head">
          <div>
            <h2 id="wf-reject-reason-title">Motivo da reprovação</h2>
          </div>
          <button
            type="button"
            className="wf-comunicacao-modal__close"
            aria-label="Fechar"
            disabled={locked}
            onClick={onClose}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <form className="wf-comunicacao-modal__form" onSubmit={handleSubmit}>
          <label htmlFor="wf-reject-reason-input">Motivo</label>
          <textarea
            id="wf-reject-reason-input"
            ref={textareaRef}
            rows={4}
            value={motivo}
            disabled={locked}
            placeholder="Explique por que esta solicitação está sendo reprovada…"
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="wf-comunicacao-modal__actions">
            <button type="button" className="wf-comunicacao-modal__btn wf-comunicacao-modal__btn--ghost" disabled={locked} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="wf-comunicacao-modal__btn wf-comunicacao-modal__btn--primary" disabled={!canConfirm}>
              <i className="ti ti-x" aria-hidden="true" />
              {submitting ? 'Reprovando…' : 'Confirmar negativa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
