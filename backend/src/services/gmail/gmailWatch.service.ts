/** gmailWatch.service v1.3.0 — suporta watch legado (mailbox antigo, somente inbound) em paralelo */
import { env } from '../../config/env';
import { isDeskConfigConnected } from '../../config/database';
import { getGmailWatchStateModel, findGmailWatchStateByKey } from '../../models/GmailWatchState';
import { createGmailClient, getGmailTopicName, GMAIL_SCOPE_READONLY } from './gmailAuth';
import { getDelegatedUserEmail, isEmailTransportReady } from '../emailTransport.service';

const RENEWAL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;

interface GmailWatchTarget {
  configKey: string;
  mailbox: string;
}

function primaryTarget(): GmailWatchTarget {
  return { configKey: env.gmailWatchStateDocumentId, mailbox: getDelegatedUserEmail() };
}

function legacyTarget(): GmailWatchTarget | null {
  if (!env.gmailLegacyInboundEnabled || !env.gmailLegacyDelegatedUserEmail.includes('@')) return null;
  return { configKey: env.gmailLegacyWatchStateDocumentId, mailbox: env.gmailLegacyDelegatedUserEmail };
}

let renewalTimer: ReturnType<typeof setInterval> | null = null;

export interface GmailWatchHealth {
  enabled: boolean;
  emailTransportReady: boolean;
  ready: boolean;
  mailbox: string | null;
  historyId: string | null;
  expiration: number | null;
  expiresInMs: number | null;
  lastWatchAt: string | null;
}

/**
 * Grava o registro do watch sem tocar no historyId já existente: sobrescrever o ponteiro
 * descartaria silenciosamente todo o backlog ainda não processado.
 */
async function persistWatchState(target: GmailWatchTarget, historyId: string, expiration: number) {
  const Model = getGmailWatchStateModel();
  await Model.findOneAndUpdate(
    { configKey: target.configKey },
    {
      $set: {
        configKey: target.configKey,
        mailbox: target.mailbox,
        expiration,
        lastWatchAt: new Date(),
      },
      $setOnInsert: { historyId: String(historyId) },
    },
    { upsert: true, new: true }
  );

  const current = await findGmailWatchStateByKey(target.configKey);
  if (!current?.historyId) {
    await Model.updateOne(
      { configKey: target.configKey },
      { $set: { historyId: String(historyId) } }
    );
  }
}

async function setupGmailWatchFor(target: GmailWatchTarget): Promise<{ historyId: string; expiration: number } | null> {
  if (!env.gmailInboundEnabled || !isEmailTransportReady()) {
    return null;
  }

  if (!target.mailbox.includes('@')) {
    console.warn(`[gmailWatch] mailbox inválido para configKey=${target.configKey}`);
    return null;
  }

  try {
    const gmail = await createGmailClient([GMAIL_SCOPE_READONLY], target.mailbox);
    const topicName = getGmailTopicName();

    const res = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName,
        labelIds: ['INBOX'],
        labelFilterBehavior: 'include',
      },
    });

    const historyId = String(res.data.historyId ?? '');
    const expiration = Number(res.data.expiration ?? 0);
    if (!historyId) throw new Error('historyId ausente na resposta watch');

    await persistWatchState(target, historyId, expiration);
    console.log(`[gmailWatch] watch ativo — mailbox=${target.mailbox} historyId=${historyId} exp=${expiration}`);
    return { historyId, expiration };
  } catch (err) {
    console.error(`[gmailWatch] setup falhou (mailbox=${target.mailbox}):`, (err as Error).message);
    return null;
  }
}

async function ensureGmailWatchFreshFor(target: GmailWatchTarget): Promise<void> {
  try {
    if (!env.gmailInboundEnabled || !isDeskConfigConnected()) return;

    const state = await findGmailWatchStateByKey(target.configKey);
    const now = Date.now();
    const needsRenew = !state?.expiration || state.expiration - now < RENEW_BEFORE_MS;

    if (needsRenew) {
      await setupGmailWatchFor(target);
    }
  } catch (err) {
    console.error(`[gmailWatch] ensureGmailWatchFresh falhou (mailbox=${target.mailbox}):`, (err as Error).message);
  }
}

export async function setupGmailWatch(): Promise<{ historyId: string; expiration: number } | null> {
  return setupGmailWatchFor(primaryTarget());
}

