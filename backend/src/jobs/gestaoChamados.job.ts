/**
 * gestaoChamados.job v1.1.0 — snapshot horário de tickets ativos para Agente 3
 * VERSION: v1.1.0 | DATE: 2026-07-14
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { runGestaoChamadosCycle } from '../services/agents/gestaoChamadosAgent.service';
import { acquireJobLock } from '../utils/jobLock';

let gestaoTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

const LOCK_ID = 'gestaoSnapshotLock';
/** Margem para o timer das outras instâncias (cada uma com fase própria) não perder a hora seguinte. */
const LOCK_SAFETY_MARGIN_MS = 5 * 60 * 1000;

async function runCycleSafe(): Promise<void> {
  if (running || !env.agentsEnabled || !isMongoConnected()) return;
  running = true;
  try {
    // O timer é por instância do Cloud Run (e cada subida de instância dispara uma execução
    // imediata). A trava deixa só UMA execução por intervalo, não importa quantas instâncias existam.
    const intervalMs = Math.max(60_000, env.gestaoSnapshotIntervalMs);
    if (!(await acquireJobLock(LOCK_ID, Math.max(60_000, intervalMs - LOCK_SAFETY_MARGIN_MS)))) return;
    await runGestaoChamadosCycle();
  } catch (err) {
    console.warn('[gestao-chamados-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startGestaoChamadosJob(): void {
  if (!env.agentsEnabled) {
    console.info('[gestao-chamados-job] AGENTS_ENABLED=false — job não iniciado.');
    return;
  }

  if (gestaoTimer) return;

  const intervalMs = Math.max(60_000, env.gestaoSnapshotIntervalMs);
  console.info(`[gestao-chamados-job] iniciado — snapshot horário a cada ${intervalMs}ms`);

  void runCycleSafe();
  gestaoTimer = setInterval(() => {
    void runCycleSafe();
  }, intervalMs);
}

export function stopGestaoChamadosJob(): void {
  if (gestaoTimer) {
    clearInterval(gestaoTimer);
    gestaoTimer = null;
  }
}
