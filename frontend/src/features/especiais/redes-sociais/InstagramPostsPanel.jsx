/**
 * InstagramPostsPanel — posts/reels do perfil + comentários classificados (só leitura)
 */
import React, { useState } from 'react';

const FILTERS = [
  { id: 'todos', label: 'Todos os posts' },
];

const INITIAL_POSTS = [
  {
    id: 'ig-post-1',
    tipo: 'foto',
    local: 'São Paulo, Brasil',
    likesDestaque: 'ana.rocha',
    likesOutras: 612,
    caption: '📢 Faltam 12 dias para o fim do prazo de entrega da declaração! Já organizou seus documentos? #velotax #declaraçãoIR',
    totalComentarios: 5,
    postado: 'Hoje, 09:40',
    comentarios: [
      {
        id: 'ic1',
        usuario: 'mari.souza82',
        texto: 'Paguei o plano Premium e até agora não recebi minha restituição, já faz 3 semanas!',
        tempo: '2h',
        sentimento: 'negativo',
        motivo: 'Prazo de restituição',
        encaminhado: false,
      },
      {
        id: 'ic2',
        usuario: 'bea.fontes',
        texto: 'Uso a Velotax há 3 anos, sempre rápido e sem dor de cabeça 🙌',
        tempo: '4h',
        sentimento: 'positivo',
        motivo: 'Elogio geral',
        encaminhado: false,
      },
    ],
  },
  {
    id: 'ig-post-2',
    tipo: 'reel',
    duracao: '0:38',
    local: 'Reels',
    likesDestaque: 'diego.martins',
    likesOutras: 310,
    caption: 'Nova atualização do app disponível! Corrigimos o problema de travamento ao anexar documentos 📲',
    totalComentarios: 3,
    postado: 'Ontem, 16:20',
    comentarios: [
      {
        id: 'ic3',
        usuario: 'joao.lima',
        texto: 'Finalmente! Vou atualizar agora e testar de novo.',
        tempo: '1h',
        sentimento: 'positivo',
        motivo: 'Instabilidade / bug (resolvido)',
        encaminhado: false,
      },
    ],
  },
];

const SENTIMENTO_LABEL = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };

export default function InstagramPostsPanel({ onBack }) {
  const [posts, setPosts] = useState(INITIAL_POSTS);
  const [activeFilter, setActiveFilter] = useState(FILTERS[0].id);

  const handleForward = (postId, commentId) => {
    setPosts((prev) => prev.map((post) => (
      post.id !== postId ? post : {
        ...post,
        comentarios: post.comentarios.map((c) => (c.id === commentId ? { ...c, encaminhado: true } : c)),
      }
    )));
  };

  const visiblePosts = posts;

  return (
    <div className="social-panel">
      <div className="social-panel__header">
        <button type="button" className="especiais-page__back" onClick={onBack}>
          <i className="ti ti-arrow-left" aria-hidden="true" />
          Voltar
        </button>
        <div className="social-panel__title-row">
          <div>
            <h3 className="social-panel__title">Posts & Comentários — Instagram</h3>
            <p className="social-panel__subtitle">
              Posts e Reels recentes do perfil da Velotax, com curtidas e comentários captados
              e classificados pela IA. Leitura automática — a resposta continua manual, direto
              no Instagram.
            </p>
            <span className="social-panel__scope-badge">
              <i className="ti ti-lock" aria-hidden="true" />
              Só leitura · sem publicação
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

      {visiblePosts.map((post) => (
        <article key={post.id} className="ig-post">
          <div className="ig-post__head">
            <span className="ig-post__ring">
              <span className="ig-post__ring-inner">
                <i className="ti ti-user" aria-hidden="true" />
              </span>
            </span>
            <span className="ig-post__who">
              <span className="ig-post__uname">
                velotax
                <i className="ti ti-rosette-discount-check-filled ig-post__verified" aria-hidden="true" />
              </span>
              <span className="ig-post__loc">{post.local}</span>
            </span>
            <i className="ti ti-dots" aria-hidden="true" />
          </div>

          <div className="ig-post__media">
            {post.tipo === 'foto' ? (
              <div className="ig-post__media-photo">
                <i className="ti ti-photo" aria-hidden="true" />
              </div>
            ) : (
              <div className="ig-post__media-video">
                <span className="ig-post__play">
                  <i className="ti ti-player-play-filled" aria-hidden="true" />
                </span>
                <span className="ig-post__reel-badge">
                  <i className="ti ti-movie" aria-hidden="true" />
                  Reels
                </span>
                <span className="ig-post__duration">{post.duracao}</span>
              </div>
            )}
          </div>

          <div className="ig-post__actions">
            <i className="ti ti-heart" aria-hidden="true" />
            <i className="ti ti-message-circle" aria-hidden="true" />
            <i className="ti ti-send" aria-hidden="true" />
            <i className="ti ti-bookmark ig-post__save" aria-hidden="true" />
          </div>

          <p className="ig-post__likes">
            Curtido por <strong>{post.likesDestaque}</strong> e outras <strong>{post.likesOutras} pessoas</strong>
          </p>

          <p className="ig-post__caption"><strong>velotax</strong>{post.caption}</p>

          {post.totalComentarios > post.comentarios.length ? (
            <p className="ig-post__view-all">
              <a href="#" onClick={(e) => e.preventDefault()}>
                Ver todos os {post.totalComentarios} comentários
              </a>
            </p>
          ) : null}

          {post.comentarios.length ? (
            <div className="ig-post__comments">
              {post.comentarios.map((comment) => (
                <div key={comment.id} className="ig-post__comment">
                  <p className="ig-post__comment-line">
                    <strong>{comment.usuario}</strong>{comment.texto}
                  </p>
                  <div className="ig-post__comment-meta">
                    <span className="ig-post__comment-time">{comment.tempo}</span>
                    <span className={`ra-badge ra-badge--${comment.sentimento}`}>
                      {SENTIMENTO_LABEL[comment.sentimento]}
                    </span>
                    <span className="ig-post__comment-motivo">{comment.motivo}</span>
                    {comment.encaminhado ? (
                      <span className="social-forward-done">
                        <i className="ti ti-check" aria-hidden="true" />
                        Encaminhado
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="social-forward-btn"
                        onClick={() => handleForward(post.id, comment.id)}
                      >
                        Encaminhar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <p className="ig-post__timestamp">
            {post.postado} ·{' '}
            <a href="#" onClick={(e) => e.preventDefault()}>
              <i className="ti ti-external-link" aria-hidden="true" />
              Ver {post.tipo === 'reel' ? 'Reel' : 'post'} no Instagram
            </a>
          </p>
        </article>
      ))}

      <p className="social-panel__note">
        <i className="ti ti-bulb" aria-hidden="true" />
        <span>
          Esta tela ainda não está integrada à Instagram Graph API — os posts e comentários
          acima são um exemplo de como a área vai funcionar quando a integração for feita.
        </span>
      </p>
    </div>
  );
}
