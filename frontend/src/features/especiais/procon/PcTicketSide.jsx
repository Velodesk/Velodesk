/**
 * PcTicketSide — sidebar direita do ticket Procon
 */
import React from 'react';
import { getStatusLabel } from '../../../services/especiais/proconData';
import { formatPcDeadlineLabel } from '../../../services/especiais/proconTicketService';
import { formatComplaintDate } from './pcTicketFormatters';
import PcClassificacaoFields from './PcClassificacaoFields';
import PcResponsavelCard from './PcResponsavelCard';
import EspeciaisTicketSideFooter from '../shared/EspeciaisTicketSideFooter';

function formatLocal(value, uf) {
  const city = String(value || '').trim();
  const state = String(uf || '').trim();
  if (city && state) return `${city} / ${state}`;
  return city || state || '';
}

export default function PcTicketSide({
  pcItem,
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
  onPcItemUpdated,
  initialMessagePrompt,
}) {
  if (!pcItem) return null;

  const protocoloDisplay = pcItem.protocoloProcon ? `#${pcItem.protocoloProcon}` : '—';
  const deadlineLabel = formatPcDeadlineLabel(pcItem.prazoLegal);
  const localDisplay = formatLocal(pcItem.cidade, pcItem.uf);

  return (
    <aside className="ra-crm-side">
      <div className="ra-ticket__side">
        <section className="ra-ticket__side-card">
          <h2>PROCON — DADOS</h2>
          <span className={`ra-badge ra-badge--${pcItem.statusPc}`}>
            {getStatusLabel(pcItem.statusPc)}
          </span>
          <dl>
            <div>
              <dt>Protocolo Procon</dt>
              <dd>{protocoloDisplay}</dd>
            </div>
            {pcItem.idDemanda ? (
              <div>
                <dt>ID da demanda</dt>
                <dd>{pcItem.idDemanda}</dd>
              </div>
            ) : null}
            <div>
              <dt>Assunto</dt>
              <dd>{pcItem.assunto || '—'}</dd>
            </div>
            {pcItem.orgaoProcon ? (
              <div>
                <dt>Órgão Procon</dt>
                <dd>{pcItem.orgaoProcon}</dd>
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
              <dd>{formatComplaintDate(pcItem.dataDemanda)}</dd>
            </div>
            {pcItem.workflowAtivo ? (
              <div>
                <dt>Workflow</dt>
                <dd>{pcItem.workflow || 'Tratativa Procon'}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <PcClassificacaoFields
          pcItem={pcItem}
          onClassificacaoDraftChange={onClassificacaoDraftChange}
        />

        <PcResponsavelCard
          pcItem={pcItem}
          onSaved={onPcItemUpdated}
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
