/** boxes.routes v1.9.0 — lista de boxes via cache TTL curto (getCachedBoxes) */
import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import { getCachedBoxes } from '../services/boxesCache.service';
import { ChamadoN1 } from '../models/ChamadoN1';
import { User } from '../models/User';
import {
  buildBoxCountFilter,
  buildBoxListFindOptions,
  buildChamadoMapContext,
  buildResponsavelCandidates,
  chamadoToTicketListItem,
  MEUS_CHAMADOS_COLUMNS,
  meusChamadosAgentScopeFilter,
  statusFromBoxName,
  workflowActorQueueFilter,
} from '../services/chamado.mapper';
import {
  hasPermission,
  resolveUserPermissions,
  shouldUseAtribuidoFuncaoQueue,
  shouldUseMeusChamadosFilter,
} from '../services/permission.service';
import { resolveWorkflowDefinitionIdsForFuncoes } from '../services/workflowDefinicao.service';
import { listAgentQueueBoxes } from '../services/agentQueueBox.service';
import { buildCustomBoxCountFilter } from '../services/customBoxCount.service';

const router = Router();

async function resolveDbUser(userId?: string) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;
  return User.findById(userId).select('name email');
}

const CE_QUEUE_PARAMS = new Set(['procon', 'consumidor-gov', 'bacen', 'reclame-aqui']);

