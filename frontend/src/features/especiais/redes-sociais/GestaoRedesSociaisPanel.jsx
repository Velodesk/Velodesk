/**
 * GestaoRedesSociaisPanel — inbox unificado de Facebook/Instagram/Google Play
 * (gestão, quantificação e atendimento das redes sociais)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { useNotifications } from '../../../context/NotificationContext';

const TOP_TABS = [
  { id: 'inbox', label: 'Inbox', icon: 'ti-inbox', count: 12 },
  { id: 'comentarios', label: 'Comentários', icon: 'ti-message-circle', count: 34 },
  { id: 'avaliacoes', label: 'Avaliações', icon: 'ti-star', count: 8 },
  { id: 'dashboard', label: 'Dashboard', icon: 'ti-chart-bar', count: null },
];

const CHANNELS = [
  { id: 'facebook', label: 'Facebook', icon: 'ti-brand-facebook', color: '#1877F2' },
  { id: 'instagram', label: 'Instagram', icon: 'ti-brand-instagram', color: '#E4405F' },
  { id: 'play-store', label: 'Google Play', icon: 'ti-brand-google-play', color: '#00A050' },
];

const STATUS_TABS = [
  { id: 'todas', label: 'Todas' },
  { id: 'nao-lidas', label: 'Não lidas' },
  { id: 'abertas', label: 'Abertas' },
  { id: 'resolvidas', label: 'Resolvidas' },
];

const TAG_META = {
  pendente: 'Pendente',
  novo: 'Novo',
  bug: 'Bug',
  resolvido: 'Resolvido',
  'em-analise': 'Em análise',
};

const CLASSIFICACAO_CATEGORIAS = ['Suporte técnico', 'Elogio', 'Reclamação', 'Dúvida', 'Sugestão'];
const CLASSIFICACAO_MOTIVOS = ['Importação e-CAC', 'Restituição', 'Cadastro', 'Pagamento', 'Instabilidade / bug', 'Outro'];
const CLASSIFICACAO_STATUS = ['Em análise', 'Aguardando cliente', 'Escalado', 'Resolvido'];

const INITIAL_CONVERSATIONS = [
  {
    id: 'mariana-pereira',
    nome: 'Mariana Pereira',
    iniciais: 'MP',
    cor: '#7C3AED',
    canal: 'instagram',
    canalLabel: 'Instagram Direct',
    handle: '@mariana.pereira',
    seguidores: 2340,
    hora: '14:32',
    preview: 'Oi! Tô tentando fazer a declaração mas tá dando um erro...',
    tag: 'pendente',
    unread: true,
    sentimento: { label: 'Frustrado', tom: 'negativo', confianca: 84 },
    classificacao: { categoria: 'Suporte técnico', motivo: 'Importação e-CAC', status: 'Em análise' },
    thread: [
      { autor: 'cliente', hora: '14:28', texto: 'Oi! Tô tentando fazer a declaração mas tá dando um erro na hora de importar meu informe de rendimentos do e-CAC. Aparece "erro de autenticação". O que eu faço?' },
      { autor: 'agente', hora: '14:30', texto: 'Olá, Mariana! Tudo bem? 😊 Esse erro acontece quando o certificado digital precisa ser renovado no e-CAC. Você pode tentar acessar diretamente pelo site gov.br e verificar se o certificado está ativo.' },
      { autor: 'cliente', hora: '14:32', texto: 'Hm, tentei aí mas ainda continua o mesmo erro 😔 meu certificado tá válido até 2027' },
    ],
    notaInterna: 'Cliente com certificado válido ainda com erro de autenticação — possível problema de cache ou token expirado. Verificar com suporte técnico.',
    sugestaoIa: {
      confianca: 91,
      texto: 'Mariana, nesse caso pode ser um token de sessão expirado. Tente limpar os cookies do navegador e refazer o login no gov.br. Se o erro persistir, podemos gerar um link de suporte técnico para você.',
    },
  },
  {
    id: 'joao-rodrigues',
    nome: 'João Rodrigues',
    iniciais: 'JR',
    cor: '#1634FF',
    canal: 'facebook',
    canalLabel: 'Facebook DM',
    handle: '@joao.rodrigues',
    seguidores: 890,
    hora: '13:55',
    preview: 'Quando sai o suporte pro MEI? Já vi em outros apps...',
    tag: 'novo',
    unread: true,
    sentimento: { label: 'Neutro', tom: 'neutro', confianca: 72 },
    classificacao: { categoria: 'Dúvida', motivo: 'Cadastro', status: 'Em análise' },
    thread: [
      { autor: 'cliente', hora: '13:55', texto: 'Quando sai o suporte pro MEI? Já vi em outros apps de contabilidade e queria saber se entra na Velotax também.' },
    ],
    notaInterna: '',
    sugestaoIa: null,
  },
  {
    id: 'ana-lima',
    nome: 'Ana Lima',
    iniciais: 'AL',
    cor: '#E4405F',
    canal: 'instagram',
    canalLabel: 'Instagram Direct',
    handle: '@ana.lima',
    seguidores: 512,
    hora: '13:10',
    preview: 'O app tá crashando toda vez que tento anexar...',
    tag: 'bug',
    unread: true,
    sentimento: { label: 'Frustrado', tom: 'negativo', confianca: 88 },
    classificacao: { categoria: 'Reclamação', motivo: 'Instabilidade / bug', status: 'Escalado' },
    thread: [
      { autor: 'cliente', hora: '13:10', texto: 'O app tá crashando toda vez que tento anexar o comprovante de residência. Já tentei reinstalar e continua.' },
    ],
    notaInterna: 'Possível bug já reportado pelo time de produto — verificar antes de responder.',
    sugestaoIa: null,
  },
  {
    id: 'carlos-ferreira',
    nome: 'Carlos Ferreira',
    iniciais: 'CF',
    cor: '#006AB9',
    canal: 'facebook',
    canalLabel: 'Facebook DM',
    handle: '@carlos.ferreira',
    seguidores: 1204,
    hora: '11:44',
    preview: 'Obrigado pelo suporte! Consegui resolver.',
    tag: 'resolvido',
    unread: false,
    sentimento: { label: 'Positivo', tom: 'positivo', confianca: 95 },
    classificacao: { categoria: 'Elogio', motivo: 'Outro', status: 'Resolvido' },
    thread: [
      { autor: 'cliente', hora: '11:40', texto: 'Obrigado pelo suporte! Consegui resolver o problema com a chave pix, tudo certo agora.' },
      { autor: 'agente', hora: '11:44', texto: 'Que ótimo, Carlos! Ficamos felizes em ajudar. Qualquer coisa, estamos por aqui 🙌' },
    ],
    notaInterna: '',
    sugestaoIa: null,
  },
  {
    id: 'renata-souza',
    nome: 'Renata Souza',
    iniciais: 'RS',
    cor: '#F97316',
    canal: 'instagram',
    canalLabel: 'Instagram Direct',
    handle: '@renata.souza',
    seguidores: 3110,
    hora: '10:20',
    preview: 'Preciso de ajuda com a restituição. Já fa...',
    tag: 'em-analise',
    unread: true,
    sentimento: { label: 'Frustrado', tom: 'negativo', confianca: 79 },
    classificacao: { categoria: 'Reclamação', motivo: 'Restituição', status: 'Em análise' },
    thread: [
      { autor: 'cliente', hora: '10:20', texto: 'Preciso de ajuda com a restituição. Já faz mais de 30 dias que declarei e nada cai na minha conta.' },
    ],
    notaInterna: 'Verificar lote de restituição da Receita antes de responder — pode não ser questão da Velotax.',
    sugestaoIa: null,
  },
  {
    id: 'tania-mendes',
    nome: 'Tânia Mendes',
    iniciais: 'TM',
    cor: '#15A237',
    canal: 'facebook',
    canalLabel: 'Facebook DM',
    handle: '@tania.mendes',
    seguidores: 674,
    hora: '09:05',
    preview: 'Boa tarde! Vocês têm plano para autônomo?',
    tag: 'novo',
    unread: true,
    sentimento: { label: 'Neutro', tom: 'neutro', confianca: 70 },
    classificacao: { categoria: 'Dúvida', motivo: 'Outro', status: 'Em análise' },
    thread: [
      { autor: 'cliente', hora: '09:05', texto: 'Boa tarde! Vocês têm plano para autônomo? Trabalho como motorista de app e queria saber como funciona a declaração.' },
    ],
    notaInterna: '',
    sugestaoIa: null,
  },
];

const CHANNEL_LABEL = { facebook: 'Facebook', instagram: 'Instagram', 'play-store': 'Google Play' };

function channelIcon(canal) {
  return CHANNELS.find((c) => c.id === canal)?.icon || 'ti-message-circle';
}

export default function GestaoRedesSociaisPanel({ onBack }) {
  const { showNotification } = useNotifications();
  const { agentOptions } = useDeskColaboradores();

  const [topTab, setTopTab] = useState(TOP_TABS[0].id);
  const [activeChannels, setActiveChannels] = useState(() => new Set(CHANNELS.map((c) => c.id)));
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].id);
  const [search, setSearch] = useState('');
  const [conversations, setConversations] = useState(INITIAL_CONVERSATIONS);
  const [activeId, setActiveId] = useState(INITIAL_CONVERSATIONS[0].id);
  const [dismissedSuggestions, setDismissedSuggestions] = useState(() => new Set());
  const [composeTab, setComposeTab] = useState('publica');
  const [composeText, setComposeText] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [classificacaoOverrides, setClassificacaoOverrides] = useState({});

  useEffect(() => {
    setComposeText('');
    setComposeTab('publica');
  }, [activeId]);

  useEffect(() => {
    if (agentOptions.length && !responsavel) setResponsavel(agentOptions[0]);
  }, [agentOptions, responsavel]);

  const notImplemented = (msg) => showNotification(msg, 'info');

  const toggleChannel = (id) => {
    setActiveChannels((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!activeChannels.has(c.canal)) return false;
      if (statusTab === 'nao-lidas' && !c.unread) return false;
      if (statusTab === 'abertas' && c.tag === 'resolvido') return false;
      if (statusTab === 'resolvidas' && c.tag !== 'resolvido') return false;
      if (q && !c.nome.toLowerCase().includes(q) && !c.preview.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [conversations, activeChannels, statusTab, search]);

  const active = conversations.find((c) => c.id === activeId) || conversations[0];
  const classificacao = classificacaoOverrides[active.id] || active.classificacao;

  const updateClassificacao = (field, value) => {
    setClassificacaoOverrides((prev) => ({
      ...prev,
      [active.id]: { ...(prev[active.id] || active.classificacao), [field]: value },
    }));
  };

  const handleSelectConversation = (id) => {
    setActiveId(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
  };

  const handleUseSuggestion = () => {
    if (!active.sugestaoIa) return;
    setComposeTab('publica');
    setComposeText(active.sugestaoIa.texto);
    setDismissedSuggestions((prev) => new Set(prev).add(active.id));
  };

  const handleIgnoreSuggestion = () => {
    setDismissedSuggestions((prev) => new Set(prev).add(active.id));
  };

  const handleSend = () => {
    if (!composeText.trim()) {
      showNotification('Escreva uma mensagem antes de enviar.', 'warning');
      return;
    }
    notImplemented(
      composeTab === 'publica'
        ? `Envio via ${CHANNEL_LABEL[active.canal]} ainda não implementado.`
        : 'Nota interna ainda não implementada.',
    );
    setComposeText('');
  };

  const handleMarkResolved = () => {
    setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, tag: 'resolvido', unread: false } : c)));
    showNotification('Conversa marcada como resolvida.', 'success');
  };

  const handleConvertTicket = () => {
    notImplemented('Conversão em ticket CRM ainda não implementada.');
  };

  return (
    <div className="grs-panel">
      <button type="button" className="especiais-page__back" onClick={onBack}>
        <i className="ti ti-arrow-left" aria-hidden="true" />
        Voltar
      </button>

      <div className="grs-panel__tabs-row">
        <nav className="ra-tabs grs-panel__toptabs" aria-label="Áreas de gestão de redes sociais">
          {TOP_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={'ra-tabs__btn' + (topTab === tab.id ? ' is-active' : '')}
              onClick={() => setTopTab(tab.id)}
            >
              <i className={`ti ${tab.icon}`} aria-hidden="true" />
              {tab.label}
              {tab.count != null ? <span className="grs-tab-count">{tab.count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="grs-panel__channel-filters">
          {CHANNELS.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={'ra-chip grs-channel-chip' + (activeChannels.has(channel.id) ? ' is-active' : '')}
              style={{ '--grs-channel-color': channel.color }}
              onClick={() => toggleChannel(channel.id)}
            >
              <span className="grs-channel-chip__dot" />
              {channel.label}
            </button>
          ))}
          <button
            type="button"
            className="grs-filters-btn"
            onClick={() => notImplemented('Filtros avançados ainda não implementados.')}
          >
            <i className="ti ti-adjustments-horizontal" aria-hidden="true" />
            Filtros
          </button>
        </div>
      </div>

      {topTab !== 'inbox' ? (
        <div className="especiais-channel-shell__placeholder">
          <i className={`ti ${TOP_TABS.find((t) => t.id === topTab)?.icon}`} aria-hidden="true" />
          <p>
            Área de <strong>{TOP_TABS.find((t) => t.id === topTab)?.label}</strong> em construção.
          </p>
        </div>
      ) : (
        <div className="grs-inbox">
          <div className="grs-list">
            <div className="grs-list__head">
              <h4 className="grs-list__title">
                Conversas
                <span className="grs-tab-count">{filteredConversations.length}</span>
              </h4>
            </div>
            <label className="grs-list__search">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar conversa…"
              />
            </label>
            <div className="grs-list__status-tabs">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={'ra-chip' + (statusTab === tab.id ? ' is-active' : '')}
                  onClick={() => setStatusTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="grs-list__items">
              {filteredConversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={'grs-list-item' + (c.id === active.id ? ' is-active' : '')}
                  onClick={() => handleSelectConversation(c.id)}
                >
                  <span className="grs-list-item__avatar" style={{ background: c.cor }}>{c.iniciais}</span>
                  <span className="grs-list-item__body">
                    <span className="grs-list-item__top">
                      <span className="grs-list-item__name">{c.nome}</span>
                      <span className="grs-list-item__time">{c.hora}</span>
                    </span>
                    <span className="grs-list-item__preview">{c.preview}</span>
                    <span className="grs-list-item__tags">
                      <span className="grs-tag grs-tag--canal">{c.canalLabel}</span>
                      <span className={`grs-tag grs-tag--${c.tag}`}>{TAG_META[c.tag]}</span>
                    </span>
                  </span>
                  {c.unread ? <span className="grs-list-item__unread" aria-hidden="true" /> : null}
                </button>
              ))}
              {!filteredConversations.length ? (
                <p className="config-placeholder-msg">Nenhuma conversa encontrada.</p>
              ) : null}
            </div>
          </div>

          <div className="grs-thread">
            <div className="grs-thread__head">
              <span className="grs-thread__avatar" style={{ background: active.cor }}>{active.iniciais}</span>
              <span className="grs-thread__who">
                <span className="grs-thread__name">{active.nome}</span>
                <span className="grs-thread__meta">
                  <i className={`ti ${channelIcon(active.canal)}`} aria-hidden="true" />
                  {active.canalLabel} · {active.handle}
                </span>
              </span>
              <div className="grs-thread__head-actions">
                <button type="button" className="grs-thread__head-btn" onClick={handleConvertTicket}>
                  <i className="ti ti-ticket" aria-hidden="true" />
                  Criar ticket
                </button>
                <button
                  type="button"
                  className="grs-thread__head-btn"
                  onClick={() => notImplemented('Perfil do remetente ainda não implementado.')}
                >
                  <i className="ti ti-user" aria-hidden="true" />
                  Ver perfil
                </button>
                <button
                  type="button"
                  className="grs-thread__head-btn grs-thread__head-btn--icon"
                  onClick={() => notImplemented('Mais ações ainda não implementadas.')}
                >
                  <i className="ti ti-dots" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="grs-thread__body">
              <span className="grs-thread__divider">
                Conversa iniciada hoje às {active.thread[0]?.hora} via {active.canalLabel}
              </span>

              {active.thread.map((msg, idx) => (
                <div key={idx} className={'grs-bubble' + (msg.autor === 'agente' ? ' grs-bubble--agente' : '')}>
                  <p className="grs-bubble__text">{msg.texto}</p>
                  <span className="grs-bubble__time">
                    {msg.hora}
                    {msg.autor === 'agente' ? <i className="ti ti-checks" aria-hidden="true" /> : null}
                  </span>
                </div>
              ))}

              {active.notaInterna ? (
                <div className="grs-note">
                  <i className="ti ti-lock" aria-hidden="true" />
                  <p><strong>Nota interna:</strong> {active.notaInterna}</p>
                </div>
              ) : null}

              {active.sugestaoIa && !dismissedSuggestions.has(active.id) ? (
                <div className="grs-ai-suggestion">
                  <div className="grs-ai-suggestion__head">
                    <i className="ti ti-sparkles" aria-hidden="true" />
                    Sugestão IA · Claude · confiança {active.sugestaoIa.confianca}%
                  </div>
                  <p className="grs-ai-suggestion__text">{active.sugestaoIa.texto}</p>
                  <div className="grs-ai-suggestion__actions">
                    <button type="button" className="ra-registro__btn ra-registro__btn--primary" onClick={handleUseSuggestion}>
                      Usar resposta
                    </button>
                    <button type="button" className="ra-registro__btn ra-registro__btn--ghost" onClick={handleUseSuggestion}>
                      Editar
                    </button>
                    <button type="button" className="grs-ai-suggestion__ignore" onClick={handleIgnoreSuggestion}>
                      Ignorar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grs-composer">
              <nav className="ra-tabs grs-composer__tabs">
                <button
                  type="button"
                  className={'ra-tabs__btn' + (composeTab === 'publica' ? ' is-active' : '')}
                  onClick={() => setComposeTab('publica')}
                >
                  Resposta pública
                </button>
                <button
                  type="button"
                  className={'ra-tabs__btn' + (composeTab === 'interna' ? ' is-active' : '')}
                  onClick={() => setComposeTab('interna')}
                >
                  Nota interna
                </button>
              </nav>
              <textarea
                className="grs-composer__textarea"
                rows={3}
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                placeholder={composeTab === 'publica'
                  ? `Escreva uma resposta para ${active.nome.split(' ')[0]}…`
                  : 'Escreva uma nota interna…'}
              />
              <div className="grs-composer__toolbar">
                <button
                  type="button"
                  className="grs-composer__tool-btn"
                  onClick={() => notImplemented('Anexos ainda não implementados.')}
                >
                  <i className="ti ti-paperclip" aria-hidden="true" />
                  Anexo
                </button>
                <button
                  type="button"
                  className="grs-composer__tool-btn"
                  onClick={() => notImplemented('Emojis ainda não implementados.')}
                >
                  <i className="ti ti-mood-smile" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="grs-composer__tool-btn"
                  onClick={() => notImplemented('Templates ainda não implementados.')}
                >
                  <i className="ti ti-template" aria-hidden="true" />
                  Templates
                </button>
                <button type="button" className="grs-composer__send-btn" onClick={handleSend}>
                  <i className="ti ti-send" aria-hidden="true" />
                  {composeTab === 'publica' ? `Enviar via ${CHANNEL_LABEL[active.canal]}` : 'Salvar nota interna'}
                </button>
              </div>
            </div>
          </div>

          <div className="grs-sidebar">
            <section className="grs-sidebar__section">
              <h5 className="grs-sidebar__label">Remetente</h5>
              <p className="grs-sidebar__row"><i className="ti ti-user" aria-hidden="true" />{active.nome}</p>
              <p className="grs-sidebar__row"><i className={`ti ${channelIcon(active.canal)}`} aria-hidden="true" />{active.handle}</p>
              <p className="grs-sidebar__row"><i className="ti ti-users" aria-hidden="true" />{active.seguidores.toLocaleString('pt-BR')} seguidores</p>
            </section>

            <section className="grs-sidebar__section">
              <h5 className="grs-sidebar__label">Classificação</h5>
              <select
                className="ra-registro__select"
                value={classificacao.categoria}
                onChange={(e) => updateClassificacao('categoria', e.target.value)}
              >
                {CLASSIFICACAO_CATEGORIAS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
              <select
                className="ra-registro__select"
                value={classificacao.motivo}
                onChange={(e) => updateClassificacao('motivo', e.target.value)}
              >
                {CLASSIFICACAO_MOTIVOS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
              <select
                className="ra-registro__select"
                value={classificacao.status}
                onChange={(e) => updateClassificacao('status', e.target.value)}
              >
                {CLASSIFICACAO_STATUS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </section>

            <section className="grs-sidebar__section">
              <h5 className="grs-sidebar__label">Sentimento detectado</h5>
              <span className={`ra-badge ra-badge--${active.sentimento.tom}`}>{active.sentimento.label}</span>
              <span className="grs-sidebar__confidence">Confiança {active.sentimento.confianca}%</span>
            </section>

            <section className="grs-sidebar__section">
              <h5 className="grs-sidebar__label">Histórico</h5>
              <p className="grs-sidebar__muted">1ª interação com a Velotax</p>
              <p className="grs-sidebar__muted">Nenhum ticket anterior</p>
            </section>

            <section className="grs-sidebar__section">
              <h5 className="grs-sidebar__label">Responsável</h5>
              <select className="ra-registro__select" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
                {agentOptions.length ? (
                  agentOptions.map((name) => <option key={name} value={name}>{name}</option>)
                ) : (
                  <option value="">Carregando agentes…</option>
                )}
              </select>
            </section>

            <section className="grs-sidebar__section">
              <h5 className="grs-sidebar__label">Ações</h5>
              <button type="button" className="grs-sidebar__action-btn grs-sidebar__action-btn--primary" onClick={handleConvertTicket}>
                <i className="ti ti-ticket" aria-hidden="true" />
                Converter em ticket CRM
              </button>
              <button type="button" className="grs-sidebar__action-btn" onClick={handleMarkResolved}>
                <i className="ti ti-circle-check" aria-hidden="true" />
                Marcar como resolvido
              </button>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
