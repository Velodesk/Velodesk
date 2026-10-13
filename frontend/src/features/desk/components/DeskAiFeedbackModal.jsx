/**
 * DeskAiFeedbackModal v1.0.0 — Área de IA: feedback do operador ao reprovar a sugestão
 * VERSION: v1.0.0 | DATE: 2026-10-02
 * — Enviar: grava o feedback para aprendizado da IA (agent_feedback).
 * — Gerar: pede uma nova resposta à IA com base no feedback digitado.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function DeskAiFeedbackModal({
  open,
  auditScore,
  onClose,
  onSend,
  onGenerate,
  busyAction = null,
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const busy = Boolean(busyAction);

  // Limpa e foca apenas na abertura (mesmo motivo do DeskAiRevisionModal:
  // re-renders do Desk não podem apagar o texto durante a digitação).
  useEffect(() => {
    if (!open) return undefined;
    setInput('');
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, busy]);

  if (!open) return null;

  const trimmed = input.trim();

  const run = async (action) => {
    if (!trimmed || busy) return;
    const result = await action(trimmed);
    if (result?.success) {
      setInput('');
      onClose();
    }
  };

  return createPortal(
    <>
      <button
        type="button"
        className="queue-box-modal__backdrop"
        aria-label="Fechar feedback da IA"
        onClick={() => !busy && onClose()}
      />
      <div
        className="queue-box-modal desk-ai-revision-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deskAiFeedbackTitle"
      >
        <header className="queue-box-modal__header">
          <div className="queue-box-modal__head-main">
            <span className="queue-box-modal__icon" aria-hidden="true">
              <i className="ti ti-message-report" />
            </span>
            <div>
              <h2 className="queue-box-modal__title" id="deskAiFeedbackTitle">
                Feedback da resposta
              </h2>
              {typeof auditScore === 'number' && (
                <p className="queue-box-modal__subtitle desk-ai-revision-modal__score">
                  Conformidade atual: <strong>{auditScore}%</strong>
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="queue-box-modal__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Fechar"
          >
            <i className="ti ti-x" />
          </button>
        </header>

        <form onSubmit={(e) => { e.preventDefault(); run(onSend); }}>
          <div className="queue-box-modal__body">
            <p className="desk-ai-revision-modal__hint">
              Descreva a correção da resposta sugerida. Enviar registra o feedback para o aprendizado da IA;
              Gerar cria uma nova resposta com base nele.
            </p>
            <textarea
              ref={inputRef}
              className="desk-ai-revision-modal__input"
              rows={5}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex.: O cliente perguntou sobre prazo de 5 dias, não 3."
              disabled={busy}
            />
          </div>
          <footer className="queue-box-modal__footer desk-ai-revision-modal__actions">
            <button
              type="button"
              className="btn-secondary queue-box-modal__btn"
              onClick={() => run(onGenerate)}
              disabled={busy || !trimmed}
            >
              {busyAction === 'gerar' ? 'Gerando…' : 'Gerar'}
            </button>
            <button
              type="submit"
              className="btn-primary queue-box-modal__btn"
              disabled={busy || !trimmed}
            >
              {busyAction === 'enviar' ? 'Enviando…' : 'Enviar'}
            </button>
          </footer>
        </form>
      </div>
    </>,
    document.body
  );
}
