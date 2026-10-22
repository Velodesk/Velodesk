/**
 * csatRepescagem.job v1.1.0 — repescagem CSAT a cada 1h (backfill na 1ª run), trava entre instâncias
 * VERSION: v1.1.0 | DATE: 2026-10-22
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { acquireJobLock } from '../utils/jobLock';
import { sendCsatRepescagemPastWindow } from '../services/csatRepescagem.service';

let repescagemTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected()) return;
  running = true;
  try {
    // Timer por instância: sem trava, cada instância do Cloud Run (e cada subida, pela execução
    // imediata) varre e tenta enviar a mesma lista. A reserva por ticket (csatEmail.service) já
    // impede o e-mail duplicado; a trava evita N varreduras paralelas da mesma lista.
    const intervalMs = Math.max(60_000, env.csatRepescagemIntervalMs);
    if (!(await acquireJobLock('csatRepescagemLock', Math.max(30_000, intervalMs - 60_000)))) return;
    const result = await sendCsatRepescagemPastWindow();
    if (result.sent > 0 || result.errors > 0) {
      console.info('[csat-repescagem-job]', result);
    }
  } catch (err) {
    console.warn('[csat-repescagem-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startCsatRepescagemJob(): void {
  if (repescagemTimer) return;

  const intervalMs = Math.max(60_000, env.csatRepescagemIntervalMs);
  console.info(
    `[csat-repescagem-job] iniciado — repescagem após ${env.csatRepescagemAfterMs}ms a cada ${intervalMs}ms`,
  );

  // 1ª execução imediata: backfill do backlog elegível
  void runCycleSafe();
  repescagemTimer = setInterval(() => {
    void runCycleSafe();
  }, intervalMs);
}

export function stopCsatRepescagemJob(): void {
  if (repescagemTimer) {
    clearInterval(repescagemTimer);
    repescagemTimer = null;
  }
}
