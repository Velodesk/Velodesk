/** dashboardOperacional.routes v1.0.0 — GET /api/dashboard/operacional (payload agregado do supervisor Desk). */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import { env } from '../config/env';
import { getDashboardOperacional, getDashboardTrend } from '../services/dashboardOperacional.service';

const router = Router();

/** Mesma regra do workspace360.routes/gestaoInsights.routes: em dev qualquer autenticado passa. */
function requireSupervisorInProduction(req: Request, res: Response, next: NextFunction) {
  const role = String(req.user?.role ?? '').trim().toLowerCase();
  if (role !== 'supervisor' && env.nodeEnv === 'production') {
    return res.status(403).json({ message: 'Acesso restrito a supervisores' });
  }
  next();
}

router.use(authMiddleware, requireSupervisorInProduction);

router.get('/operacional/trend', async (req: Request, res: Response) => {
  if (!isMongoConnected()) {
    return res.status(503).json({ message: 'Banco de chamados indisponível' });
  }
  try {
    const query = {
      period: typeof req.query.period === 'string' ? req.query.period : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    };
    const payload = await getDashboardTrend(query);
    return res.json(payload);
  } catch (err) {
    console.error('[dashboard-operacional] GET /operacional/trend falhou:', err);
    return res.status(500).json({ message: 'Erro ao carregar tendência do dashboard' });
  }
});

router.get('/operacional', async (req: Request, res: Response) => {
  if (!isMongoConnected()) {
    return res.status(503).json({ message: 'Banco de chamados indisponível' });
  }
  try {
    if (!req.user) return res.status(401).json({ message: 'Usuário não autenticado' });
    const query = {
      period: typeof req.query.period === 'string' ? req.query.period : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
    };
    const payload = await getDashboardOperacional(req.user, query);
    return res.json(payload);
  } catch (err) {
    console.error('[dashboard-operacional] GET /operacional falhou:', err);
    return res.status(500).json({ message: 'Erro ao carregar dashboard operacional' });
  }
});

export default router;
