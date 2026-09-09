/**
 * BcResponsavelCard — responsável do ticket Bacen + assumir ticket
 */
import React, { useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { getAgentName } from '../../../services/clientDb';
import { sanitizeResponsavel } from '../../../services/tabulationConfig';
import { formatResponsavelForDisplay } from '../../../services/desk/responsavelDisplay';
import { patchDemanda } from '../../../services/especiais/bacenStore';

export default function BcResponsavelCard({ bcItem, onSaved }) {
  const { showNotification } = useNotifications();
  const [assuming, setAssuming] = useState(false);

  if (!bcItem) return null;

  const currentResponsavel = sanitizeResponsavel(bcItem.responsavel || bcItem.atendente);
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
      const updated = await reclamacoesApi.patch('bacen', bcItem.id, { responsavel: loggedAgent });
      const merged = { ...bcItem, ...updated };
      patchDemanda(merged);
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
        <label htmlFor="bc-responsavel">Responsável</label>
        <input
          id="bc-responsavel"
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
