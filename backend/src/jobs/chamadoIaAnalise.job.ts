/**
 * chamadoIaAnalise.job v1.0.0 — ciclo periódico da análise de IA do texto do cliente
 * VERSION: v1.0.0 | DATE: 2026-07-23
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { runChamadoIaAnaliseAgentCycle } from '../services/agents/chamadoIaAnaliseAgent.service';
import { isAgentsConfigured } from '../services/agents/openaiAgent.util';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !env.chamadoIaAnaliseEnabled || !isMongoConnected() || !isAgentsConfigured()) return;
  running = true;
  try {
    await runChamadoIaAnaliseAgentCycle();
  } catch (err) {
    console.warn('[chamado-ia-analise-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startChamadoIaAnaliseJob(): void {
  if (!env.chamadoIaAnaliseEnabled) {
    console.info('[chamado-ia-analise-job] CHAMADO_IA_ANALISE_ENABLED=false — job não iniciado.');
    return;
  }
  if (timer) return;

  const intervalMs = Math.max(60_000, env.chamadoIaAnaliseIntervalMs);
  console.info(`[chamado-ia-analise-job] iniciado — ciclo a cada ${intervalMs}ms`);

  void runCycleSafe();
  timer = setInterval(() => {
    void runCycleSafe();
  }, intervalMs);
}

export function stopChamadoIaAnaliseJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
