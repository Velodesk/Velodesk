/** agentPresence.service v1.0.0 — heartbeat online/offline para roleta cap-10 */
import type { AuthPayload } from '../middleware/auth';
import { env } from '../config/env';
import { getAgentPresenceModel } from '../models/AgentPresence';
import { isAllMongoReady, waitForMongoReady } from '../config/database';

function emailLocalPart(email?: string): string {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0] ?? '';
}

function responsavelKeyFromAuth(authUser: AuthPayload): string {
  const fromEmail = emailLocalPart(authUser.email);
  if (fromEmail) return fromEmail;
  return String(authUser.name ?? '').trim();
}

export interface PresenceHeartbeatResult {
  online: boolean;
  lastSeenAt: string;
  wasOffline: boolean;
}

function normalizeEmail(email?: string): string {
  return String(email ?? '').trim().toLowerCase();
}

export function isPresenceStale(lastSeenAt?: Date | null): boolean {
  if (!lastSeenAt) return true;
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  return elapsed > env.assignmentRouterPresenceTtlMs;
}

export async function recordAgentHeartbeat(authUser: AuthPayload): Promise<PresenceHeartbeatResult> {
  if (!isAllMongoReady()) await waitForMongoReady();
  const Model = getAgentPresenceModel();
  const email = normalizeEmail(authUser.email);
  const userId = String(authUser.userId ?? '').trim();
  const responsavelKey = responsavelKeyFromAuth(authUser).toLowerCase();
  const now = new Date();

  const existing = await Model.findOne({ userId }).lean();
  const wasOffline = !existing?.online || isPresenceStale(existing?.lastSeenAt);

  await Model.findOneAndUpdate(
    { userId },
    {
      $set: {
        email,
        responsavelKey,
        online: true,
        lastSeenAt: now,
      },
      $setOnInsert: {
        lastOfflineAt: null,
      },
    },
    { upsert: true, new: true },
  );

  if (wasOffline && responsavelKey) {
    // backfill roleta disparado em agents.routes após heartbeat
  }

  return {
    online: true,
    lastSeenAt: now.toISOString(),
    wasOffline,
  };
}

export async function recordAgentOffline(authUser: AuthPayload): Promise<void> {
  if (!isAllMongoReady()) await waitForMongoReady();
  const Model = getAgentPresenceModel();
  const userId = String(authUser.userId ?? '').trim();
  if (!userId) return;

  const now = new Date();
  await Model.findOneAndUpdate(
    { userId },
    {
      $set: {
        email: normalizeEmail(authUser.email),
        responsavelKey: responsavelKeyFromAuth(authUser).toLowerCase(),
        online: false,
        lastOfflineAt: now,
        lastSeenAt: now,
      },
    },
    { upsert: true },
  );
}

export async function listOnlineEligiblePresenceKeys(): Promise<string[]> {
  const Model = getAgentPresenceModel();
  const cutoff = new Date(Date.now() - env.assignmentRouterPresenceTtlMs);
  const docs = await Model.find({
    online: true,
    lastSeenAt: { $gte: cutoff },
    responsavelKey: { $ne: '' },
  })
    .select('responsavelKey')
    .lean();

  return [...new Set(
    docs
      .map((doc) => String(doc.responsavelKey ?? '').trim().toLowerCase())
      .filter(Boolean),
  )];
}

export async function isAgentOnlineByResponsavelKey(responsavelKey: string): Promise<boolean> {
  const key = String(responsavelKey ?? '').trim().toLowerCase();
  if (!key) return false;

  const Model = getAgentPresenceModel();
  const cutoff = new Date(Date.now() - env.assignmentRouterPresenceTtlMs);
  const doc = await Model.findOne({
    responsavelKey: key,
    online: true,
    lastSeenAt: { $gte: cutoff },
  }).lean();

  return Boolean(doc);
}
