/**
 * DashboardOnlineAgentsCard v1.0.0 — quadro de colaboradores online + forçar logoff
 *
 * Lê de GET /agents/sessions/online (useOnlineAgents, poll de 30s) — sessão real do agente
 * (agentSession.service.ts), não o snapshot de 10min do dashboard operacional. displayName já
 * vem resolvido pelo backend (alias do colaborador quando preenchido, senão nome completo).
 */
import React, { useState } from 'react';
import { useOnlineAgents } from '../../../../hooks/useOnlineAgents';
import { agentSessionsApi } from '../../../../api/client';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

function ForceLogoffConfirmModal({ target, busy, onCancel, onConfirm }) {
  if (!target) return null;
  const isAll = target === 'all';

  return (
    <div className="dashop-modal" role="presentation">
      <button
        type="button"
        className="dashop-modal__backdrop"
        aria-label="Fechar"
        onClick={busy ? undefined : onCancel}
      />
      <div className="dashop-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="forceLogoffTitle">
        <header className="dashop-modal__header">
          <h4 id="forceLogoffTitle">
            {isAll ? 'Forçar logoff geral?' : `Forçar logoff de ${target.displayName}?`}
          </h4>
        </header>
        <div className="dashop-modal__body">
          <p>
            {isAll
              ? 'Todos os colaboradores online agora serão desconectados.'
              : `${target.displayName} será desconectado.`}
            {' '}O efeito ocorre no próximo heartbeat do colaborador (em até 60s).
          </p>
        </div>
        <footer className="dashop-modal__footer">
          <button type="button" className="dashop-btn dashop-btn--ghost" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="dashop-btn dashop-btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Forçando…' : 'Confirmar'}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default function DashboardOnlineAgentsCard() {
  const { agents, loading, refresh } = useOnlineAgents();
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      if (confirmTarget === 'all') {
        await agentSessionsApi.forceLogoffAll();
      } else {
        await agentSessionsApi.forceLogoff(confirmTarget.userId);
      }
      await refresh();
    } finally {
      setBusy(false);
      setConfirmTarget(null);
    }
  };

  return (
    <article className="dashop-card">
      <header className="dashop-card__head">
        <h3 className="dashop-card__title">Usuários online</h3>
        {agents.length > 0 ? (
          <button
            type="button"
            className="dashop-btn dashop-btn--ghost dashop-btn--danger-text"
            onClick={() => setConfirmTarget('all')}
          >
            Forçar logoff geral
          </button>
        ) : null}
      </header>

      {loading && !agents.length ? (
        <p className="dashop-card__empty">Carregando…</p>
      ) : !agents.length ? (
        <p className="dashop-card__empty">Nenhum colaborador online agora.</p>
      ) : (
        <div className="dashop-online-list">
          {agents.map((agent) => (
            <div key={agent.userId} className="dashop-online-badge">
              <span className="dashop-online-badge__dot" aria-hidden="true" />
              <span className="dashop-online-badge__avatar">{initials(agent.displayName)}</span>
              <span className="dashop-online-badge__name">{agent.displayName}</span>
              <button
                type="button"
                className="dashop-online-badge__logoff"
                title={`Forçar logoff de ${agent.displayName}`}
                onClick={() => setConfirmTarget(agent)}
              >
                <i className="ti ti-logout" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ForceLogoffConfirmModal
        target={confirmTarget}
        busy={busy}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={handleConfirm}
      />
    </article>
  );
}
