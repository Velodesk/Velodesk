/**
 * EspeciaisTicketSideFooter — Abrir conversa, Salvar ticket e Enviar como (status)
 */
import React from 'react';
import { DeskStatusCommitButton } from '../../desk/components/DeskComposePanel';

export default function EspeciaisTicketSideFooter({
  waChatOpen = false,
  onOpenChat,
  onCloseChat,
  onSave,
  sendStatus,
  onCommitStatus,
  saving = false,
  disabled = false,
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
      <DeskStatusCommitButton
        sendStatus={sendStatus}
        onCommitStatus={onCommitStatus}
        variant="panel"
        disabled={actionsDisabled}
        menuDisabledReason="Ticket fechado ou em processamento — aguarde."
      />
    </div>
  );
}
