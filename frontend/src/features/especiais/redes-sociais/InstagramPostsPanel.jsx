/**
 * InstagramPostsPanel — comentários reais captados de posts do Instagram (mesmos
 * dados/ações da aba "Comentários" de Gestão de Redes Sociais, filtrado só pra
 * este canal, acessado por outro caminho de navegação).
 */
import React from 'react';
import ComentariosPanel from './ComentariosPanel';

export default function InstagramPostsPanel({ onBack }) {
  return (
    <div className="social-panel">
      <div className="social-panel__header">
        <button type="button" className="especiais-page__back" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true" />
          Voltar
        </button>
        <div className="social-panel__title-row">
          <div>
            <h3 className="social-panel__title">Comentários — Instagram</h3>
            <p className="social-panel__subtitle">
              Comentários captados em posts do perfil da Velotax e classificados pela IA.
              Resposta registrada aqui — publicação direto no Instagram ainda não implementada.
            </p>
          </div>
        </div>
      </div>

      <ComentariosPanel canais={['instagram']} />
    </div>
  );
}
