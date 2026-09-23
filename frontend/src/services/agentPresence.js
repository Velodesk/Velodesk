/**
 * agentPresence v1.2.0 — heartbeat só com atividade real (mousemove/keydown/click)
 * VERSION: v1.2.0 | DATE: 2026-09-23
 *
 * Aba fora de foco leva o navegador a desacelerar (throttle) o setInterval do heartbeat,
 * podendo estourar o TTL de presença (5min) mesmo com o agente logado e trabalhando — daí:
 * (1) heartbeat periódico via sendBeacon (mais confiável que fetch/axios sob throttling/
 *     descarregamento de página) e (2) heartbeat extra assim que a aba volta a ficar visível,
 *     fechando o intervalo em que o setInterval pode ter atrasado enquanto escondida.
 *
 * Isso resolve aba em 2º plano, mas cria um problema oposto: aba deixada aberta e esquecida
 * (ex.: fim de turno sem logout) continua respondendo "estou aqui" pra sempre, porque o
 * navegador está tecnicamente vivo mesmo sem ninguém usando. Por isso o heartbeat periódico e
 * o de retorno de foco só disparam se houve interação real (mouse/teclado/clique) nos últimos
 * IDLE_THRESHOLD_MS — sem isso, o heartbeat para de ser mandado e a presença expira sozinha
 * pelo TTL de 5min já existente no backend, mesmo com a aba ainda aberta.
 */
import api from '../api/client';

const HEARTBEAT_URL = '/api/agents/presence/heartbeat';
const OFFLINE_URL = '/api/agents/presence/offline';
const HEARTBEAT_MS = 120_000;
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

export async function sendAgentHeartbeat() {
  try {
    await api.post('/agents/presence/heartbeat');
  } catch (err) {
    console.warn('[agentPresence] heartbeat falhou', err?.response?.status || err?.message);
  }
}

/** Heartbeat "silencioso" (sem esperar resposta) pro intervalo periódico e pro retorno de foco. */
function pingHeartbeat() {
  if (isIdle()) return;
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
