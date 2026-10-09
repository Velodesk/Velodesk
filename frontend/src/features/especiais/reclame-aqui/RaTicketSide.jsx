/**
 * RaTicketSide — sidebar direita do ticket RA
 */
import React from 'react';
import { getStatusLabel } from '../../../services/especiais/reclameAquiData';
import RaDadosEditableFields from './RaDadosEditableFields';
import { formatComplaintDate } from './raTicketFormatters';
import RaClassificacaoFields from './RaClassificacaoFields';
import RaNotaContatoCard from './RaNotaContatoCard';
import RaResponsavelCard from './RaResponsavelCard';
import RaRelatedTicketsCard from './RaRelatedTicketsCard';
import EspeciaisTicketSideFooter from '../shared/EspeciaisTicketSideFooter';

export default function RaTicketSide({
  raItem,
  ticket,
  waChatOpen = false,
  onOpenChat,
  onCloseChat,
  onSave,
  onFinalize,
  sendStatus,
  onCommitStatus,
  saving = false,
  disabled = false,
  finalized = false,
  onClassificacaoDraftChange,
  onRaItemUpdated,
  initialMessagePrompt = null,
}) {
  if (!raItem) return null;

  // Data em que o ticket entrou na caixa de atendimento (criação do ticket).
  const dataTicket = ticket?.createdAt || raItem.createdAt;

  return (
    <aside className="ra-crm-side">
      <div className="ra-ticket__side">
        <section className="ra-ticket__side-card">
          <h2>RECLAME AQUI — DADOS</h2>
          <span className={`ra-badge ra-badge--${raItem.statusRa}`}>
            {getStatusLabel(raItem.statusRa)}
          </span>
          <dl>
            <RaDadosEditableFields raItem={raItem} onSaved={onRaItemUpdated} />
            <div>
              <dt>Data do Ticket</dt>
              <dd>{dataTicket ? formatComplaintDate(dataTicket) : '—'}</dd>
            </div>
            {raItem.workflowAtivo ? (
              <div>
                <dt>Workflow</dt>
                <dd>{raItem.workflow || 'Tratativa RA'}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <RaClassificacaoFields
          raItem={raItem}
          onClassificacaoDraftChange={onClassificacaoDraftChange}
        />

        <RaNotaContatoCard
          raItem={raItem}
          onSaved={onRaItemUpdated}
        />

        <RaResponsavelCard
          raItem={raItem}
          onSaved={onRaItemUpdated}
        />

        <RaRelatedTicketsCard
          raItem={raItem}
          onSaved={onRaItemUpdated}
        />

        <EspeciaisTicketSideFooter
          waChatOpen={waChatOpen}
          onOpenChat={onOpenChat}
          onCloseChat={onCloseChat}
          onSave={onSave}
          onFinalize={onFinalize}
          sendStatus={sendStatus}
          onCommitStatus={onCommitStatus}
          saving={saving}
          disabled={disabled}
          finalized={finalized}
          initialMessagePrompt={initialMessagePrompt}
          showSave={false}
        />
      </div>
    </aside>
  );
}
