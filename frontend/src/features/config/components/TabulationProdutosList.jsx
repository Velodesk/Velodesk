/**
 * TabulationProdutosList v1.6.0 — cards de motivos por órgão
 * VERSION: v1.6.0 | DATE: 2026-08-19
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tabulationApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { TABULACAO_OPCOES_CATEGORIAS } from '../../../services/tabulationConfig';
import TabulationProdutoEditor from './TabulationProdutoEditor';
import TabulationDeleteConfirmModal, { countDetalhes } from './TabulationDeleteConfirmModal';
import TabulationOpcoesModal from './TabulationOpcoesModal';
import ConfigAtivoToggle from './ConfigAtivoToggle';

function computeOpcoesStats(opcoesDocs, categoria) {
  const doc = (opcoesDocs || []).find((item) => item.categoria === categoria);
  const list = doc?.opcoes || [];
  return {
    total: list.length,
    ativos: list.filter((item) => item.ativo !== false).length,
  };
}

function computeStats(produtos) {
  const list = produtos || [];
  return {
    total: list.length,
    ativos: list.filter((p) => p.ativo !== false).length,
    motivos: list.reduce((sum, p) => sum + (p.motivos || []).length, 0),
    detalhes: list.reduce((sum, p) => sum + countDetalhes(p.motivos), 0),
  };
}

function sortProdutos(list) {
  return [...(list || [])].sort((a, b) => {
    const ordemDiff = (a.ordem ?? 0) - (b.ordem ?? 0);
    if (ordemDiff !== 0) return ordemDiff;
    return (a.produto || '').localeCompare(b.produto || '', 'pt-BR');
  });
}

function moveItem(list, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export default function TabulationProdutosList({ id, onChanged }) {
  const { showNotification } = useNotifications();
  const [produtos, setProdutos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [orderEditMode, setOrderEditMode] = useState(false);
  const [orderDraft, setOrderDraft] = useState([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [opcoesDocs, setOpcoesDocs] = useState([]);
  const [opcoesModal, setOpcoesModal] = useState(null);

  const sortedProdutos = useMemo(() => sortProdutos(produtos), [produtos]);
  const stats = useMemo(() => computeStats(produtos), [produtos]);
  const tipoStats = useMemo(
    () => computeOpcoesStats(opcoesDocs, TABULACAO_OPCOES_CATEGORIAS.TIPO_CHAMADO),
    [opcoesDocs]
  );
  const canalStats = useMemo(
    () => computeOpcoesStats(opcoesDocs, TABULACAO_OPCOES_CATEGORIAS.CANAL_CONTATO),
    [opcoesDocs]
  );
  const motivoRaStats = useMemo(
    () => computeOpcoesStats(opcoesDocs, TABULACAO_OPCOES_CATEGORIAS.MOTIVO_RECLAME_AQUI),
    [opcoesDocs]
  );
  const motivoProconStats = useMemo(
    () => computeOpcoesStats(opcoesDocs, TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON),
    [opcoesDocs]
  );
  const motivoGovStats = useMemo(
    () => computeOpcoesStats(opcoesDocs, TABULACAO_OPCOES_CATEGORIAS.MOTIVO_CONSUMIDOR_GOV),
    [opcoesDocs]
  );
  const motivoBacenStats = useMemo(
    () => computeOpcoesStats(opcoesDocs, TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN),
    [opcoesDocs]
  );
  const displayProdutos = orderEditMode ? orderDraft : sortedProdutos;
  const columnCount = orderEditMode ? 3 : 4;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const produtosData = await tabulationApi.listProdutos(true);
      setProdutos(sortProdutos(produtosData || []));
    } catch {
      showNotification('Erro ao carregar produtos.', 'error');
    }

    try {
      const opcoesData = await tabulationApi.listOpcoes(true);
      setOpcoesDocs(opcoesData || []);
    } catch {
      showNotification('Erro ao carregar tipos/canais.', 'warning');
      setOpcoesDocs([]);
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => { load(); }, [load]);

  const toggleAtivo = async (itemId, nextAtivo) => {
    setTogglingId(itemId);
    try {
      await tabulationApi.patchProduto(itemId, { ativo: nextAtivo });
      showNotification(nextAtivo ? 'Produto ativado.' : 'Produto desativado.', 'success');
      await load();
      onChanged?.();
    } catch {
      showNotification('Erro ao atualizar status do produto.', 'error');
    } finally {
      setTogglingId(null);
    }
  };

  const startOrderEdit = () => {
    setOrderDraft(sortedProdutos);
    setOrderEditMode(true);
  };

  const cancelOrderEdit = () => {
    setOrderEditMode(false);
    setOrderDraft([]);
    setDragIndex(null);
  };

  const moveOrderItem = (index, direction) => {
    setOrderDraft((prev) => moveItem(prev, index, index + direction));
  };

  const handleDragStart = (index) => (event) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (index) => (event) => {
    event.preventDefault();
    const fromIndex = dragIndex ?? Number(event.dataTransfer.getData('text/plain'));
    if (Number.isNaN(fromIndex) || fromIndex === index) {
      setDragIndex(null);
      return;
    }
    setOrderDraft((prev) => moveItem(prev, fromIndex, index));
    setDragIndex(null);
  };

  const saveOrder = async () => {
    setSavingOrder(true);
    try {
      const updates = orderDraft
        .map((item, index) => ({ id: item._id, ordem: index }))
        .filter(({ id, ordem }) => {
          const original = sortedProdutos.find((item) => item._id === id);
          return (original?.ordem ?? 0) !== ordem;
        });

      await Promise.all(updates.map(({ id, ordem }) => tabulationApi.patchProduto(id, { ordem })));
      showNotification('Ordem salva.', 'success');
      setOrderEditMode(false);
      setOrderDraft([]);
      await load();
      onChanged?.();
    } catch {
      showNotification('Erro ao salvar ordem.', 'error');
    } finally {
      setSavingOrder(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await tabulationApi.deleteProduto(deleteTarget._id);
      showNotification('Produto excluído.', 'success');
      setDeleteTarget(null);
      await load();
      onChanged?.();
    } catch {
      showNotification('Erro ao excluir produto.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  if (creating || editingId) {
    return (
      <TabulationProdutoEditor
        produtoId={editingId}
        onClose={() => { setCreating(false); setEditingId(null); }}
        onSaved={async () => { await load(); onChanged?.(); }}
      />
    );
  }

  return (
    <div
      id={id}
      className={'config-section-body config-tabulation' + (orderEditMode ? ' config-tabulation--order-edit' : '')}
    >
      <div className="forms-stats-row">
        <button
          type="button"
          className="stat-card stat-card--clickable"
          onClick={() => setOpcoesModal({
            categoria: TABULACAO_OPCOES_CATEGORIAS.TIPO_CHAMADO,
            title: 'Tipos de chamado',
            description: 'Opções exibidas no campo Tipo do painel lateral do desk.',
          })}
        >
          <span className="stat-card__edit-hint" aria-hidden="true">
            <i className="ti ti-pencil" />
          </span>
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-tag" /></span>
          <div className="stat-info">
            <h3>{tipoStats.ativos}</h3>
            <p>Tipos de chamado</p>
          </div>
        </button>
        <button
          type="button"
          className="stat-card stat-card--clickable"
          onClick={() => setOpcoesModal({
            categoria: TABULACAO_OPCOES_CATEGORIAS.CANAL_CONTATO,
            title: 'Canal de contato',
            description: 'Opções exibidas no campo Canal do painel lateral do desk.',
          })}
        >
          <span className="stat-card__edit-hint" aria-hidden="true">
            <i className="ti ti-pencil" />
          </span>
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-message-circle" /></span>
          <div className="stat-info">
            <h3>{canalStats.ativos}</h3>
            <p>Canais de contato</p>
          </div>
        </button>
        <button
          type="button"
          className="stat-card stat-card--clickable"
          onClick={() => setOpcoesModal({
            categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_RECLAME_AQUI,
            title: 'Motivos Reclame Aqui',
            description: 'Lista do campo Motivo no formulário Reclame Aqui — independente da tabulação do Desk.',
          })}
        >
          <span className="stat-card__edit-hint" aria-hidden="true">
            <i className="ti ti-pencil" />
          </span>
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-star" /></span>
          <div className="stat-info">
            <h3>{motivoRaStats.ativos}</h3>
            <p>Motivos Reclame Aqui</p>
          </div>
        </button>
        <button
          type="button"
          className="stat-card stat-card--clickable"
          onClick={() => setOpcoesModal({
            categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON,
            title: 'Motivos Procon',
            description: 'Lista do campo Motivo no formulário Procon — independente da tabulação do Desk.',
          })}
        >
          <span className="stat-card__edit-hint" aria-hidden="true">
            <i className="ti ti-pencil" />
          </span>
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-building-bank" /></span>
          <div className="stat-info">
            <h3>{motivoProconStats.ativos}</h3>
            <p>Motivos Procon</p>
          </div>
        </button>
        <button
          type="button"
          className="stat-card stat-card--clickable"
          onClick={() => setOpcoesModal({
            categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_CONSUMIDOR_GOV,
            title: 'Motivos Consumidor.Gov',
            description: 'Lista do campo Motivo no formulário Consumidor.Gov — independente da tabulação do Desk.',
          })}
        >
          <span className="stat-card__edit-hint" aria-hidden="true">
            <i className="ti ti-pencil" />
          </span>
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-building" /></span>
          <div className="stat-info">
            <h3>{motivoGovStats.ativos}</h3>
            <p>Motivos Consumidor.Gov</p>
          </div>
        </button>
        <button
          type="button"
          className="stat-card stat-card--clickable"
          onClick={() => setOpcoesModal({
            categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN,
            title: 'Motivos Bacen',
            description: 'Lista do campo Motivo no formulário Bacen — independente da tabulação do Desk.',
          })}
        >
          <span className="stat-card__edit-hint" aria-hidden="true">
            <i className="ti ti-pencil" />
          </span>
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-building-skyscraper" /></span>
          <div className="stat-info">
            <h3>{motivoBacenStats.ativos}</h3>
            <p>Motivos Bacen</p>
          </div>
        </button>
        <div className="stat-card stat-card--static">
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-box" /></span>
          <div className="stat-info">
            <h3>{stats.total}</h3>
            <p>Produtos cadastrados</p>
          </div>
        </div>
        <div className="stat-card stat-card--static">
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-circle-check" /></span>
          <div className="stat-info">
            <h3>{stats.ativos}</h3>
            <p>Ativos no desk</p>
          </div>
        </div>
        <div className="stat-card stat-card--static">
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-list-tree" /></span>
          <div className="stat-info">
            <h3>{stats.motivos}</h3>
            <p>Motivos na árvore</p>
          </div>
        </div>
        <div className="stat-card stat-card--static">
          <span className="stat-icon" aria-hidden="true"><i className="ti ti-git-branch" /></span>
          <div className="stat-info">
            <h3>{stats.detalhes}</h3>
            <p>Detalhes vinculados</p>
          </div>
        </div>
      </div>

      <div className="config-table-wrap">
        <div className="config-table-head-actions">
          {orderEditMode ? (
            <>
              <button
                type="button"
                className="config-action-btn config-action-btn--edit config-action-btn--compact"
                onClick={cancelOrderEdit}
                disabled={savingOrder}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="config-action-btn config-action-btn--create config-action-btn--compact"
                onClick={saveOrder}
                disabled={savingOrder}
              >
                {savingOrder ? 'Salvando…' : 'Salvar ordem'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="config-action-btn config-action-btn--edit config-action-btn--compact"
                onClick={startOrderEdit}
                disabled={loading || sortedProdutos.length < 2}
              >
                Editar Ordem
              </button>
              <button
                type="button"
                className="config-action-btn config-action-btn--create config-action-btn--compact"
                onClick={() => setCreating(true)}
              >
                Adicionar Produto
              </button>
            </>
          )}
        </div>

        {orderEditMode && (
          <p className="config-order-edit-hint">
            Arraste pela alça ou use as setas para definir a sequência exibida no desk.
          </p>
        )}

        <table className={'config-table' + (orderEditMode ? ' config-table--order-edit' : '')}>
          <thead>
            <tr>
              {orderEditMode && <th className="config-table-th-order">Ordem</th>}
              <th>Produto</th>
              <th>Motivos</th>
              {!orderEditMode && <th>Ações</th>}
              {!orderEditMode && <th>Status</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount}>
                  <div className="config-loading" role="status">
                    <i className="ti ti-loader-2 config-loading__icon" aria-hidden="true" />
                    <span>Carregando produtos…</span>
                  </div>
                </td>
              </tr>
            ) : displayProdutos.length === 0 ? (
              <tr>
                <td colSpan={columnCount}>
                  <div className="forms-empty-state">
                    <p className="forms-empty-text">Nenhum produto configurado.</p>
                  </div>
                </td>
              </tr>
            ) : (
              displayProdutos.map((item, index) => (
                <tr
                  key={item._id}
                  className={orderEditMode ? 'config-table-row--draggable' : undefined}
                  draggable={orderEditMode}
                  onDragStart={orderEditMode ? handleDragStart(index) : undefined}
                  onDragOver={orderEditMode ? handleDragOver : undefined}
                  onDrop={orderEditMode ? handleDrop(index) : undefined}
                  onDragEnd={orderEditMode ? () => setDragIndex(null) : undefined}
                >
                  {orderEditMode && (
                    <td className="config-table__order-controls">
                      <span className="config-order-handle" aria-hidden="true">
                        <i className="ti ti-grip-vertical" />
                      </span>
                      <div className="config-order-arrows">
                        <button
                          type="button"
                          className="config-order-arrow"
                          aria-label={'Subir ' + item.produto}
                          disabled={index === 0}
                          onClick={() => moveOrderItem(index, -1)}
                        >
                          <i className="ti ti-chevron-up" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="config-order-arrow"
                          aria-label={'Descer ' + item.produto}
                          disabled={index === displayProdutos.length - 1}
                          onClick={() => moveOrderItem(index, 1)}
                        >
                          <i className="ti ti-chevron-down" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  )}
                  <td>
                    <strong className="config-table__name">{item.produto}</strong>
                    {item.apenasInterno && (
                      <span className="config-table__badge" title="Não exibido na API de consulta do app externo">
                        Apenas interno
                      </span>
                    )}
                  </td>
                  <td>{(item.motivos || []).length}</td>
                  {!orderEditMode && (
                    <td className="config-table__actions">
                      <button type="button" className="config-action-btn config-action-btn--edit" onClick={() => setEditingId(item._id)}>Editar</button>
                      <button
                        type="button"
                        className="config-action-btn config-action-btn--delete"
                        onClick={() => setDeleteTarget(item)}
                      >
                        Excluir
                      </button>
                    </td>
                  )}
                  {!orderEditMode && (
                    <td>
                      <ConfigAtivoToggle
                        ativo={item.ativo}
                        onChange={(nextAtivo) => toggleAtivo(item._id, nextAtivo)}
                        disabled={togglingId === item._id}
                      />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TabulationDeleteConfirmModal
        produto={deleteTarget}
        motivosCount={(deleteTarget?.motivos || []).length}
        detalhesCount={countDetalhes(deleteTarget?.motivos)}
        deleting={deleting}
        onCancel={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={confirmDelete}
      />

      {opcoesModal && (
        <TabulationOpcoesModal
          categoria={opcoesModal.categoria}
          title={opcoesModal.title}
          description={opcoesModal.description}
          onClose={() => setOpcoesModal(null)}
          onChanged={async () => {
            await load();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
