/**
 * RaModeracaoPanel — registro de moderação de reclamações RA que violam os termos da plataforma
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchReclamacao } from '../../../services/especiais/reclameAquiStore';

export default function RaModeracaoPanel({ raItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [solicitada, setSolicitada] = useState(Boolean(raItem?.moderacaoSolicitada));
  const [aceita, setAceita] = useState(Boolean(raItem?.moderacaoAceita));
  const [motivo, setMotivo] = useState(raItem?.moderacaoMotivo || '');
  const [avaliacaoCliente, setAvaliacaoCliente] = useState(raItem?.moderacaoAvaliacaoCliente || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSolicitada(Boolean(raItem?.moderacaoSolicitada));
    setAceita(Boolean(raItem?.moderacaoAceita));
    setMotivo(raItem?.moderacaoMotivo || '');
    setAvaliacaoCliente(raItem?.moderacaoAvaliacaoCliente || '');
  }, [raItem?.id]);

  const handleSave = async () => {
    if (!raItem?.id || saving) return;
    setSaving(true);
    try {
      const updated = await reclamacoesApi.patch('reclame-aqui', raItem.id, {
        updatedAt: raItem.updatedAt,
        meta: {
          moderacaoSolicitada: solicitada,
          moderacaoAceita: aceita,
          moderacaoMotivo: motivo,
          moderacaoAvaliacaoCliente: avaliacaoCliente,
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

  return (
    <div className="ra-moderacao-panel">
      <h3 className="ra-moderacao-panel__title">Moderação — Reclame Aqui</h3>
      <p className="ra-moderacao-panel__hint">
        Registro de solicitação de remoção ou edição de reclamações que violam os termos da plataforma.
      </p>

      <div className="ra-moderacao-panel__field">
        <span className="ra-registro__side-label">Ocorreu solicitação de moderação?</span>
        <div className="ra-registro__toggle">
          <button
            type="button"
            className={`ra-registro__toggle-btn${solicitada ? ' is-active' : ''}`}
            onClick={() => setSolicitada(true)}
          >
            Sim
          </button>
          <button
            type="button"
            className={`ra-registro__toggle-btn${!solicitada ? ' is-active' : ''}`}
            onClick={() => setSolicitada(false)}
          >
            Não
          </button>
        </div>
      </div>

      <div className="ra-moderacao-panel__field">
        <span className="ra-registro__side-label">Moderação aceita pelo RA?</span>
        <div className="ra-registro__toggle">
          <button
            type="button"
            className={`ra-registro__toggle-btn${aceita ? ' is-active' : ''}`}
            onClick={() => setAceita(true)}
          >
            Sim
          </button>
          <button
            type="button"
            className={`ra-registro__toggle-btn${!aceita ? ' is-active' : ''}`}
            onClick={() => setAceita(false)}
          >
            Não
          </button>
        </div>
      </div>

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

      <div className="ra-moderacao-panel__field ra-registro__field">
        <label htmlFor="ra-moderacao-avaliacao">Avaliação do RA encaminhada pelo cliente</label>
        <textarea
          id="ra-moderacao-avaliacao"
          className="ra-registro__textarea"
          rows={4}
          value={avaliacaoCliente}
          onChange={(e) => setAvaliacaoCliente(e.target.value)}
          placeholder="Cole aqui a avaliação encaminhada pelo cliente..."
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
