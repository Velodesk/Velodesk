/**
 * PcTicketSide — sidebar direita do ticket Procon
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchDemanda } from '../../../services/especiais/proconStore';
import { getStatusLabel } from '../../../services/especiais/proconData';
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

/** Converte ISO -> valor aceito por <input type="datetime-local"> (hora local). */
function toDatetimeLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PcTicketSide({
  pcItem,
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
  onPcItemUpdated,
  initialMessagePrompt,
}) {
  const { showNotification } = useNotifications();
  const [editingData, setEditingData] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [dataDemanda, setDataDemanda] = useState(pcItem?.dataDemanda || '');

  useEffect(() => {
    setEditingData(false);
    setDataDemanda(pcItem?.dataDemanda || '');
  }, [pcItem?.id]);

  if (!pcItem) return null;

  const handleDataDemandaChange = async (raw) => {
    const iso = raw ? new Date(raw).toISOString() : '';
    setDataDemanda(iso);
    if (iso === (pcItem.dataDemanda || '') || !pcItem.id || savingData) return;
    setSavingData(true);
    try {
      const updated = await reclamacoesApi.patch('procon', pcItem.id, {
        dataReclamacao: iso || null,
        updatedAt: pcItem.updatedAt,
      });
      const merged = { ...pcItem, ...updated, dataDemanda: iso || null };
      // Grava no store local antes do reload disparado por onPcItemUpdated — sem isso,
      // o reload relê o item obsoleto do cache e reverte a data recém-salva.
      patchDemanda(merged);
      onPcItemUpdated?.(merged);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível salvar.';
      showNotification(msg, 'error');
    } finally {
      setSavingData(false);
    }
  };

  const protocoloDisplay = pcItem.protocoloProcon ? `#${pcItem.protocoloProcon}` : '—';
  // Data em que o ticket entrou na caixa de atendimento (criação do ticket).
  const dataTicket = ticket?.createdAt || pcItem.createdAt;
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
              <dt>Data do Ticket</dt>
              <dd>{dataTicket ? formatComplaintDate(dataTicket) : '—'}</dd>
            </div>
            <div>
              <dt>Data da demanda</dt>
              {editingData ? (
                <dd>
                  <input
                    type="datetime-local"
                    className="ra-registro__input"
                    autoFocus
                    value={toDatetimeLocalInput(dataDemanda)}
                    onChange={(e) => handleDataDemandaChange(e.target.value)}
                    onBlur={() => setEditingData(false)}
                    disabled={savingData}
                  />
                </dd>
              ) : (
                <dd className="ra-dados-editable-value">
                  <span>{formatComplaintDate(pcItem.dataDemanda)}</span>
                  <button
                    type="button"
                    className="ra-dados-edit-btn"
                    aria-label="Editar data da demanda"
                    onClick={() => setEditingData(true)}
                  >
                    <i className="ti ti-pencil" aria-hidden="true" />
                  </button>
                </dd>
              )}
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
