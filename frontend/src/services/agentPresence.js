/**
 * agentPresence v1.3.0 — heartbeat de 60s lendo a resposta (detecta forceLogoff do gestor)
 * VERSION: v1.3.0 | DATE: 2026-09-25
 *
 * O heartbeat periódico e o de retorno de foco só disparam se houve interação real
 * (mouse/teclado/clique) nos últimos IDLE_THRESHOLD_MS — uma aba deixada aberta e esquecida
 * (ex.: fim de turno sem logout) para de mandar heartbeat e a sessão expira sozinha pelo
 * mecanismo de sessão do backend (3 heartbeats perdidos ~180s), mesmo com a aba ainda aberta.
 *
 * O heartbeat periódico usa axios (não sendBeacon) porque a resposta carrega `forceLogoff`
 * (gestor derrubou a sessão pelo painel) — sendBeacon é fire-and-forget e nunca entregaria esse
 * sinal. sendBeacon fica reservado só para o aviso de aba fechando (onBeforeUnload).
 */
import api from '../api/client';

const OFFLINE_URL = '/api/agents/presence/offline';
const HEARTBEAT_MS = 60_000;
const IDLE_THRESHOLD_MS = 15 * 60_000;
const ACTIVITY_THROTTLE_MS = 2_000;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];

let heartbeatTimer = null;
let started = false;
let lastActivityAt = 0;
let lastActivityWriteAt = 0;

function getToken() {
  return localStorage.getItem('velodesk_token') || '';
}

function markActivity() {
  const now = Date.now();
  // grava o timestamp real sempre, mas só entre chamadas custosas — evita reescrever a
  // variável em toda micro-movimentação do mouse (mousemove pode disparar centenas de vezes/s).
  if (now - lastActivityWriteAt < ACTIVITY_THROTTLE_MS) return;
  lastActivityWriteAt = now;
  lastActivityAt = now;
}

function isIdle() {
  return Date.now() - lastActivityAt > IDLE_THRESHOLD_MS;
}

/** sendBeacon não permite header Authorization — o token vai no corpo (ver authFromHeaderOrBody no backend). */
function sendBeaconWithToken(url) {
  const token = getToken();
  if (!token || typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
  try {
    const blob = new Blob([JSON.stringify({ token })], { type: 'application/json' });
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
}

/** Dispara quando o backend sinaliza que um gestor forçou o logoff desta sessão (ver
 * agentSession.service.ts:touchAgentSession). Quem escuta decide como encerrar a sessão local
 * (ver AuthContext/interceptor 401) — este módulo só detecta e avisa. */
function dispatchForceLogoff() {
  try {
    window.dispatchEvent(new CustomEvent('velodesk:force-logoff'));
  } catch {
    /* ignore */
  }
}

export async function sendAgentHeartbeat() {
  try {
    const { data } = await api.post('/agents/presence/heartbeat');
    if (data?.forceLogoff) dispatchForceLogoff();
  } catch (err) {
    console.warn('[agentPresence] heartbeat falhou', err?.response?.status || err?.message);
  }
}

/**
 * Heartbeat periódico e de retorno de foco. Usa axios (não sendBeacon) porque precisamos ler a
 * resposta pra detectar `forceLogoff` — sendBeacon é fire-and-forget e nunca entregaria esse
 * sinal. sendBeacon continua reservado só para o aviso de aba fechando (onBeforeUnload), onde
 * não há mais chance de ler resposta de qualquer forma.
 */
function pingHeartbeat() {
  if (isIdle()) return;
  void sendAgentHeartbeat();
}

export async function sendAgentOffline() {
  try {
    await api.post('/agents/presence/offline');
  } catch {
    /* best-effort */
  }
}

function onBeforeUnload() {
  sendBeaconWithToken(OFFLINE_URL);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') {
    // voltar pra aba já conta como atividade, mesmo antes de mexer o mouse — senão o
    // heartbeat pode ficar preso "idle" logo no primeiro ping depois de um tempo fora.
    markActivity();
    pingHeartbeat();
  }
}

export function startAgentPresenceHeartbeat() {
  if (started) return;
  started = true;
  markActivity();

  void sendAgentHeartbeat();

  heartbeatTimer = window.setInterval(() => {
    pingHeartbeat();
  }, HEARTBEAT_MS);

  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibilityChange);
  ACTIVITY_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, markActivity, { passive: true });
  });
}

export function stopAgentPresenceHeartbeat() {
  if (!started) return;
  started = false;

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  window.removeEventListener('beforeunload', onBeforeUnload);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  ACTIVITY_EVENTS.forEach((eventName) => {
    window.removeEventListener(eventName, markActivity);
  });
}

export async function notifyAgentOfflineAndStop() {
  stopAgentPresenceHeartbeat();
  await sendAgentOffline();
}
