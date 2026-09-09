/**
 * BcDadosFields — dados do ticket Bacen. RDR, Assunto e Data da demanda são editáveis via
 * ícone de lápis, para corrigir o que veio da extração automática do e-mail (assunto do e-mail).
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchDemanda } from '../../../services/especiais/bacenStore';
import { formatBcDeadlineLabel } from '../../../services/especiais/bacenTicketService';
import { formatComplaintDate } from './bcTicketFormatters';

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

export default function BcDadosFields({ bcItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rdr, setRdr] = useState(bcItem?.protocoloBacen || '');
  const [assunto, setAssunto] = useState(bcItem?.assunto || '');
  const [dataDemanda, setDataDemanda] = useState(bcItem?.dataDemanda || '');

  useEffect(() => {
    setEditingField(null);
    setRdr(bcItem?.protocoloBacen || '');
    setAssunto(bcItem?.assunto || '');
    setDataDemanda(bcItem?.dataDemanda || '');
  }, [bcItem?.id]);

  if (!bcItem) return null;

  const protocoloDisplay = bcItem.protocoloBacen ? `#${bcItem.protocoloBacen}` : '—';
  const deadlineLabel = formatBcDeadlineLabel(bcItem.prazoLegal);
  const localDisplay = formatLocal(bcItem.cidade, bcItem.uf);

  const patchField = async (patch, localOverlay = {}) => {
    if (!bcItem?.id || saving) return;
    setSaving(true);
    try {
      const updated = await reclamacoesApi.patch('bacen', bcItem.id, patch);
      const merged = { ...bcItem, ...updated, ...localOverlay };
      // Grava no store local antes do reload disparado por onSaved — sem isso, o reload
      // relê o item obsoleto do cache e reverte o campo recém-salvo.
      patchDemanda(merged);
      onSaved?.(merged);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível salvar.';
      showNotification(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const commitRdr = () => {
    setEditingField(null);
    const value = rdr.trim();
    if (value === (bcItem.protocoloBacen || '')) return;
    patchField({ protocoloExterno: value, idDemandaExterna: value });
  };

  const commitAssunto = () => {
    setEditingField(null);
    const value = assunto.trim();
    if (value === (bcItem.assunto || '')) return;
    patchField({ assunto: value });
  };

  const handleDataDemandaChange = (raw) => {
    const iso = raw ? new Date(raw).toISOString() : '';
    setDataDemanda(iso);
    if (iso === (bcItem.dataDemanda || '')) return;
    patchField({ dataReclamacao: iso || null }, { dataDemanda: iso || null });
  };

  return (
    <dl>
      <div>
        <dt>RDR</dt>
        {editingField === 'rdr' ? (
          <dd>
            <input
              type="text"
              className="ra-registro__input"
              autoFocus
              value={rdr}
              onChange={(e) => setRdr(e.target.value)}
              onBlur={commitRdr}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setRdr(bcItem.protocoloBacen || ''); setEditingField(null); }
              }}
              disabled={saving}
              placeholder="RDR"
            />
          </dd>
        ) : (
          <dd className="ra-dados-editable-value">
            <span>{protocoloDisplay}</span>
            <button
              type="button"
              className="ra-dados-edit-btn"
              aria-label="Editar RDR"
              onClick={() => setEditingField('rdr')}
            >
              <i className="ti ti-pencil" aria-hidden="true" />
            </button>
          </dd>
        )}
      </div>

      <div>
        <dt>Assunto</dt>
        {editingField === 'assunto' ? (
          <dd>
            <input
              type="text"
              className="ra-registro__input"
              autoFocus
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              onBlur={commitAssunto}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setAssunto(bcItem.assunto || ''); setEditingField(null); }
              }}
              disabled={saving}
              placeholder="Assunto"
            />
          </dd>
        ) : (
          <dd className="ra-dados-editable-value">
            <span>{bcItem.assunto || '—'}</span>
            <button
              type="button"
              className="ra-dados-edit-btn"
              aria-label="Editar assunto"
              onClick={() => setEditingField('assunto')}
            >
              <i className="ti ti-pencil" aria-hidden="true" />
            </button>
          </dd>
        )}
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
        <dt>Data da demanda</dt>
        {editingField === 'data' ? (
          <dd>
            <input
              type="datetime-local"
              className="ra-registro__input"
              autoFocus
              value={toDatetimeLocalInput(dataDemanda)}
              onChange={(e) => handleDataDemandaChange(e.target.value)}
              onBlur={() => setEditingField(null)}
              disabled={saving}
            />
          </dd>
        ) : (
          <dd className="ra-dados-editable-value">
            <span>{formatComplaintDate(bcItem.dataDemanda)}</span>
            <button
              type="button"
              className="ra-dados-edit-btn"
              aria-label="Editar data da demanda"
              onClick={() => setEditingField('data')}
            >
              <i className="ti ti-pencil" aria-hidden="true" />
            </button>
          </dd>
        )}
      </div>

      <div>
        <dt>Prazo de resposta</dt>
        <dd className="ra-ticket__deadline-value">{deadlineLabel}</dd>
      </div>

      {bcItem.workflowAtivo ? (
        <div>
          <dt>Workflow</dt>
          <dd>{bcItem.workflow || 'Tratativa Bacen'}</dd>
        </div>
      ) : null}
    </dl>
  );
}
