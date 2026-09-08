/**
 * BcTicketSide — sidebar direita do ticket Bacen
 */
import React from 'react';
import { getStatusLabel } from '../../../services/especiais/bacenData';
import { formatBcDeadlineLabel } from '../../../services/especiais/bacenTicketService';
import { formatComplaintDate } from './bcTicketFormatters';
import BcClassificacaoFields from './BcClassificacaoFields';
import EspeciaisTicketSideFooter from '../shared/EspeciaisTicketSideFooter';

function formatLocal(value, uf) {
  const city = String(value || '').trim();
  const state = String(uf || '').trim();
  if (city && state) return `${city} / ${state}`;
  return city || state || '';
}

export default function BcTicketSide({
  bcItem,
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
}) {
  if (!bcItem) return null;

  const protocoloDisplay = bcItem.protocoloBacen ? `#${bcItem.protocoloBacen}` : '—';
  const deadlineLabel = formatBcDeadlineLabel(bcItem.prazoLegal);
  const localDisplay = formatLocal(bcItem.cidade, bcItem.uf);

  return (
    <aside className="ra-crm-side">
      <div className="ra-ticket__side">
        <section className="ra-ticket__side-card">
          <h2>BACEN — DADOS</h2>
          <span className={`ra-badge ra-badge--${bcItem.statusBc}`}>
            {getStatusLabel(bcItem.statusBc)}
          </span>
          <dl>
            <div>
              <dt>RDR</dt>
              <dd>{protocoloDisplay}</dd>
            </div>
            <div>
              <dt>Assunto</dt>
              <dd>{bcItem.assunto || '—'}</dd>
            </div>
            {bcItem.orgaoBacen ? (
              <div>
                <dt>Órgão Bacen</dt>
                <dd>{bcItem.orgaoBacen}</dd>
              </div>
            ) : null}
            {localDisplay ? (
              <div>
                <dt>Local</dt>
                <dd>{localDisplay}</dd>
              </div>
            ) : null}
            <div>
              <dt>Prazo de resposta</dt>
              <dd className="ra-ticket__deadline-value">{deadlineLabel}</dd>
            </div>
            <div>
              <dt>Data da demanda</dt>
              <dd>{formatComplaintDate(bcItem.prazoLegal)}</dd>
            </div>
            {bcItem.workflowAtivo ? (
              <div>
                <dt>Workflow</dt>
                <dd>{bcItem.workflow || 'Tratativa Bacen'}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <BcClassificacaoFields
          bcItem={bcItem}
          onClassificacaoDraftChange={onClassificacaoDraftChange}
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
        />
      </div>
    </aside>
  );
}
