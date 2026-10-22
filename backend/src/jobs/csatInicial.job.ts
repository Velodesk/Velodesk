/**
 * csatInicial.job v1.1.0 — pesquisa de CSAT inicial, decoupled do fechamento automático
 * de tickets. Gatilho (status + prazo) configurado no e-mail "Encerramento mais
 * satisfação" (aba Emails de Saída). Mesma cadência do job de repescagem; trava entre
 * instâncias (acquireJobLock) — só uma instância varre a lista por período.
 * VERSION: v1.1.0 | DATE: 2026-10-22
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { acquireJobLock } from '../utils/jobLock';
import { runCsatInicialPastWindow } from '../services/csatEmail.service';

let inicialTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected()) return;
  running = true;
  try {
    // Timer por instância: sem trava, cada instância do Cloud Run (e cada subida, pela execução
    // imediata) varre e tenta enviar a mesma lista. A reserva por ticket (csatEmail.service) já
    // impede o e-mail duplicado; a trava evita N varreduras paralelas da mesma lista.
    const intervalMs = Math.max(60_000, env.csatRepescagemIntervalMs);
    if (!(await acquireJobLock('csatInicialLock', Math.max(30_000, intervalMs - 60_000)))) return;
    const result = await runCsatInicialPastWindow();
    if (result.sent > 0 || result.errors > 0) {
      console.info('[csat-inicial-job]', result);
    }
  } catch (err) {
    console.warn('[csat-inicial-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startCsatInicialJob(): void {
  if (inicialTimer) return;

  const intervalMs = Math.max(60_000, env.csatRepescagemIntervalMs);
  console.info(`[csat-inicial-job] iniciado — intervalo ${intervalMs}ms`);

  // 1ª execução imediata: backfill do backlog elegível
  void runCycleSafe();
  inicialTimer = setInterval(() => {
    void runCycleSafe();
  }, intervalMs);
}

export function stopCsatInicialJob(): void {
  if (inicialTimer) {
    clearInterval(inicialTimer);
    inicialTimer = null;
  }
}
