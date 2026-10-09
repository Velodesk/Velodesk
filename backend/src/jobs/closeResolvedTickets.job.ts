/**
 * closeResolvedTickets.job v1.0.0 — fecha resolvidos ≥48h a cada 1h (backfill na 1ª run)
 * VERSION: v1.0.0 | DATE: 2026-07-29
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { closeResolvedTicketsPastWindow } from '../services/closeResolvedTickets.service';
import { acquireJobLock } from '../utils/jobLock';

let closeTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected()) return;
  running = true;
  try {
    // Timer por instância: sem trava, N instâncias carregam e tentam fechar os mesmos resolvidos
    // (VersionError e leitura duplicada do histórico completo de cada ticket).
    const intervalMs = Math.max(60_000, env.resolvedCloseIntervalMs);
    if (!(await acquireJobLock('closeResolvedLock', Math.max(30_000, intervalMs - 60_000)))) return;
    const result = await closeResolvedTicketsPastWindow();
    if (result.closed > 0 || result.errors > 0) {
      console.info('[close-resolved-job]', result);
    }
  } catch (err) {
    console.warn('[close-resolved-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startCloseResolvedTicketsJob(): void {
  if (closeTimer) return;

  const intervalMs = Math.max(60_000, env.resolvedCloseIntervalMs);
  console.info(
    `[close-resolved-job] iniciado — fecha resolvidos após ${env.resolvedCloseAfterMs}ms a cada ${intervalMs}ms`,
  );

  // 1ª execução imediata: backfill do backlog elegível
  void runCycleSafe();
  closeTimer = setInterval(() => {
    void runCycleSafe();
  }, intervalMs);
}

export function stopCloseResolvedTicketsJob(): void {
  if (closeTimer) {
    clearInterval(closeTimer);
    closeTimer = null;
  }
}
