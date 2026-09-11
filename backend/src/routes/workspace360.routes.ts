/** workspace360.routes v1.2.1 — gestão com ver_todos usa visão equipe */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import {
  buildAgent360Payload,
  buildReportPayload,
  buildSupervisor360Payload,
  getAgentInProgressTickets,
  Workspace360Query,
} from '../services/workspace360.service';
import { hasPermission, resolveUserPermissions } from '../services/permission.service';

const router = Router();

function parseQuery(req: { query: Record<string, unknown> }): Workspace360Query {
  return {
    period: typeof req.query.period === 'string' ? req.query.period : undefined,
    channel: typeof req.query.channel === 'string' ? req.query.channel : undefined,
    team: typeof req.query.team === 'string' ? req.query.team : undefined,
    report: typeof req.query.report === 'string' ? req.query.report : undefined,
    leaderboardPeriod: typeof req.query.leaderboardPeriod === 'string' ? req.query.leaderboardPeriod : undefined,
    leaderboardFrom: typeof req.query.leaderboardFrom === 'string' ? req.query.leaderboardFrom : undefined,
    leaderboardTo: typeof req.query.leaderboardTo === 'string' ? req.query.leaderboardTo : undefined,
  };
}

function wantsSupervisorPayload(
  req: { query: Record<string, unknown> },
  resolved: Awaited<ReturnType<typeof resolveUserPermissions>>,
): boolean {
  const profile = String(req.query.profile ?? '').trim().toLowerCase();
  const hasEquipe = hasPermission(resolved.permissoes, 'workspace', 'painel_360_equipe');
  const hasVerTodos = hasPermission(resolved.permissoes, 'tickets', 'ver_todos');
  const canViewTeam = hasEquipe || hasVerTodos;

  if (profile === 'gestao' || profile === 'supervisor') return canViewTeam;
  if (profile === 'agent') return false;
  return canViewTeam;
}

router.get('/', authMiddleware, async (req, res: Response) => {
  if (!isMongoConnected()) {
    return res.status(503).json({ message: 'Banco de chamados indisponível' });
  }

  try {
    const resolved = await resolveUserPermissions(req.user!);
    const hasEquipe = hasPermission(resolved.permissoes, 'workspace', 'painel_360_equipe');
    const query = parseQuery(req);
    const supervisorView = wantsSupervisorPayload(req, resolved);

    if (query.report && supervisorView) {
      const report = await buildReportPayload(req.user!, query);
      if (!report) return res.status(404).json({ message: 'Relatório não encontrado' });
      return res.json({ report });
    }

    if (supervisorView) {
      const payload = await buildSupervisor360Payload(req.user!, query);
      return res.json(payload);
    }

    const payload = await buildAgent360Payload(req.user!);
    return res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[workspace360] GET falhou:', message);
    return res.status(500).json({ message: 'Erro ao carregar Painel 360°' });
  }
});

router.get('/agents', authMiddleware, async (req, res: Response) => {
  if (!isMongoConnected()) {
    return res.status(503).json({ message: 'Banco indisponível' });
  }
  try {
    const resolved = await resolveUserPermissions(req.user!);
    if (!hasPermission(resolved.permissoes, 'workspace', 'painel_360_equipe')) {
      return res.status(403).json({ message: 'Sem permissão para listar agentes' });
    }
    const { listAgentesDeskLive } = await import('../services/agenteDesk.service');
    const { resolveRoleFromAtuacao } = await import('../services/deskCadastroAccess.service');
    const agentes = await listAgentesDeskLive();
    res.json(
      agentes
        .filter((a) => !a.afastado)
        .map((a) => ({ ...a, role: resolveRoleFromAtuacao(a.atuacao).role }))
        .map((a) => ({
          id: a.email,
          name: a.colaboradorNome,
          email: a.email,
          role: a.role,
        }))
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[workspace360] GET /agents falhou:', message);
    res.status(500).json({ message: 'Erro ao listar agentes' });
  }
});

router.get('/agent-tickets', authMiddleware, async (req, res: Response) => {
  if (!isMongoConnected()) {
    return res.status(503).json({ message: 'Banco de chamados indisponível' });
  }
  try {
    const resolved = await resolveUserPermissions(req.user!);
    const canViewTeam =
      hasPermission(resolved.permissoes, 'workspace', 'painel_360_equipe') ||
      hasPermission(resolved.permissoes, 'tickets', 'ver_todos');
    if (!canViewTeam) {
      return res.status(403).json({ message: 'Sem permissão para ver tickets da equipe' });
    }
    const agentKey = typeof req.query.agentKey === 'string' ? req.query.agentKey : '';
    if (!agentKey.trim()) {
      return res.status(400).json({ message: 'Parâmetro agentKey é obrigatório' });
    }
    const tickets = await getAgentInProgressTickets(agentKey);
    return res.json({ agentKey, tickets });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[workspace360] GET /agent-tickets falhou:', message);
    return res.status(500).json({ message: 'Erro ao carregar tickets do colaborador' });
  }
});

export default router;
