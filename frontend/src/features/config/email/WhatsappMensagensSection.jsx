/**
 * WhatsappMensagensSection — registro de modelos de mensagem (templates) exigidos pela
 * Meta pra iniciar uma conversa com o cliente ou reativar uma janela de 24h já encerrada.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { whatsappTemplatesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import WhatsappTemplateEditor from './WhatsappTemplateEditor';
import WhatsappDisponibilidadeModal from './WhatsappDisponibilidadeModal';
import WhatsappTemplateRowMenu from './WhatsappTemplateRowMenu';
import WhatsappTemplatePreviewModal from './WhatsappTemplatePreviewModal';

const STATUS_LABEL = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  arquivado: 'Arquivado',
};

const DISPONIBILIDADE_PREVIEW_MAX = 2;

function disponibilidadeLabel(disponibilidade) {
  const lista = Array.isArray(disponibilidade) ? disponibilidade : [];
  if (!lista.length || (lista.length === 1 && lista[0] === 'Todos os usuários')) {
    return { texto: 'Todos os usuários', completo: 'Todos os usuários' };
  }
  const completo = lista.join(', ');
  if (lista.length <= DISPONIBILIDADE_PREVIEW_MAX) {
    return { texto: completo, completo };
  }
  return { texto: `${lista.slice(0, DISPONIBILIDADE_PREVIEW_MAX).join(', ')}, …`, completo };
}

const CATEGORIA_LABEL = {
  marketing: 'Marketing',
  utilitario: 'Utilitário',
  autenticacao: 'Autenticação',
};

const IDIOMA_LABEL = {
  pt_BR: 'Português (BR)',
  en_US: 'Inglês (US)',
};

const FILTRO_TODOS = 'todos';

export default function WhatsappMensagensSection({ onNestedViewChange }) {
  const { showNotification } = useNotifications();
  const [search, setSearch] = useState('');
  const [filtroStatus, setFiltroStatus] = useState(FILTRO_TODOS);
  const [filtroCategoria, setFiltroCategoria] = useState(FILTRO_TODOS);
  const [filtroIdioma, setFiltroIdioma] = useState(FILTRO_TODOS);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const [editingDisponibilidadeItem, setEditingDisponibilidadeItem] = useState(null);
  const nestedOpen = Boolean(creating || editingItem);

  useEffect(() => {
    onNestedViewChange?.(nestedOpen);
    return () => onNestedViewChange?.(false);
  }, [nestedOpen, onNestedViewChange]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await whatsappTemplatesApi.list();
      setItems(data?.items || []);
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao carregar modelos de mensagem.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (item) => {
    if (!window.confirm(`Excluir o modelo "${item.nome}"?`)) return;
    try {
      await whatsappTemplatesApi.remove(item.id);
      showNotification('Modelo excluído.', 'success');
      await load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível excluir.', 'error');
    }
  };

  const handleToggleArquivar = async (item) => {
    const novoStatus = item.status === 'arquivado' ? 'pendente' : 'arquivado';
    try {
      await whatsappTemplatesApi.update(item.id, { status: novoStatus });
      showNotification(novoStatus === 'arquivado' ? 'Modelo arquivado.' : 'Modelo desarquivado.', 'success');
      await load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível atualizar o status.', 'error');
    }
  };

  const filteredItems = useMemo(() => {
    const termo = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filtroStatus !== FILTRO_TODOS && item.status !== filtroStatus) return false;
      if (filtroCategoria !== FILTRO_TODOS && item.categoria !== filtroCategoria) return false;
      if (filtroIdioma !== FILTRO_TODOS && item.idioma !== filtroIdioma) return false;
      if (termo && !item.nome.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [items, search, filtroStatus, filtroCategoria, filtroIdioma]);

  if (creating || editingItem) {
    return (
      <WhatsappTemplateEditor
        initialTemplate={editingItem}
        onClose={() => {
          setCreating(false);
          setEditingItem(null);
        }}
        onSaved={load}
      />
    );
  }

  return (
    <div className="config-whatsapp-templates">
      <div className="config-whatsapp-templates__head">
        <p className="config-placeholder-msg">
          Modelos aprovados pela Meta, usados pra iniciar uma conversa com o cliente ou
          reativar uma conversa cuja janela de 24h já encerrou.
        </p>
        <button type="button" className="config-action-btn config-action-btn--create" onClick={() => setCreating(true)}>
          Criar modelo
        </button>
      </div>

      <div className="config-whatsapp-templates__filtros">
        <span className="config-whatsapp-templates__filtros-label">Filtrar por</span>

        <label className="config-whatsapp-templates__filtro">
          <span>Status</span>
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
            <option value={FILTRO_TODOS}>Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="config-whatsapp-templates__filtro">
          <span>Categoria</span>
          <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)}>
            <option value={FILTRO_TODOS}>Todos</option>
            {Object.entries(CATEGORIA_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="config-whatsapp-templates__filtro">
          <span>Idioma</span>
          <select value={filtroIdioma} onChange={(e) => setFiltroIdioma(e.target.value)}>
            <option value={FILTRO_TODOS}>Todos</option>
            {Object.entries(IDIOMA_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label className="config-whatsapp-templates__search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Pesquisar…"
          />
          <i className="ti ti-search" aria-hidden="true" />
        </label>
      </div>

      <div className="config-whatsapp-templates__list">
        {loading ? (
          <p className="config-placeholder-msg">Carregando…</p>
        ) : filteredItems.length === 0 ? (
          <p className="config-placeholder-msg">
            {items.length === 0 ? 'Nenhum modelo cadastrado ainda.' : 'Nenhum modelo encontrado para esses filtros.'}
          </p>
        ) : (
          <table className="config-email-table">
            <thead>
              <tr>
                <th>Nome do modelo</th>
                <th>Categoria</th>
                <th>Disponibilidade</th>
                <th>Status</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const disponibilidade = disponibilidadeLabel(item.disponibilidade);
                return (
                  <tr key={item.id}>
                    <td>{item.nome}</td>
                    <td>
                      <div>{CATEGORIA_LABEL[item.categoria] || item.categoria}</div>
                      <div className="config-whatsapp-templates__idioma">{IDIOMA_LABEL[item.idioma] || item.idioma}</div>
                    </td>
                    <td>
                      <div className="config-whatsapp-templates__disponibilidade" title={disponibilidade.completo}>
                        <span>{disponibilidade.texto}</span>
                        <button
                          type="button"
                          className="config-whatsapp-templates__disponibilidade-edit"
                          onClick={() => setEditingDisponibilidadeItem(item)}
                          aria-label={`Editar disponibilidade de ${item.nome}`}
                        >
                          <i className="ti ti-pencil" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                    <td>{STATUS_LABEL[item.status] || item.status}</td>
                    <td>
                      <WhatsappTemplateRowMenu
                        onVisualizar={() => setViewingItem(item)}
                        onEditar={() => setEditingItem(item)}
                        isArquivado={item.status === 'arquivado'}
                        onToggleArquivar={() => handleToggleArquivar(item)}
                        onExcluir={() => handleDelete(item)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {editingDisponibilidadeItem && (
        <WhatsappDisponibilidadeModal
          item={editingDisponibilidadeItem}
          onClose={() => setEditingDisponibilidadeItem(null)}
          onSaved={load}
        />
      )}

      {viewingItem && (
        <WhatsappTemplatePreviewModal item={viewingItem} onClose={() => setViewingItem(null)} />
      )}
    </div>
  );
}
