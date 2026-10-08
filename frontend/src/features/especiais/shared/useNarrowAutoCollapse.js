/**
 * Recolhe uma coluna (fila / lista) dos CRMs de casos especiais em telas estreitas (notebook,
 * zoom alto, janela dividida) sem gravar a preferência; ao voltar para tela larga, restaura o
 * valor salvo em localStorage pelo agente.
 */
import { useEffect } from 'react';

export const ESPECIAIS_QUEUE_NARROW_QUERY = '(max-width: 1100px)';
export const ESPECIAIS_LIST_NARROW_QUERY = '(max-width: 960px)';

export function matchesViewport(query) {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
}

function readStoredCollapsed(storageKey) {
  try {
    return localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

/** Estado inicial da coluna: preferência salva ou tela estreita. */
export function readCollapsedPreference(storageKey, query) {
  return readStoredCollapsed(storageKey) || matchesViewport(query);
}

export function useNarrowAutoCollapse(query, storageKey, setCollapsed) {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = (event) => {
      setCollapsed(event.matches || readStoredCollapsed(storageKey));
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query, storageKey, setCollapsed]);
}
