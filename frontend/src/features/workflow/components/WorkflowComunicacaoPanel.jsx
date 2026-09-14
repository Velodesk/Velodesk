/**
 * WorkflowComunicacaoPanel — thread inline entre workflow e responsável
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  loadComunicacaoWorkflowForTicket,
  readTicketComunicacaoWorkflow,
} from '../../../services/workflow/workflowDecisionHandlers';

function formatMsgTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function scrollThreadToEnd(listRef) {
  requestAnimationFrame(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  });
}

export default function WorkflowComunicacaoPanel({
  ticket,
  responsibleAgent,
  busy = false,
  onSubmit,
  readOnly = false,
}) {
  const [message, setMessage] = useState('');
  const [thread, setThread] = useState([]);
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [awaitingSignalDismissed, setAwaitingSignalDismissed] = useState(false);
  const listRef = useRef(null);
  const textareaRef = useRef(null);
  const ticketId = ticket?.id || ticket?._id;

  const lastMessage = thread[thread.length - 1];
  const lastMessageKey = lastMessage ? `${lastMessage.data || ''}|${lastMessage.mensagem || ''}` : '';
  // Última mensagem sem prefixo "WF:" = enviada pelo responsável do ticket, aguardando resposta do time de workflow.
  const awaitingWorkflowReply = Boolean(lastMessage) && !String(lastMessage.autor || '').startsWith('WF:');
  const showAwaitingSignal = awaitingWorkflowReply && !awaitingSignalDismissed;

  useEffect(() => {
    setAwaitingSignalDismissed(false);
  }, [lastMessageKey]);

  useEffect(() => {
    if (!ticketId) return undefined;

    let cancelled = false;
    setThread(readTicketComunicacaoWorkflow(ticket));
    setLoadingThread(true);

    void loadComunicacaoWorkflowForTicket(ticketId)
      .then((result) => {
        if (cancelled) return;
        setThread(result.thread || []);
        scrollThreadToEnd(listRef);
      })
      .catch(() => {
        /* mantém cache local */
      })
      .finally(() => {
        if (!cancelled) setLoadingThread(false);
      });

    return () => { cancelled = true; };
  }, [ticketId, ticket]);

  useEffect(() => {
    if (sending || loadingThread) return;
    const next = readTicketComunicacaoWorkflow(ticket);
    if (!next.length) return;
    setThread((prev) => (next.length >= prev.length ? next : prev));
  }, [ticket, sending, loadingThread]);

  useEffect(() => {
    scrollThreadToEnd(listRef);
  }, [thread.length]);

  const locked = busy || sending;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || locked) return;

    const optimistic = {
      mensagem: trimmed,
      data: new Date().toISOString(),
      autor: 'WF: você',
      _optimistic: true,
    };
    setThread((prev) => [...prev, optimistic]);
    setMessage('');
    setSending(true);
    scrollThreadToEnd(listRef);

    try {
      const updated = await onSubmit?.(trimmed);
      if (updated) {
        setThread(readTicketComunicacaoWorkflow(updated));
      } else if (ticketId) {
        const refreshed = await loadComunicacaoWorkflowForTicket(ticketId);
        setThread(refreshed.thread || []);
      }
    } catch {
      setThread((prev) => prev.filter((item) => !item._optimistic));
      setMessage(trimmed);
    } finally {
      setSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  return (
    <aside
      className={'wf-approval-comunicacao-panel' + (showAwaitingSignal ? ' is-awaiting-reply' : '')}
      aria-label="Comunicação com responsável"
    >
      <header className="wf-approval-comunicacao-panel__head">
        <h3>Comunicação</h3>
        <p>com {responsibleAgent || 'responsável do ticket'}</p>
        {showAwaitingSignal ? (
          <p className="wf-approval-comunicacao-panel__awaiting-badge">
            <i className="ti ti-clock" aria-hidden="true" />
            Aguardando resposta do agente de workflow
          </p>
        ) : null}
      </header>

      <div className="wf-approval-comunicacao-panel__thread" ref={listRef}>
        {loadingThread && thread.length === 0 ? (
          <p className="wf-approval-comunicacao-panel__empty">Carregando mensagens…</p>
        ) : thread.length === 0 ? (
          <p className="wf-approval-comunicacao-panel__empty">Nenhuma mensagem ainda.</p>
        ) : (
          thread.map((item, index) => {
            const isWf = String(item.autor || '').startsWith('WF:');
            return (
              <article
                key={`${item.data || index}-${index}`}
                className={
                  'wf-approval-comunicacao-panel__msg'
                  + (isWf ? ' is-wf' : ' is-resp')
                  + (item._optimistic ? ' is-pending' : '')
                }
              >
                <header>
                  <strong>{item.autor || '—'}</strong>
                  <time>{formatMsgTime(item.data)}</time>
                </header>
                <p>{item.mensagem}</p>
              </article>
            );
          })
        )}
      </div>

      {readOnly ? null : (
      <form className="wf-approval-comunicacao-panel__form" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          rows={2}
          value={message}
          disabled={locked}
          placeholder="Escreva para o responsável do ticket…"
          onChange={(e) => setMessage(e.target.value)}
          onFocus={() => setAwaitingSignalDismissed(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
        />
        <button
          type="submit"
          className="wf-approval-comunicacao-panel__send"
          disabled={locked || !message.trim()}
        >
          <i className="ti ti-send" aria-hidden="true" />
          {sending ? 'Enviando…' : 'Enviar'}
        </button>
      </form>
      )}
    </aside>
  );
}
