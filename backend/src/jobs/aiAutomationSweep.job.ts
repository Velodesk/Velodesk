/**
 * aiAutomationSweep.job v2.0.0 — recupera chamados presos no fluxo do agente autônomo
 * VERSION: v2.0.0 | DATE: 2026-10-19
 *
 * - processando há mais de 10 min (instância caiu no meio do pipeline): volta às filas humanas.
 * - em_revisao há mais de 10 min (decisão humana interrompida): volta à fila de aprovação.
 */
import { ChamadoN1 } from '../models/ChamadoN1';
import { recoverStaleReviews, releaseProcessing } from '../services/agents/aiAutomation.service';

const INTERVAL_MS = 2 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;

export async function sweepAiAutomation(): Promise<void> {
  const limite = new Date(Date.now() - STALE_MS);
  const presos = await ChamadoN1.find({
    'aiAutomation.status': 'processando',
    'aiAutomation.updatedAt': { $lt: limite },
  }).select('_id').limit(50).lean();
  for (const c of presos) await releaseProcessing(String(c._id), 'processando_expirado');
  await recoverStaleReviews(limite);
}

export function startAiAutomationSweepJob(): void {
  const tick = () => {
    sweepAiAutomation().catch((err) => console.warn('[aiAutomationSweep] fail-soft:', (err as Error).message));
  };
  setInterval(tick, INTERVAL_MS).unref?.();
  setTimeout(tick, 30_000).unref?.();
}
