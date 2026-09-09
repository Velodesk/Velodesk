/**
 * CgDadosFields — dados do ticket Consumidor.gov. Protocolo, Assunto, Problema e Data da
 * demanda são editáveis via ícone de lápis, para corrigir o que veio da extração automática
 * do e-mail (assunto do e-mail).
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchDemanda } from '../../../services/especiais/consumidorGovStore';
import { formatCgDeadlineLabel } from '../../../services/especiais/consumidorGovTicketService';
import { formatComplaintDate } from './cgTicketFormatters';

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

export default function CgDadosFields({ cgItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [editingField, setEditingField] = useState(null);
  const [saving, setSaving] = useState(false);
  const [protocolo, setProtocolo] = useState(cgItem?.protocoloGov || '');
  const [assunto, setAssunto] = useState(cgItem?.assunto || '');
  const [motivo, setMotivo] = useState(cgItem?.motivo || '');
  const [dataDemanda, setDataDemanda] = useState(cgItem?.dataDemanda || '');

  useEffect(() => {
    setEditingField(null);
    setProtocolo(cgItem?.protocoloGov || '');
    setAssunto(cgItem?.assunto || '');
    setMotivo(cgItem?.motivo || '');
    setDataDemanda(cgItem?.dataDemanda || '');
  }, [cgItem?.id]);

  if (!cgItem) return null;

  const protocoloDisplay = cgItem.protocoloGov ? `#${cgItem.protocoloGov}` : '—';
  const deadlineLabel = formatCgDeadlineLabel(cgItem.prazoLegal);
  const localDisplay = formatLocal(cgItem.cidade, cgItem.uf);

  const patchField = async (patch, localOverlay = {}) => {
    if (!cgItem?.id || saving) return;
    setSaving(true);
    try {
      const updated = await reclamacoesApi.patch('consumidor-gov', cgItem.id, patch);
      const merged = { ...cgItem, ...updated, ...localOverlay };
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

  const commitProtocolo = () => {
    setEditingField(null);
    const value = protocolo.trim();
    if (value === (cgItem.protocoloGov || '')) return;
    patchField({ protocoloExterno: value, idDemandaExterna: value });
  };

  const commitAssunto = () => {
    setEditingField(null);
    const value = assunto.trim();
    if (value === (cgItem.assunto || '')) return;
    patchField({ assunto: value });
  };

  const commitMotivo = () => {
    setEditingField(null);
    const value = motivo.trim();
    if (value === (cgItem.motivo || '')) return;
    patchField({ motivo: value });
  };

  const handleDataDemandaChange = (raw) => {
    const iso = raw ? new Date(raw).toISOString() : '';
    setDataDemanda(iso);
    if (iso === (cgItem.dataDemanda || '')) return;
    patchField({ dataReclamacao: iso || null }, { dataDemanda: iso || null });
  };

  return (
    <dl>
      <div>
        <dt>Protocolo Consumidor.gov</dt>
        {editingField === 'protocolo' ? (
          <dd>
            <input
              type="text"
              className="ra-registro__input"
              autoFocus
              value={protocolo}
              onChange={(e) => setProtocolo(e.target.value)}
              onBlur={commitProtocolo}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setProtocolo(cgItem.protocoloGov || ''); setEditingField(null); }
              }}
              disabled={saving}
              placeholder="Protocolo Consumidor.gov"
            />
          </dd>
        ) : (
          <dd className="ra-dados-editable-value">
            <span>{protocoloDisplay}</span>
            <button
              type="button"
              className="ra-dados-edit-btn"
              aria-label="Editar protocolo"
              onClick={() => setEditingField('protocolo')}
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
                if (e.key === 'Escape') { setAssunto(cgItem.assunto || ''); setEditingField(null); }
              }}
              disabled={saving}
              placeholder="Assunto"
            />
          </dd>
        ) : (
          <dd className="ra-dados-editable-value">
            <span>{cgItem.assunto || '—'}</span>
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

      {(cgItem.motivo || editingField === 'motivo') ? (
        <div>
          <dt>Problema</dt>
          {editingField === 'motivo' ? (
            <dd>
              <input
                type="text"
                className="ra-registro__input"
                autoFocus
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={commitMotivo}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') { setMotivo(cgItem.motivo || ''); setEditingField(null); }
                }}
                disabled={saving}
                placeholder="Problema"
              />
            </dd>
          ) : (
            <dd className="ra-dados-editable-value">
              <span>{cgItem.motivo}</span>
              <button
                type="button"
                className="ra-dados-edit-btn"
                aria-label="Editar problema"
                onClick={() => setEditingField('motivo')}
              >
                <i className="ti ti-pencil" aria-hidden="true" />
              </button>
            </dd>
          )}
        </div>
      ) : null}

      {cgItem.orgaoGov ? (
        <div>
          <dt>Órgão Consumidor.gov</dt>
          <dd>{cgItem.orgaoGov}</dd>
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
            <span>{formatComplaintDate(cgItem.dataDemanda)}</span>
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

      {cgItem.workflowAtivo ? (
        <div>
          <dt>Workflow</dt>
          <dd>{cgItem.workflow || 'Tratativa Consumidor.Gov'}</dd>
        </div>
      ) : null}
    </dl>
  );
}
