/**
 * FacebookPostsPanel — comentários reais captados de posts do Facebook (mesmos
 * dados/ações da aba "Comentários" de Gestão de Redes Sociais, filtrado só pra
 * este canal, acessado por outro caminho de navegação).
 */
import React from 'react';
import ComentariosPanel from './ComentariosPanel';

export default function FacebookPostsPanel({ onBack }) {
  return (
    <div className="social-panel">
      <div className="social-panel__header">
        <button type="button" className="especiais-page__back" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true" />
          Voltar
        </button>
        <div className="social-panel__title-row">
          <div>
            <h3 className="social-panel__title">Comentários — Facebook</h3>
            <p className="social-panel__subtitle">
              Comentários captados em posts da página da Velotax e classificados pela IA.
              Resposta registrada aqui — publicação direto no Facebook ainda não implementada.
            </p>
          </div>
        </div>
      </div>

      <ComentariosPanel canais={['facebook']} />
    </div>
  );
}
