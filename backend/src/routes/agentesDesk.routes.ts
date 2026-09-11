/** agentesDesk.routes v2.0.0 — leitura 100% ao vivo do VeloHub (espelho local removido) */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { requireGestaoOrPermission } from '../middleware/permission';
import { listAgentesDeskLive } from '../services/agenteDesk.service';

const router = Router();

router.get(
  '/',
  authMiddleware,
  requireGestaoOrPermission('config', 'visualizar'),
  async (req, res: Response) => {
    try {
      const agentes = await listAgentesDeskLive();
      res.json(agentes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/indisponível|unavailable|console_funcionarios/i.test(message)) {
        return res.status(503).json({ message: 'VeloHub indisponível — lista de agentes não pode ser carregada.' });
      }
      res.status(500).json({ message });
    }
  },
);

export default router;
