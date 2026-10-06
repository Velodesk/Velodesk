/**
 * useOnlineAgents v1.0.0 — quem está online agora, pro card do painel de gestão
 *
 * Mesmo padrão de polling do useDashboardOperacional (setTimeout recursivo + pausa quando a
 * aba está oculta), mas com intervalo bem mais curto: presença muda em segundos, não faz
 * sentido esperar os 10min do dashboard operacional.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { agentSessionsApi } from '../api/client';

const POLL_INTERVAL_MS = 30_000;

export function useOnlineAgents() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const payload = await agentSessionsApi.online();
      setAgents(payload?.agents ?? []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      await refresh();
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        void tick().finally(() => {
          if (!cancelled) schedule();
        });
      }, POLL_INTERVAL_MS);
    };

    schedule();

    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh]);

  return { agents, loading, error, refresh };
}
