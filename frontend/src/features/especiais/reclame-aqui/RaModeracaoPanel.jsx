/**
 * RaModeracaoPanel — registro de moderação de reclamações RA que violam os termos da plataforma
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchReclamacao } from '../../../services/especiais/reclameAquiStore';

export default function RaModeracaoPanel({ raItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [motivo, setMotivo] = useState(raItem?.moderacaoMotivo || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMotivo(raItem?.moderacaoMotivo || '');
  }, [raItem?.id]);

  const handleSave = async () => {
    if (!raItem?.id || saving) return;
    setSaving(true);
    try {
      const updated = await reclamacoesApi.patch('reclame-aqui', raItem.id, {
        updatedAt: raItem.updatedAt,
        meta: {
          moderacaoMotivo: motivo,
        },
      });
      const merged = { ...raItem, ...updated };
      // Grava no store local antes do reload disparado por onSaved — sem isso, o reload
      // relê o item obsoleto do cache e reverte o campo recém-salvo.
      patchReclamacao(merged);
      onSaved?.(merged);
      showNotification('Moderação salva.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível salvar a moderação.';
      showNotification(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!raItem) return null;

  // Solicitada/aceita/quantidade vêm direto da base Reclame Aqui (coluna "Moderação status" /
  // "Moderações neste ticket") e são atualizadas a cada reimport — não são editáveis aqui.
  const solicitada = Boolean(raItem.moderacaoSolicitada);
  const aceita = Boolean(raItem.moderacaoAceita);
  const qtd = raItem.moderacaoQtd || '';
  const statusBase = raItem.moderacaoStatusBase || '';

  return (
    <div className="ra-moderacao-panel">
      <h3 className="ra-moderacao-panel__title">Moderação — Reclame Aqui</h3>
      <p className="ra-moderacao-panel__hint">
        Solicitação, desfecho e quantidade vêm da base do Reclame Aqui e são atualizados a cada importação.
      </p>

      <dl className="ra-moderacao-panel__base-info">
        <div>
          <dt>Solicitação de moderação?</dt>
          <dd>{solicitada ? 'Sim' : 'Não'}</dd>
        </div>
        {solicitada ? (
          <div>
            <dt>Moderação aceita pelo RA?</dt>
            <dd>{aceita ? 'Sim' : 'Não'}{statusBase ? ` (${statusBase})` : ''}</dd>
          </div>
        ) : null}
        <div>
          <dt>Moderações neste ticket</dt>
          <dd>{qtd || '—'}</dd>
        </div>
      </dl>

      <div className="ra-moderacao-panel__field ra-registro__field">
        <label htmlFor="ra-moderacao-motivo">Motivo</label>
        <textarea
          id="ra-moderacao-motivo"
          className="ra-registro__textarea"
          rows={4}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Descreva o motivo da solicitação de moderação..."
        />
      </div>

      <button
        type="button"
        className="ra-moderacao-panel__save-btn"
        onClick={handleSave}
        disabled={saving}
      >
        <i className="ti ti-device-floppy" aria-hidden="true" />
        {saving ? 'Salvando…' : 'Salvar moderação'}
      </button>
    </div>
  );
}
