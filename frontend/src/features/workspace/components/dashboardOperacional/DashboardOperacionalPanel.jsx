/**
 * DashboardOperacionalPanel v1.1.0 — Fase 1 com filtro de período + layout redistribuído.
 *
 * Layout (top-down):
 *  1. Header: título + filtro de período à direita + ações
 *  2. Faixa "Agora"     — 4 KPIs snapshot (não filtram)
 *  3. Faixa "No período"— 5 KPIs históricos (respeitam o filtro)
 *  4. Alerta war-room   — opcional (>= 3 breaches)
 *  5. Linha principal   — Breach table (2fr) + Fila por canal (1fr)
 *  6. Desempenho por atendente (full width)
 *
 * Snapshots (Agora, Fila por canal, Breach) NÃO respeitam o filtro de período — refletem
 * o estado agora. Só a faixa "No período" e o Desempenho por atendente é que respeitam.
 */
import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTickets } from '../../../../context/TicketsContext';
import { useDashboardOperacional } from '../../../../hooks/useDashboardOperacional';
import { useDashboardTrend } from '../../../../hooks/useDashboardTrend';
import GestaoPeriodFilter from '../gestaoInsights/GestaoPeriodFilter';
import DashboardKpiStrip from './DashboardKpiStrip';
import DashboardChannelBars from './DashboardChannelBars';
import DashboardEtapasTable from './DashboardEtapasTable';
import DashboardBreachTable from './DashboardBreachTable';
import DashboardWorkflowCard from './DashboardWorkflowCard';
import DashboardTrendMini from './DashboardTrendMini';
import DashboardTop3Motivos from './DashboardTop3Motivos';
import './dashboardOperacional.css';

function fmtUpdatedAt(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function DashboardOperacionalPanel() {
  const navigate = useNavigate();
  const { openTicket } = useTickets();
  const [period, setPeriod] = useState({ period: 'hoje' });
  const [trendPeriod, setTrendPeriod] = useState({ period: '7d' });
  const { data, loading, error, refresh } = useDashboardOperacional(period);
  const { data: trend } = useDashboardTrend(trendPeriod);

  const handleOpenTicket = useCallback(
    (ticketId) => {
      if (!ticketId) return;
      if (typeof window.openTicket === 'function') {
        window.openTicket(ticketId);
        return;
      }
      openTicket(ticketId);
      navigate('/tickets?desk=v2');
    },
    [navigate, openTicket],
  );

  const showFirstLoad = loading && !data;

  return (
    <div className="dashop-shell">
      <header className="dashop-header">
        <div className="dashop-header__title-block">
          <h2 className="dashop-header__title">Painel operacional</h2>
          <p className="dashop-header__subtitle">
            Estado ao vivo da fila + desempenho no período.
            {data?.updatedAt ? ` Atualizado ${fmtUpdatedAt(data.updatedAt)}.` : ''}
          </p>
        </div>
        <div className="dashop-header__actions">
          <GestaoPeriodFilter value={period} onChange={setPeriod} idPrefix="dashop-period" />
          <button
            type="button"
            className="dashop-btn dashop-btn--ghost"
            onClick={refresh}
            disabled={loading}
            title="Atualiza manualmente (o painel também atualiza sozinho a cada 10 min)"
          >
            <i className="ti ti-refresh" aria-hidden="true" /> Atualizar
          </button>
          <button
            type="button"
            className="dashop-btn"
            onClick={() => navigate('/tickets?desk=v2')}
          >
            Abrir fila
          </button>
        </div>
      </header>

      {error ? (
        <p className="dashop-error">
          Não foi possível carregar o dashboard. Tente novamente em instantes.
        </p>
      ) : null}

      {showFirstLoad ? (
        <p className="dashop-loading">Carregando dashboard operacional…</p>
      ) : null}

      {data ? (
        <>
          <DashboardKpiStrip
            agora={data.agora}
            noPeriodo={data.noPeriodo}
            periodoLabel={data.periodo?.label}
            loading={loading}
          />

          <div className="dashop-row dashop-row--trend">
            <DashboardTrendMini
              serie={trend?.serie || []}
              periodoLabel={trend?.periodo?.label}
              headerControls={
                <div className="dashop-trend__filter">
                  <div className="dashop-trend__pills" role="group" aria-label="Período do gráfico">
                    {[
                      { value: '7d', label: '7 dias' },
                      { value: 'mes', label: 'Mês' },
                      { value: 'personalizado', label: 'Personalizado' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={
                          'dashop-trend__pill'
                          + (trendPeriod.period === opt.value ? ' is-active' : '')
                        }
                        onClick={() => {
                          if (opt.value === 'personalizado') {
                            setTrendPeriod({
                              period: 'personalizado',
                              from: trendPeriod.from,
                              to: trendPeriod.to,
                            });
                          } else {
                            setTrendPeriod({ period: opt.value });
                          }
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {trendPeriod.period === 'personalizado' ? (
                    <div className="dashop-trend__range">
                      <input
                        type="date"
                        value={trendPeriod.from || ''}
                        max={trendPeriod.to || undefined}
                        onChange={(e) => setTrendPeriod((p) => ({ ...p, period: 'personalizado', from: e.target.value }))}
                      />
                      <span>até</span>
                      <input
                        type="date"
                        value={trendPeriod.to || ''}
                        min={trendPeriod.from || undefined}
                        onChange={(e) => setTrendPeriod((p) => ({ ...p, period: 'personalizado', to: e.target.value }))}
                      />
                    </div>
                  ) : null}
                </div>
              }
            />
            <DashboardTop3Motivos
              motivos={trend?.motivos?.items || []}
              totalTabulado={trend?.motivos?.totalTabulado || 0}
              totalCriado={trend?.motivos?.totalCriado || 0}
              canceladosExcluidos={trend?.motivos?.canceladosExcluidos || 0}
            />
          </div>

          {data.agora?.warRoom ? (
            <div className="dashop-alert-strip">
              <i className="ti ti-alert-triangle" aria-hidden="true" />
              <strong>{data.agora.slaCritical}</strong> tickets em atraso crítico de SLA.
              Ação imediata necessária.
            </div>
          ) : null}

          <div className="dashop-row dashop-row--main">
            <DashboardBreachTable
              tickets={data.breachTickets || []}
              onOpenTicket={handleOpenTicket}
            />
            <DashboardChannelBars channels={data.channelVision || []} />
          </div>

          <DashboardWorkflowCard
            workflow={data.workflow}
            onOpenTicket={handleOpenTicket}
          />

          <DashboardEtapasTable
            leaderboard={data.leaderboard}
            agentsOnlineKeys={data.agentsOnline}
          />
        </>
      ) : null}
    </div>
  );
}
