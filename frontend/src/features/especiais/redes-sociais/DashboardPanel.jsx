/**
 * DashboardPanel — visão consolidada de volume, sentimento e performance
 * por canal (Instagram/Facebook DMs, comentários e Google Play).
 */
import React from 'react';

const KPIS = [
  { id: 'total', label: 'Total Mensagens (7D)', valor: '1.847', delta: '+14% vs. semana anterior', direction: 'up', tone: 'positivo', accent: '#1634FF' },
  { id: 'facebook', label: 'Facebook DMs', valor: '612', delta: '+8% vs. semana anterior', direction: 'up', tone: 'positivo', accent: '#1877F2' },
  { id: 'instagram', label: 'Instagram DMs', valor: '894', delta: '+22% vs. semana anterior', direction: 'up', tone: 'positivo', accent: '#E4405F' },
  { id: 'comentarios', label: 'Comentários IG+FB', valor: '341', delta: '+5% — 34 sem resposta', direction: 'up', tone: 'aviso', accent: '#E4405F' },
  { id: 'tma', label: 'TMA Resposta', valor: '4:18', delta: '-42s vs. semana anterior', direction: 'down', tone: 'positivo', accent: '#1634FF' },
];

const VOLUME_POR_CANAL = [
  { id: 'instagram-dm', label: 'Instagram DM', icon: 'ti-brand-instagram', color: '#E4405F', valor: 894 },
  { id: 'facebook-dm', label: 'Facebook DM', icon: 'ti-brand-facebook', color: '#1877F2', valor: 612 },
  { id: 'comentarios-ig', label: 'Comentários IG', icon: 'ti-message-circle', color: '#F97316', valor: 241 },
  { id: 'comentarios-fb', label: 'Comentários FB', icon: 'ti-message-circle', color: '#1634FF', valor: 100 },
  { id: 'google-play', label: 'Google Play', icon: 'ti-brand-google-play', color: '#15A237', valor: 143 },
];

const SENTIMENTO_GERAL = [
  { id: 'positivo', label: 'Positivo', pct: 64, color: '#15A237' },
  { id: 'neutro', label: 'Neutro', pct: 26, color: '#FCC200' },
  { id: 'negativo', label: 'Negativo', pct: 10, color: '#D6293E' },
];

const PERFORMANCE_TABLE = [
  { canal: 'Instagram DM', icon: 'ti-brand-instagram', color: '#E4405F', mensagens: 894, tma: '3:48', taxaResposta: 96, sentimento: 68, convertido: 142 },
  { canal: 'Facebook DM', icon: 'ti-brand-facebook', color: '#1877F2', mensagens: 612, tma: '4:52', taxaResposta: 94, sentimento: 61, convertido: 88 },
  { canal: 'Comentários IG', icon: 'ti-message-circle', color: '#F97316', mensagens: 241, tma: '6:10', taxaResposta: 76, sentimento: 58, convertido: 24 },
  { canal: 'Comentários FB', icon: 'ti-message-circle', color: '#1634FF', mensagens: 100, tma: '7:22', taxaResposta: 71, sentimento: 54, convertido: 9 },
  { canal: 'Google Play', icon: 'ti-brand-google-play', color: '#15A237', mensagens: 143, tma: '6:24', taxaResposta: 94, sentimento: 72, convertido: null },
];

function taxaClass(pct) {
  if (pct >= 90) return 'dash-table__pct--good';
  if (pct >= 72) return 'dash-table__pct--warn';
  return 'dash-table__pct--bad';
}

function buildConicGradient(segments) {
  let acc = 0;
  const stops = segments.map((seg) => {
    const start = acc;
    acc += seg.pct;
    return `${seg.color} ${start}% ${acc}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export default function DashboardPanel() {
  const maxVolume = Math.max(...VOLUME_POR_CANAL.map((c) => c.valor));
  const donutGradient = buildConicGradient(SENTIMENTO_GERAL);
  const sentimentoPositivo = SENTIMENTO_GERAL.find((s) => s.id === 'positivo');

  return (
    <div className="dash-panel">
      <div className="gp-kpis dash-panel__kpis">
        {KPIS.map((kpi) => (
          <div key={kpi.id} className="gp-kpi dash-kpi" style={{ '--dash-accent': kpi.accent }}>
            <span className="gp-kpi__label">{kpi.label}</span>
            <span className="gp-kpi__value">{kpi.valor}</span>
            <span className={'gp-kpi__delta' + (kpi.tone === 'aviso' ? ' gp-kpi__delta--warn' : '')}>
              {kpi.direction === 'up' ? '↑ ' : '↓ '}
              {kpi.delta}
            </span>
          </div>
        ))}
      </div>

      <div className="dash-panel__row2">
        <section className="ra-registro__card dash-volume-card">
          <h2 className="ra-registro__card-title">Volume por canal</h2>
          <p className="dash-card__subtitle">Mensagens recebidas — últimos 7 dias</p>
          <div className="dash-volume-list">
            {VOLUME_POR_CANAL.map((canal) => (
              <div key={canal.id} className="dash-volume-row">
                <span className="dash-volume-row__label">
                  <i className={`ti ${canal.icon}`} style={{ color: canal.color }} aria-hidden="true" />
                  {canal.label}
                </span>
                <span className="dash-volume-row__track">
                  <span
                    className="dash-volume-row__fill"
                    style={{ width: `${(canal.valor / maxVolume) * 100}%`, background: canal.color }}
                  />
                </span>
                <span className="dash-volume-row__value">{canal.valor}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="ra-registro__card dash-sentiment-card">
          <h2 className="ra-registro__card-title">Sentimento geral</h2>
          <p className="dash-card__subtitle">Análise IA — 7 dias</p>
          <div className="dash-donut-wrap">
            <div className="dash-donut" style={{ background: donutGradient }}>
              <span className="dash-donut__value">{sentimentoPositivo.pct}%</span>
            </div>
            <div className="dash-legend">
              {SENTIMENTO_GERAL.map((seg) => (
                <span key={seg.id} className="dash-legend__item">
                  <span className="dash-legend__dot" style={{ background: seg.color }} />
                  {seg.label} · {seg.pct}%
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="ra-registro__card dash-table-card">
        <h2 className="ra-registro__card-title">Performance por canal</h2>
        <p className="dash-card__subtitle">TMA, taxa de resposta e CSAT — 7 dias</p>
        <div className="dash-table-wrap">
          <table className="dash-table">
            <thead>
              <tr>
                <th>Canal</th>
                <th>Mensagens</th>
                <th>TMA resposta</th>
                <th>Taxa resposta</th>
                <th>Sentimento +</th>
                <th>Convertido ticket</th>
              </tr>
            </thead>
            <tbody>
              {PERFORMANCE_TABLE.map((row) => (
                <tr key={row.canal}>
                  <td>
                    <span className="dash-table__channel">
                      <i className={`ti ${row.icon}`} style={{ color: row.color }} aria-hidden="true" />
                      {row.canal}
                    </span>
                  </td>
                  <td className="dash-table__num">{row.mensagens}</td>
                  <td className="dash-table__num">{row.tma}</td>
                  <td className={'dash-table__num ' + taxaClass(row.taxaResposta)}>{row.taxaResposta}%</td>
                  <td className="dash-table__num">{row.sentimento}%</td>
                  <td className="dash-table__num">{row.convertido != null ? row.convertido : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
