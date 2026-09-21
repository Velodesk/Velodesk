/**
 * initialMessagePrompt — versão genérica de raInitialMessagePrompt.js, parametrizada por
 * módulo (bc/pc/cg/...), pra não duplicar a chave de storage por canal de casos especiais.
 */
function storageKeyFor(moduleKey) {
  return `veloDesk${moduleKey}InitialMessageAnsweredV1`;
}

function readAnsweredSet(moduleKey) {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKeyFor(moduleKey)) || '[]'));
  } catch {
    return new Set();
  }
}

function writeAnsweredSet(moduleKey, set) {
  try {
    localStorage.setItem(storageKeyFor(moduleKey), JSON.stringify([...set]));
  } catch {
    /* localStorage indisponível (modo privado/quota) — prompt pode reaparecer ao recarregar */
  }
}

export function isInitialMessageAnswered(moduleKey, ticketId) {
  if (!ticketId) return false;
  return readAnsweredSet(moduleKey).has(String(ticketId));
}

export function markInitialMessageAnswered(moduleKey, ticketId) {
  if (!ticketId) return;
  const set = readAnsweredSet(moduleKey);
  set.add(String(ticketId));
  writeAnsweredSet(moduleKey, set);
}
