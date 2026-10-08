/**
 * WhatsappTemplatePreviewModal — "Visualizar" na lista: só a simulação de como a mensagem
 * aparece no WhatsApp do cliente, sem o formulário de edição.
 */
import React from 'react';
import WhatsappPreviewCard from './WhatsappPreviewCard';

export default function WhatsappTemplatePreviewModal({ item, onClose }) {
  return (
    <div className="config-modal" role="presentation">
      <button type="button" className="config-modal__backdrop" aria-label="Fechar" onClick={onClose} />
      <div
        className="config-modal__dialog config-whatsapp-preview-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsappPreviewTitle"
      >
        <header className="config-modal__header">
          <h4 id="whatsappPreviewTitle">{item.nome}</h4>
          <button type="button" className="config-modal__close" onClick={onClose} aria-label="Fechar">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <div className="config-modal__body">
          <WhatsappPreviewCard
            cabecalhoTipo={item.cabecalhoTipo}
            cabecalhoTexto={item.cabecalhoTexto}
            corpo={item.corpo}
            rodape={item.rodape}
            botoes={item.botoes || []}
          />
        </div>
      </div>
    </div>
  );
}
