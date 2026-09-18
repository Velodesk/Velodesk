/**
 * AvaliacoesPanel — avaliações reais da Google Play (via GET /api/redes-sociais/comentarios
 * ?canal=google_play), classificadas por IA. Responder/ignorar grava no Velodesk — publicar
 * de fato no Google Play ainda não está integrado, só o registro da resposta aqui.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { redesSociaisApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';

const STATUS_TABS = [
  { id: 'todas', label: 'Todas' },
  { id: '1-2-estrelas', label: '1-2 estrelas' },
  { id: 'sem-resposta', label: 'Sem resposta' },
];

function renderStars(nota) {
  const n = Math.max(0, Math.min(5, Number(nota) || 0));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

function formatarData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AvaliacoesPanel() {
  const { showNotification } = useNotifications();
  const [reviews, setReviews] = useState([]);
  const [relatorio, setRelatorio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].id);
  const [drafts, setDrafts] = useState({});
  const [editingIds, setEditingIds] = useState(() => new Set());
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { canal: 'google_play', pageSize: 50 };
      if (statusTab === 'sem-resposta') {
        params.respondido = false;
        params.ignorado = false;
      }
      const [listData, relatorioData] = await Promise.all([
        redesSociaisApi.listComentarios(params),
        redesSociaisApi.relatorio({ canal: 'google_play' }),
      ]);
      const items = listData.items || [];
      setReviews(items);
      setRelatorio(relatorioData);
      setEditingIds(new Set(items.filter((r) => !r.respondido && !r.ignorado).map((r) => r._id)));
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Não foi possível carregar as avaliações.');
    } finally {
      setLoading(false);
    }
  }, [statusTab]);

  useEffect(() => { load(); }, [load]);

  const visibleReviews = useMemo(() => {
    if (statusTab === '1-2-estrelas') return reviews.filter((r) => (r.notaEstrelas ?? 0) <= 2);
    return reviews;
  }, [reviews, statusTab]);

  const updateDraft = (id, value) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const handleEditarResposta = (id) => {
    setEditingIds((prev) => new Set(prev).add(id));
  };

  const handleIgnorar = async (review) => {
    try {
      await redesSociaisApi.ignorar(review._id);
      showNotification('Avaliação marcada como ignorada.', 'info');
      load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível ignorar a avaliação.', 'error');
    }
  };

  const handlePublicar = async (review) => {
    const texto = (drafts[review._id] ?? review.resposta ?? '').trim();
    if (!texto) {
      showNotification('Escreva uma resposta antes de publicar.', 'warning');
      return;
    }
    setSavingId(review._id);
    try {
      await redesSociaisApi.responder(review._id, texto);
      showNotification(
        'Resposta registrada no Velodesk. Publicação direto no Google Play ainda não implementada.',
        'info',
      );
      load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível salvar a resposta.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const kpis = [
    { id: 'total', label: 'Avaliações', valor: String(relatorio?.totalPorCanal?.google_play ?? '—'), tone: 'positivo' },
    { id: 'sem-resposta', label: 'Sem resposta', valor: String(relatorio?.semResposta ?? '—'), tone: 'negativo' },
    { id: 'negativas', label: 'Negativas', valor: String(relatorio?.totalPorSentimento?.negativo ?? 0), tone: 'negativo' },
    { id: 'positivas', label: 'Positivas', valor: String(relatorio?.totalPorSentimento?.positivo ?? 0), tone: 'positivo' },
  ];

  return (
    <div className="av-panel">
      <div className="gp-kpis av-panel__kpis">
        {kpis.map((kpi) => (
          <div key={kpi.id} className={`gp-kpi av-kpi av-kpi--${kpi.tone}`}>
            <span className="gp-kpi__label">{kpi.label}</span>
            <span className="gp-kpi__value">{kpi.valor}</span>
          </div>
        ))}
      </div>

      <div className="av-panel__list-head">
        <h4 className="av-panel__list-title">Avaliações · Google Play</h4>
        <p className="av-panel__list-subtitle">Ordenadas por data · mais recentes primeiro</p>
      </div>

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

      <div className="av-panel__list">
        {loading ? <p className="config-placeholder-msg">Carregando…</p> : null}
        {!loading && error ? <p className="config-placeholder-msg">{error}</p> : null}
        {!loading && !error && !visibleReviews.length ? (
          <p className="config-placeholder-msg">Nenhuma avaliação encontrada.</p>
        ) : null}

        {!loading && !error ? visibleReviews.map((review) => {
          const isEditing = editingIds.has(review._id);
          return (
            <article key={review._id} className="av-review">
              <div className="av-review__top">
                <div className="av-review__author">
                  <span className="av-review__name">{review.nomeCliente}</span>
                  <span className="av-review__stars" aria-hidden="true">{renderStars(review.notaEstrelas)}</span>
                </div>
                <div className="av-review__device">
                  <span>{formatarData(review.dataHora)}</span>
                </div>
              </div>

              <p className="av-review__text">"{review.mensagem}"</p>

              {isEditing ? (
                <div className="av-review__reply-box">
                  <textarea
                    className="ra-registro__textarea"
                    rows={2}
                    value={drafts[review._id] ?? ''}
                    onChange={(e) => updateDraft(review._id, e.target.value)}
                    placeholder="Escreva a resposta pública…"
                    disabled={savingId === review._id}
                  />
                  <div className="av-review__actions">
                    <button
                      type="button"
                      className="cm-composer__ignore-btn"
                      onClick={() => handleIgnorar(review)}
                      disabled={savingId === review._id}
                    >
                      Ignorar
                    </button>
                    <button
                      type="button"
                      className="ra-registro__btn ra-registro__btn--primary"
                      onClick={() => handlePublicar(review)}
                      disabled={savingId === review._id}
                    >
                      <i className="ti ti-brand-google-play" aria-hidden="true" />
                      {savingId === review._id ? 'Salvando…' : 'Publicar no Play'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="av-review__answered-box">
                    {review.ignorado ? <strong>Ignorada</strong> : <><strong>Velotax:</strong> {review.resposta}</>}
                  </div>
                  {!review.ignorado ? (
                    <button type="button" className="av-review__edit-link" onClick={() => handleEditarResposta(review._id)}>
                      Editar resposta
                    </button>
                  ) : null}
                </>
              )}
            </article>
          );
        }) : null}
      </div>
    </div>
  );
}
