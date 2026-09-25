/**
 * agentSession.service v1.0.0 — sessão real de agente (substitui agentPresence.service)
 * Singleton por colaborador (sem histórico): online/offline, heartbeat, e cache em memória do
 * nome de exibição (alias ou nome completo) pra uso sem I/O extra em req.user.displayName.
 */
import { getAgentSessionModel } from '../models/AgentSession';
import { isAllMongoReady, waitForMongoReady } from '../config/database';
import { getResponsavelDisplayIndexSync } from './colaboradoresCadastro.service';
import type { ColaboradorDeskPublico } from './colaboradoresCadastro.service';
import { resolveColaboradorDisplayName } from './colaboradoresCadastro.service';

/** 3 heartbeats perdidos (heartbeat de 60s no front) — usado pelo job de limpeza. */
export const AGENT_SESSION_STALE_MS = 180_000;

interface AgentSessionCacheEntry {
  displayName: string;
  cachedAt: number;
}

const displayNameCache = new Map<string, AgentSessionCacheEntry>();

function emailLocalPart(email?: string): string {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0] ?? '';
}

function normalizeEmail(email?: string): string {
  return String(email ?? '').trim().toLowerCase();
}

function resolveDisplayNameFromIndex(email: string, fallback: string): string {
  const index = getResponsavelDisplayIndexSync();
  const key = normalizeEmail(email);
  const fromIndex = index.get(key) || index.get(emailLocalPart(key));
  return fromIndex || fallback;
}

/** Leitura em memória, sem I/O — usada pelo middleware de auth em toda requisição autenticada. */
export function getCachedDisplayName(userId: string): string | undefined {
  const id = String(userId ?? '').trim();
  if (!id) return undefined;
  return displayNameCache.get(id)?.displayName;
}

function setCachedDisplayName(userId: string, displayName: string): void {
  const id = String(userId ?? '').trim();
  if (!id || !displayName) return;
  displayNameCache.set(id, { displayName, cachedAt: Date.now() });
}

export function isAgentSessionStale(lastSeenAt?: Date | null): boolean {
  if (!lastSeenAt) return true;
  return Date.now() - new Date(lastSeenAt).getTime() > AGENT_SESSION_STALE_MS;
}

export interface OpenAgentSessionInput {
  userId: string;
  email: string;
  colaborador?: Pick<ColaboradorDeskPublico, 'aliasColaborador' | 'colaboradorNome'> | null;
  fallbackName?: string;
}

/** Chamado no login — abre/reabre a sessão do colaborador. */
export async function openAgentSession(input: OpenAgentSessionInput): Promise<{ displayName: string }> {
  if (!isAllMongoReady()) await waitForMongoReady();
  const Model = getAgentSessionModel();
  const userId = String(input.userId ?? '').trim();
  const email = normalizeEmail(input.email);
  const responsavelKey = emailLocalPart(email);
  const displayName = input.colaborador
    ? resolveColaboradorDisplayName(input.colaborador)
    : String(input.fallbackName || '').trim();
  const now = new Date();

  await Model.findOneAndUpdate(
    { userId },
    {
      $set: {
        email,
        responsavelKey,
        displayName,
        online: true,
        lastSeenAt: now,
        lastLoginAt: now,
        forceLogoffAt: null,
        forceLogoffBy: null,
      },
      $setOnInsert: {
        lastOfflineAt: null,
      },
    },
    { upsert: true, new: true },
  );

  setCachedDisplayName(userId, displayName);
  return { displayName };
}

export interface AgentSessionHeartbeatResult {
  online: boolean;
  lastSeenAt: string;
  wasOffline: boolean;
  displayName: string;
  forceLogoff: boolean;
}

/** Chamado a cada heartbeat (60s) — mantém a sessão viva e resolve pedido de forçar logoff. */
export async function touchAgentSession(userId: string, email?: string): Promise<AgentSessionHeartbeatResult> {
  if (!isAllMongoReady()) await waitForMongoReady();
  const Model = getAgentSessionModel();
  const id = String(userId ?? '').trim();
  const now = new Date();

  const existing = await Model.findOne({ userId: id });
  const wasOffline = !existing?.online || isAgentSessionStale(existing?.lastSeenAt);
  const forceLogoff = Boolean(existing?.forceLogoffAt);
  const displayName = resolveDisplayNameFromIndex(
    email || existing?.email || '',
    existing?.displayName || '',
  );

  await Model.findOneAndUpdate(
    { userId: id },
    {
      $set: {
        online: !forceLogoff,
        lastSeenAt: now,
        displayName,
        ...(forceLogoff ? { forceLogoffAt: null, forceLogoffBy: null, lastOfflineAt: now } : {}),
      },
      $setOnInsert: {
        email: normalizeEmail(email),
        responsavelKey: emailLocalPart(email),
        lastOfflineAt: null,
        lastLoginAt: now,
      },
    },
    { upsert: true },
  );

  setCachedDisplayName(id, displayName);

  return {
    online: !forceLogoff,
    lastSeenAt: now.toISOString(),
    wasOffline,
    displayName,
    forceLogoff,
  };
}