async function resolveQueueMode(
  resolved: Awaited<ReturnType<typeof resolveUserPermissions>>,
  queueParam?: string,
) {
  if (queueParam && CE_QUEUE_PARAMS.has(queueParam)) {
    return { queue: queueParam, extraFilter: undefined as Record<string, unknown> | undefined };
  }
  if (hasPermission(resolved.permissoes, 'tickets', 'ver_todos')) {
    return { queue: queueParam, extraFilter: undefined as Record<string, unknown> | undefined };
  }
  if (shouldUseAtribuidoFuncaoQueue(resolved)) {
    const slugs = [
      ...new Set(
        [resolved.funcaoSlug, ...(resolved.funcoes || [])]
          .map((s) => String(s || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    const workflowIds = await resolveWorkflowDefinitionIdsForFuncoes(slugs);
    return {
      queue: 'funcao-atribuido',
      extraFilter: workflowActorQueueFilter(slugs, workflowIds),
    };
  }
  if (shouldUseMeusChamadosFilter(resolved)) {
    return { queue: 'meus-chamados', extraFilter: undefined };
  }
  return { queue: queueParam, extraFilter: undefined };
}

/** Fila "Resolvidos" = resolvido + fechado. Cancelado nunca conta nem aparece nela. */
const RESOLVED_COLUMN_STATUSES = new Set(['resolvido', 'fechado']);

function deskQueueIdFromColumn(column: { id: string; status: string }): string | null {
  const id = String(column.id || '').trim();
  if (id === 'meus-novos') return 'novos';
  if (id === 'meus-em-aberto' || id === 'meus-em-andamento') return 'em-andamento';
  if (id === 'meus-pendente') return 'pendente';
  if (id === 'meus-resolvidos') return 'resolvidos';

  const status = String(column.status || '').trim().toLowerCase();
  if (status === 'novo') return 'novos';
  if (status === 'em-aberto' || status === 'em-andamento') return 'em-andamento';
  if (status === 'pendente' || status === 'em-espera') return 'pendente';
  if (RESOLVED_COLUMN_STATUSES.has(status)) return 'resolvidos';
  if (status === 'cancelado') return null;
  return 'em-andamento';
}

async function loadQueueCounts(
  columns: Array<{ id: string; name: string; order: number; status: string }>,
  queue: string | undefined,
  responsavelCandidates: string[],
  extraFilter?: Record<string, unknown>,
) {
  const counts: Record<string, number> = {
    novos: 0,
    'em-andamento': 0,
    pendente: 0,
    resolvidos: 0,
  };

  await Promise.all(
    columns.map(async (column) => {
      // Contagem do badge nunca usa buildBoxListFindOptions — aquela função injeta uma
      // janela de 30 dias pra status terminal (resolvido/cancelado/fechado) só pra
      // manter a LISTA paginada rápida; usada aqui, capava o total exibido em ~150.
      const filter = buildBoxCountFilter(
        column.status,
        queue,
        responsavelCandidates,
        extraFilter,
      );
      const deskQueueId = deskQueueIdFromColumn(column);
      if (!deskQueueId) return;
      const total = await ChamadoN1.countDocuments(filter);
      counts[deskQueueId] = (counts[deskQueueId] || 0) + total;
    }),
  );

  return counts;
}

async function loadBoxesWithListTickets(
  columns: Array<{ id: string; name: string; order: number; status: string }>,
  queue: string | undefined,
  responsavelCandidates: string[],
  extraFilter?: Record<string, unknown>,
) {
  const loaded = await Promise.all(
    columns.map(async (column) => {
      const { filter, limit, sort } = buildBoxListFindOptions(
        column.status,
        queue,
        responsavelCandidates,
        extraFilter,
      );
      const chamados = await ChamadoN1.find(filter).sort(sort).limit(limit);
      return { column, chamados };
    }),
  );

  const allChamados = loaded.flatMap((entry) => entry.chamados);
  const ctx = await buildChamadoMapContext(allChamados, 'list');

  return loaded.map(({ column, chamados }) => ({
    id: column.id,
    name: column.name,
    order: column.order,
    tickets: chamados.map((chamado) => chamadoToTicketListItem(chamado, column.id, ctx)),
  }));
}

/** Status ativos considerados em "Meus Tickets" — nunca inclui resolvido/fechado/cancelado. */
const MEUS_TICKETS_ATIVOS_STATUSES = ['novo', 'em-aberto', 'em-andamento', 'pendente', 'em-espera'];

/**
 * Contagem real (countDocuments, sem limite) de "Meus Tickets" — SOMENTE responsável OU
 * atribuído = usuário logado, em status ativo. Regra estrita: NÃO usar
 * buildBoxCountFilter(status, 'meus-chamados', ...) aqui — aquela variante inclui de propósito
 * 'novo' sem responsável (fila compartilhada de não reivindicados, pro board de Meus Chamados),
 * o que infla essa contagem com ticket que ainda não é de ninguém. "Meus Tickets" é sempre
 * escopo estrito (mesma regra que o frontend já impõe em filterMyTicketsEntries).
 */
async function countMeusTicketsReal(responsavelCandidates: string[]): Promise<number> {
  if (!responsavelCandidates.length) return 0;
  const scopeFilter = meusChamadosAgentScopeFilter(responsavelCandidates);
  const perStatus = await Promise.all(
    MEUS_TICKETS_ATIVOS_STATUSES.map((status) => {
      const baseFilter = buildBoxCountFilter(status, undefined, responsavelCandidates);
      return ChamadoN1.countDocuments({ $and: [baseFilter, scopeFilter] });
    }),
  );
  return perStatus.reduce((sum, n) => sum + n, 0);
}

router.get('/queue-counts', authMiddleware, async (req, res: Response) => {
  const queueParam = typeof req.query.fila === 'string' ? req.query.fila : undefined;
  const userId = req.user?.userId;

  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ message: 'Banco de chamados indisponível' });
    }
    const dbUser = await resolveDbUser(userId);
    const resolved = await resolveUserPermissions(req.user!);
    const responsavelCandidates = buildResponsavelCandidates(req.user!, dbUser);
    const { queue, extraFilter } = await resolveQueueMode(resolved, queueParam);

    let counts: Record<string, number>;
    if (queue === 'meus-chamados') {
      counts = await loadQueueCounts(
        MEUS_CHAMADOS_COLUMNS.map((column) => ({
          id: column.id,
          name: column.name,
          order: column.order,
          status: column.status,
        })),
        queue,
        responsavelCandidates,
      );
    } else {
      const boxes = await getCachedBoxes();
      const columns = boxes.map((box) => ({
        id: String(box._id),
        name: box.name,
        order: box.order,
        status: statusFromBoxName(box.name),
      }));
      counts = await loadQueueCounts(columns, queue, responsavelCandidates, extraFilter);
    }

    counts['meus-tickets'] = await countMeusTicketsReal(responsavelCandidates);

    const customBoxUnsupported: Record<string, string[]> = {};
    const email = req.user?.email || '';
    if (email) {
      const customBoxes = await listAgentQueueBoxes(email);
      await Promise.all(
        customBoxes.map(async (box) => {
          const { filter, unsupported } = buildCustomBoxCountFilter(
            box.criterios || [],
            responsavelCandidates,
          );
          counts[box.id] = await ChamadoN1.countDocuments(filter);
          if (unsupported.length) customBoxUnsupported[box.id] = unsupported;
        }),
      );
    }

    return res.json({
      counts,
      // Critérios sem tradução exata pro servidor (hoje: 'sla') — contagem daquela caixa
      // pode não bater 100% até isso ser implementado; frontend deve avisar, nunca fingir certeza.
      unsupportedCriteria: customBoxUnsupported,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[boxes] GET /queue-counts falhou:', message);
    return res.status(500).json({ message: 'Erro ao carregar contadores das filas' });
  }
});

router.get('/', authMiddleware, async (req, res: Response) => {
  const queueParam = typeof req.query.fila === 'string' ? req.query.fila : undefined;
  const userId = req.user?.userId;

  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ message: 'Banco de chamados indisponível' });
    }
    const dbUser = await resolveDbUser(userId);
    const resolved = await resolveUserPermissions(req.user!);
    const responsavelCandidates = buildResponsavelCandidates(req.user!, dbUser);
    const { queue, extraFilter } = await resolveQueueMode(resolved, queueParam);

    if (queue === 'meus-chamados' || queue === 'procon' || queue === 'consumidor-gov') {
      const result = await loadBoxesWithListTickets(
        MEUS_CHAMADOS_COLUMNS.map((column) => ({
          id: column.id,
          name: column.name,
          order: column.order,
          status: column.status,
        })),
        queue,
        responsavelCandidates,
      );
      return res.json(result);
    }

    const boxes = await getCachedBoxes();
    const columns = boxes.map((box) => ({
      id: String(box._id),
      name: box.name,
      order: box.order,
      status: statusFromBoxName(box.name),
    }));
    const result = await loadBoxesWithListTickets(
      columns,
      queue,
      responsavelCandidates,
      extraFilter,
    );
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[boxes] GET falhou:', message);
    res.status(500).json({ message: 'Erro ao carregar boxes' });
  }
});

export default router;
