/** whatsappTemplate.routes v1.0.0 — CRUD de modelos de mensagem do WhatsApp */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { supervisorMiddleware } from '../middleware/supervisor';
import { isDeskConfigConnected } from '../config/database';
import { isValidWhatsappTemplateId } from '../models/WhatsappTemplate';
import {
  createWhatsappTemplate,
  deleteWhatsappTemplate,
  getWhatsappTemplateById,
  listWhatsappTemplates,
  updateWhatsappTemplate,
} from '../services/whatsappTemplate.service';

const router = Router();

function actorName(req: Request): string {
  return req.user?.name || req.user?.email || 'sistema';
}

function deskConfigUnavailable(res: Response) {
  return res.status(503).json({ message: 'Configuração de mensagens indisponível' });
}

router.get('/', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const items = await listWhatsappTemplates();
    return res.json({ items });
  } catch (err) {
    console.error('[whatsappTemplate] GET /', err);
    return deskConfigUnavailable(res);
  }
});

router.post('/', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const item = await createWhatsappTemplate(req.body || {}, actorName(req));
    return res.status(201).json(item);
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.get('/:id', authMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const id = String(req.params.id);
    if (!isValidWhatsappTemplateId(id)) return res.status(400).json({ message: 'ID inválido' });
    const item = await getWhatsappTemplateById(id);
    if (!item) return res.status(404).json({ message: 'Modelo não encontrado' });
    return res.json(item);
  } catch (err) {
    console.error('[whatsappTemplate] GET /:id', err);
    return deskConfigUnavailable(res);
  }
});

router.put('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const id = String(req.params.id);
    if (!isValidWhatsappTemplateId(id)) return res.status(400).json({ message: 'ID inválido' });
    const item = await updateWhatsappTemplate(id, req.body || {}, actorName(req));
    if (!item) return res.status(404).json({ message: 'Modelo não encontrado' });
    return res.json(item);
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.delete('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const id = String(req.params.id);
    if (!isValidWhatsappTemplateId(id)) return res.status(400).json({ message: 'ID inválido' });
    const ok = await deleteWhatsappTemplate(id);
    if (!ok) return res.status(404).json({ message: 'Modelo não encontrado' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[whatsappTemplate] DELETE /:id', err);
    return deskConfigUnavailable(res);
  }
});

export default router;
