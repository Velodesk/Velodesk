/**
 * RaDadosEditableFields — ID Reclame Aqui, Assunto e Prazo de resposta editáveis no DADOS
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchReclamacao } from '../../../services/especiais/reclameAquiStore';
import { formatRaDeadlineLabel } from '../../../services/especiais/reclameAquiTicketService';
import { formatComplaintDate } from './raTicketFormatters';

/** Converte ISO -> valor aceito por <input type="datetime-local"> (hora local). */
function toDatetimeLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Só o cadastro manual permite corrigir a data — tickets do HugMe já trazem a data real da planilha. */
function isManuallyCreatedRaTicket(raItem) {
  return raItem?.origemEntrada === 'reclamacoes-manual';
}

export default function RaDadosEditableFields({ raItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [saving, setSaving] = useState(false);
  const [idReclamacaoRa, setIdReclamacaoRa] = useState(raItem?.idReclamacaoRa || '');
  const [assunto, setAssunto] = useState(raItem?.assunto || '');
  const [prazoRa, setPrazoRa] = useState(raItem?.prazoRa || '');
  const [dataReclamacao, setDataReclamacao] = useState(raItem?.dataReclamacao || '');
  const [editingDataReclamacao, setEditingDataReclamacao] = useState(false);

  useEffect(() => {
    setIdReclamacaoRa(raItem?.idReclamacaoRa || '');
    setAssunto(raItem?.assunto || '');
    setPrazoRa(raItem?.prazoRa || '');
    setDataReclamacao(raItem?.dataReclamacao || '');
    setEditingDataReclamacao(false);
  }, [raItem?.id]);

  if (!raItem) return null;

  const manual = isManuallyCreatedRaTicket(raItem);

  const patchFields = async (patch) => {
    if (!raItem?.id || saving) return;
    setSaving(true);
    try {
      const updated = await reclamacoesApi.patch('reclame-aqui', raItem.id, patch);
      const merged = { ...raItem, ...updated };
      // Grava no store local antes do reload disparado por onSaved — sem isso, o reload
      // relê o item obsoleto do cache e reverte o campo recém-salvo.
      patchReclamacao(merged);
      onSaved?.(merged);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível salvar.';
      showNotification(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleIdBlur = () => {
    const value = idReclamacaoRa.trim();
    if (value === (raItem.idReclamacaoRa || '')) return;
    patchFields({ protocoloExterno: value, idDemandaExterna: value });
  };

  const handleAssuntoBlur = () => {
    const value = assunto.trim();
    if (value === (raItem.assunto || '')) return;
    patchFields({ assunto: value });
  };

  const handlePrazoChange = (raw) => {
    const iso = raw ? new Date(raw).toISOString() : '';
    setPrazoRa(iso);
    patchFields({ prazoLegal: iso || null });
  };

  const handleDataReclamacaoChange = (raw) => {
    const iso = raw ? new Date(raw).toISOString() : '';
    setDataReclamacao(iso);
    patchFields({ dataReclamacao: iso || null });
  };

  return (
    <>
      <div>
        <dt>ID Reclame Aqui</dt>
        {manual ? (
          <dd>
            <input
              type="text"
              className="ra-registro__input"
              value={idReclamacaoRa}
              onChange={(e) => setIdReclamacaoRa(e.target.value)}
              onBlur={handleIdBlur}
              disabled={saving}
              placeholder="ID da reclamação"
            />
          </dd>
        ) : (
          <dd>{raItem.idReclamacaoRa || '—'}</dd>
        )}
      </div>
      <div>
        <dt>Assunto</dt>
        {manual ? (
          <dd>
            <input
              type="text"
              className="ra-registro__input"
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              onBlur={handleAssuntoBlur}
              disabled={saving}
              placeholder="Assunto da reclamação"
            />
          </dd>
        ) : (
          <dd>{raItem.assunto || '—'}</dd>
        )}
      </div>
      {manual ? (
        <div>
          <dt>Data da reclamação</dt>
          <dd>
            <input
              type="datetime-local"
              className="ra-registro__input"
              value={toDatetimeLocalInput(dataReclamacao)}
              onChange={(e) => handleDataReclamacaoChange(e.target.value)}
              disabled={saving}
            />
          </dd>
        </div>
      ) : (
        <div>
          <dt>Data da reclamação</dt>
          {editingDataReclamacao ? (
            <dd>
              <input
                type="datetime-local"
                className="ra-registro__input"
                autoFocus
                value={toDatetimeLocalInput(dataReclamacao)}
                onChange={(e) => handleDataReclamacaoChange(e.target.value)}
                onBlur={() => setEditingDataReclamacao(false)}
                disabled={saving}
              />
            </dd>
          ) : (
            <dd className="ra-dados-editable-value">
              <span>{formatComplaintDate(raItem.dataReclamacao)}</span>
              <button
                type="button"
                className="ra-dados-edit-btn"
                aria-label="Editar data da reclamação"
                onClick={() => setEditingDataReclamacao(true)}
              >
                <i className="ti ti-pencil" aria-hidden="true" />
              </button>
            </dd>
          )}
        </div>
      )}
      <div>
        <dt>Prazo de resposta</dt>
        {manual ? (
          <dd>
            <input
              type="datetime-local"
              className="ra-registro__input"
              value={toDatetimeLocalInput(prazoRa)}
              onChange={(e) => handlePrazoChange(e.target.value)}
              disabled={saving}
            />
          </dd>
        ) : (
          <dd className="ra-ticket__deadline-value">{formatRaDeadlineLabel(raItem.prazoRa)}</dd>
        )}
      </div>
    </>
  );
}
