/**
 * GestaoPanel — Fase 1: substituído pelo painel operacional Desk.
 *
 * A antiga versão v3.10.0 misturava visão operacional com analítica gerencial (custos IA,
 * aderência, motivos, voz do cliente, casos especiais mensais). Combinado que o WFM vira a
 * plataforma central gerencial → aqui fica só a visão operacional do supervisor Desk.
 *
 * Este arquivo é intencionalmente fino: só delega pro DashboardOperacionalPanel. Rota e
 * links do menu permanecem os mesmos.
 */
import React from 'react';
import DashboardOperacionalPanel from './components/dashboardOperacional/DashboardOperacionalPanel';

export default function GestaoPanel() {
  return <DashboardOperacionalPanel />;
}
