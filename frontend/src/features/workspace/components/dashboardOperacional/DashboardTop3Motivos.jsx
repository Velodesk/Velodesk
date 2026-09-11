/**
 * DashboardTop3Motivos v1.0.0 — top 3 motivos de acionamento (produto → motivo).
 *
 * Segue o filtro de período do painel (Hoje/Ontem/Mês/Personalizado). Cada linha:
 * produto (subtítulo pequeno), motivo (título), contagem + % barra.
 */
import React from 'react';

export default function DashboardTop3Motivos({ motivos = [], totalTabulado = 0, totalCriado = 0, canceladosExcluidos = 0 }) {
  const cobertura = totalCriado > 0 ? Math.round((totalTabulado / totalCriado) * 100) : 0;
  const metaHint = totalCriado > 0
    ? `${totalTabulado} tabulados de ${totalCriado} criados (${cobertura}%)`
    : 'Árvore de decisão';
  const canceladosHint = canceladosExcluidos > 0
    ? ` · ${canceladosExcluidos} cancelados excluídos`
    : '';

  if (!motivos.length) {
    return (
      <article className="dashop-card dashop-top-motivos">
        <header className="dashop-card__head">
          <h3 className="dashop-card__title">Top 3 motivos</h3>
          <span className="dashop-card__meta">{metaHint}{canceladosHint}</span>
        </header>
        <p className="dashop-card__empty">Sem motivos consolidados no período.</p>
      </article>
    );
  }

  const maxPct = Math.max(...motivos.map((m) => m.pct ?? 0), 1);

  return (
    <article className="dashop-card dashop-top-motivos">
      <header className="dashop-card__head">
        <h3 className="dashop-card__title">Top 3 motivos</h3>
        <span className="dashop-card__meta" title="% calculado sobre tickets tabulados; cancelados são excluídos">
          {metaHint}{canceladosHint}
        </span>
      </header>
      <div className="dashop-top-motivos__list">
        {motivos.slice(0, 3).map((m, idx) => {
          const barWidth = maxPct > 0 ? Math.round(((m.pct ?? 0) / maxPct) * 100) : 0;
          return (
            <div key={`${m.produto}::${m.motivo}::${idx}`} className="dashop-top-motivos__row">
              <div className="dashop-top-motivos__rank">{idx + 1}</div>
              <div className="dashop-top-motivos__info">
                <div className="dashop-top-motivos__motivo" title={m.motivo}>
                  {m.motivo || '—'}
                </div>
                <div className="dashop-top-motivos__produto" title={m.produto}>
                  {m.produto || 'Sem produto'}
                </div>
                <div className="dashop-top-motivos__bar-wrap">
                  <div className="dashop-top-motivos__bar" style={{ width: `${barWidth}%` }} />
                </div>
              </div>
              <div className="dashop-top-motivos__stats">
                <div className="dashop-top-motivos__count">{m.count}</div>
                <div className="dashop-top-motivos__pct">{(m.pct ?? 0).toFixed(1)}%</div>
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
