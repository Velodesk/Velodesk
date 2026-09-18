/**
 * redesSociaisCaptacao.job v1.0.0 — capta e classifica comentários/avaliações de
 * Facebook, Instagram e Google Play a cada env.redesSociaisPollIntervalMs
 * VERSION: v1.0.0 | DATE: 2026-09-18
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { rodarCicloRedesSociais } from '../services/redesSociais/orquestrador.service';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected()) return;
  running = true;
  try {
    await rodarCicloRedesSociais();
  } catch (err) {
    console.warn('[redes-sociais-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startRedesSociaisCaptacaoJob(): void {
  if (timer) return;
  if (!env.redesSociaisCaptacaoEnabled) {
    console.info('[redes-sociais-job] REDES_SOCIAIS_CAPTACAO_ENABLED != true — job não iniciado.');
    return;
  }

  const intervalMs = Math.max(60_000, env.redesSociaisPollIntervalMs);
  console.info(`[redes-sociais-job] iniciado — ciclo a cada ${intervalMs}ms`);

  // 1ª execução imediata — não espera o primeiro intervalo completo.
  void runCycleSafe();
  timer = setInterval(() => {
    void runCycleSafe();
  }, intervalMs);
}

export function stopRedesSociaisCaptacaoJob(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