export async function setupLegacyGmailWatch(): Promise<{ historyId: string; expiration: number } | null> {
  const target = legacyTarget();
  if (!target) {
    console.warn('[gmailWatch] watch legado não configurado (GMAIL_LEGACY_INBOUND_ENABLED/GMAIL_LEGACY_DELEGATED_USER_EMAIL)');
    return null;
  }
  return setupGmailWatchFor(target);
}

export async function ensureGmailWatchFresh(): Promise<void> {
  await ensureGmailWatchFreshFor(primaryTarget());
  const target = legacyTarget();
  if (target) await ensureGmailWatchFreshFor(target);
}

export function startGmailWatchRenewalLoop(): void {
  if (!env.gmailInboundEnabled || renewalTimer) return;

  renewalTimer = setInterval(() => {
    void ensureGmailWatchFresh();
  }, RENEWAL_INTERVAL_MS);

  console.log('[gmailWatch] renovação automática a cada 24h (inclui watch legado, se habilitado)');
}

async function watchHealthFor(target: GmailWatchTarget | null): Promise<GmailWatchHealth | null> {
  if (!target) return null;
  let state: Awaited<ReturnType<typeof findGmailWatchStateByKey>> = null;

  try {
    if (isDeskConfigConnected()) {
      state = await findGmailWatchStateByKey(target.configKey);
    }
  } catch (err) {
    console.warn('[gmailWatch] health — desk_config:', (err as Error).message);
  }

  const expiration = state?.expiration ?? null;
  const transportReady = isEmailTransportReady();
  const watchActive = !!(state?.historyId && state?.expiration);

  return {
    enabled: env.gmailInboundEnabled,
    emailTransportReady: transportReady,
    ready: transportReady && watchActive,
    mailbox: (state?.mailbox ?? target.mailbox) || null,
    historyId: state?.historyId ?? null,
    expiration,
    expiresInMs: expiration ? expiration - Date.now() : null,
    lastWatchAt: state?.lastWatchAt ? new Date(state.lastWatchAt).toISOString() : null,
  };
}

export async function getGmailWatchHealth(): Promise<GmailWatchHealth> {
  const health = await watchHealthFor(primaryTarget());
  return (
    health ?? {
      enabled: env.gmailInboundEnabled,
      emailTransportReady: isEmailTransportReady(),
      ready: false,
      mailbox: null,
      historyId: null,
      expiration: null,
      expiresInMs: null,
      lastWatchAt: null,
    }
  );
}

export async function getLegacyGmailWatchHealth(): Promise<GmailWatchHealth & { enabled: boolean }> {
  const target = legacyTarget();
  const health = await watchHealthFor(target);
  return (
    health ?? {
      enabled: env.gmailLegacyInboundEnabled,
      emailTransportReady: isEmailTransportReady(),
      ready: false,
      mailbox: env.gmailLegacyDelegatedUserEmail || null,
      historyId: null,
      expiration: null,
      expiresInMs: null,
      lastWatchAt: null,
    }
  );
}

export async function getStoredHistoryId(): Promise<string | null> {
  const state = await findGmailWatchStateByKey(env.gmailWatchStateDocumentId);
  return state?.historyId ? String(state.historyId) : null;
}

export async function getStoredHistoryIdFor(configKey: string): Promise<string | null> {
  const state = await findGmailWatchStateByKey(configKey);
  return state?.historyId ? String(state.historyId) : null;
}

function toHistoryNumber(value: unknown): bigint | null {
  const raw = String(value ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * Avança o ponteiro apenas para frente. Retorna true quando houve avanço real.
 * Retroceder reprocessaria histórico já consumido e geraria duplicidade.
 */
export async function updateStoredHistoryIdFor(configKey: string, historyId: string): Promise<boolean> {
  const next = String(historyId ?? '').trim();
  if (!next) return false;

  const current = await getStoredHistoryIdFor(configKey);
  const nextNum = toHistoryNumber(next);
  const currentNum = toHistoryNumber(current);

  if (current === next) return false;
  if (nextNum !== null && currentNum !== null && nextNum <= currentNum) return false;

  const Model = getGmailWatchStateModel();
  await Model.findOneAndUpdate(
    { configKey },
    { $set: { historyId: next } },
    { upsert: true }
  );
  return true;
}

export async function updateStoredHistoryId(historyId: string): Promise<boolean> {
  return updateStoredHistoryIdFor(env.gmailWatchStateDocumentId, historyId);
}

export function getPrimaryWatchConfigKey(): string {
  return env.gmailWatchStateDocumentId;
}

export function getLegacyWatchTarget(): GmailWatchTarget | null {
  return legacyTarget();
}
