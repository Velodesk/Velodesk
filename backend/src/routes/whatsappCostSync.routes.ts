/** whatsappCostSync.routes v1.0.0 — sync sob demanda + status da coleção `whatsapp_message_costs`. */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import { env } from '../config/env';
import {
  getWhatsappCostStatus,
  syncWhatsappCostRange,
} from '../services/twilio/whatsappCostSync.service';

const router = Router();

/** Mesma regra dos demais painéis: em produção só supervisor. Fora, qualquer autenticado. */
function requireSupervisorInProduction(req: Request, res: Response, next: NextFunction) {
  const role = String(req.user?.role ?? '').trim().toLowerCase();
  if (role !== 'supervisor' && env.nodeEnv === 'production') {
    return res.status(403).json({ message: 'Acesso restrito a supervisores' });
  }
  next();
}

router.use(authMiddleware, requireSupervisorInProduction);

router.get('/status', async (_req: Request, res: Response) => {
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  try {
    const result = await getWhatsappCostStatus();
    return res.json(result);
  } catch (err) {
    console.error('[whatsapp-cost] GET /status falhou:', err);
    return res.status(500).json({ message: 'Erro ao carregar status do sync' });
  }
});

router.post('/sync', async (req: Request, res: Response) => {
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  const from = typeof req.body?.from === 'string' ? new Date(req.body.from) : null;
  const to = typeof req.body?.to === 'string' ? new Date(req.body.to) : null;
  if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return res.status(400).json({ message: 'Body precisa de `from` e `to` (ISO 8601)' });
  }
  if (from >= to) {
    return res.status(400).json({ message: '`from` deve ser anterior a `to`' });
  }
  try {
    const result = await syncWhatsappCostRange(from, to);
    return res.json(result);
  } catch (err) {
    console.error('[whatsapp-cost] POST /sync falhou:', err);
    return res.status(500).json({ message: (err as Error).message || 'Erro no sync' });
  }
});

export default router;
