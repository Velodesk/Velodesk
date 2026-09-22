/**
 * agentPresence v1.1.0 — heartbeat resistente a aba em 2º plano (visibilitychange + sendBeacon)
 * VERSION: v1.1.0 | DATE: 2026-09-22
 *
 * Aba fora de foco leva o navegador a desacelerar (throttle) o setInterval do heartbeat,
 * podendo estourar o TTL de presença (5min) mesmo com o agente logado e trabalhando — daí:
 * (1) heartbeat periódico via sendBeacon (mais confiável que fetch/axios sob throttling/
 *     descarregamento de página) e (2) heartbeat extra assim que a aba volta a ficar visível,
 *     fechando o intervalo em que o setInterval pode ter atrasado enquanto escondida.
 */
import api from '../api/client';

const HEARTBEAT_URL = '/api/agents/presence/heartbeat';
const OFFLINE_URL = '/api/agents/presence/offline';
const HEARTBEAT_MS = 120_000;
let heartbeatTimer = null;
let started = false;

function getToken() {
  return localStorage.getItem('velodesk_token') || '';
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

export async function sendAgentHeartbeat() {
  try {
    await api.post('/agents/presence/heartbeat');
  } catch (err) {
    console.warn('[agentPresence] heartbeat falhou', err?.response?.status || err?.message);
  }
}

/** Heartbeat "silencioso" (sem esperar resposta) pro intervalo periódico e pro retorno de foco. */
function pingHeartbeat() {
  if (!sendBeaconWithToken(HEARTBEAT_URL)) {
    void sendAgentHeartbeat();
  }
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
    pingHeartbeat();
  }
}

export function startAgentPresenceHeartbeat() {
  if (started) return;
  started = true;

  void sendAgentHeartbeat();

  heartbeatTimer = window.setInterval(() => {
    pingHeartbeat();
  }, HEARTBEAT_MS);

  window.addEventListener('beforeunload', onBeforeUnload);
  document.addEventListener('visibilitychange', onVisibilityChange);
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
}

export async function notifyAgentOfflineAndStop() {
  stopAgentPresenceHeartbeat();
  await sendAgentOffline();
}
