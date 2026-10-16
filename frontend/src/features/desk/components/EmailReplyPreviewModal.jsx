/**
 * EmailReplyPreviewModal v1.0.0 — mostra a resposta do agente como o cliente recebe no e-mail:
 * cabeçalho de leitor de e-mail (assunto, de, para, data) + o HTML real do template, montado no
 * servidor pelo mesmo caminho do envio (POST /email-outbound/preview-reply). Só leitura.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { emailOutboundApi } from '../../../api/client';

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function attachmentName(url) {
  const raw = String(url || '').split('?')[0];
  const last = raw.split('/').pop() || raw;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export default function EmailReplyPreviewModal({ open, onClose, ticketId, message }) {
  const [state, setState] = useState({ loading: false, error: '', data: null });
  const attachments = Array.isArray(message?.attachments) ? message.attachments.filter(Boolean) : [];

  useEffect(() => {
    if (!open || !ticketId || !message) return undefined;
    let cancelled = false;
    setState({ loading: true, error: '', data: null });
    emailOutboundApi.previewReply({
      ticketId: String(ticketId),
      text: message.text || '',
      hasAttachments: attachments.length > 0,
    })
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: '', data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.response?.data?.message || 'Não foi possível montar a prévia do e-mail.',
          data: null,
        });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ticketId, message]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const { loading, error, data } = state;

  return createPortal(
    <div
      className="email-preview__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="email-preview" role="dialog" aria-modal="true" aria-labelledby="emailPreviewTitle">
        <header className="email-preview__top">
          <div>
            <h2 id="emailPreviewTitle">Visualização do e-mail</h2>
            <p>Como o cliente recebe esta resposta</p>
          </div>
          <button type="button" className="email-preview__close" onClick={onClose} aria-label="Fechar visualização">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <section className="email-preview__envelope" aria-label="Dados do e-mail">
          <h3 className="email-preview__subject">{data?.subject || 'Atendimento Velotax'}</h3>
          <div className="email-preview__from-row">
            <span className="email-preview__avatar" aria-hidden="true">V</span>
            <div className="email-preview__parties">
              <p><strong>Velotax</strong>{data?.from ? <span className="email-preview__addr"> &lt;{data.from}&gt;</span> : null}</p>
              <p className="email-preview__to">para {data?.to || 'o cliente'}</p>
            </div>
            {message?.timestamp ? (
              <time className="email-preview__date">{formatDateTime(message.timestamp)}</time>
            ) : null}
          </div>
          {attachments.length ? (
            <ul className="email-preview__attachments" aria-label="Anexos">
              {attachments.map((url) => (
                <li key={url}>
                  <i className="ti ti-paperclip" aria-hidden="true" />
                  {attachmentName(url)}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <div className="email-preview__body">
          {loading ? (
            <p className="email-preview__state"><i className="ti ti-loader-2 email-preview__spin" aria-hidden="true" /> Montando o e-mail…</p>
          ) : error ? (
            <p className="email-preview__state is-error">{error}</p>
          ) : data?.html ? (
            <iframe
              className="email-preview__frame"
              title="Conteúdo do e-mail enviado ao cliente"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={data.html}
            />
          ) : null}
        </div>

        <p className="email-preview__note">
          Montado com o template atual de e-mail. O visual final pode variar conforme o aplicativo de e-mail do cliente.
        </p>
      </div>
    </div>,
    document.body,
  );
}
