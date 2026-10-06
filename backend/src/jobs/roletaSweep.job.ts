/**
 * roletaSweep.job v1.0.0 — distribui por rodízio os tickets órfãos acumulados entre os agentes
 * online (sem teto, sem gatilho de login/heartbeat). Ver distributeOrphansRoundRobin.
 */
import { isMongoConnected } from '../config/database';
import { distributeOrphansRoundRobin } from '../services/assignmentRouter.service';

const INTERVAL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected()) return;
  running = true;
  try {
    await distributeOrphansRoundRobin();
  } catch (err) {
    console.warn('[roleta-sweep]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startRoletaSweepJob(): void {
  if (timer) return;
  console.info(`[roleta-sweep] iniciado — varre a cada ${INTERVAL_MS}ms`);
  timer = setInterval(() => {
    void runCycleSafe();
  }, INTERVAL_MS);
}
