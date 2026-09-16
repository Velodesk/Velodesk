/**
 * FacebookPostsPanel — posts da página + comentários classificados (só leitura)
 */
import React, { useState } from 'react';

const FILTERS = [
  { id: 'todos', label: 'Todos os posts' },
];

const INITIAL_POSTS = [
  {
    id: 'post-1',
    time: 'Hoje, 07:30',
    text: '📢 Faltam 12 dias para o fim do prazo de entrega da declaração! Já organizou seus documentos? Conta com a Velotax pra não perder o prazo. 🧾',
    media: { type: 'photo' },
    reactions: 214,
    shares: 18,
    comments: [
      {
        id: 'c1',
        iniciais: 'MS',
        nome: 'Mariana Souza',
        mensagem: 'Paguei o plano Premium e até agora não recebi minha restituição, já faz 3 semanas! Isso é um absurdo.',
        hora: '09:12',
        sentimento: 'negativo',
        motivo: 'Prazo de restituição',
        encaminhado: false,
      },
      {
        id: 'c2',
        iniciais: 'CA',
        nome: 'Carlos Andrade',
        mensagem: 'Quanto custa o plano completo esse ano?',
        hora: '08:20',
        sentimento: 'neutro',
        motivo: 'Dúvida sobre preço',
        encaminhado: false,
      },
      {
        id: 'c3',
        iniciais: 'RD',
        nome: 'Renata Dias',
        mensagem: 'Já baixei tudo aqui, obrigada pelo lembrete! 🙏',
        hora: '07:52',
        sentimento: 'positivo',
        motivo: 'Elogio geral',
        encaminhado: false,
      },
    ],
  },
  {
    id: 'post-2',
    time: 'Ontem, 16:10',
    text: 'Nova atualização do app disponível! Corrigimos o problema de travamento ao anexar documentos. Atualize já na sua loja de apps. 📲',
    media: { type: 'video', duration: '0:42' },
    reactions: 89,
    shares: 6,
    comments: [
      {
        id: 'c4',
        iniciais: 'JP',
        nome: 'João Pedro Lima',
        mensagem: 'Finalmente! Vou atualizar agora e testar de novo.',
        hora: 'Ontem, 17:03',
        sentimento: 'positivo',
        motivo: 'Instabilidade / bug (resolvido)',
        encaminhado: false,
      },
      {
        id: 'c5',
        iniciais: 'DM',
        nome: 'Diego Martins',
        mensagem: 'Ainda travando aqui no meu Android, versão 14.',
        hora: 'Ontem, 19:40',
        sentimento: 'negativo',
        motivo: 'Instabilidade / bug',
        encaminhado: false,
      },
    ],
  },
  {
    id: 'post-3',
    time: '2 dias atrás',
    text: 'Você sabia que dá pra declarar bens no exterior direto pelo app? Assista o tutorial completo no nosso canal. 🎥',
    media: { type: 'video', duration: '2:15' },
    reactions: 46,
    shares: 2,
    comments: [],
  },
];

const SENTIMENTO_LABEL = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };

export default function FacebookPostsPanel({ onBack }) {
  const [posts, setPosts] = useState(INITIAL_POSTS);
  const [activeFilter, setActiveFilter] = useState(FILTERS[0].id);

  const handleForward = (postId, commentId) => {
    setPosts((prev) => prev.map((post) => (
      post.id !== postId ? post : {
        ...post,
        comments: post.comments.map((c) => (c.id === commentId ? { ...c, encaminhado: true } : c)),
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
            <h3 className="social-panel__title">Posts & Comentários — Facebook</h3>
            <p className="social-panel__subtitle">
              Posts recentes da página da Velotax com os comentários captados e classificados
              pela IA. Leitura automática — a resposta continua manual, direto no Facebook.
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
        <article key={post.id} className="fb-post">
          <div className="fb-post__head">
            <span className="fb-post__avatar">
              <i className="ti ti-brand-facebook" aria-hidden="true" />
            </span>
            <span className="fb-post__who">
              <span className="fb-post__page">Velotax</span>
              <span className="fb-post__time">{post.time}</span>
            </span>
            <a className="fb-post__link" href="#" onClick={(e) => e.preventDefault()}>
              <i className="ti ti-external-link" aria-hidden="true" />
              Ver post no Facebook
            </a>
          </div>

          <p className="fb-post__text">{post.text}</p>

          <div className="fb-post__media">
            {post.media.type === 'photo' ? (
              <div className="fb-post__media-photo">
                <i className="ti ti-photo" aria-hidden="true" />
              </div>
            ) : (
              <div className="fb-post__media-video">
                <span className="fb-post__play">
                  <i className="ti ti-player-play-filled" aria-hidden="true" />
                </span>
                <span className="fb-post__duration">{post.media.duration}</span>
              </div>
            )}
          </div>

          <div className="fb-post__stats">
            <span><i className="ti ti-thumb-up" aria-hidden="true" /> {post.reactions}</span>
            <span>
              <i className="ti ti-message-circle" aria-hidden="true" />
              {post.comments.length
                ? `${post.comments.length} comentário(s) captado(s)`
                : 'Nenhum comentário captado ainda'}
            </span>
            <span><i className="ti ti-share" aria-hidden="true" /> {post.shares} compartilhamentos</span>
          </div>

          {post.comments.length ? (
            <div className="fb-post__comments">
              {post.comments.map((comment) => (
                <div key={comment.id} className="fb-post__comment">
                  <span className="fb-post__comment-avatar">{comment.iniciais}</span>
                  <div className="fb-post__comment-body">
                    <div className="fb-post__comment-bubble">
                      <div className="fb-post__comment-name">{comment.nome}</div>
                      <div className="fb-post__comment-msg">{comment.mensagem}</div>
                    </div>
                    <div className="fb-post__comment-meta">
                      <span className="fb-post__comment-time">{comment.hora}</span>
                      <span className={`ra-badge ra-badge--${comment.sentimento}`}>
                        {SENTIMENTO_LABEL[comment.sentimento]}
                      </span>
                      <span className="fb-post__comment-motivo">{comment.motivo}</span>
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
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}

      <p className="social-panel__note">
        <i className="ti ti-bulb" aria-hidden="true" />
        <span>
          Esta tela ainda não está integrada à Graph API do Facebook — os posts e comentários
          acima são um exemplo de como a área vai funcionar quando a integração for feita.
        </span>
      </p>
    </div>
  );
}