/** Chamado no logout (manual ou beacon de aba fechada). */
export async function closeAgentSession(userId: string, email?: string): Promise<void> {
  if (!isAllMongoReady()) await waitForMongoReady();
  const Model = getAgentSessionModel();
  const id = String(userId ?? '').trim();
  if (!id) return;

  const now = new Date();
  await Model.findOneAndUpdate(
    { userId: id },
    {
      $set: {
        online: false,
        lastOfflineAt: now,
        lastSeenAt: now,
        ...(email ? { email: normalizeEmail(email), responsavelKey: emailLocalPart(email) } : {}),
      },
    },
    { upsert: true },
  );
}

/** Ação de gestor — marca a sessão pra ser encerrada no próximo heartbeat do colaborador. */
export async function requestForceLogoff(userId: string, byEmail: string): Promise<boolean> {
  const Model = getAgentSessionModel();
  const id = String(userId ?? '').trim();
  if (!id) return false;
  const now = new Date();
  const result = await Model.findOneAndUpdate(
    { userId: id },
    { $set: { forceLogoffAt: now, forceLogoffBy: normalizeEmail(byEmail), online: false, lastOfflineAt: now } },
  );
  return Boolean(result);
}

/** Ação de gestor — derruba todo mundo que está online agora. */
export async function requestForceLogoffAll(byEmail: string): Promise<number> {
  const Model = getAgentSessionModel();
  const now = new Date();
  const result = await Model.updateMany(
    { online: true },
    { $set: { forceLogoffAt: now, forceLogoffBy: normalizeEmail(byEmail), online: false, lastOfflineAt: now } },
  );
  return result.modifiedCount ?? 0;
}

export async function listOnlineEligiblePresenceKeys(): Promise<string[]> {
  const Model = getAgentSessionModel();
  const cutoff = new Date(Date.now() - AGENT_SESSION_STALE_MS);
  const docs = await Model.find({
    online: true,
    lastSeenAt: { $gte: cutoff },
    responsavelKey: { $ne: '' },
  })
    .select('responsavelKey')
    .lean();

  return [...new Set(
    docs.map((doc) => String(doc.responsavelKey ?? '').trim().toLowerCase()).filter(Boolean),
  )];
}

/**
 * E-mails de quem está online agora — usar isto pra checar elegibilidade da roleta, nunca
 * `listOnlineEligiblePresenceKeys`/responsavelKey pra esse fim (ver aviso histórico em
 * assignmentRouter.service.ts: os dois formatos de chave nunca coincidem).
 */
export async function listOnlineEligibleEmails(): Promise<Set<string>> {
  const Model = getAgentSessionModel();
  const cutoff = new Date(Date.now() - AGENT_SESSION_STALE_MS);
  const docs = await Model.find({
    online: true,
    lastSeenAt: { $gte: cutoff },
    email: { $ne: '' },
  })
    .select('email')
    .lean();

  return new Set(docs.map((doc) => String(doc.email ?? '').trim().toLowerCase()).filter(Boolean));
}

export interface OnlineAgentBoardEntry {
  userId: string;
  email: string;
  displayName: string;
}

/** Lista pro card "Usuários online" do painel de gestão. */
export async function listOnlineAgentsForBoard(): Promise<OnlineAgentBoardEntry[]> {
  const Model = getAgentSessionModel();
  const cutoff = new Date(Date.now() - AGENT_SESSION_STALE_MS);
  const docs = await Model.find({ online: true, lastSeenAt: { $gte: cutoff } })
    .select('userId email displayName')
    .sort({ displayName: 1 })
    .lean();

  return docs.map((doc) => ({
    userId: String(doc.userId ?? ''),
    email: String(doc.email ?? ''),
    displayName: String(doc.displayName || doc.email || ''),
  }));
}

/** Marca offline toda sessão sem heartbeat há mais de AGENT_SESSION_STALE_MS — job de limpeza. */
export async function sweepStaleAgentSessions(): Promise<number> {
  const Model = getAgentSessionModel();
  const cutoff = new Date(Date.now() - AGENT_SESSION_STALE_MS);
  const result = await Model.updateMany(
    { online: true, lastSeenAt: { $lt: cutoff } },
    { $set: { online: false, lastOfflineAt: new Date() } },
  );
  return result.modifiedCount ?? 0;
}
