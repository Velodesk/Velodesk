/** whatsappCostSync.routes v1.1.0 — sync sob demanda + status + endpoint pro Cloud Scheduler. */
import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import { env } from '../config/env';
import {
  getWhatsappCostStatus,
  purgeForeignWhatsappCostDocs,
  syncWhatsappCostBackfill,
  syncWhatsappCostDaily,
  syncWhatsappCostRange,
} from '../services/twilio/whatsappCostSync.service';

const router = Router();

/**
 * Endpoint pro Cloud Scheduler — ANTES do authMiddleware porque não tem JWT de usuário,
 * autentica via Bearer secret próprio. Fail-closed: se o secret não estiver configurado,
 * nega tudo (503) pra não deixar o endpoint aberto por engano.
 *
 * Body `{days: N}` roda backfill de N dias (1..90). Sem body, roda sync diário.
 */
router.post('/sync/scheduled', async (req: Request, res: Response) => {
  const secret = env.whatsappCostSyncSchedulerSecret;
  if (!secret) {
    return res.status(503).json({ message: 'Scheduler secret não configurado' });
  }
  const header = String(req.headers.authorization ?? '').trim();
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== secret) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  try {
    const rawDays = req.body?.days;
    if (rawDays !== undefined && rawDays !== null) {
      const n = Number(rawDays);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ message: '`days` precisa ser número' });
      }
      const clamped = Math.max(1, Math.min(90, Math.trunc(n)));
      const result = await syncWhatsappCostBackfill(clamped);
      return res.json({ mode: 'backfill', days: clamped, ...result });
    }
    const result = await syncWhatsappCostDaily();
    return res.json({ mode: 'daily', ...result });
  } catch (err) {
    console.error('[whatsapp-cost] POST /sync/scheduled falhou:', err);
    return res.status(500).json({ message: (err as Error).message || 'Erro no sync' });
  }
});

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

/**
 * Limpa os registros que não pertencem ao(s) número(s) do Desk — lixo ingerido pela v1.0.0
 * do sync, que varria a conta Twilio compartilhada. Default é dry-run: só conta.
 * Passe `{ "confirm": true }` no body pra apagar de verdade.
 */
router.post('/purge-foreign', async (req: Request, res: Response) => {
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  const confirm = req.body?.confirm === true;
  try {
    const result = await purgeForeignWhatsappCostDocs(!confirm);
    return res.json({
      ...result,
      aviso: confirm
        ? undefined
        : 'Dry-run: nada foi apagado. Reenvie com {"confirm": true} pra executar.',
    });
  } catch (err) {
    console.error('[whatsapp-cost] POST /purge-foreign falhou:', err);
    return res.status(500).json({ message: (err as Error).message || 'Erro na limpeza' });
  }
});

export default router;
