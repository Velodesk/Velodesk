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
import {
  getWhatsappCostDailyStatus,
  rollupWhatsappCostDaily,
  rollupWhatsappCostRange,
} from '../services/twilio/whatsappCostDaily.service';

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
      // Depois do sync do cru, roda rollup diário cobrindo a mesma janela —
      // repricing tardio da Twilio e crons perdidos entram no mesmo passe.
      const rollup = await rollupWhatsappCostDaily(Math.max(15, clamped));
      return res.json({ mode: 'backfill', days: clamped, sync: result, rollup });
    }
    const result = await syncWhatsappCostDaily();
    // Default: janela de 15 dias cobre o repricing tardio sem gastar à toa.
    const rollup = await rollupWhatsappCostDaily();
    return res.json({ mode: 'daily', sync: result, rollup });
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

/**
 * Relatório diário — 1 doc por dia BRT, pronto pro frontend consumir sem reagregar.
 * `?limit=N` opcional (1..365, default 30).
 */
router.get('/daily', async (req: Request, res: Response) => {
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  try {
    const rawLimit = req.query?.limit;
    const limit = rawLimit !== undefined ? Number(rawLimit) : 30;
    const result = await getWhatsappCostDailyStatus(Number.isFinite(limit) ? limit : 30);
    return res.json(result);
  } catch (err) {
    console.error('[whatsapp-cost] GET /daily falhou:', err);
    return res.status(500).json({ message: 'Erro ao carregar relatório diário' });
  }
});

/**
 * Reagregação manual de um período histórico — fora da janela de 15 dias do cron.
 * Útil quando o financeiro pede pra bater com fatura de meses passados.
 * Body: `{ fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD" }` (BRT).
 */
router.post('/rollup', async (req: Request, res: Response) => {
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  const fromDate = String(req.body?.fromDate ?? '').trim();
  const toDate = String(req.body?.toDate ?? '').trim();
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(fromDate) || !dateRe.test(toDate)) {
    return res.status(400).json({ message: 'Body precisa de `fromDate` e `toDate` no formato YYYY-MM-DD' });
  }
  if (fromDate > toDate) {
    return res.status(400).json({ message: '`fromDate` deve ser anterior ou igual a `toDate`' });
  }
  try {
    const result = await rollupWhatsappCostRange(fromDate, toDate);
    return res.json(result);
  } catch (err) {
    console.error('[whatsapp-cost] POST /rollup falhou:', err);
    return res.status(500).json({ message: (err as Error).message || 'Erro no rollup' });
  }
});

export default router;
