/**
 * PlayStoreReviewsPanel — avaliações do app na Play Store (só leitura, via polling)
 */
import React, { useMemo, useState } from 'react';

const FILTERS = [
  { id: 'todas', label: 'Todas' },
  { id: '1-2-estrelas', label: '1-2 estrelas' },
  { id: 'sem-resposta', label: 'Sem resposta do desenvolvedor' },
  { id: 'nao-encaminhadas', label: 'Não encaminhadas' },
];

const SUMMARY = {
  media: '4,2',
  total: '3.482 avaliações',
  distribuicao: [
    { estrelas: 5, pct: 58 },
    { estrelas: 4, pct: 19 },
    { estrelas: 3, pct: 9 },
    { estrelas: 2, pct: 6 },
    { estrelas: 1, pct: 8 },
  ],
};

const KPIS = [
  { label: 'Novas hoje', valor: '14' },
  { label: 'Nota média (7d)', valor: '4,0', delta: '▼ 0,2 vs. sem. anterior', deltaNeg: true },
  { label: 'Sem resposta do dev.', valor: '9' },
];

const INITIAL_REVIEWS = [
  {
    id: 'gp1',
    iniciais: 'JP',
    nome: 'João Pedro Lima',
    nota: 2,
    tempo: 'Hoje, 08:47',
    dispositivo: 'v4.12.0 · Android 14 · Moto G84',
    texto: 'App trava toda vez que tento anexar o informe de rendimentos. Alguém mais com esse problema?',
    sentimento: 'negativo',
    motivo: 'Instabilidade / bug',
    confianca: 88,
    encaminhado: false,
    devReply: 'sem',
  },
  {
    id: 'gp2',
    iniciais: 'FA',
    nome: 'Fernanda Aquino',
    nota: 4,
    tempo: 'Ontem, 15:33',
    dispositivo: 'v4.12.0 · Android 13 · Samsung A54',
    texto: 'Faltou um tutorial mais claro de como importar o informe de rendimentos direto do banco. Fora isso, ótimo app.',
    sentimento: 'neutro',
    motivo: 'Sugestão de melhoria',
    confianca: 84,
    encaminhado: false,
    devReply: 'sem',
  },
  {
    id: 'gp3',
    iniciais: 'RT',
    nome: 'Ricardo Tavares',
    nota: 1,
    tempo: 'Ontem, 11:02',
    dispositivo: 'v4.11.2 · Android 12 · Xiaomi Redmi Note 11',
    texto: 'Paguei pelo plano completo e o contador nunca respondeu minhas mensagens. Péssimo suporte.',
    sentimento: 'negativo',
    motivo: 'Atendimento / suporte',
    confianca: 93,
    encaminhado: false,
    devReply: 'sem',
  },
  {
    id: 'gp4',
    iniciais: 'LP',
    nome: 'Lucas Prado',
    nota: 5,
    tempo: '2 dias atrás',
    dispositivo: 'v4.11.2 · Android 14 · Pixel 8',
    texto: 'Segunda vez usando e de novo tudo tranquilo. Recomendo bastante!',
    sentimento: 'positivo',
    motivo: 'Elogio geral',
    confianca: 96,
    encaminhado: false,
    devReply: 'respondida',
  },
];

const SENTIMENTO_LABEL = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };

function renderStars(nota) {
  return '★'.repeat(nota) + '☆'.repeat(Math.max(0, 5 - nota));
}

