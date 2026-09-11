/**
 * useDashboardTrend v1.0.0 — bloco de tendência (série 7d + top motivos) com filtro próprio.
 *
 * Filtro independente do painel principal — default 7 dias (`period: '7d'`). Não faz polling
 * (o dashboard principal em si já tem seu próprio hook com polling 10min; a tendência recarrega
 * sob demanda quando o período muda ou o usuário clica em atualizar).
 */
import { useCallback, useEffect, useState } from 'react';
import { dashboardOperacionalApi } from '../api/client';

export function useDashboardTrend(period = { period: '7d' }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await dashboardOperacionalApi.trend({
        period: period?.period,
        from: period?.from,
        to: period?.to,
      });
      setData(payload);
      return payload;
    } catch (err) {
      setError(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [period?.period, period?.from, period?.to]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
