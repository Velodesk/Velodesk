/**
 * RaResponsavelCard — responsável do ticket RA + assumir ticket
 */
import React, { useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { getAgentName } from '../../../services/clientDb';
import { sanitizeResponsavel } from '../../../services/tabulationConfig';
import { formatResponsavelForDisplay } from '../../../services/desk/responsavelDisplay';
import { patchReclamacao } from '../../../services/especiais/reclameAquiStore';

export default function RaResponsavelCard({ raItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [assuming, setAssuming] = useState(false);

  if (!raItem) return null;

  const currentResponsavel = sanitizeResponsavel(raItem.responsavel || raItem.atendente);
  const responsavelDisplay = formatResponsavelForDisplay(currentResponsavel);
  const loggedAgent = sanitizeResponsavel(getAgentName());
  const isCurrentAgent = Boolean(
    currentResponsavel && loggedAgent
    && currentResponsavel.trim().toLowerCase() === loggedAgent.trim().toLowerCase(),
  );
  const showAssume = !isCurrentAgent;

  const handleAssume = async () => {
    if (assuming) return;
    if (!loggedAgent) {
      showNotification('Não foi possível identificar o agente logado.', 'warning');
      return;
    }
    setAssuming(true);
    try {
      const updated = await reclamacoesApi.patch('reclame-aqui', raItem.id, {
        responsavel: loggedAgent,
        updatedAt: raItem.updatedAt,
      });
      const merged = { ...raItem, ...updated };
      patchReclamacao(merged);
      onSaved?.(merged);
      showNotification('Ticket assumido com sucesso.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível assumir o ticket.';
      showNotification(msg, 'error');
    } finally {
      setAssuming(false);
    }
  };

  return (
    <section className="ra-ticket__side-card">
      <div className="ra-registro__field">
        <label htmlFor="ra-responsavel">Responsável</label>
        <input
          id="ra-responsavel"
          type="text"
          className="ra-registro__input ra-registro__input--readonly"
          readOnly
          value={responsavelDisplay}
        />
      </div>
      {showAssume ? (
        <button
          type="button"
          className="ra-registro__assume-link"
          disabled={assuming}
          onClick={handleAssume}
        >
          {assuming ? 'Assumindo…' : 'Assumir Ticket'}
        </button>
      ) : null}
    </section>
  );
}
