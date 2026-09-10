/**
 * RaNotaContatoCard — indicador "Passível de nota?" e registro de tentativas de contato
 */
import React, { useEffect, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { patchReclamacao } from '../../../services/especiais/reclameAquiStore';

export default function RaNotaContatoCard({ raItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [saving, setSaving] = useState(false);
  const [tentativaContato, setTentativaContato] = useState(raItem?.tentativaContato || '');

  useEffect(() => {
    setTentativaContato(raItem?.tentativaContato || '');
  }, [raItem?.id]);

  if (!raItem) return null;

  const patchMeta = async (metaPatch) => {
    if (!raItem?.id || saving) return;
    setSaving(true);
    try {
      const updated = await reclamacoesApi.patch('reclame-aqui', raItem.id, {
        meta: metaPatch,
        updatedAt: raItem.updatedAt,
      });
      const merged = { ...raItem, ...updated };
      // Grava no store local antes do reload disparado por onSaved — sem isso, o reload
      // relê o item obsoleto do cache e reverte o campo recém-salvo.
      patchReclamacao(merged);
      onSaved?.(merged);
      showNotification('Atualizado.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível salvar.';
      showNotification(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePassivelNota = (value) => {
    if (Boolean(raItem.passivelNota) === value) return;
    patchMeta({ passivelNota: value });
  };

  const handleTentativaContatoBlur = () => {
    if (tentativaContato === (raItem.tentativaContato || '')) return;
    patchMeta({ tentativaContato });
  };

  return (
    <section className="ra-ticket__side-card">
      <p className="ra-registro__side-label">Passível de nota?</p>
      <div className="ra-registro__toggle">
        <button
          type="button"
          className={`ra-registro__toggle-btn${raItem.passivelNota ? ' is-active' : ''}`}
          disabled={saving}
          onClick={() => handlePassivelNota(true)}
        >
          Sim
        </button>
        <button
          type="button"
          className={`ra-registro__toggle-btn${!raItem.passivelNota ? ' is-active' : ''}`}
          disabled={saving}
          onClick={() => handlePassivelNota(false)}
        >
          Não
        </button>
      </div>

      <div className="ra-registro__field ra-nota-contato__field">
        <label htmlFor="ra-tentativa-contato">Tentativa de contato</label>
        <input
          id="ra-tentativa-contato"
          type="text"
          className="ra-registro__input"
          value={tentativaContato}
          onChange={(e) => setTentativaContato(e.target.value)}
          onBlur={handleTentativaContatoBlur}
          disabled={saving}
          placeholder="Ex.: 2x — ligações em 15/08 e 18/08"
        />
      </div>
    </section>
  );
}
