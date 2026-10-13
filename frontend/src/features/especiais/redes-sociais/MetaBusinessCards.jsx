/**
 * MetaBusinessCards — cards das redes/lojas monitoradas via Meta Business
 */
import React from 'react';

const META_BUSINESS_CARDS = [
  {
    id: 'gestao-redes',
    label: 'Gestão de Redes Sociais',
    desc: 'Gestão, quantificação e atendimento das redes sociais.',
    textIcon: 'RS',
    color: '#1634FF',
    ready: true,
  },
];

export default function MetaBusinessCards({ onSelect }) {
  return (
    <div className="especiais-channel-shell__meta">
      <div className="especiais-channel-grid especiais-channel-grid--meta">
        {META_BUSINESS_CARDS.map((card) => {
          const content = (
            <>
              <span className="especiais-channel-card__icon">
                {card.textIcon ? card.textIcon : <i className={`ti ${card.icon}`} aria-hidden="true" />}
              </span>
              <span className="especiais-channel-card__label">{card.label}</span>
              <span className="especiais-channel-card__desc">{card.desc}</span>
              <span className={'especiais-channel-card__cta' + (card.ready ? '' : ' especiais-channel-card__cta--muted')}>
                {card.ready ? (
                  <>
                    Abrir
                    <i className="ti ti-arrow-right" aria-hidden="true" />
                  </>
                ) : 'Em construção'}
              </span>
            </>
          );

          if (card.ready) {
            return (
              <button
                key={card.id}
                type="button"
                className="especiais-channel-card"
                style={{ '--especiais-accent': card.color }}
                onClick={() => onSelect?.(card.id)}
              >
                {content}
              </button>
            );
          }

          return (
            <div
              key={card.id}
              className="especiais-channel-card especiais-channel-card--static"
              style={{ '--especiais-accent': card.color }}
            >
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
