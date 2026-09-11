/**
 * DashboardChannelBars v1.0.0 — distribuição por canal (só volume, sem SLA por canal).
 *
 * Reusa o `channelVision` retornado pelo supervisor360. Não mostra a % de SLA por canal
 * de propósito: sem política de SLA por canal (Bacen/RA/Procon têm prazos legais que não
 * estão configurados), o número existe mas induz interpretação errada.
 */
import React, { useMemo } from 'react';

export default function DashboardChannelBars({ channels = [] }) {
  const total = useMemo(
    () => channels.reduce((s, c) => s + (Number(c?.tickets) || 0), 0),
    [channels],
  );

  if (!channels.length) return null;

  return (
    <article className="dashop-card">
      <header className="dashop-card__head">
        <h3 className="dashop-card__title">Fila por canal</h3>
        <span className="dashop-card__meta">{total} tickets ativos</span>
      </header>
      <div className="dashop-channel-bars">
        {channels.map((channel) => {
          const value = Number(channel?.tickets) || 0;
          const pct = total > 0 ? Math.round((value / total) * 100) : 0;
          return (
            <div key={channel.id} className="dashop-channel-row">
              <span className="dashop-channel-row__label">{channel.label}</span>
              <div className="dashop-channel-row__bar-wrap">
                <div className="dashop-channel-row__bar" style={{ width: `${pct}%` }} />
              </div>
              <span className="dashop-channel-row__pct">{value} · {pct}%</span>
            </div>
          );
        })}
      </div>
    </article>
  );
}
