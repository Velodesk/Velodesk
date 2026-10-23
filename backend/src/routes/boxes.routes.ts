/** boxes.routes v1.9.0 — lista de boxes via cache TTL curto (getCachedBoxes) */
import { Router, Response } from 'express';
import mongoose from 'mongoose';
import { authMiddleware, type AuthPayload } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import { getCachedBoxes } from '../services/boxesCache.service';
import { ChamadoN1, type IChamadoN1 } from '../models/ChamadoN1';
import { cpfExactVariants, cpfToleranceRegex } from '../services/ticketSearch.service';
import { User } from '../models/User';
import {
  buildBoxCountFilter,
  buildBoxListFindOptions,
  buildChamadoMapContext,
  buildResponsavelCandidates,
  chamadoToTicketListItem,
  excludeAiAutomationFlowFilter,
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  // Colunas cujos status se sobrepõem (em-aberto ⊂ em-andamento; boxes "Em aberto"/"Em Andamento"
  // resolvem pro mesmo status) contariam o mesmo chamado duas vezes — conta cada status uma só vez.
  const hasEmAndamento = columns.some((c) => c.status === 'em-andamento');
  const seenStatuses = new Set<string>();
  const countableColumns = columns.filter((column) => {
    if (column.status === 'em-aberto' && hasEmAndamento) return false;
    if (seenStatuses.has(column.status)) return false;
    seenStatuses.add(column.status);
    return true;
  });

  await Promise.all(
    countableColumns.map(async (column) => {
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
// 'em-aberto' NÃO entra aqui: STATUS_VARIANTS['em-andamento'] já o inclui — listar os dois contava
// em dobro todo ticket 'em-aberto' (ex.: "Cliente respondeu"), gerando o contador fantasma.
const MEUS_TICKETS_ATIVOS_STATUSES = ['novo', 'em-andamento', 'pendente', 'em-espera'];

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

/**
 * Junta chamadas idênticas (mesmo usuário + rota + fila) que chegam enquanto uma ainda está em
 * execução. Sem isso, o cliente que estoura timeout (45s) reenvia a requisição enquanto o servidor
 * ainda processa a anterior — cada tentativa dispara os mesmos find/count sem índice (`$expr`) e
 * a fila de requisições só cresce. Não guarda resultado depois de terminar (sem dado velho).
 */
const inFlightByKey = new Map<string, Promise<{ status: number; body: unknown }>>();

async function dedupeInFlight(
  key: string,
  run: () => Promise<{ status: number; body: unknown }>,
): Promise<{ status: number; body: unknown }> {
  const existing = inFlightByKey.get(key);
  if (existing) return existing;
  const promise = run().finally(() => inFlightByKey.delete(key));
  inFlightByKey.set(key, promise);
  return promise;
}

router.get('/queue-counts', authMiddleware, async (req, res: Response) => {
  const queueParam = typeof req.query.fila === 'string' ? req.query.fila : undefined;
  const userId = req.user?.userId;
  const key = `counts|${userId || ''}|${req.user?.email || ''}|${queueParam || ''}`;
  const out = await dedupeInFlight(key, () => computeQueueCounts(req.user!, queueParam, userId));
  return res.status(out.status).json(out.body);
});

async function computeQueueCounts(
  user: AuthPayload,
  queueParam: string | undefined,
  userId: string | undefined,
): Promise<{ status: number; body: unknown }> {
  try {
    if (!isMongoConnected()) {
      return { status: 503, body: { message: 'Banco de chamados indisponível' } };
    }
    const dbUser = await resolveDbUser(userId);
    const resolved = await resolveUserPermissions(user);
    const responsavelCandidates = buildResponsavelCandidates(user, dbUser);
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
    const email = user.email || '';
    if (email) {
      const customBoxes = await listAgentQueueBoxes(email);
      await Promise.all(
        customBoxes.map(async (box) => {
          const { filter, unsupported } = buildCustomBoxCountFilter(
            box.criterios || [],
            responsavelCandidates,
          );
          counts[box.id] = await ChamadoN1.countDocuments({ $and: [filter, excludeAiAutomationFlowFilter()] });
          if (unsupported.length) customBoxUnsupported[box.id] = unsupported;
        }),
      );
    }

    return {
      status: 200,
      body: {
        counts,
        // Mesmos candidatos de "sou eu" usados na contagem — o frontend monta a lista de Meus Tickets com eles.
        responsavelCandidates,
        // Critérios sem tradução exata pro servidor (hoje: 'sla') — contagem daquela caixa
        // pode não bater 100% até isso ser implementado; frontend deve avisar, nunca fingir certeza.
        unsupportedCriteria: customBoxUnsupported,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[boxes] GET /queue-counts falhou:', message);
    return { status: 500, body: { message: 'Erro ao carregar contadores das filas' } };
  }
}

router.get('/', authMiddleware, async (req, res: Response) => {
  const queueParam = typeof req.query.fila === 'string' ? req.query.fila : undefined;
  const key = `list|${req.user?.userId || ''}|${req.user?.email || ''}|${queueParam || ''}`;
  const out = await dedupeInFlight(key, () => computeBoxesList(req.user!, queueParam, req.user?.userId));
  return res.status(out.status).json(out.body);
});

async function computeBoxesList(
  user: AuthPayload,
  queueParam: string | undefined,
  userId: string | undefined,
): Promise<{ status: number; body: unknown }> {
  try {
    if (!isMongoConnected()) {
      return { status: 503, body: { message: 'Banco de chamados indisponível' } };
    }
    const dbUser = await resolveDbUser(userId);
    const resolved = await resolveUserPermissions(user);
    const responsavelCandidates = buildResponsavelCandidates(user, dbUser);
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
      return { status: 200, body: result };
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
    return { status: 200, body: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[boxes] GET falhou:', message);
    return { status: 500, body: { message: 'Erro ao carregar boxes' } };
  }
}

/**
 * Página sob demanda da fila "Resolvidos" (resolvido + fechado), direto no banco — evita o
 * teto de BOX_LIST_MAX_ITEMS (500) que GET / usa pra montar o board inteiro. Sem isso, a
 * tabela "Resolvidos" calculava as páginas pela contagem real (milhares) mas só tinha os 500
 * itens do board pra fatiar — páginas além da ~25 vinham em branco. O total devolvido aqui vem
 * do mesmo buildBoxCountFilter que já alimenta o badge, então nunca diverge da paginação.
 */
router.get('/resolvidos/page', authMiddleware, async (req, res: Response) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ message: 'Banco de chamados indisponível' });
    }
    const dbUser = await resolveDbUser(req.user?.userId);
    const resolved = await resolveUserPermissions(req.user!);
    const responsavelCandidates = buildResponsavelCandidates(req.user!, dbUser);
    const queueParam = typeof req.query.fila === 'string' ? req.query.fila : undefined;
    const { queue, extraFilter } = await resolveQueueMode(resolved, queueParam);

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 50);
    const skip = Math.max(parseInt(String(req.query.skip ?? '0'), 10) || 0, 0);

    let boxId: string | undefined;
    if (queue === 'meus-chamados') {
      boxId = MEUS_CHAMADOS_COLUMNS.find((c) => c.status === 'resolvido')?.id;
    } else {
      const boxes = await getCachedBoxes();
      const box = boxes.find((b) => statusFromBoxName(b.name) === 'resolvido');
      boxId = box ? String(box._id) : undefined;
    }

    // Mesmo filtro/ordenação que GET / já usa pra montar a coluna Resolvidos do board — só troca
    // o limit fixo de 500 (buildBoxListFindOptions) por skip/limit de verdade.
    const { filter, sort } = buildBoxListFindOptions('resolvido', queue, responsavelCandidates, extraFilter);
    const countFilter = buildBoxCountFilter('resolvido', queue, responsavelCandidates, extraFilter);

    const q = String(req.query.q ?? '').trim();
    let chamados: IChamadoN1[];
    let total: number;
    if (q) {
      // Busca (CPF ou protocolo) dentro de Resolvidos — nunca a fila inteira, então não precisa
      // paginar: devolve as combinações encontradas direto (mesmo limite de 50 como teto).
      const qDigits = q.replace(/\D/g, '');
      let searchFilter: Record<string, unknown>;
      if (qDigits.length === 11) {
        const exactClause = { 'cliente.clienteCpf': { $in: cpfExactVariants(qDigits) } };
        const exactCount = await ChamadoN1.countDocuments({ $and: [filter, exactClause] });
        searchFilter = exactCount
          ? exactClause
          : { 'cliente.clienteCpf': { $regex: cpfToleranceRegex(qDigits) } };
      } else {
        searchFilter = { chamadoProtocolo: { $regex: escapeRegex(q), $options: 'i' } };
      }
      chamados = await ChamadoN1.find({ $and: [filter, searchFilter] }).sort(sort).limit(limit);
      // Dígitos com menos de 11 são ambíguos (CPF parcial ou protocolo) — mesma regra da busca
      // geral do Desk (inferDeskSearchMode/DESK_SEARCH_MODE_BOTH): sem bater por protocolo,
      // tenta também como CPF antes de desistir.
      if (!chamados.length && qDigits && qDigits.length !== 11) {
        const cpfFallback = { 'cliente.clienteCpf': { $regex: cpfToleranceRegex(qDigits) } };
        chamados = await ChamadoN1.find({ $and: [filter, cpfFallback] }).sort(sort).limit(limit);
      }
      total = chamados.length;
    } else {
      [chamados, total] = await Promise.all([
        ChamadoN1.find(filter).sort(sort).skip(skip).limit(limit),
        ChamadoN1.countDocuments(countFilter),
      ]);
    }

    const ctx = await buildChamadoMapContext(chamados, 'list');
    const items = chamados.map((chamado) => chamadoToTicketListItem(chamado, boxId, ctx));

    return res.json({ items, total, limit, skip });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[boxes] GET /resolvidos/page falhou:', message);
    return res.status(500).json({ message: 'Erro ao carregar página de Resolvidos' });
  }
});

export default router;
