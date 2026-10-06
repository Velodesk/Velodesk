/**
 * authSession v1.0.0 — limpeza de sessão Desk (localStorage)
 * VERSION: v1.0.0 | DATE: 2026-07-17
 */

export function isPublicAuthApiPath(url = '') {
  const path = String(url || '');
  return (
    path.includes('/login')
    || path.includes('/auth/google')
    || path.includes('/auth/dev-login')
  );
}
