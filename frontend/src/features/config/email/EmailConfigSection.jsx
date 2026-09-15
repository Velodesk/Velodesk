/**
 * EmailConfigSection v2.2.0 — esconde Voltar do hub no editor de saída
 * VERSION: v2.2.0 | DATE: 2026-08-20
 */
import React, { useState } from 'react';
import EmailRemetentesSection from './EmailRemetentesSection';
import EmailOutboundSection from './EmailOutboundSection';
import EmailAssinaturaSection from './EmailAssinaturaSection';
import WhatsappMensagensSection from './WhatsappMensagensSection';

const EMAIL_AREAS = [
  {
    id: 'remetentes',
    label: 'Controle de remetentes',
    desc: 'Ignorados, spam e prioritários do inbound',
    icon: 'ti-filter',
  },
  {
    id: 'saida',
    label: 'E-mails de saída',
    desc: 'Textos, saudação, corpo e gatilhos',
    icon: 'ti-mail-forward',
  },
  {
    id: 'assinatura',
    label: 'Layout de assinatura',
    desc: 'Texto formatado e imagens da assinatura',
    icon: 'ti-writing',
  },
  {
    id: 'whatsapp-mensagens',
    label: 'Mensagens Whatsapp',
    desc: 'Modelos aprovados pra iniciar ou reativar conversa',
    icon: 'ti-brand-whatsapp',
  },
];

export default function EmailConfigSection() {
  const [area, setArea] = useState(null);
  const [hideHubBack, setHideHubBack] = useState(false);
  const active = EMAIL_AREAS.find((item) => item.id === area) || null;

  if (!area) {
    return (
      <div className="config-email-hub">
        <p className="config-placeholder-msg">Escolha o que deseja configurar neste módulo.</p>
        <div className="config-email-hub-grid">
          {EMAIL_AREAS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="config-email-hub-card"
              onClick={() => setArea(item.id)}
            >
              <span className="config-welcome-card-icon" aria-hidden="true">
                <i className={'ti ' + item.icon} />
              </span>
              <span className="config-email-hub-card-text">
                <strong>{item.label}</strong>
                <span>{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="config-email-hub-view">
      <div className="config-email-hub-nav">
        {hideHubBack ? null : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setArea(null)}>
            Voltar ao e-mail
          </button>
        )}
        <h4>{active?.label}</h4>
      </div>
      {area === 'remetentes' ? (
        <EmailRemetentesSection />
      ) : area === 'saida' ? (
        <EmailOutboundSection onNestedViewChange={setHideHubBack} />
      ) : area === 'whatsapp-mensagens' ? (
        <WhatsappMensagensSection onNestedViewChange={setHideHubBack} />
      ) : (
        <EmailAssinaturaSection />
      )}
    </div>
  );
}
