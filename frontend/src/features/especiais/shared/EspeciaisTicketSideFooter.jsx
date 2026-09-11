/**
 * EspeciaisTicketSideFooter — Abrir conversa, Salvar ticket e Finalizar
 */
import React from 'react';

export default function EspeciaisTicketSideFooter({
  waChatOpen = false,
  onOpenChat,
  onCloseChat,
  onSave,
  onFinalize,
  saving = false,
  disabled = false,
  finalized = false,
  initialMessagePrompt = null,
}) {
  const actionsDisabled = disabled || saving;

  return (
    <div className="ra-ticket__side-footer">
      {initialMessagePrompt ? (
        <button
          type="button"
          className="especiais-initial-message-prompt__btn especiais-initial-message-prompt__btn--send"
          disabled={initialMessagePrompt.busy}
          onClick={() => initialMessagePrompt.onSend?.()}
        >
          <i className="ti ti-brand-whatsapp" aria-hidden="true" />
          {initialMessagePrompt.busy ? 'Enviando…' : 'Enviar Mensagem'}
        </button>
      ) : null}
      <button
        type="button"
        className={`rp-footer-btn rp-footer-btn--secondary${waChatOpen ? ' is-active' : ''}`}
        id="btnOpenChat"
        onClick={waChatOpen ? onCloseChat : onOpenChat}
      >
        <i className="ti ti-message-circle" aria-hidden="true" />
        {waChatOpen ? 'Fechar conversa' : 'Abrir conversa'}
      </button>
      <button
        type="button"
        className="ra-ticket__save-btn"
        onClick={onSave}
        disabled={actionsDisabled}
      >
        <i className="ti ti-device-floppy" aria-hidden="true" />
        {saving ? 'Salvando…' : 'Salvar ticket'}
      </button>
      <button
        type="button"
        className="ra-ticket__finalize-btn"
        onClick={onFinalize}
        disabled={actionsDisabled || finalized}
      >
        <i className="ti ti-circle-check" aria-hidden="true" />
        {saving ? 'Processando…' : 'Finalizar'}
      </button>
    </div>
  );
}
