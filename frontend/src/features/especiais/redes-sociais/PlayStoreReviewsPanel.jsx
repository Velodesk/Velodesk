/**
 * PlayStoreReviewsPanel — avaliações reais da Google Play (mesmos dados/ações da
 * aba "Avaliações" de Gestão de Redes Sociais, só acessada por outro caminho).
 */
import React from 'react';
import AvaliacoesPanel from './AvaliacoesPanel';

export default function PlayStoreReviewsPanel({ onBack }) {
  return (
    <div className="social-panel">
      <div className="social-panel__header">
        <button type="button" className="especiais-page__back" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true" />
          Voltar
        </button>
        <div className="social-panel__title-row">
          <div>
            <h3 className="social-panel__title">Avaliações — Google Play</h3>
            <p className="social-panel__subtitle">
              Avaliações do app Velotax na Play Store, captadas periodicamente e classificadas
              pela IA. Não existe webhook aqui — a consulta é feita por polling.
            </p>
            <span className="social-panel__scope-badge">
              <i className="ti ti-lock" aria-hidden="true" />
              Resposta registrada aqui · publicação no Play ainda não implementada
            </span>
          </div>
        </div>
      </div>

      <AvaliacoesPanel />
    </div>
  );
}
