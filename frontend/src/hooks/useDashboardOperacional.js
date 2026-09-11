/**
 * useDashboardOperacional v1.1.0 — payload agregado do dashboard operacional com filtro de período.
 *
 * Refresh silencioso a cada 10 min + volta imediata ao voltar da aba (visibilitychange).
 * Aceita `{ period, from, to }` — muda o período redispara imediatamente sem esperar o poll.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardOperacionalApi } from '../api/client';

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

export function useDashboardOperacional(period = { period: 'hoje' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const silentInFlightRef = useRef(false);
  const periodRef = useRef(period);

  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  const params = {
    period: period?.period,
    from: period?.from,
    to: period?.to,
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await dashboardOperacionalApi.get(params);
      setData(payload);
      return payload;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period?.period, period?.from, period?.to]);

  const refreshSilent = useCallback(async () => {
    if (silentInFlightRef.current) return null;
    silentInFlightRef.current = true;
    try {
      const current = periodRef.current || {};
      const payload = await dashboardOperacionalApi.get({
        period: current.period,
        from: current.from,
        to: current.to,
      });
      setData(payload);
      return payload;
    } catch {
      return null;
    } finally {
      silentInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      if (cancelled || document.hidden) return;
      await refreshSilent();
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
      if (!document.hidden) void refreshSilent();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshSilent]);

  return { data, loading, error, refresh };
}
