/**
 * aiApprovals.routes v1.0.0 — fila de aprovação humana das respostas do agente autônomo
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Contrato documentado em docs/AI-APPROVALS-API.md. Acesso: módulo `permissoes.acesso.ia`.
 */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { permissionMiddleware } from '../middleware/permission';
import {
  AiAutomationError,
  approve,
  getApproval,
  listApprovals,
  reject,
} from '../services/agents/aiAutomation.service';
import { TabulacaoValidationError } from '../services/tabulation.service';
import type { AiAutomationStatus } from '../models/ChamadoN1';

const router = Router();
router.use(authMiddleware, permissionMiddleware('acesso', 'ia'));

const STATUSES: AiAutomationStatus[] = [
  'aguardando_aprovacao',
  'em_revisao',
  'aprovada',
  'enviada_direto',
  'encerrada_humano',
  'cancelada',
];

function fail(res: Response, err: unknown) {
  if (err instanceof AiAutomationError) {
    return res.status(err.status).json({ success: false, error: err.message });
  }
  if (err instanceof TabulacaoValidationError) {
    return res.status(422).json({ success: false, error: err.message });
  }
  console.error('[ai-approvals]', (err as Error)?.message);
  return res.status(500).json({ success: false, error: 'Erro interno' });
}

function actor(req: Request): string {
  return req.user?.email || req.user?.userId || 'desconhecido';
}

router.get('/', async (req, res) => {
  try {
    const status = String(req.query.status || 'aguardando_aprovacao') as AiAutomationStatus;
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'status inválido' });
    }
    const data = await listApprovals({
      status,
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 30,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    return fail(res, err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    return res.json({ success: true, item: await getApproval(req.params.id) });
  } catch (err) {
    return fail(res, err);
  }
});

router.post('/:id/aprovar', async (req, res) => {
  try {
    const textoFinal = typeof req.body?.textoFinal === 'string' ? req.body.textoFinal : undefined;
    return res.json({
      success: true,
      ...(await approve(req.params.id, req.user!, textoFinal, req.body?.tabulacao)),
    });
  } catch (err) {
    return fail(res, err);
  }
});

router.post('/:id/reprovar', async (req, res) => {
  try {
    const feedback = typeof req.body?.feedback === 'string' ? req.body.feedback : undefined;
    return res.json({ success: true, ...(await reject(req.params.id, actor(req), feedback)) });
  } catch (err) {
    return fail(res, err);
  }
});

export default router;
