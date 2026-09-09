/**
 * authSession v1.0.0 — limpeza de sessão Desk (localStorage)
 * VERSION: v1.0.0 | DATE: 2026-07-17
 */

export function clearStoredAuthSession() {
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

export function isPublicAuthApiPath(url = '') {
  const path = String(url || '');
  return (
    path.includes('/login')
    || path.includes('/auth/google')
    || path.includes('/auth/dev-login')
  );
}

export function redirectToLoginIfNeeded() {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  window.location.href = '/login';
}
