/**
 * WhatsappDisponibilidadeModal — edição rápida da disponibilidade de um modelo direto pela
 * lista, sem precisar abrir o formulário inteiro.
 */
import React, { useState } from 'react';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { useNotifications } from '../../../context/NotificationContext';
import { whatsappTemplatesApi } from '../../../api/client';

export default function WhatsappDisponibilidadeModal({ item, onClose, onSaved }) {
  const { showNotification } = useNotifications();
  const { agentOptions } = useDeskColaboradores();
  const [disponibilidade, setDisponibilidade] = useState(item.disponibilidade || []);
  const [saving, setSaving] = useState(false);

  const options = ['Todos os usuários', ...agentOptions].filter((opt) => !disponibilidade.includes(opt));

  const handleAdd = (value) => {
    if (!value || disponibilidade.includes(value)) return;
    setDisponibilidade((prev) => [...prev, value]);
  };

  const handleRemove = (value) => {
    setDisponibilidade((prev) => prev.filter((entry) => entry !== value));
  };

  const handleClear = () => setDisponibilidade([]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await whatsappTemplatesApi.update(item.id, { disponibilidade });
      showNotification('Disponibilidade atualizada.', 'success');
      onSaved?.();
      onClose?.();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="config-modal" role="presentation">
      <button type="button" className="config-modal__backdrop" aria-label="Fechar" onClick={saving ? undefined : onClose} />
      <div
        className="config-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsappDisponibilidadeTitle"
      >
        <header className="config-modal__header">
          <h4 id="whatsappDisponibilidadeTitle">Editar disponibilidade</h4>
          <button type="button" className="config-modal__close" onClick={onClose} aria-label="Fechar" disabled={saving}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <div className="config-modal__body">
          <p className="config-placeholder-msg">Selecione os grupos e/ou usuários que terão disponibilidade a este modelo de mensagem.</p>

          <label className="config-email-field">
            <span>Disponibilidade</span>
            <div className="config-whatsapp-picker">
              <div className="config-whatsapp-chips">
                {disponibilidade.map((entry) => (
                  <span key={entry} className="config-whatsapp-chip">
                    {entry}
                    <button
                      type="button"
                      className="config-whatsapp-chip-remove"
                      onClick={() => handleRemove(entry)}
                      aria-label={`Remover ${entry}`}
                      disabled={saving}
                    >
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="config-whatsapp-picker-clear"
                onClick={handleClear}
                aria-label="Limpar disponibilidade"
                disabled={saving || !disponibilidade.length}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
              <select
                className="config-whatsapp-picker-select"
                value=""
                onChange={(e) => handleAdd(e.target.value)}
                aria-label="Adicionar grupo ou usuário"
                disabled={saving}
              >
                <option value="">+ Adicionar grupo ou usuário…</option>
                {options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
          </label>
        </div>

        <footer className="config-modal__footer">
          <button type="button" className="config-action-btn config-action-btn--edit" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="button" className="config-action-btn config-action-btn--create" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
