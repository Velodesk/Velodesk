/**
 * agents.routes v1.2.2 — revisar-sugestao retorna 503 quando agentes incompletos
 * VERSION: v1.2.2 | DATE: 2026-08-07
 */
import { Router, Request, Response } from 'express';
import { authMiddleware, authFromHeaderOrBody } from '../middleware/auth';
import { supervisorMiddleware } from '../middleware/supervisor';
import { env } from '../config/env';
import { resolveOperadorDisplayNameForAuthEmail } from '../services/colaboradoresCadastro.service';
import { getAgentsStatus, isAgentsConfigured } from '../services/agents/openaiAgent.util';
import { runAgentPipeline, runRevisarSugestao } from '../services/agents/agentOrchestrator.service';
import { validateAuditoria } from '../services/agents/auditoriaAgent.service';
import {
  createAutonomyRule,
  deleteAutonomyRule,
  listAutonomyRules,
  updateAutonomyRule,
} from '../services/agents/autonomyRules.service';
import {
  executeGestaoHandoff,
  listGestaoAlerts,
  markGestaoAlertRead,
} from '../services/agents/gestaoChamadosHandoff.service';
import { runGestaoChamadosCycle } from '../services/agents/gestaoChamadosAgent.service';
import {
  getLatestGestaoSnapshot,
  listGestaoSnapshots,
} from '../services/agents/gestaoSnapshot.service';
import {
  exportAgentFeedbackCsv,
  listAgentFeedback,
} from '../services/agents/agentFeedback.service';
import { validateTicketAiInput } from '../services/openaiTicketSuggest.service';
import type { RevisaoOrigem, TicketAiTabulationResult } from '../services/agents/agentTypes';
import {
  touchAgentSession,
  closeAgentSession,
  listOnlineAgentsForBoard,
  requestForceLogoff,
  requestForceLogoffAll,
} from '../services/agentSession.service';
import { isTicketPresenceConfigured, mintTicketPresenceToken } from '../services/presence/ticketPresenceToken.service';
import { rebalanceAgentToCap, provisionalResponsavelFromAuth } from '../services/assignmentRouter.service';
import { requireGestaoOrPermission } from '../middleware/permission';
import {
  listParticipantesRoleta,
  setParticipanteRoleta,
  removeParticipanteRoleta,
} from '../services/roletaParticipantes.service';

const router = Router();

router.post('/presence/heartbeat', authFromHeaderOrBody, async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Não autenticado' });

  try {
    const result = await touchAgentSession(req.user.userId, req.user.email);

    if (result.wasOffline && !result.forceLogoff && env.assignmentRouterEnabled) {
      const key = provisionalResponsavelFromAuth(req.user);
      if (key) {
        void rebalanceAgentToCap(key).catch((err) => {
          console.warn('[agents/presence/heartbeat] rebalance falhou', err);
        });
      }
    }

    return res.json({ success: true, ...result, source: 'agents_presence_heartbeat' });
  } catch (err) {
    console.error('[agents/presence/heartbeat] falhou', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/presence/offline', authFromHeaderOrBody, async (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Não autenticado' });
  try {
    await closeAgentSession(req.user.userId, req.user.email);
    return res.json({ success: true, online: false, source: 'agents_presence_offline' });
  } catch (err) {
    console.error('[agents/presence/offline] falhou', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

/** Quadro de "usuários online" do painel de gestão — mesma permissão do 360 de equipe. */
router.get(
  '/sessions/online',
  authMiddleware,
  requireGestaoOrPermission('workspace', 'painel_360_equipe'),
  async (_req: Request, res: Response) => {
    const agents = await listOnlineAgentsForBoard();
    return res.json({ success: true, agents });
  },
);

/** Força logoff de um colaborador específico — efeito no próximo heartbeat dele (até 60s). */
router.post(
  '/sessions/:userId/force-logoff',
  authMiddleware,
  requireGestaoOrPermission('workspace', 'painel_360_equipe'),
  async (req: Request, res: Response) => {
    const ok = await requestForceLogoff(req.params.userId, req.user!.email);
    return res.json({ success: ok });
  },
);

/** Força logoff de todo mundo que está online agora. */
router.post(
  '/sessions/force-logoff-all',
  authMiddleware,
  requireGestaoOrPermission('workspace', 'painel_360_equipe'),
  async (req: Request, res: Response) => {
    const count = await requestForceLogoffAll(req.user!.email);
    return res.json({ success: true, count });
  },
);

/**
 * Gestão manual de quem participa da roleta — ainda sem tela no front (ver
 * roletaParticipantes.service.ts). Só Gestão ou quem tiver config.roleta_editar.
 */
router.get(
  '/roleta/participantes',
  authMiddleware,
  requireGestaoOrPermission('config', 'visualizar'),
  async (_req: Request, res: Response) => {
    const lista = await listParticipantesRoleta();
    return res.json({ success: true, participantes: lista });
  },
);

router.put(
  '/roleta/participantes/:email',
  authMiddleware,
  requireGestaoOrPermission('config', 'roleta_editar'),
  async (req: Request, res: Response) => {
    const { email } = req.params;
    const { ativo, motivo } = req.body ?? {};
    if (typeof ativo !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Campo "ativo" (boolean) é obrigatório.' });
    }
    await setParticipanteRoleta(email, ativo, {
      motivo: typeof motivo === 'string' ? motivo : '',
      atualizadoPor: req.user?.email ?? '',
    });
    return res.json({ success: true });
  },
);

router.delete(
  '/roleta/participantes/:email',
  authMiddleware,
  requireGestaoOrPermission('config', 'roleta_editar'),
  async (req: Request, res: Response) => {
    const removido = await removeParticipanteRoleta(req.params.email);
    return res.json({ success: true, removido });
  },
);

router.get('/presence/realtime-token', authMiddleware, (req: Request, res: Response) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Não autenticado' });

  if (!isTicketPresenceConfigured()) {
    return res.status(503).json({ success: false, error: 'Presence de ticket não configurado no servidor.' });
  }

  try {
    const result = mintTicketPresenceToken(req.user);
    return res.json({ success: true, ...result, source: 'agents_presence_realtime_token' });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/status', authMiddleware, (_req: Request, res: Response) => {
  const status = getAgentsStatus();
  return res.json({
    success: true,
    ...status,
    model: env.openaiModel,
    thresholds: {
      auto: env.agentAuditThresholdAuto,
      desk: env.agentAuditThresholdDesk,
      maxRevisions: env.agentRevisionMaxAttempts,
    },
    source: 'agents_status',
  });
});

router.post('/pipeline', authMiddleware, async (req: Request, res: Response) => {
  const parsed = validateTicketAiInput(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ success: false, error: parsed.error });
  }
  if (!isAgentsConfigured()) {
    const status = getAgentsStatus();
    return res.status(503).json({
      success: false,
      error: 'Agentes não configurados no servidor.',
      missing: status.missing,
    });
  }

  const pipelineModo = req.body?.pipelineModo === 'auto_envio' ? 'auto_envio' : 'desk';
  const nomeOperador = await resolveOperadorDisplayNameForAuthEmail(req.user?.email || '');
  const result = await runAgentPipeline({
    ...parsed.data,
    nomeOperador: nomeOperador || undefined,
    pipelineModo,
    userId: req.user?.userId,
  });

  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }

  return res.json({
    ...result,
    success: true,
    aiProvider: 'OpenAI',
    source: 'agents_pipeline',
  });
});

