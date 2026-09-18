/**
 * ComentariosPanel — comentários reais de Facebook/Instagram (via
 * GET /api/redes-sociais/comentarios), já classificados por IA. Responder/ignorar
 * grava no Velodesk (PATCH .../responder e .../ignorar) — publicar de fato no
 * Facebook/Instagram ainda não está integrado, só o registro da resposta aqui.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { redesSociaisApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';

const STATUS_TABS = [
  { id: 'todos', label: 'Todos' },
  { id: 'sem-resposta', label: 'Sem resposta' },
  { id: 'negativos', label: 'Negativos' },
];

const SENTIMENTO_LABEL = { positivo: 'Positivo', neutro: 'Neutro', negativo: 'Negativo' };
const CHANNEL_ICON = { instagram: 'ti-brand-instagram', facebook: 'ti-brand-facebook' };
const CHANNEL_LABEL = { instagram: 'Instagram', facebook: 'Facebook' };
const MOTIVO_LABEL = {
  elogio: 'Elogio',
  reclamacao_atendimento: 'Reclamação · Atendimento',
  reclamacao_prazo_restituicao: 'Reclamação · Prazo de restituição',
  reclamacao_cobranca_preco: 'Reclamação · Cobrança/Preço',
  problema_tecnico_bug: 'Problema técnico / bug',
  duvida_sobre_produto: 'Dúvida sobre produto',
  duvida_sobre_status: 'Dúvida sobre status',
  spam_irrelevante: 'Spam / irrelevante',
  outro: 'Outro',
};

function iniciaisDoNome(nome) {
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ComentariosPanel({ canais = ['facebook', 'instagram'] }) {
  const { showNotification } = useNotifications();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].id);
  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [composerText, setComposerText] = useState('');
  const [saving, setSaving] = useState(false);
  const canalParam = canais.join(',');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { canal: canalParam, pageSize: 50 };
      if (statusTab === 'sem-resposta') {
        params.respondido = false;
        params.ignorado = false;
      }
      if (statusTab === 'negativos') params.sentimento = 'negativo';
      if (search.trim()) params.busca = search.trim();
      const data = await redesSociaisApi.listComentarios(params);
      setComments(data.items || []);
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Não foi possível carregar os comentários.');
    } finally {
      setLoading(false);
    }
  }, [statusTab, search, canalParam]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!comments.length) {
      setActiveId(null);
      return;
    }
    if (!comments.some((c) => c._id === activeId)) {
      setActiveId(comments[0]._id);
    }
  }, [comments, activeId]);

  const active = comments.find((c) => c._id === activeId) || null;

  useEffect(() => {
    setComposerText(active?.resposta || '');
  }, [active?._id, active?.resposta]);

  const handleIgnorar = async () => {
    if (!active) return;
    try {
      await redesSociaisApi.ignorar(active._id);
      showNotification('Comentário marcado como ignorado.', 'info');
      load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível ignorar o comentário.', 'error');
    }
  };

  const handlePublicar = async () => {
    if (!active) return;
    if (!composerText.trim()) {
      showNotification('Escreva uma resposta antes de publicar.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await redesSociaisApi.responder(active._id, composerText.trim());
      showNotification(
        'Resposta registrada no Velodesk. Publicação direto no Facebook/Instagram ainda não implementada.',
        'info',
      );
      load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível salvar a resposta.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cm-panel">
      <div className="grs-list cm-list">
        <div className="grs-list__head">
          <h4 className="grs-list__title">
            Comentários
            <span className="grs-tab-count">{comments.length}</span>
          </h4>
          <button
            type="button"
            className="grs-thread__head-btn grs-thread__head-btn--icon"
            onClick={load}
            title="Atualizar lista"
            aria-label="Atualizar lista"
          >
            <i className="ti ti-refresh" aria-hidden="true" />
          </button>
        </div>
        <label className="grs-list__search">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar comentário…"
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
          {loading ? <p className="config-placeholder-msg">Carregando…</p> : null}
          {!loading && error ? <p className="config-placeholder-msg">{error}</p> : null}
          {!loading && !error && !comments.length ? (
            <p className="config-placeholder-msg">Nenhum comentário encontrado.</p>
          ) : null}
          {!loading && !error ? comments.map((comment) => (
            <button
              key={comment._id}
              type="button"
              className={'cm-item' + (comment._id === activeId ? ' is-active' : '')}
              onClick={() => setActiveId(comment._id)}
            >
              <span className="cm-item__post">
                <i className={`ti ${CHANNEL_ICON[comment.canal]}`} aria-hidden="true" />
                {CHANNEL_LABEL[comment.canal]} · {comment.nomeCliente}
              </span>
              <span className="cm-item__texto">{comment.mensagem}</span>
              <span className="cm-item__meta">
                <span className="cm-item__handle">{formatarData(comment.dataHora)}</span>
                <span className={`ra-badge ra-badge--${comment.sentimento}`}>
                  {SENTIMENTO_LABEL[comment.sentimento]}
                </span>
              </span>
            </button>
          )) : null}
        </div>
      </div>

      <div className="cm-main">
        {!active ? (
          <p className="config-placeholder-msg">
            {loading ? 'Carregando…' : 'Selecione um comentário na lista.'}
          </p>
        ) : (
          <>
            <section className="ra-registro__card">
              <h2 className="ra-registro__card-title">Comentário selecionado</h2>
              <div className="cm-thread">
                <div className="cm-thread__bubble">
                  <span className="cm-thread__avatar" style={{ background: '#1634FF' }}>
                    {iniciaisDoNome(active.nomeCliente)}
                  </span>
                  <div className="cm-thread__body">
                    <span className="cm-thread__name">{active.nomeCliente}</span>
                    <p className="cm-thread__text">"{active.mensagem}"</p>
                    <div className="cm-thread__meta">
                      <span>{formatarData(active.dataHora)}</span>
                      <span className={`ra-badge ra-badge--${active.sentimento}`}>
                        {SENTIMENTO_LABEL[active.sentimento]}
                      </span>
                      <span>{MOTIVO_LABEL[active.motivo] || active.motivo}</span>
                      {active.confiancaIa != null ? <span>IA {active.confiancaIa}%</span> : null}
                    </div>
                  </div>
                </div>

                {active.respondido ? (
                  <div className="cm-thread__bubble cm-thread__bubble--published">
                    <span className="cm-thread__avatar cm-thread__avatar--brand">V</span>
                    <div className="cm-thread__body">
                      <span className="cm-thread__name">Velotax Oficial</span>
                      <p className="cm-thread__text">{active.resposta}</p>
                      <div className="cm-thread__meta">
                        <span className="cm-thread__draft-label cm-thread__draft-label--ok">
                          <i className="ti ti-check" aria-hidden="true" />
                          Respondido{active.respondidoPor ? ` por ${active.respondidoPor}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : active.ignorado ? (
                  <div className="cm-thread__bubble">
                    <div className="cm-thread__body">
                      <span className="cm-thread__draft-label">Marcado como ignorado</span>
                    </div>
                  </div>
                ) : null}
              </div>
              {active.linkOriginal ? (
                <p style={{ marginTop: '0.65rem' }}>
                  <a
                    href={active.linkOriginal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cm-composer__scope"
                  >
                    <i className="ti ti-external-link" aria-hidden="true" /> Ver no {CHANNEL_LABEL[active.canal]}
                  </a>
                </p>
              ) : null}
            </section>

            <section className="ra-registro__card">
              <div className="ra-registro__card-head">
                <h2 className="ra-registro__card-title">Responder como Velotax Oficial</h2>
                <span className="cm-composer__scope">{CHANNEL_LABEL[active.canal]} · público</span>
              </div>
              <textarea
                className="ra-registro__textarea"
                rows={3}
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                placeholder={`Escreva uma resposta pública para ${active.nomeCliente}…`}
                disabled={saving}
              />
              <div className="cm-composer__actions">
                <button type="button" className="cm-composer__ignore-btn" onClick={handleIgnorar} disabled={saving}>
                  Ignorar
                </button>
                <button
                  type="button"
                  className="ra-registro__btn ra-registro__btn--primary"
                  onClick={handlePublicar}
                  disabled={saving}
                >
                  <i className="ti ti-send" aria-hidden="true" />
                  {saving ? 'Salvando…' : 'Publicar resposta'}
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
