/**
 * DeskInternalNotesPanel v1.5.0 — somente notas internas (registros → aba Eventos)
 * VERSION: v1.5.0 | DATE: 2026-07-28
 */
import React, { useMemo, useEffect, useState } from 'react';
import {
  buildInternalNotesOnlyFeed,
  formatInternalNoteTimestamp,
} from '../../../services/desk/utils';
import {
  isSameTicketNote,
  NoteAvatar,
} from './DeskNoteCardParts';
import { MessageBubbleText } from './DeskConversation';

export default function DeskInternalNotesPanel({ ticket, client }) {
  const [infoRevision, setInfoRevision] = useState(0);

  useEffect(() => {
    const onInfoChanged = () => setInfoRevision((value) => value + 1);
    window.addEventListener('velodesk:workflow-info-changed', onInfoChanged);
    return () => window.removeEventListener('velodesk:workflow-info-changed', onInfoChanged);
  }, []);

  const notes = useMemo(
    () => buildInternalNotesOnlyFeed(ticket),
    [ticket, infoRevision],
  );

  if (!notes.length) {
    return (
      <div className="crm-internal-notes crm-internal-notes--empty">
        <p>Nenhuma nota interna registrada.</p>
      </div>
    );
  }

  return (
    <div className="crm-internal-notes">
      {notes.map((note, index) => (
        <React.Fragment key={note.id}>
          {index > 0 ? <hr className="crm-note-card__divider" aria-hidden="true" /> : null}
          <article className={`crm-note-card crm-note-card--${note.kind}`}>
            <div className="crm-note-card__accent" aria-hidden="true" />
            <div className="crm-note-card__inner">
              <header className="crm-note-card__head">
                <div className="crm-note-card__head-left">
                  <NoteAvatar note={note} />
                  <div className="crm-note-card__meta">
                    <strong className="crm-note-card__author">{note.badge}</strong>
                    <span className={`crm-note-card__badge crm-note-card__badge--${note.kind}`}>
                      {note.author}
                    </span>
                  </div>
                </div>
                <time className="crm-note-card__time" dateTime={note.timestamp}>
                  {formatInternalNoteTimestamp(note.timestamp)}
                </time>
              </header>
              {note.ticketTitle && !isSameTicketNote(note, ticket) ? (
                <p className="crm-note-card__ticket-ref">
                  Ticket #{note.ticketId} · {note.ticketTitle}
                </p>
              ) : null}
              <MessageBubbleText
                text={note.body}
                attachments={note.attachments}
                messageOrigin="agente"
                messageType="internal"
              />
              {note.tags?.length ? (
                <div className="crm-note-card__tags">
                  {note.tags.map((tag) => (
                    <span key={tag} className="crm-note-card__tag">{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </article>
        </React.Fragment>
      ))}
    </div>
  );
}