router.post('/revisar-sugestao', authMiddleware, async (req: Request, res: Response) => {
  const parsed = validateTicketAiInput(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ success: false, error: parsed.error });
  }

  const body = req.body as Record<string, unknown>;
  const respostaAtual = String(body.respostaAtual || '').trim();
  const tabulacaoAtual = body.tabulacaoAtual as TicketAiTabulationResult | undefined;
  const origemRevisao = body.origemRevisao === 'solicitada_operador'
    ? 'solicitada_operador' as RevisaoOrigem
    : 'automatica_baixo_compliance' as RevisaoOrigem;

  if (!respostaAtual || !tabulacaoAtual) {
    return res.status(400).json({ success: false, error: 'respostaAtual e tabulacaoAtual são obrigatórios' });
  }

  if (!isAgentsConfigured()) {
    const status = getAgentsStatus();
    return res.status(503).json({
      success: false,
      error: 'Agentes não configurados no servidor.',
      missing: status.missing,
    });
  }

  const nomeOperador = await resolveOperadorDisplayNameForAuthEmail(req.user?.email || '');

  const result = await runRevisarSugestao({
    input: {
      ...parsed.data,
      nomeOperador: nomeOperador || undefined,
      userId: req.user?.userId,
    },
    respostaAtual,
    tabulacaoAtual,
    auditScore: typeof body.auditScore === 'number' ? body.auditScore : undefined,
    origemRevisao,
    inputOperador: String(body.inputOperador || '').trim() || undefined,
    violacoes: Array.isArray(body.violacoes) ? body.violacoes.map(String) : undefined,
    recomendacoes: Array.isArray(body.recomendacoes) ? body.recomendacoes.map(String) : undefined,
  });

  if (!result.success) {
    const isConfigError = result.error === 'Agentes não configurados';
    return res.status(isConfigError ? 503 : 500).json({
      success: false,
      error: result.error,
      ...(isConfigError ? { missing: getAgentsStatus().missing } : {}),
    });
  }

  return res.json({ ...result, success: true, source: 'agents_revisar_sugestao' });
});

