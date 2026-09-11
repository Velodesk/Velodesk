/** workflows.routes v1.0.0 */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { supervisorMiddleware } from '../middleware/supervisor';
import { isDeskConfigConnected } from '../config/database';
import {
  createWorkflow,
  deleteWorkflow,
  getActiveWorkflows,
  getWorkflowById,
  listWorkflows,
  patchWorkflow,
  replaceWorkflow,
} from '../services/workflowDefinicao.service';

const router = Router();

function actorName(req: Request): string {
  return req.user?.name || req.user?.email || 'sistema';
}

function deskConfigUnavailable(res: Response) {
  return res.status(503).json({ message: 'Configuração de workflows indisponível' });
}

router.get('/', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const workflows = await getActiveWorkflows();
    res.json({ workflows, grupos: [] });
  } catch (err) {
    console.error('[workflows] GET /:', err);
    return deskConfigUnavailable(res);
  }
});

router.get('/all', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const includeInactive = req.query.includeInactive === 'true';
    const workflows = await listWorkflows(includeInactive);
    res.json(workflows);
  } catch (err) {
    console.error('[workflows] GET /all:', err);
    return deskConfigUnavailable(res);
  }
});

router.all('/grupos-responsabilidade*', authMiddleware, (_req, res: Response) => {
  res.status(410).json({ message: 'Grupos de atuação descontinuados. Use atribuição por função.' });
});

router.get('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const workflow = await getWorkflowById(String(req.params.id));
    if (!workflow) return res.status(404).json({ message: 'Workflow não encontrado' });
    res.json(workflow);
  } catch (err) {
    console.error('[workflows] GET /:id:', err);
    return deskConfigUnavailable(res);
  }
});

router.post('/', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const workflow = await createWorkflow(req.body, actorName(req));
    res.status(201).json(workflow);
  } catch (err) {
    const msg = (err as Error).message;
    res.status(msg.includes('já cadastrado') ? 409 : 400).json({ message: msg });
  }
});

router.put('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const workflow = await replaceWorkflow(String(req.params.id), req.body, actorName(req));
    if (!workflow) return res.status(404).json({ message: 'Workflow não encontrado' });
    res.json(workflow);
  } catch (err) {
    const msg = (err as Error).message;
    res.status(msg.includes('já cadastrado') ? 409 : 400).json({ message: msg });
  }
});

router.patch('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const workflow = await patchWorkflow(String(req.params.id), req.body, actorName(req));
    if (!workflow) return res.status(404).json({ message: 'Workflow não encontrado' });
    res.json(workflow);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

router.delete('/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const ok = await deleteWorkflow(String(req.params.id));
    if (!ok) return res.status(404).json({ message: 'Workflow não encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

export default router;
