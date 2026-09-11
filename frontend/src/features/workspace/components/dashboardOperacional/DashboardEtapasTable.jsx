/**
 * DashboardEtapasTable v1.0.0 — desempenho por atendente com 3 marcos.
 *
 * Recebido → 1ª resposta → Resolução (sem "Tratativa" no meio: não há timestamp
 * confiável de início de tratativa no schema; ver plano Fase 1).
 *
 * Reusa 100% dos dados que o `buildLeaderboard` do workspace360 já entrega:
 *   - `tme` = tempo médio até 1ª resposta (formatado)
 *   - `tma` = tempo médio total (formatado)
 *   - `resolved`, `inProgress`, `sla`, `csat`
 * A cor da linha na coluna SLA muda por faixa: ≥90% verde, 70-89% amarelo, <70% vermelho.
 */
import React, { useMemo } from 'react';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] || '' : '';
  return (first + last).toUpperCase();
}

function slaColorClass(slaStr) {
  const n = parseInt(String(slaStr || '').replace(/\D/g, ''), 10);
  if (!Number.isFinite(n)) return 'is-muted';
  if (n >= 90) return 'is-ok';
  if (n >= 70) return 'is-warn';
  return 'is-crit';
}

function csatColorClass(csat) {
  if (csat == null) return 'is-muted';
  if (csat >= 4.3) return 'is-ok';
  if (csat >= 3.8) return 'is-warn';
  return 'is-crit';
}

export default function DashboardEtapasTable({ leaderboard, agentsOnlineKeys = [] }) {
  const ranking = leaderboard?.ranking ?? [];
  const onlineSet = useMemo(
    () => new Set((agentsOnlineKeys || []).map((k) => String(k).trim().toLowerCase())),
    [agentsOnlineKeys],
  );

  if (!ranking.length) {
    return (
      <article className="dashop-card">
        <header className="dashop-card__head">
          <h3 className="dashop-card__title">Desempenho por atendente</h3>
        </header>
        <p className="dashop-card__empty">Sem atendimentos no período.</p>
      </article>
    );
  }

  return (
    <article className="dashop-card">
      <header className="dashop-card__head">
        <h3 className="dashop-card__title">Desempenho por atendente (7 dias)</h3>
        <span className="dashop-card__meta">Recebido → 1ª resposta → Resolução</span>
      </header>
      <div className="dashop-table-wrap">
        <table className="dashop-table">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Atendente</th>
              <th>Ativos</th>
              <th>⏱ 1ª resposta (méd.)</th>
              <th>⏱ TMA total</th>
              <th>SLA</th>
              <th>Resolvidos (7d)</th>
              <th>CSAT</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((row) => {
              const online = onlineSet.has(String(row.agentKey || '').toLowerCase());
              return (
                <tr key={row.id}>
                  <td>
                    <div className="dashop-agent-cell">
                      <span className={'dashop-agent-avatar' + (online ? ' is-online' : '')}>
                        {initials(row.name)}
                      </span>
                      <div>
                        <div className="dashop-agent-name">{row.name}</div>
                        <div className={'dashop-agent-status ' + (online ? 'is-online' : 'is-offline')}>
                          {online ? '● Online' : '○ Offline'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="dashop-num">{row.inProgress ?? 0}</td>
                  <td className="dashop-num">{row.tme ?? '—'}</td>
                  <td className="dashop-num">{row.tma ?? '—'}</td>
                  <td className={'dashop-num ' + slaColorClass(row.sla)}>{row.sla ?? '—'}</td>
                  <td className="dashop-num">{row.resolved ?? 0}</td>
                  <td className={'dashop-num ' + csatColorClass(row.csat)}>
                    {row.csat != null ? `${row.csat.toFixed(1)} ★` : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
