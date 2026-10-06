/**
 * backendJwt v1.0.0 — validação local do JWT do backend Desk
 * VERSION: v1.0.0 | DATE: 2026-07-15 | AUTHOR: VeloHub Development Team
 */
import { DEV_LOCAL_TOKEN } from '../config/devAuth';

export function decodeBackendJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    return JSON.parse(atob(parts[1]));
  } catch {
    return null;
  }
}

export function isBackendJwtUsable(token) {
  if (!token || token === DEV_LOCAL_TOKEN) return false;
  const payload = decodeBackendJwtPayload(token);
  if (!payload) return false;

  const userId = String(payload.userId ?? payload.sub ?? '').trim();
  if (!/^[a-f0-9]{24}$/i.test(userId)) return false;

  if (typeof payload.exp === 'number' && payload.exp * 1000 <= Date.now()) {
    return false;
  }

  return true;
}

export function clearDeskAuthSession() {
  localStorage.removeItem('velodesk_gate_authorized');
  localStorage.removeItem('velodesk_user');
  localStorage.removeItem('velodesk_colaborador');
  localStorage.removeItem('velodesk_token');
  localStorage.removeItem('velodesk_auth_mode');
  localStorage.removeItem('velodesk_profile_locked');
  localStorage.removeItem('velodeskProfile');
  localStorage.removeItem('velodeskCustomQueues');
  localStorage.removeItem('velodeskCustomQueuesMigrated');
}
