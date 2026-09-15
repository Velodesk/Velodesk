/** mailPrioritySubjectRules.routes v1.0.0 — CRUD desk_config.mail_priority_subject */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { supervisorMiddleware } from '../middleware/supervisor';
import { isDeskConfigConnected } from '../config/database';
import {
  createMailPrioritySubjectRule,
  deleteMailPrioritySubjectRule,
  listMailPrioritySubjectRules,
  patchMailPrioritySubjectRule,
} from '../services/mailPrioritySubjectRules.service';

const router = Router();

function actorName(req: Request): string {
  return req.user?.name || req.user?.email || 'sistema';
}

function deskConfigUnavailable(res: Response) {
  return res.status(503).json({ message: 'Configuração de e-mail indisponível' });
}

router.get('/', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const items = await listMailPrioritySubjectRules();
    return res.json({ items });
  } catch (err) {
    console.error('[mail-priority-subjects] GET /', err);
    return deskConfigUnavailable(res);
  }
});

router.post('/', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const item = await createMailPrioritySubjectRule(
      {
        area: req.body?.area,
        matchType: req.body?.matchType,
        value: req.body?.value,
        note: req.body?.note,
        orgao: req.body?.orgao,
      },
      actorName(req),
    );
    return res.status(201).json(item);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg.includes('já cadastrada') ? 409 : 400;
    return res.status(status).json({ message: msg });
  }
});

router.patch('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const item = await patchMailPrioritySubjectRule(
      String(req.params.id),
      {
        active: typeof req.body?.active === 'boolean' ? req.body.active : undefined,
        note: req.body?.note,
      },
      actorName(req),
    );
    if (!item) return res.status(404).json({ message: 'Regra não encontrada' });
    return res.json(item);
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.delete('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const ok = await deleteMailPrioritySubjectRule(String(req.params.id));
    if (!ok) return res.status(404).json({ message: 'Regra não encontrada' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[mail-priority-subjects] DELETE /:id', err);
    return deskConfigUnavailable(res);
  }
});

export default router;
