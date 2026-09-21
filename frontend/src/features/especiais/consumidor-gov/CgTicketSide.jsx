/**
 * CgTicketSide — sidebar direita do ticket Consumidor.gov
 */
import React from 'react';
import { getStatusLabel } from '../../../services/especiais/consumidorGovData';
import CgDadosFields from './CgDadosFields';
import CgClassificacaoFields from './CgClassificacaoFields';
import CgResponsavelCard from './CgResponsavelCard';
import EspeciaisTicketSideFooter from '../shared/EspeciaisTicketSideFooter';

export default function CgTicketSide({
  cgItem,
  ticket,
  waChatOpen = false,
  onOpenChat,
  onCloseChat,
  onSave,
  onFinalize,
  saving = false,
  disabled = false,
  finalized = false,
  onClassificacaoDraftChange,
  onCgItemUpdated,
  initialMessagePrompt,
}) {
  if (!cgItem) return null;

  return (
    <aside className="ra-crm-side">
      <div className="ra-ticket__side">
        <section className="ra-ticket__side-card">
          <h2>CONSUMIDOR.GOV — DADOS</h2>
          <span className={`ra-badge ra-badge--${cgItem.statusGov}`}>
            {getStatusLabel(cgItem.statusGov)}
          </span>
          <CgDadosFields cgItem={cgItem} onSaved={onCgItemUpdated} />
        </section>

        <CgClassificacaoFields
          cgItem={cgItem}
          onClassificacaoDraftChange={onClassificacaoDraftChange}
        />

        <CgResponsavelCard
          cgItem={cgItem}
          onSaved={onCgItemUpdated}
        />

        <EspeciaisTicketSideFooter
          waChatOpen={waChatOpen}
          onOpenChat={onOpenChat}
          onCloseChat={onCloseChat}
          onSave={onSave}
          onFinalize={onFinalize}
          saving={saving}
          disabled={disabled}
          finalized={finalized}
          initialMessagePrompt={initialMessagePrompt}
        />
      </div>
    </aside>
  );
}
