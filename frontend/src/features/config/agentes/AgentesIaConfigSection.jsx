/**
 * AgentesIaConfigSection v1.0.0 — Configurações > Agentes de IA (card "Agente Autônomo")
 */
import React, { useState } from 'react';
import AgenteAutonomoCard from './AgenteAutonomoCard';

export default function AgentesIaConfigSection() {
  const [card, setCard] = useState(null);

  if (card === 'autonomo') {
    return (
      <div className="config-agentes">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCard(null)}>
          <i className="ti ti-arrow-left" aria-hidden="true" /> Agentes de IA
        </button>
        <AgenteAutonomoCard />
      </div>
    );
  }

  return (
    <div className="config-welcome-grid">
      <button type="button" className="config-welcome-card" onClick={() => setCard('autonomo')}>
        <span className="config-welcome-card-icon" aria-hidden="true">
          <i className="ti ti-robot" />
        </span>
        <strong>Agente Autônomo</strong>
      </button>
    </div>
  );
}
