/**
 * EmailRemetentesSection v1.0.0 — listas ignorados, spam e prioritários (inbound)
 * VERSION: v1.0.0 | DATE: 2026-08-20
 */
import React, { useCallback, useEffect, useState } from 'react';
import { mailRulesApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';

const LISTS = [
  { id: 'ignorado', label: 'Ignorados', description: 'Remetentes que não geram ticket nem resposta.' },
  { id: 'spam', label: 'Spam / Lixo', description: 'Mesmo comportamento dos ignorados; use para lixo conhecido.' },
  { id: 'priority', label: 'Prioritários', description: 'Novos tickets entram com prioridade alta.' },
];

function formatType(type) {
  return type === 'domain' ? 'Domínio' : 'E-mail';
}

function MailRulesPanel({ listId, listLabel, listDescription }) {
  const { showNotification } = useNotifications();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ type: 'email', value: '', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mailRulesApi.list(listId);
      setItems(data?.items || []);
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao carregar regras de e-mail.', 'error');
    } finally {
      setLoading(false);
    }
  }, [listId, showNotification]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.value.trim()) {
      showNotification('Informe um e-mail ou domínio.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await mailRulesApi.create(listId, form);
      setForm({ type: form.type, value: '', note: '' });
      showNotification('E-mail adicionado', 'success');
      await load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível adicionar a regra.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (item) => {
    try {
      await mailRulesApi.patch(listId, item.id, { active: !item.active });
      await load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao atualizar regra.', 'error');
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Remover "${item.value}" da lista ${listLabel}?`)) return;
    try {
      await mailRulesApi.remove(listId, item.id);
      showNotification('E-mail removido', 'success');
      await load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao remover regra.', 'error');
    }
  };

  return (
    <div className="config-email-panel">
      <p className="config-placeholder-msg">{listDescription}</p>

      <form className="config-email-form" onSubmit={handleAdd}>
        <label>
          <span>Tipo</span>
          <select
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="email">E-mail completo</option>
            <option value="domain">Domínio (@empresa.com)</option>
          </select>
        </label>
        <label>
          <span>Valor</span>
          <input
            type="text"
            value={form.value}
            placeholder={form.type === 'domain' ? '@mailing.com ou mailing.com' : 'remetente@empresa.com'}
            onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
          />
        </label>
        <label>
          <span>Nota (opcional)</span>
          <input
            type="text"
            value={form.note}
            placeholder=""
            onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Salvando…' : 'Adicionar'}
        </button>
      </form>

      {loading ? (
        <p className="config-placeholder-msg">Carregando…</p>
      ) : items.length === 0 ? (
        <p className="config-placeholder-msg">Nenhuma regra cadastrada.</p>
      ) : (
        <table className="config-email-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Valor</th>
              <th>Nota</th>
              <th>Ativo</th>
              <th aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{formatType(item.type)}</td>
                <td><code>{item.value}</code></td>
                <td>{item.note || '—'}</td>
                <td>
                  <button
                    type="button"
                    className={'config-email-toggle' + (item.active ? ' is-on' : '')}
                    onClick={() => handleToggle(item)}
                  >
                    {item.active ? 'Sim' : 'Não'}
                  </button>
                </td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleDelete(item)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function EmailRemetentesSection() {
  const [activeList, setActiveList] = useState('ignorado');
  const active = LISTS.find((item) => item.id === activeList) || LISTS[0];

  return (
    <div className="config-email-section">
      <div className="config-email-tabs" role="tablist" aria-label="Listas de e-mail">
        {LISTS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={activeList === item.id}
            className={'config-email-tab' + (activeList === item.id ? ' is-active' : '')}
            onClick={() => setActiveList(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <MailRulesPanel
        key={activeList}
        listId={active.id}
        listLabel={active.label}
        listDescription={active.description}
      />
    </div>
  );
}
