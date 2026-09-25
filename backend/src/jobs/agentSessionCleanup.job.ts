/**
 * agentSessionCleanup.job v1.0.0 — marca offline sessões sem heartbeat há >180s (3 perdidos)
 */
import { isMongoConnected } from '../config/database';
import { sweepStaleAgentSessions } from '../services/agentSession.service';

const INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function runCycleSafe(): Promise<void> {
  if (running || !isMongoConnected()) return;
  running = true;
  try {
    const count = await sweepStaleAgentSessions();
    if (count > 0) {
      console.info('[agent-session-cleanup] sessões marcadas offline por inatividade', { count });
    }
  } catch (err) {
    console.warn('[agent-session-cleanup]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startAgentSessionCleanupJob(): void {
  if (timer) return;
  console.info(`[agent-session-cleanup] iniciado — varre a cada ${INTERVAL_MS}ms`);
  timer = setInterval(() => {
    void runCycleSafe();
  }, INTERVAL_MS);
}
