/**
 * BcTicketSide — sidebar direita do ticket Bacen
 */
import React from 'react';
import { getStatusLabel } from '../../../services/especiais/bacenData';
import BcDadosFields from './BcDadosFields';
import BcClassificacaoFields from './BcClassificacaoFields';
import BcResponsavelCard from './BcResponsavelCard';
import EspeciaisTicketSideFooter from '../shared/EspeciaisTicketSideFooter';

export default function BcTicketSide({
  bcItem,
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
  onBcItemUpdated,
  initialMessagePrompt,
}) {
  if (!bcItem) return null;

  return (
    <aside className="ra-crm-side">
      <div className="ra-ticket__side">
        <section className="ra-ticket__side-card">
          <h2>BACEN — DADOS</h2>
          <span className={`ra-badge ra-badge--${bcItem.statusBc}`}>
            {getStatusLabel(bcItem.statusBc)}
          </span>
          <BcDadosFields bcItem={bcItem} onSaved={onBcItemUpdated} />
        </section>

        <BcClassificacaoFields
          bcItem={bcItem}
          onClassificacaoDraftChange={onClassificacaoDraftChange}
        />

        <BcResponsavelCard
          bcItem={bcItem}
          onSaved={onBcItemUpdated}
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
        />
      </div>
    </aside>
  );
}
