/** emailTransport.service v1.1.0 — envio espera snapshot Gmail no startup */
import { env } from '../config/env';
import { isDeskConfigConnected } from '../config/database';
import { findEmailTransportSingleton, IServiceAccountJson } from '../models/EmailTransportConfig';

export interface EmailTransportSnapshot {
  transportMode: 'gmail_api' | 'smtp';
  defaultFromEmail: string;
  delegatedUserEmail: string;
  serviceAccountJson: IServiceAccountJson;
}

const READY_WAIT_MS = 15_000;
const READY_POLL_MS = 400;

let snapshot: EmailTransportSnapshot | null = null;
let loadInflight: Promise<'ready' | 'incomplete' | 'unavailable'> | null = null;
let loggedReady = false;

function applyDoc(doc: {
  transportMode?: string;
  defaultFromEmail?: string;
  delegatedUserEmail?: string;
  serviceAccountJson?: IServiceAccountJson | null;
} | null) {
  if (!doc) {
    snapshot = null;
    return;
  }

  const defaultFromEmail = String(doc.defaultFromEmail ?? '').trim().toLowerCase();
  let delegatedUserEmail = String(doc.delegatedUserEmail ?? doc.defaultFromEmail ?? '').trim().toLowerCase();
  if (defaultFromEmail && !delegatedUserEmail.includes('@')) {
    delegatedUserEmail = defaultFromEmail;
  }

  const sa = doc.serviceAccountJson;
  if (!sa?.client_email || !sa?.private_key) {
    snapshot = null;
    return;
  }

  const transportMode: EmailTransportSnapshot['transportMode'] = doc.transportMode === 'smtp' ? 'smtp' : 'gmail_api';

  snapshot = {
    transportMode,
    defaultFromEmail,
    delegatedUserEmail,
    serviceAccountJson: sa,
  };
}

export function isEmailTransportReady(): boolean {
  if (!env.emailEnabled) return false;
  const s = snapshot;
  return !!(
    s &&
    s.defaultFromEmail.includes('@') &&
    s.delegatedUserEmail.includes('@') &&
    s.serviceAccountJson?.client_email &&
    s.serviceAccountJson?.private_key
  );
}

export function getEmailTransportSnapshot(): EmailTransportSnapshot | null {
  return snapshot;
}

export function getEffectiveFromAddress(): string {
  return snapshot?.defaultFromEmail ?? '';
}

export function getDelegatedUserEmail(): string {
  return snapshot?.delegatedUserEmail ?? '';
}

async function loadEmailTransportOnce(): Promise<'ready' | 'incomplete' | 'unavailable'> {
  try {
    const doc = await findEmailTransportSingleton();
    applyDoc(doc);
    if (isEmailTransportReady()) {
      if (!loggedReady) {
        loggedReady = true;
        console.log(`[emailTransport] pronto (${snapshot?.transportMode}) — from=${getEffectiveFromAddress()}`);
      }
      return 'ready';
    }
    loggedReady = false;
    if (env.emailEnabled) {
      console.warn('[emailTransport] EMAIL_ENABLED=true mas desk_config.email_transport incompleto');
    }
    return 'incomplete';
  } catch (err) {
    console.error('[emailTransport] falha ao carregar:', (err as Error).message);
    snapshot = null;
    loggedReady = false;
    return 'unavailable';
  }
}

export async function loadEmailTransport(): Promise<void> {
  await runLoadEmailTransport();
}

async function runLoadEmailTransport(): Promise<'ready' | 'incomplete' | 'unavailable'> {
  if (loadInflight) return loadInflight;
  loadInflight = loadEmailTransportOnce().finally(() => {
    loadInflight = null;
  });
  return loadInflight;
}

/**
 * Garante o snapshot Gmail antes de enviar.
 * No restart o HTTP sobe antes do bootstrap: se desk_config já conectou, carrega na hora;
 * senão espera até timeoutMs pelo Mongo/desk_config. Config incompleta não fica em loop.
 */
export async function ensureEmailTransportReady(timeoutMs = READY_WAIT_MS): Promise<boolean> {
  if (!env.emailEnabled) return false;
  if (isEmailTransportReady()) return true;

  const deadline = Date.now() + Math.max(0, timeoutMs);

  while (Date.now() <= deadline) {
    if (isEmailTransportReady()) return true;
    if (isDeskConfigConnected()) {
      const result = await runLoadEmailTransport();
      if (result === 'ready') return true;
      if (result === 'incomplete') return false;
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  if (isDeskConfigConnected() && !isEmailTransportReady()) {
    const result = await runLoadEmailTransport();
    return result === 'ready';
  }
  return isEmailTransportReady();
}

export async function reloadEmailTransport(): Promise<void> {
  loggedReady = false;
  await loadEmailTransport();
}
