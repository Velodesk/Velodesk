/**
 * emailSlaTrigger.job v1.1.0 — ciclo de SLA a cada 30 minutos
 * VERSION: v1.1.0 | DATE: 2026-09-01
 */
import { ChamadoN1 } from '../models/ChamadoN1';
import { isDeskConfigConnected, isMongoConnected } from '../config/database';
import { evaluateEmailTriggers } from '../services/emailTrigger.service';
import { lastStatusNotInFilter } from '../services/chamado.mapper';

const INTERVAL_MS = 30 * 60 * 1000;

let slaTimer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected() || !isDeskConfigConnected()) return;
  running = true;
  try {
    // Cobre tanto o SLA (em-aberto/em-andamento) quanto o prazo por status (novo/
    // em-andamento/pendente/resolvido/fechado) — só exclui cancelado, que não dispara e-mail.
    const cursor = ChamadoN1.find(lastStatusNotInFilter(['cancelado'])).cursor();

    let scanned = 0;
    let sent = 0;
    for await (const chamado of cursor) {
      scanned += 1;
      sent += await evaluateEmailTriggers(chamado, 'sla');
    }
    if (sent > 0) {
      console.info('[email-sla-job]', { scanned, sent });
    }
  } catch (err) {
    console.warn('[email-sla-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startEmailSlaTriggerJob(): void {
  if (slaTimer) return;
  console.info('[email-sla-job] iniciado — intervalo 30min');
  void runCycleSafe();
  slaTimer = setInterval(() => {
    void runCycleSafe();
  }, INTERVAL_MS);
}

export function stopEmailSlaTriggerJob(): void {
  if (slaTimer) {
    clearInterval(slaTimer);
    slaTimer = null;
  }
}
