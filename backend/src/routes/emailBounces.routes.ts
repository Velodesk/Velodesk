/** emailBounces.routes v1.0.0 — badge de alerta de bounces/DSN descartados (sem ticket) */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isDeskConfigConnected } from '../config/database';
import {
  countUnviewedBounces,
  listRecentBounces,
  markBouncesViewed,
} from '../services/emailBounceLog.service';

const router = Router();

function deskConfigUnavailable(res: Response) {
  return res.status(503).json({ message: 'Configuração de e-mail indisponível' });
}

router.get('/', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const [items, unviewed] = await Promise.all([
      listRecentBounces(),
      countUnviewedBounces(),
    ]);
    return res.json({ items, unviewed });
  } catch (err) {
    console.error('[emailBounces] GET /', err);
    return deskConfigUnavailable(res);
  }
});

router.post('/mark-viewed', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const modified = await markBouncesViewed();
    return res.json({ modified });
  } catch (err) {
    console.error('[emailBounces] POST /mark-viewed', err);
    return deskConfigUnavailable(res);
  }
});

export default router;
