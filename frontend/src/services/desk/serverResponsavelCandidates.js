/**
 * serverResponsavelCandidates v1.0.0 — candidatos de "sou eu" calculados pelo backend (mesmos da contagem de Meus Tickets).
 * Inclui alias/nome de exibição do cadastro de colaboradores, que o navegador sozinho não conhece.
 * Módulo à parte para evitar import circular entre queueCounts e responsavelSegmentation.
 */
const STORAGE_KEY = 'velodesk_responsavel_candidates_v1';

let candidates = null;

function normalizeList(list) {
  return [...new Set((Array.isArray(list) ? list : [])
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean))];
}

export function setServerResponsavelCandidates(list, userEmail = '') {
  candidates = normalizeList(list);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      userEmail: String(userEmail || '').trim().toLowerCase(),
      candidates,
    }));
  } catch {
    /* quota ou modo privado */
  }
}

export function getServerResponsavelCandidates() {
  if (candidates) return candidates;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const stored = JSON.parse(localStorage.getItem('velodesk_user') || '{}');
    const sameUser = !parsed?.userEmail
      || String(stored?.email || '').trim().toLowerCase() === parsed.userEmail;
    candidates = sameUser ? normalizeList(parsed?.candidates) : [];
  } catch {
    candidates = [];
  }
  return candidates;
}