router.post('/auditoria', authMiddleware, supervisorMiddleware, async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const modo = body.modo === 'pos_humano' ? 'pos_humano' : 'desk_sugestao';

  const result = await validateAuditoria({
    modo,
    protocolo: String(body.protocolo || ''),
    canal: String(body.canal || ''),
    respostaSugerida: String(body.respostaSugerida || body.mensagemOperador || ''),
    tabulacao: (body.tabulacao as TicketAiTabulationResult) || {
      tipo: '', produto: '', motivo: '', detalhe: '',
    },
    mensagemOperador: String(body.mensagemOperador || ''),
    ultimaMensagemCliente: String(body.ultimaMensagemCliente || ''),
    messages: Array.isArray(body.messages) ? body.messages : undefined,
    userId: req.user?.userId,
  });

  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }

  return res.json({ ...result, success: true, source: 'agents_auditoria' });
});

router.get('/autonomy-rules', authMiddleware, supervisorMiddleware, async (_req, res) => {
  const rules = await listAutonomyRules();
  return res.json({ success: true, rules, source: 'agents_autonomy_rules' });
});

router.post('/autonomy-rules', authMiddleware, supervisorMiddleware, async (req, res) => {
  const rule = await createAutonomyRule(req.body);
  return res.status(201).json({ success: true, rule, source: 'agents_autonomy_rules' });
});

router.put('/autonomy-rules/:id', authMiddleware, supervisorMiddleware, async (req, res) => {
  const rule = await updateAutonomyRule(req.params.id, req.body);
  if (!rule) return res.status(404).json({ success: false, error: 'Regra não encontrada' });
  return res.json({ success: true, rule });
});

router.delete('/autonomy-rules/:id', authMiddleware, supervisorMiddleware, async (req, res) => {
  const rule = await deleteAutonomyRule(req.params.id);
  if (!rule) return res.status(404).json({ success: false, error: 'Regra não encontrada' });
  return res.json({ success: true, deleted: true });
});

router.get('/feedback', authMiddleware, supervisorMiddleware, async (req, res) => {
  const limit = parseInt(String(req.query.limit || '50'), 10);
  const skip = parseInt(String(req.query.skip || '0'), 10);
  const items = await listAgentFeedback(limit, skip);
  return res.json({ success: true, items, source: 'agents_feedback' });
});

router.get('/feedback/export', authMiddleware, supervisorMiddleware, async (_req, res) => {
  const csv = await exportAgentFeedbackCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agent_feedback.csv"');
  return res.send(csv);
});

router.get('/gestao/snapshots/latest', authMiddleware, supervisorMiddleware, async (_req, res) => {
  const snapshot = await getLatestGestaoSnapshot();
  if (!snapshot) {
    return res.status(404).json({ success: false, error: 'Nenhum snapshot horário disponível' });
  }
  return res.json({ success: true, snapshot, source: 'agents_gestao_snapshot_latest' });
});

router.get('/gestao/snapshots', authMiddleware, supervisorMiddleware, async (req, res) => {
  const limit = parseInt(String(req.query.limit || '24'), 10);
  const snapshots = await listGestaoSnapshots(limit);
  return res.json({ success: true, snapshots, source: 'agents_gestao_snapshots' });
});

router.get('/gestao/alerts', authMiddleware, supervisorMiddleware, async (req, res) => {
  const limit = parseInt(String(req.query.limit || '50'), 10);
  const onlyUnread = req.query.unread === 'true';
  const alerts = await listGestaoAlerts(limit, onlyUnread);
  return res.json({ success: true, alerts, source: 'agents_gestao_alerts' });
});

router.patch('/gestao/alerts/:id/read', authMiddleware, supervisorMiddleware, async (req, res) => {
  const alert = await markGestaoAlertRead(req.params.id);
  if (!alert) return res.status(404).json({ success: false, error: 'Alerta não encontrado' });
  return res.json({ success: true, alert });
});

router.post('/gestao/handoff', authMiddleware, supervisorMiddleware, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const ticketId = String(body.ticketId || '').trim();
  const protocolo = String(body.protocolo || '').trim();
  if (!ticketId || !protocolo) {
    return res.status(400).json({ success: false, error: 'ticketId e protocolo obrigatórios' });
  }

  const result = await executeGestaoHandoff({
    ticketId,
    protocolo,
    nivelCriticidade: (body.nivelCriticidade as 'critica' | 'alta' | 'media' | 'baixa') || 'alta',
    palavrasCriticas: Array.isArray(body.palavrasCriticas) ? body.palavrasCriticas.map(String) : [],
    categoriaAtendimento: String(body.categoriaAtendimento || ''),
    origem: String(body.origem || 'manual_supervisor'),
    auditScore: typeof body.auditScore === 'number' ? body.auditScore : undefined,
    produto: String(body.produto || ''),
    motivo: String(body.motivo || ''),
  });

  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }

  return res.json({ ...result, success: true, source: 'agents_gestao_handoff' });
});

router.post('/gestao/run', authMiddleware, supervisorMiddleware, async (_req, res) => {
  const result = await runGestaoChamadosCycle();
  if (!result.success) {
    return res.status(500).json({ success: false, error: result.error });
  }
  return res.json({ ...result, success: true, source: 'agents_gestao_run' });
});

export default router;
