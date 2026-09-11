/**
 * DashboardTrendMini v1.0.0 — mini-gráfico dos últimos 7 dias.
 *
 * Barras: tickets criados por dia (eixo esquerdo).
 * Linha:  nota média CSAT por dia (eixo direito, escala 1-5). Dias sem resposta
 *         não pintam ponto — a linha só conecta dias com dado real.
 *
 * SVG puro pra evitar peso extra de biblioteca de chart (7 pontos não valem).
 * Série fixa 7d — não segue o filtro de período do painel (é uma referência histórica).
 */
import React, { useMemo } from 'react';

const PADDING = { top: 16, right: 36, bottom: 24, left: 14 };
const CHART_HEIGHT = 190;
const BAR_GAP_RATIO = 0.35;
const CSAT_MAX = 5;

function fmtDayLabel(label) {
  // "Dom, 04/09" → "04/09"
  const m = String(label || '').match(/(\d{2}\/\d{2})/);
  return m ? m[1] : (label || '');
}

export default function DashboardTrendMini({ serie = [], periodoLabel, headerControls = null }) {
  // Se o período render >7 dias, mostramos até 14 (limite prático do mini-chart).
  const data = useMemo(() => serie.slice(-14), [serie]);

  const chart = useMemo(() => {
    if (!data.length) return null;
    const maxAbertos = Math.max(1, ...data.map((d) => d.abertos ?? 0));
    return { maxAbertos };
  }, [data]);

  const title = periodoLabel || 'Últimos 7 dias';

  if (!data.length || !chart) {
    return (
      <article className="dashop-card dashop-trend">
        <header className="dashop-card__head">
          <h3 className="dashop-card__title">{title}</h3>
          {headerControls}
        </header>
        <p className="dashop-card__empty">Sem dados no período.</p>
      </article>
    );
  }

  // Layout responsivo via viewBox
  const totalWidth = 420;
  const innerWidth = totalWidth - PADDING.left - PADDING.right;
  const innerHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const step = innerWidth / data.length;
  const barWidth = step * (1 - BAR_GAP_RATIO);

  function xCenter(i) {
    return PADDING.left + step * i + step / 2;
  }
  function yFromBars(value) {
    const h = (value / chart.maxAbertos) * innerHeight;
    return PADDING.top + (innerHeight - h);
  }
  function yFromCsat(value) {
    // Escala 1..5 → topo..base
    const clamped = Math.max(1, Math.min(CSAT_MAX, value));
    const norm = (clamped - 1) / (CSAT_MAX - 1);
    return PADDING.top + (innerHeight - norm * innerHeight);
  }

  // Pontos válidos de CSAT (dias com resposta)
  const csatPoints = data
    .map((d, i) => (d.notaMedia != null ? { x: xCenter(i), y: yFromCsat(d.notaMedia), value: d.notaMedia } : null))
    .filter(Boolean);
  const csatPath = csatPoints.length
    ? csatPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  const totalAbertos = data.reduce((s, d) => s + (d.abertos ?? 0), 0);
  const notasValidas = data.filter((d) => d.notaMedia != null);
  const csatMedio = notasValidas.length
    ? notasValidas.reduce((s, d) => s + d.notaMedia, 0) / notasValidas.length
    : null;

  return (
    <article className="dashop-card dashop-trend">
      <header className="dashop-card__head">
        <div className="dashop-card__head-left">
          <h3 className="dashop-card__title">{title}</h3>
          <span className="dashop-card__meta">
            {totalAbertos} criados · CSAT {csatMedio != null ? csatMedio.toFixed(1) : '—'}
          </span>
        </div>
        {headerControls}
      </header>
      <div className="dashop-trend__chart-wrap">
        <svg viewBox={`0 0 ${totalWidth} ${CHART_HEIGHT}`} className="dashop-trend__svg" role="img" aria-label="Tickets criados e CSAT últimos 7 dias">
          {/* Grid horizontal simples: linha base */}
          <line
            x1={PADDING.left}
            x2={totalWidth - PADDING.right}
            y1={PADDING.top + innerHeight}
            y2={PADDING.top + innerHeight}
            stroke="rgba(0,0,88,0.08)"
            strokeWidth="1"
          />

          {/* Barras — abertos */}
          {data.map((d, i) => {
            const value = d.abertos ?? 0;
            const y = yFromBars(value);
            const height = PADDING.top + innerHeight - y;
            const x = xCenter(i) - barWidth / 2;
            return (
              <g key={d.date}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(1, height)}
                  fill="var(--eco-blue, #1634FF)"
                  opacity="0.85"
                  rx="2"
                />
                <text
                  x={xCenter(i)}
                  y={PADDING.top + innerHeight + 14}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#94a3b8"
                >
                  {fmtDayLabel(d.label)}
                </text>
              </g>
            );
          })}

          {/* Linha CSAT */}
          {csatPath ? (
            <>
              <path d={csatPath} stroke="#F5A623" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
              {csatPoints.map((p, i) => (
                <g key={`csat-${i}`}>
                  <circle cx={p.x} cy={p.y} r="3" fill="#fff" stroke="#F5A623" strokeWidth="1.8" />
                  <text
                    x={p.x}
                    y={p.y - 7}
                    textAnchor="middle"
                    fontSize="9"
                    fontWeight="600"
                    fill="#8a6d00"
                  >
                    {p.value.toFixed(1)}
                  </text>
                </g>
              ))}
            </>
          ) : null}

          {/* Eixo CSAT à direita: marcas 1 e 5 */}
          <text
            x={totalWidth - PADDING.right + 6}
            y={PADDING.top + 4}
            fontSize="10"
            fill="#F5A623"
          >
            5★
          </text>
          <text
            x={totalWidth - PADDING.right + 6}
            y={PADDING.top + innerHeight + 4}
            fontSize="10"
            fill="#F5A623"
          >
            1★
          </text>
        </svg>
      </div>
      <div className="dashop-trend__legend">
        <span className="dashop-trend__legend-item">
          <span className="dashop-trend__legend-swatch dashop-trend__legend-swatch--bars" />
          Tickets criados
        </span>
        <span className="dashop-trend__legend-item">
          <span className="dashop-trend__legend-swatch dashop-trend__legend-swatch--line" />
          CSAT (1–5)
        </span>
      </div>
    </article>
  );
}
