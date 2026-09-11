/**
 * DashboardKpiStrip v1.1.0 — 2 faixas de KPIs: "Agora" (snapshot) e "No período" (histórico).
 *
 * Agora (4): Fila aberta, Não atribuídos, Novos, Vencendo em 4h — não filtram por data.
 * Período (5): Criados, Resolvidos, TMA total, TME 1ª resposta, CSAT — filtram pelo seletor.
 */
import React from 'react';

function fmtNumber(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(n);
}

function fmtCsat(n) {
  if (n == null) return '—';
  return `${n.toFixed(1)} ★`;
}

function KpiCard({ label, value, tone = 'neutral', hint }) {
  return (
    <article className={`dashop-kpi dashop-kpi--${tone}`} title={hint}>
      <span className="dashop-kpi__label">{label}</span>
      <strong className="dashop-kpi__value">{value}</strong>
    </article>
  );
}

export default function DashboardKpiStrip({ agora, noPeriodo, periodoLabel, loading = false }) {
  return (
    <div className={'dashop-kpi-block' + (loading ? ' is-loading' : '')}>
      {/* Faixa AGORA — estado atual */}
      <div className="dashop-kpi-group">
        <header className="dashop-kpi-group__head">
          <span className="dashop-kpi-group__tag dashop-kpi-group__tag--live">
            <span className="dashop-kpi-group__dot" /> Agora
          </span>
          <span className="dashop-kpi-group__meta">Estado atual da fila</span>
        </header>
        <div className="dashop-kpi-grid dashop-kpi-grid--4">
          <KpiCard
            label="Fila aberta"
            value={fmtNumber(agora?.filaAberta)}
            tone="neutral"
            hint="Total de tickets ativos (novo, em andamento, pendente). Igual ao Desk."
          />
          <KpiCard
            label="Novos"
            value={fmtNumber(agora?.novosNaCaixa)}
            tone={agora?.novosNaCaixa > 0 ? 'warn' : 'ok'}
            hint="Tickets com status 'novo' aguardando primeira ação"
          />
          <KpiCard
            label="Não atribuídos"
            value={fmtNumber(agora?.naoAtribuidos)}
            tone={agora?.naoAtribuidos > 0 ? 'warn' : 'ok'}
            hint="Ativos sem responsável no último status"
          />
          <KpiCard
            label="Vencendo em 4h"
            value={fmtNumber(agora?.vencendoEm4h)}
            tone={agora?.vencendoEm4h > 0 ? 'crit' : 'ok'}
            hint="SLA padrão 4h em-aberto / 8h em-andamento — não considera prioridade nem canal"
          />
        </div>
      </div>

      {/* Faixa NO PERÍODO — agregados históricos */}
      <div className="dashop-kpi-group">
        <header className="dashop-kpi-group__head">
          <span className="dashop-kpi-group__tag dashop-kpi-group__tag--period">
            <i className="ti ti-calendar" aria-hidden="true" /> {periodoLabel || 'No período'}
          </span>
          <span className="dashop-kpi-group__meta">Agregados históricos</span>
        </header>
        <div className="dashop-kpi-grid dashop-kpi-grid--5">
          <KpiCard
            label="Criados"
            value={fmtNumber(noPeriodo?.criados)}
            tone="neutral"
            hint="Tickets abertos no período"
          />
          <KpiCard
            label="Resolvidos"
            value={fmtNumber(noPeriodo?.resolvidos)}
            tone="ok"
            hint="Tickets encerrados no período (resolvido/fechado/cancelado)"
          />
          <KpiCard
            label="TMA total (méd.)"
            value={noPeriodo?.tmaLabel || '—'}
            tone="neutral"
            hint="Tempo médio de resolução dos tickets encerrados no período"
          />
          <KpiCard
            label="1ª resposta (méd.)"
            value={noPeriodo?.tmeLabel || '—'}
            tone="neutral"
            hint="Tempo médio até a primeira resposta pública do atendente"
          />
          <KpiCard
            label="CSAT"
            value={fmtCsat(noPeriodo?.csatMedio)}
            tone={noPeriodo?.csatMedio != null && noPeriodo.csatMedio >= 4 ? 'ok' : 'neutral'}
            hint="Nota média das respostas de CSAT recebidas no período"
          />
        </div>
      </div>
    </div>
  );
}
