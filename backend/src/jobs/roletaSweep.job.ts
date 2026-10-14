/**
 * roletaSweep.job v1.1.0 — distribui por rodízio os tickets órfãos acumulados entre os agentes
 * online, respeitando o teto por agente só na janela de 8h–9h de Brasília (CAP_START/END_HOUR);
 * fora dela, sem teto. Sem gatilho de login/heartbeat. Ver distributeOrphansRoundRobin /
 * pickRoundRobinAgent / isWithinRoletaCapWindow.
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
