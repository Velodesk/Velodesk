/**
 * AprovacaoIaPage v1.0.0 — fila de aprovação humana das respostas do agente autônomo.
 * Usa o layout de revisão da Área de IA (IaTicketReview) alimentado por /api/ai-approvals.
 * Aprovar = envia a resposta (editada ou não), tabula, assume e resolve o ticket.
 * Reprovar (com/sem feedback) = nova tentativa da IA; na 2ª reprovação o ticket volta ao atendimento humano.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDeskV2Mode } from '../../hooks/useDeskV2Mode';
import { aiApprovalsApi, tabulationApi } from '../../api/client';
import { apiTicketToCockpit } from '../../api/adapters/ticketAdapter';
import { useNotifications } from '../../context/NotificationContext';
import IaTicketReview from '../ia/components/IaTicketReview';

function errMsg(err, fallback) {
  return err?.response?.data?.error || err?.response?.data?.message || err?.message || fallback;
}

const REJECT_MESSAGES = {
  aguardando_aprovacao: 'Reprovado. A IA gerou uma nova resposta para você revisar.',
  encerrada_humano: 'Reprovado. O ticket voltou para o atendimento humano.',
};

export default function AprovacaoIaPage() {
  useDeskV2Mode();
  const { showNotification } = useNotifications();
  const [list, setList] = useState({ items: [], total: 0 });
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [tree, setTree] = useState(null);
  const [tab, setTab] = useState({ tipo: '', produto: '', motivo: '', detalhe: '' });

  const loadList = useCallback(async () => {
    try {
      const data = await aiApprovalsApi.list({ status: 'aguardando_aprovacao', limit: 100 });
      setList({ items: data.items || [], total: data.total || 0 });
      return data.items || [];
    } catch (err) {
      showNotification(errMsg(err, 'Erro ao carregar a fila de aprovação.'), 'error');
      return [];
    } finally {
      setLoadingList(false);
    }
  }, [showNotification]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    tabulationApi.getActive().then(setTree).catch(() => setTree(null));
  }, []);

  useEffect(() => {
    const t = detail?.pendente?.tabulacao;
    setTab({ tipo: t?.tipo || '', produto: t?.produto || '', motivo: t?.motivo || '', detalhe: t?.detalhe || '' });
  }, [detail]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    let cancelled = false;
    setLoadingDetail(true);
    aiApprovalsApi.get(selectedId)
      .then((item) => { if (!cancelled) setDetail(item); })
      .catch((err) => {
        if (!cancelled) {
          setDetail(null);
          showNotification(errMsg(err, 'Erro ao carregar o ticket.'), 'error');
        }
      })
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [selectedId, showNotification]);

  const selectNextAfter = useCallback(async (removedId) => {
    const items = await loadList();
    const next = items.find((item) => item.id !== removedId);
    setSelectedId(next ? next.id : '');
  }, [loadList]);

  const cockpit = useMemo(() => (detail?.ticket ? apiTicketToCockpit(detail.ticket) : null), [detail]);
  const ai = useMemo(() => ({
    loading: false,
    error: null,
    hasSuggestion: Boolean(detail?.pendente?.resposta),
    respostaSugerida: detail?.pendente?.resposta || '',
    auditScore: detail?.pendente?.auditScore,
    waitingMessage: '',
  }), [detail]);

  const proposta = detail?.pendente?.tabulacao || {};
  const tabChanged = ['tipo', 'produto', 'motivo', 'detalhe'].some((k) => (tab[k] || '') !== (proposta[k] || ''));
  const tipoOptions = tree?.opcoes?.tipoChamado || [];
  const produtoOptions = (tree?.produtos || []).filter((p) => p.ativo !== false);
  const motivoOptions = (produtoOptions.find((p) => p.produto === tab.produto)?.motivos || []).filter((m) => m.ativo !== false);
  const detalheOptions = (motivoOptions.find((m) => m.motivo === tab.motivo)?.detalhes || []).filter((d) => d.ativo !== false);

  const changeTab = (field, value) => setTab((prev) => {
    const next = { ...prev, [field]: value };
    if (field === 'produto') { next.motivo = ''; next.detalhe = ''; }
    if (field === 'motivo') next.detalhe = '';
    return next;
  });

  const handleApprove = async (text) => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      await aiApprovalsApi.approve(detail.id, text, tabChanged ? tab : undefined);
      showNotification('Resposta enviada ao cliente e ticket resolvido.', 'success');
      await selectNextAfter(detail.id);
    } catch (err) {
      showNotification(errMsg(err, 'Não foi possível aprovar.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!detail || busy) return;
    setBusy(true);
    try {
      const result = await aiApprovalsApi.reject(detail.id, feedback.trim() || undefined);
      showNotification(REJECT_MESSAGES[result.status] || 'Reprovado.', 'success');
      setRejectOpen(false);
      setFeedback('');
      if (result.status === 'aguardando_aprovacao') {
        await loadList();
        setDetail(await aiApprovalsApi.get(detail.id));
      } else {
        await selectNextAfter(detail.id);
      }
    } catch (err) {
      showNotification(errMsg(err, 'Não foi possível reprovar.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="velodeskDeskV2Root" className="aprov-ia">
      <aside className="aprov-ia__list" aria-label="Respostas aguardando aprovação">
        <header className="aprov-ia__list-head">
          <h2>Aprovação de respostas da IA</h2>
          <span>{list.total} aguardando</span>
        </header>
        {loadingList ? <p className="aprov-ia__empty">Carregando…</p> : null}
        {!loadingList && list.items.length === 0 ? (
          <p className="aprov-ia__empty">Nenhuma resposta aguardando aprovação.</p>
        ) : null}
        <ul>
          {list.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={'aprov-ia__item' + (item.id === selectedId ? ' is-active' : '')}
                onClick={() => setSelectedId(item.id)}
              >
                <strong>#{item.protocolo}</strong>
                <span className="aprov-ia__item-title">{item.titulo || 'Sem título'}</span>
                <span className="aprov-ia__item-meta">
                  {item.pendente?.tabulacao?.produto || '—'}
                  {item.tentativa > 1 ? ' · 2ª tentativa' : ''}
                  {typeof item.aguardandoMinutos === 'number' ? ` · ${item.aguardandoMinutos} min` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="aprov-ia__main">
        {!selectedId ? (
          <p className="aprov-ia__empty">Selecione um ticket na lista para revisar a resposta da IA.</p>
        ) : loadingDetail || !cockpit ? (
          <p className="aprov-ia__empty">Carregando ticket…</p>
        ) : (
          <IaTicketReview
            ticket={cockpit}
            client={null}
            messages={cockpit.messages || []}
            ticketStatus={{ label: 'Aguardando aprovação', cls: 'novo' }}
            channelLabel={cockpit.lateralForm?.canal || cockpit.channel || ''}
            ai={ai}
            onApproveSend={handleApprove}
            onReject={() => setRejectOpen(true)}
            sending={busy}
          />
        )}
      </main>

      {selectedId && cockpit ? (
        <aside className="crm-right-panel crm-right-panel--ia aprov-ia__tab" aria-label="Tabulação">
          <div className="crm-right-panel__scroll">
            <section className="rp-section rp-section--ia-card">
              <div className="rp-section__label">Tabulação proposta pela IA</div>
              <div className="rp-field">
                <label htmlFor="aprovCanal">Canal</label>
                <input id="aprovCanal" type="text" readOnly value={cockpit.lateralForm?.canal || cockpit.channel || ''} />
              </div>
              <div className="rp-field">
                <label htmlFor="aprovTipo">Tipo</label>
                <select id="aprovTipo" value={tab.tipo} disabled={busy} onChange={(e) => changeTab('tipo', e.target.value)}>
                  {tab.tipo && !tipoOptions.includes(tab.tipo) ? <option value={tab.tipo}>{tab.tipo}</option> : null}
                  {tipoOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="rp-field">
                <label htmlFor="aprovProduto">Produto</label>
                <select id="aprovProduto" value={tab.produto} disabled={busy} onChange={(e) => changeTab('produto', e.target.value)}>
                  <option value="">Selecionar</option>
                  {produtoOptions.map((p) => <option key={p._id} value={p.produto}>{p.produto}</option>)}
                </select>
              </div>
              <div className="rp-field">
                <label htmlFor="aprovMotivo">Motivo</label>
                <select id="aprovMotivo" value={tab.motivo} disabled={busy || !motivoOptions.length} onChange={(e) => changeTab('motivo', e.target.value)}>
                  <option value="">Selecionar</option>
                  {motivoOptions.map((m) => <option key={m.motivo} value={m.motivo}>{m.motivo}</option>)}
                </select>
              </div>
              <div className="rp-field">
                <label htmlFor="aprovDetalhe">Detalhe</label>
                <select id="aprovDetalhe" value={tab.detalhe} disabled={busy || !detalheOptions.length} onChange={(e) => changeTab('detalhe', e.target.value)}>
                  <option value="">Selecionar</option>
                  {detalheOptions.map((d) => <option key={d.detalhe} value={d.detalhe}>{d.detalhe}</option>)}
                </select>
              </div>
              <p className="rp-field-hint">
                {tabChanged
                  ? 'Você alterou a tabulação sugerida: a nova será gravada ao aprovar.'
                  : 'A tabulação sugerida pela IA será gravada ao aprovar.'}
              </p>
              {tabChanged ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setTab({ tipo: proposta.tipo || '', produto: proposta.produto || '', motivo: proposta.motivo || '', detalhe: proposta.detalhe || '' })}>
                  Restaurar sugestão da IA
                </button>
              ) : null}
            </section>
          </div>
        </aside>
      ) : null}

      {rejectOpen ? (
        <div className="aprov-ia__modal-backdrop" role="dialog" aria-modal="true" aria-label="Reprovar resposta">
          <div className="aprov-ia__modal">
            <h3>Reprovar resposta da IA</h3>
            <p>
              {detail?.tentativa >= 2
                ? 'Esta é a 2ª tentativa: ao reprovar, o ticket volta para o atendimento humano e a IA não responde mais nele.'
                : 'A IA vai reescrever a resposta e você poderá revisar a nova versão. O feedback é opcional.'}
            </p>
            <textarea
              rows={5}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Feedback para a IA (opcional)"
              disabled={busy}
            />
            <div className="aprov-ia__modal-actions">
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRejectOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={handleReject}>
                {busy ? 'Reprovando…' : 'Reprovar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