export default function PlayStoreReviewsPanel({ onBack }) {
  const [reviews, setReviews] = useState(INITIAL_REVIEWS);
  const [activeFilter, setActiveFilter] = useState(FILTERS[0].id);

  const handleForward = (id) => {
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, encaminhado: true } : r)));
  };

  const visibleReviews = useMemo(() => {
    if (activeFilter === '1-2-estrelas') return reviews.filter((r) => r.nota <= 2);
    if (activeFilter === 'sem-resposta') return reviews.filter((r) => r.devReply === 'sem');
    if (activeFilter === 'nao-encaminhadas') return reviews.filter((r) => !r.encaminhado);
    return reviews;
  }, [reviews, activeFilter]);

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
              pela IA. Não existe webhook aqui — a consulta é feita por polling, a cada 15-30 min.
            </p>
            <span className="social-panel__scope-badge">
              <i className="ti ti-lock" aria-hidden="true" />
              Só leitura · sem publicação automática
            </span>
          </div>
        </div>

        <div className="social-panel__filters">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={'ra-chip' + (activeFilter === filter.id ? ' is-active' : '')}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gp-summary">
        <div className="gp-summary__avg">
          <span className="gp-summary__avg-num">{SUMMARY.media}</span>
          <span className="gp-summary__avg-stars" aria-hidden="true">★★★★☆</span>
          <span className="gp-summary__avg-count">{SUMMARY.total}</span>
        </div>
        <div className="gp-summary__dist">
          {SUMMARY.distribuicao.map((row) => (
            <div key={row.estrelas} className="gp-dist-row">
              <span className="gp-dist-row__label">{row.estrelas} ★</span>
              <span className="gp-dist-row__track">
                <span
                  className={'gp-dist-row__fill' + (row.estrelas <= 2 ? ' gp-dist-row__fill--low' : '')}
                  style={{ width: `${row.pct}%` }}
                />
              </span>
              <span className="gp-dist-row__value">{row.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="gp-kpis">
        {KPIS.map((kpi) => (
          <div key={kpi.label} className="gp-kpi">
            <span className="gp-kpi__label">{kpi.label}</span>
            <span className="gp-kpi__value">{kpi.valor}</span>
            {kpi.delta ? (
              <span className={'gp-kpi__delta' + (kpi.deltaNeg ? ' gp-kpi__delta--neg' : '')}>{kpi.delta}</span>
            ) : null}
          </div>
        ))}
      </div>

      {visibleReviews.map((review) => (
        <article key={review.id} className="gp-review">
          <span className="gp-review__avatar">{review.iniciais}</span>
          <div className="gp-review__body">
            <div className="gp-review__top">
              <span className="gp-review__name">{review.nome}</span>
              <span className="gp-review__stars" aria-hidden="true">{renderStars(review.nota)}</span>
              <span className="gp-review__time">{review.tempo}</span>
            </div>
            <span className="gp-review__device">{review.dispositivo}</span>
            <p className="gp-review__text">{review.texto}</p>
            <div className="gp-review__tags">
              <span className={`ra-badge ra-badge--${review.sentimento}`}>{SENTIMENTO_LABEL[review.sentimento]}</span>
              <span className="gp-tag">Motivo: {review.motivo}</span>
              <span className="gp-review__conf">Confiança IA: {review.confianca}%</span>
            </div>
            <div className="gp-review__actions">
              {review.encaminhado ? (
                <span className="social-forward-done">
                  <i className="ti ti-check" aria-hidden="true" />
                  Encaminhado
                </span>
              ) : (
                <button type="button" className="gp-review__forward-btn" onClick={() => handleForward(review.id)}>
                  Encaminhar p/ central
                </button>
              )}
              <span className={'gp-review__dev-reply' + (review.devReply === 'respondida' ? ' gp-review__dev-reply--ok' : '')}>
                · {review.devReply === 'respondida' ? 'Já respondida pelo desenvolvedor' : 'Sem resposta do desenvolvedor'}
              </span>
            </div>
          </div>
        </article>
      ))}

      <p className="social-panel__note">
        <i className="ti ti-bulb" aria-hidden="true" />
        <span>
          <strong>Sem webhook no Google Play:</strong> os dados viriam de uma consulta periódica
          (polling) à API do Google Play Console — diferente do Facebook/Instagram, que também
          podem usar webhook. Esta tela ainda não está integrada; os itens acima são um exemplo
          de como a área vai funcionar.
        </span>
      </p>
    </div>
  );
}
