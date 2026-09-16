/** workspace360.service v1.5.1 — reprovação workflow → seção action-now do agente */
import mongoose from 'mongoose';
import { env } from '../config/env';
import { ChamadoN1, IChamadoN1 } from '../models/ChamadoN1';
import { User } from '../models/User';
import type { AuthPayload } from '../middleware/auth';
import {
  buildChamadoMapContext,
  buildResponsavelCandidates,
  chamadoToTicketListItem,
  currentStatus,
  excludeEspeciaisChannelsMongoFilter,
  isSlaBreached,
  meusChamadosResponsavelFilter,
} from './chamado.mapper';
import { resolvePeriodRange } from './gestaoInsights.service';

// pendente/em-espera: 48h até a resolução automática (resolvePendenteTickets.service.ts) —
// mesmo critério de chamado.mapper.ts, pra não voltar a divergir do que a fila do Desk mostra.
const PENDENTE_LIMIT_HOURS = env.pendenteResolveAfterMs / (60 * 60 * 1000);

const SLA_LIMIT_HOURS: Record<string, number> = {
  'em-aberto': 4,
  'em-andamento': 8,
  pendente: PENDENTE_LIMIT_HOURS,
  'em-espera': PENDENTE_LIMIT_HOURS,
};

const SLA_TRACKED = new Set(['em-aberto', 'em-andamento', 'pendente', 'em-espera']);
const ACTIVE_STATUSES = new Set(['novo', 'em-aberto', 'em-andamento', 'pendente', 'em-espera']);
const ACTIVE_STATUS_LIST = [...ACTIVE_STATUSES];

/** Campos mínimos para KPIs, SLA, leaderboard e cards do painel — registro vem enxuto da agregação. */
const PANEL_CHAMADO_SELECT =
  'createdAt updatedAt chamadoTitulo tabulacao registro workflow cliente csat';

/** Projeta registro sem mensagens/anotações — preserva status, datas, metadados e flags de conteúdo. */
const SLIM_REGISTRO_EXPR = {
  $map: {
    input: { $ifNull: ['$registro', []] },
    as: 'r',
    in: {
      status: '$$r.status',
      data: '$$r.data',
      origin: '$$r.origin',
      mensagemPublica: {
        $let: {
          vars: {
            t: {
              $trim: {
                input: { $ifNull: ['$$r.mensagemPublica', ''] },
              },
            },
          },
          in: { $cond: [{ $gt: [{ $strLenCP: '$$t' }, 0] }, '1', ''] },
        },
      },
      metadados: { $ifNull: ['$$r.metadados', {}] },
      anexosMensagemPublica: { $ifNull: ['$$r.anexosMensagemPublica', []] },
    },
  },
};

function supervisorChamadosMatchFilter(from: Date, to: Date): Record<string, unknown> {
  const prevFrom = new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    $or: [
      lastStatusInFilter(ACTIVE_STATUS_LIST),
      {
        registro: {
          $elemMatch: {
            status: 'resolvido',
            data: { $gte: prevFrom, $lte: to },
          },
        },
      },
      { createdAt: { $gte: from, $lte: to } },
    ],
  };
}

function lastStatusInFilter(statuses: string[]): Record<string, unknown> {
  return {
    $expr: {
      $in: [
        { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
        statuses,
      ],
    },
  };
}

function compareSlaPriority(a: IChamadoN1, b: IChamadoN1): number {
  const prio: Record<string, number> = { critical: 0, warning: 1, ok: 2 };
  return (prio[slaStatus(a)] ?? 9) - (prio[slaStatus(b)] ?? 9);
}

function panelClientLabel(chamado: IChamadoN1): string {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  return String(tab?.motivo ?? chamado.chamadoTitulo ?? 'Cliente').trim() || 'Cliente';
}

const FINANCEIRO_KW = ['financeiro', 'cobrança', 'cobranca', 'fatura', 'inadimplência', 'inadimplencia'];
const ESTORNO_KW = ['estorno', 'procon', 'devolução', 'devolucao'];

const TZ = 'America/Sao_Paulo';

/** Chave (segunda-feira da semana, YYYY-MM-DD) usada pra agrupar o relatório de CSAT por semana. */
function weekKeyOf(date: Date): string {
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
  const local = new Date(`${dayKey}T12:00:00`);
  const weekday = local.getDay(); // 0=dom..6=sáb
  const diffToMonday = (weekday + 6) % 7;
  local.setDate(local.getDate() - diffToMonday);
  return new Intl.DateTimeFormat('en-CA').format(local);
}

function weekLabelOf(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  return `Semana de ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

export interface Workspace360Query {
  period?: string;
  channel?: string;
  team?: string;
  report?: string;
  /** Período próprio do leaderboard operacional — independente do `period` usado nos KPIs/escalonados. */
  leaderboardPeriod?: string;
  leaderboardFrom?: string;
  leaderboardTo?: string;
}

function startOfDayInTz(date: Date, tz = TZ): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`);
}

function periodRange(period = '7d'): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === 'today') {
    return { from: startOfDayInTz(to), to };
  }
  if (period === 'month') {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(to);
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    return { from: new Date(`${y}-${m}-01T00:00:00-03:00`), to };
  }
  if (period === '30d') {
    from.setDate(from.getDate() - 30);
    return { from, to };
  }
  from.setDate(from.getDate() - 7);
  return { from, to };
}

function tabulacaoText(chamado: IChamadoN1): string {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  return [chamado.chamadoTitulo, tab?.tipoChamado, tab?.produto, tab?.motivo, tab?.detalhe]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function responsavelMatches(chamado: IChamadoN1, candidates: string[]): boolean {
  const resp = (chamado.tabulacao?.[chamado.tabulacao.length - 1]?.responsavel ?? '').trim().toLowerCase();
  if (!resp) return false;
  return candidates.includes(resp);
}

function getResolvedAt(chamado: IChamadoN1): Date | null {
  const regs = chamado.registro ?? [];
  for (let i = regs.length - 1; i >= 0; i--) {
    if (regs[i].status === 'resolvido') return new Date(regs[i].data);
  }
  return null;
}

function getFirstAgentResponseAt(chamado: IChamadoN1): Date | null {
  for (const reg of chamado.registro ?? []) {
    if (reg.origin === 'agente' && String(reg.mensagemPublica ?? '').trim()) {
      return new Date(reg.data);
    }
  }
  return null;
}

function slaRemainingMinutes(chamado: IChamadoN1): number | null {
  const status = currentStatus(chamado);
  if (!SLA_TRACKED.has(status)) return null;
  const limitHours = SLA_LIMIT_HOURS[status];
  if (!limitHours) return null;
  const regs = chamado.registro ?? [];
  const statusSince = regs[regs.length - 1]?.data ?? chamado.createdAt;
  if (!statusSince) return null;
  const elapsedMin = Math.max(0, Math.floor((Date.now() - new Date(statusSince).getTime()) / 60000));
  const totalMin = limitHours * 60;
  return totalMin - elapsedMin;
}

function isSlaAtRisk(chamado: IChamadoN1): boolean {
  if (isSlaBreached(chamado)) return true;
  const remaining = slaRemainingMinutes(chamado);
  if (remaining == null) return false;
  const status = currentStatus(chamado);
  const limitHours = SLA_LIMIT_HOURS[status];
  if (!limitHours) return false;
  const totalMin = limitHours * 60;
  return remaining <= Math.max(30, Math.floor(totalMin * 0.2));
}

function slaStatus(chamado: IChamadoN1): 'critical' | 'warning' | 'ok' {
  if (isSlaBreached(chamado)) return 'critical';
  const remaining = slaRemainingMinutes(chamado);
  if (remaining != null && remaining <= 30) return 'warning';
  if (isSlaAtRisk(chamado)) return 'warning';
  return 'ok';
}

function inferChannel(chamado: IChamadoN1): string {
  for (const reg of chamado.registro ?? []) {
    const meta = reg.metadados ?? {};
    if (meta.emailMessageId || meta.emailFrom) return 'email';
    if (meta.whatsapp || meta.waChatId || meta.channel === 'whatsapp') return 'whatsapp';
    if (String(meta.channel ?? '').toLowerCase().includes('instagram')) return 'instagram';
    if (String(meta.channel ?? '').toLowerCase().includes('chat')) return 'chat';
  }
  return 'portal';
}

function channelMatchesFilter(chamado: IChamadoN1, filter: string): boolean {
  if (!filter || filter === 'all') return true;
  const ch = inferChannel(chamado);
  if (filter === 'telefone') return ch === 'telefone';
  return ch === filter;
}

function statusToQueueId(status: string): string {
  if (status === 'novo') return 'novos';
  if (status === 'em-aberto' || status === 'em-andamento') return 'em-andamento';
  if (status === 'pendente' || status === 'em-espera') return 'pendente';
  if (status === 'resolvido') return 'resolvidos';
  return 'novos';
}

function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}m ${String(m).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function formatDurationMinutes(totalMin: number): string {
  return formatDurationMs(Math.max(0, Math.round(totalMin)) * 60000);
}

function isEscalationCandidate(chamado: IChamadoN1): boolean {
  const status = currentStatus(chamado);
  if (!ACTIVE_STATUSES.has(status)) return false;
  if (!isSlaBreached(chamado) && !isSlaAtRisk(chamado)) return false;
  if (chamado.workflow?.active) return true;
  const text = tabulacaoText(chamado);
  return matchesKeywords(text, [...FINANCEIRO_KW, ...ESTORNO_KW]);
}

function escalationCategory(chamado: IChamadoN1): 'financeiro' | 'estorno' | null {
  if (!isEscalationCandidate(chamado)) return null;
  const text = tabulacaoText(chamado);
  if (matchesKeywords(text, FINANCEIRO_KW)) return 'financeiro';
  if (matchesKeywords(text, ESTORNO_KW)) return 'estorno';
  if (chamado.workflow?.active) return 'financeiro';
  return null;
}

/**
 * Supervisor: uma agregação MongoDB devolve tickets com registro enxuto (~KB vs ~MB).
 * O backend calcula KPIs/leaderboard/cards em memória sobre esse conjunto compacto.
 */
async function loadSupervisorChamados(from: Date, to: Date): Promise<IChamadoN1[]> {
  return ChamadoN1.aggregate([
    { $match: supervisorChamadosMatchFilter(from, to) },
    {
      $project: {
        _id: 1,
        createdAt: 1,
        updatedAt: 1,
        chamadoTitulo: 1,
        tabulacao: 1,
        workflow: 1,
        cliente: 1,
        csat: 1,
        registro: SLIM_REGISTRO_EXPR,
      },
    },
    { $sort: { updatedAt: -1 } },
  ]).allowDiskUse(true) as Promise<IChamadoN1[]>;
}

async function loadAgentChamados(candidates: string[]): Promise<IChamadoN1[]> {
  const baseFilter = meusChamadosResponsavelFilter(candidates);
  const productionFrom = startOfDayInTz(new Date());
  productionFrom.setDate(productionFrom.getDate() - 6);

  return ChamadoN1.find({
    $and: [
      baseFilter,
      // Painel 360° pessoal do agente é do módulo Tickets — canais especiais (Procon/Bacen/
      // Consumidor.gov/Reclame Aqui) têm CRM próprio e não devem contar nos KPIs/seções do
      // agente comum, mesmo se ele aparecer como responsável/atribuído (mesma regra já
      // aplicada ao módulo Tickets em chamado.mapper.ts:buildChamadoQueryFilter).
      excludeEspeciaisChannelsMongoFilter(),
      {
        $or: [
          lastStatusInFilter(ACTIVE_STATUS_LIST),
          {
            registro: {
              $elemMatch: {
                status: 'resolvido',
                data: { $gte: productionFrom },
              },
            },
          },
        ],
      },
    ],
  })
    .select(PANEL_CHAMADO_SELECT)
    .sort({ updatedAt: -1 })
    .lean<IChamadoN1[]>();
}

async function resolveDbUser(userId?: string) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null;
  return User.findById(userId).select('name email').lean();
}

type PanelTicketEntry = {
  ticket: Record<string, unknown>;
  queueId: string;
  sla: 'critical' | 'warning' | 'ok';
};

async function enrichTicketsForPanel(
  chamados: IChamadoN1[],
  queueIdFn: (chamado: IChamadoN1) => string = (chamado) => statusToQueueId(currentStatus(chamado)),
): Promise<PanelTicketEntry[]> {
  if (!chamados.length) return [];
  const ctx = await buildChamadoMapContext(chamados, 'list');
  return chamados.map((chamado) => {
    const remaining = slaRemainingMinutes(chamado);
    const status = slaStatus(chamado);
    const queueId = queueIdFn(chamado);
    const dto = chamadoToTicketListItem(chamado, queueId, ctx);
    return {
      ticket: {
        ...dto,
        id: chamado._id?.toString(),
        slaRemaining: remaining,
        slaStatus: status,
        channel: inferChannel(chamado),
      },
      queueId,
      sla: status,
    };
  });
}

function registroHasWorkflowReject(chamado: IChamadoN1): boolean {
  return (chamado.registro || []).some((row) => {
    if (row.metadados?.workflowDecision === 'reject') return true;
    return (row.alteracoes || []).some(
      (item) => (item as Record<string, unknown>)?.workflowDecision === 'reject',
    );
  });
}

/** Workflow reprovado aguardando retorno manual do responsável (N1). */
function isWorkflowRejectAwaitingAgent(chamado: IChamadoN1): boolean {
  const wf = chamado.workflow;
  if (!wf?.active || wf.workflowStatus === 'finished' || wf.workflowStatus === 'cancel') {
    return false;
  }
  if (!registroHasWorkflowReject(chamado)) return false;
  const status = currentStatus(chamado);
  return status === 'em-andamento' || status === 'pendente' || status === 'em-espera';
}

function classifyAgentSection(chamado: IChamadoN1): 'action-now' | 'client-replied' | 'workflow' | null {
  if (isWorkflowRejectAwaitingAgent(chamado)) return 'action-now';
  const status = currentStatus(chamado);
  if (status === 'em-aberto') return 'client-replied';
  if (status === 'em-andamento' || status === 'pendente' || status === 'em-espera') return 'workflow';
  if (status === 'novo' || isSlaAtRisk(chamado)) return 'action-now';
  return null;
}

export async function buildAgent360Payload(authUser: AuthPayload) {
  const dbUser = await resolveDbUser(authUser.userId);
  const candidates = buildResponsavelCandidates(authUser, dbUser);
  const chamados = await loadAgentChamados(candidates);
  const now = new Date();
  const todayStart = startOfDayInTz(now);

  const active = chamados.filter((c) => ACTIVE_STATUSES.has(currentStatus(c)));
  const resolvedTodayList = chamados.filter((c) => {
    if (currentStatus(c) !== 'resolvido') return false;
    const resolvedAt = getResolvedAt(c);
    return resolvedAt ? resolvedAt >= todayStart : false;
  });

  const slaAtRiskList = chamados.filter(
    (c) => ACTIVE_STATUSES.has(currentStatus(c)) && isSlaAtRisk(c)
  );

  let tmaTotalMin = 0;
  let tmaCount = 0;
  let csatTotal = 0;
  let csatCount = 0;
  resolvedTodayList.forEach((c) => {
    const resolvedAt = getResolvedAt(c);
    if (!resolvedAt) return;
    const start = c.createdAt ? new Date(c.createdAt) : resolvedAt;
    tmaTotalMin += (resolvedAt.getTime() - start.getTime()) / 60000;
    tmaCount++;
    if (c.csat?.respondido && typeof c.csat.nota === 'number') {
      csatTotal += c.csat.nota;
      csatCount++;
    }
  });

  const bucketsRaw: Record<string, IChamadoN1[]> = {
    'action-now': [],
    'client-replied': [],
    workflow: [],
  };

  active.forEach((c) => {
    const section = classifyAgentSection(c);
    if (!section) return;
    bucketsRaw[section].push(c);
  });

  Object.keys(bucketsRaw).forEach((key) => {
    bucketsRaw[key].sort(compareSlaPriority);
  });

  const buckets: Record<string, PanelTicketEntry[]> = {};
  await Promise.all(
    Object.keys(bucketsRaw).map(async (key) => {
      buckets[key] = await enrichTicketsForPanel(bucketsRaw[key].slice(0, 5));
    }),
  );

  const productionMap = new Map<string, number>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    productionMap.set(
      new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d),
      0
    );
  }
  chamados.forEach((c) => {
    if (currentStatus(c) !== 'resolvido') return;
    const resolvedAt = getResolvedAt(c);
    if (!resolvedAt) return;
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(resolvedAt);
    if (productionMap.has(key)) productionMap.set(key, (productionMap.get(key) ?? 0) + 1);
  });

  const productionWeek = [...productionMap.entries()].map(([id, value], index, arr) => {
    const date = new Date(`${id}T12:00:00`);
    const isToday = index === arr.length - 1;
    const weekday = date
      .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: TZ })
      .replace('.', '')
      .replace(/^\w/, (c) => c.toUpperCase());
    const dateLabel = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
    return {
      id,
      label: isToday ? 'Hoje' : `${weekday} ${dateLabel}`,
      value,
      isToday,
    };
  });
  const maxProd = Math.max(...productionWeek.map((d) => d.value), 1);
  const productionWeekPct = productionWeek.map((day) => ({
    ...day,
    pct: Math.round((day.value / maxProd) * 100),
  }));

  const criticalChamado = active
    .filter((c) => slaStatus(c) === 'critical')
    .sort((a, b) => (slaRemainingMinutes(a) ?? 999) - (slaRemainingMinutes(b) ?? 999))[0];

  let alert = null;
  if (criticalChamado) {
    alert = {
      ticketId: String(criticalChamado._id),
      clientName: panelClientLabel(criticalChamado),
      subject: String(criticalChamado.chamadoTitulo || 'Ticket').split('—')[0].trim() || criticalChamado.chamadoTitulo,
      expiresIn: `${Math.max(0, slaRemainingMinutes(criticalChamado) ?? 0)} minutos`,
    };
  }

  const sectionDefs = [
    { id: 'action-now', title: 'Precisa de ação agora', icon: 'ti ti-alert-circle', variant: 'urgent' },
    { id: 'client-replied', title: 'Cliente respondeu', icon: 'ti ti-message-circle', variant: 'replied' },
    { id: 'workflow', title: 'Atualização interna / workflow', icon: 'ti ti-arrows-exchange', variant: 'workflow' },
  ];

  const sections = sectionDefs.map((def) => ({
    ...def,
    count: bucketsRaw[def.id]?.length ?? 0,
    entries: buckets[def.id] ?? [],
  }));

  return {
    kpis: {
      assigned: active.length,
      resolvedToday: resolvedTodayList.length,
      slaAtRisk: slaAtRiskList.length,
      csat: csatCount > 0 ? Math.round((csatTotal / csatCount) * 10) / 10 : null,
      tma: tmaCount > 0 ? formatDurationMinutes(tmaTotalMin / tmaCount) : null,
    },
    sections,
    productionWeek: productionWeekPct,
    alert,
  };
}

/**
 * Payload de gestão é global (não depende do usuário — mesma visão de equipe para todo supervisor).
 * Cache TTL curto colapsa múltiplas chamadas concorrentes/refreshes (o cálculo custa ~30s):
 * o painel dispara workspace360 + leaderboard + refreshes, e vários supervisores compartilham o dado.
 */
const SUPERVISOR_PAYLOAD_TTL_MS = 30_000;
type SupervisorPayload = Awaited<ReturnType<typeof computeSupervisor360Payload>>;
const supervisorPayloadCache = new Map<string, { at: number; promise: Promise<SupervisorPayload> }>();

function supervisorCacheKey(query: Workspace360Query): string {
  return JSON.stringify({
    period: query.period ?? '7d',
    channel: query.channel ?? 'all',
    team: query.team ?? null,
    report: query.report ?? null,
    lbP: query.leaderboardPeriod ?? null,
    lbF: query.leaderboardFrom ?? null,
    lbT: query.leaderboardTo ?? null,
  });
}

export async function buildSupervisor360Payload(authUser: AuthPayload, query: Workspace360Query = {}) {
  const key = supervisorCacheKey(query);
  const now = Date.now();
  const cached = supervisorPayloadCache.get(key);
  if (cached && now - cached.at < SUPERVISOR_PAYLOAD_TTL_MS) {
    return cached.promise;
  }
  // Guarda a promise (não só o valor) para coalescer chamadas concorrentes no mesmo cálculo.
  const promise = computeSupervisor360Payload(authUser, query);
  supervisorPayloadCache.set(key, { at: now, promise });
  try {
    return await promise;
  } catch (err) {
    supervisorPayloadCache.delete(key);
    throw err;
  }
}

async function computeSupervisor360Payload(authUser: AuthPayload, query: Workspace360Query = {}) {
  const { from, to } = periodRange(query.period ?? '7d');
  const chamados = await loadSupervisorChamados(from, to);
  const filtered = chamados.filter((c) => channelMatchesFilter(c, query.channel ?? 'all'));

  const active = filtered.filter((c) => ACTIVE_STATUSES.has(currentStatus(c)));
  const slaRisk = active.filter((c) => isSlaAtRisk(c)).length;

  const resolvedInPeriod = filtered.filter((c) => {
    if (currentStatus(c) !== 'resolvido') return false;
    const at = getResolvedAt(c);
    return at ? at >= from && at <= to : false;
  });

  const resolvedCompliant = resolvedInPeriod.filter((c) => !wasResolvedWithSlaBreach(c)).length;
  const slaPct = resolvedInPeriod.length
    ? Math.round((resolvedCompliant / resolvedInPeriod.length) * 100)
    : 0;

  let tmaSum = 0;
  let tmaN = 0;
  let tmeSum = 0;
  let tmeN = 0;
  let csatSum = 0;
  let csatN = 0;
  resolvedInPeriod.forEach((c) => {
    const resolvedAt = getResolvedAt(c);
    if (!resolvedAt) return;
    const start = c.createdAt ? new Date(c.createdAt) : resolvedAt;
    tmaSum += resolvedAt.getTime() - start.getTime();
    tmaN++;
    const firstAgent = getFirstAgentResponseAt(c);
    if (firstAgent) {
      tmeSum += firstAgent.getTime() - start.getTime();
      tmeN++;
    }
    if (c.csat?.respondido && typeof c.csat.nota === 'number') {
      csatSum += c.csat.nota;
      csatN++;
    }
  });

  const createdInPeriod = filtered.filter((c) => {
    const created = c.createdAt ? new Date(c.createdAt) : null;
    return created ? created >= from && created <= to : false;
  }).length;

  const escalatedTickets = filtered.filter((c) => escalationCategory(c) !== null);
  const slaCriticalOnlyTickets = active.filter((c) => isSlaBreached(c) && escalationCategory(c) === null);
  const categories = [
    { id: 'financeiro', label: 'Financeiro', count: 0, accent: 'orange' },
    { id: 'estorno', label: 'Estorno', count: 0, accent: 'navy' },
    { id: 'sla-critico', label: 'SLA crítico', count: slaCriticalOnlyTickets.length, accent: 'red' },
  ];
  const escalatedGroups: Record<string, IChamadoN1[]> = {
    financeiro: [],
    estorno: [],
    'sla-critico': slaCriticalOnlyTickets,
  };
  escalatedTickets.forEach((c) => {
    const cat = escalationCategory(c);
    if (!cat) return;
    escalatedGroups[cat].push(c);
    const row = categories.find((x) => x.id === cat);
    if (row) row.count++;
  });

  /** Total de tickets ativos já fora do prazo de SLA, escalados ou não — usado no banner do card. */
  const slaCriticalCount = active.filter((c) => isSlaBreached(c)).length;

  const escalatedToEnrich = new Map<string, IChamadoN1>();
  categories.forEach((cat) => {
    (escalatedGroups[cat.id] ?? []).slice(0, 20).forEach((c) => {
      escalatedToEnrich.set(String(c._id), c);
    });
  });
  const enrichedEscalated = await enrichTicketsForPanel([...escalatedToEnrich.values()]);
  const enrichedById = new Map(enrichedEscalated.map((entry) => [String(entry.ticket.id), entry]));

  const escalatedGroupEntries = categories.map((cat) => ({
    ...cat,
    entries: (escalatedGroups[cat.id] ?? [])
      .slice(0, 20)
      .map((c) => enrichedById.get(String(c._id)))
      .filter((entry): entry is PanelTicketEntry => Boolean(entry)),
  }));

  const channelIds = ['whatsapp', 'email', 'chat', 'instagram', 'portal'] as const;
  const channelVision = channelIds.map((id) => {
    const inChannel = active.filter((c) => inferChannel(c) === id || (id === 'portal' && !['whatsapp', 'email', 'chat', 'instagram'].includes(inferChannel(c))));
    const total = inChannel.length;
    const ok = inChannel.filter((c) => !isSlaAtRisk(c)).length;
    const sla = total ? Math.round((ok / total) * 100) : 0;
    return {
      id,
      label: id.charAt(0).toUpperCase() + id.slice(1),
      tickets: total,
      sla,
      highVolume: false,
    };
  });
  const avgTickets = channelVision.reduce((s, c) => s + c.tickets, 0) / Math.max(channelVision.length, 1);
  channelVision.forEach((c) => {
    c.highVolume = c.tickets > avgTickets * 1.3;
  });

  const leaderboardRange = resolvePeriodRange({
    period: query.leaderboardPeriod ?? '7d',
    from: query.leaderboardFrom,
    to: query.leaderboardTo,
  });
  const leaderboard = await buildLeaderboard(filtered, leaderboardRange.start, leaderboardRange.end);
  const reports: Record<string, unknown> = {};
  if (query.report) {
    reports[query.report] = buildReport(query.report, filtered, query);
  }

  return {
    kpis: {
      slaPct,
      slaRisk,
      online: null,
      tma: tmaN ? formatDurationMs(tmaSum / tmaN) : '—',
      tme: tmeN ? formatDurationMs(tmeSum / tmeN) : '—',
      nps: null,
      csat: csatN ? Math.round((csatSum / csatN) * 10) / 10 : null,
      volume: String(createdInPeriod),
      warRoom: slaCriticalCount >= 3,
    },
    escalated: {
      categories,
      slaCriticalCount,
      updatedAt: new Date().toISOString(),
      groups: escalatedGroupEntries,
    },
    channelVision,
    leaderboard,
    reports,
  };
}

function wasResolvedWithSlaBreach(chamado: IChamadoN1): boolean {
  const regs = chamado.registro ?? [];
  for (let i = regs.length - 1; i >= 0; i--) {
    if (regs[i].status !== 'resolvido') continue;
    const snapshot = { ...chamado, registro: regs.slice(0, i + 1) } as IChamadoN1;
    return isSlaBreached(snapshot);
  }
  return false;
}

interface LeaderboardEntry {
  id: string;
  rank: number;
  name: string;
  /** Chave normalizada (lowercase) do responsável — usada para buscar a lista de tickets "em andamento" no drill-down. */
  agentKey: string;
  medal: boolean;
  trend: 'up' | 'down';
  sla: string;
  /** Tickets resolvidos no período filtrado do leaderboard. */
  resolved: number;
  /** Tickets com status "em-andamento" agora — não é filtrado pelo período do leaderboard. */
  inProgress: number;
  /** Tempo médio de resolução (createdAt → resolução), sobre os resolvidos no período. */
  tma: string;
  /** Tempo médio até a 1ª resposta do agente, sobre os resolvidos no período. */
  tme: string;
  /** Nota média de CSAT (1-5) dos tickets resolvidos por esse agente no período; null se nenhum cliente respondeu. */
  csat: number | null;
  vsLastWeek: string;
  shift: null;
  channel: null;
}

/**
 * Mapa de aliases → nome canônico do usuário (email completo, nome e parte local do e-mail,
 * todos em lowercase). Usado para agrupar um mesmo colaborador mesmo quando o campo
 * `tabulacao.responsavel` foi salvo de formas diferentes (ex.: "victor.silva" vs "victor silva").
 */
async function buildUserByKeyMap(): Promise<Map<string, string>> {
  const users = await User.find({ role: { $in: ['agent', 'supervisor'] } }).select('name email').lean();
  const map = new Map<string, string>();
  users.forEach((u) => {
    map.set(u.email.toLowerCase(), u.name);
    map.set(u.name.toLowerCase(), u.name);
    const local = u.email.split('@')[0]?.toLowerCase();
    if (local) map.set(local, u.name);
  });
  return map;
}

/** Resolve a chave de agrupamento canônica (nome do usuário se conhecido, senão a própria string). */
function canonicalAgentKey(rawResponsavel: string, userByKey: Map<string, string>): string {
  const raw = rawResponsavel.trim().toLowerCase();
  if (!raw) return '';
  return (userByKey.get(raw) ?? raw).toLowerCase();
}

function computeDelta(current: number, previous: number): number {
  if (previous) return Math.round(((current - previous) / previous) * 100);
  return current > 0 ? 100 : 0;
}

function rankEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .sort((a, b) => b.resolved - a.resolved)
    .slice(0, 20)
    .map((entry, index) => ({ ...entry, rank: index + 1, medal: index === 0 }));
}

async function buildLeaderboard(chamados: IChamadoN1[], from: Date, to: Date) {
  const userByKey = await buildUserByKeyMap();

  /** Comparação sempre com o mesmo período, 7 dias antes (semana anterior). */
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const prevFrom = new Date(from.getTime() - WEEK_MS);
  const prevTo = new Date(to.getTime() - WEEK_MS);

  const byAgent = new Map<string, {
    resolved: number;
    resolvedPrevWeek: number;
    inProgress: number;
    slaOk: number;
    slaTotal: number;
    tmaSum: number;
    tmaN: number;
    tmeSum: number;
    tmeN: number;
    csatSum: number;
    csatN: number;
  }>();

  const ensureAgent = (key: string) => {
    if (!byAgent.has(key)) {
      byAgent.set(key, {
        resolved: 0,
        resolvedPrevWeek: 0,
        inProgress: 0,
        slaOk: 0,
        slaTotal: 0,
        tmaSum: 0,
        tmaN: 0,
        tmeSum: 0,
        tmeN: 0,
        csatSum: 0,
        csatN: 0,
      });
    }
    return byAgent.get(key)!;
  };

  chamados.forEach((c) => {
    const rawResp = (c.tabulacao?.[c.tabulacao.length - 1]?.responsavel ?? '').trim();
    if (!rawResp) return;
    const resp = canonicalAgentKey(rawResp, userByKey);
    if (!resp) return;
    const status = currentStatus(c);

    // "Em andamento" é sempre o estado atual do ticket — não é filtrado pelo período do leaderboard.
    if (status === 'em-andamento') {
      ensureAgent(resp).inProgress++;
    }

    if (status !== 'resolvido') return;
    const resolvedAt = getResolvedAt(c);
    if (!resolvedAt) return;
    const inCurrent = resolvedAt >= from && resolvedAt <= to;
    const inPrev = resolvedAt >= prevFrom && resolvedAt <= prevTo;
    if (!inCurrent && !inPrev) return;

    const row = ensureAgent(resp);
    if (inCurrent) {
      row.resolved++;
      row.slaTotal++;
      if (!wasResolvedWithSlaBreach(c)) row.slaOk++;
      const start = c.createdAt ? new Date(c.createdAt) : resolvedAt;
      row.tmaSum += resolvedAt.getTime() - start.getTime();
      row.tmaN++;
      const firstAgent = getFirstAgentResponseAt(c);
      if (firstAgent) {
        row.tmeSum += firstAgent.getTime() - start.getTime();
        row.tmeN++;
      }
      if (c.csat?.respondido && typeof c.csat.nota === 'number') {
        row.csatSum += c.csat.nota;
        row.csatN++;
      }
    } else {
      row.resolvedPrevWeek++;
    }
  });

  const ranking = rankEntries(
    [...byAgent.entries()]
      .filter(([, stats]) => stats.resolved > 0 || stats.inProgress > 0)
      .map(([key, stats]) => {
        const delta = computeDelta(stats.resolved, stats.resolvedPrevWeek);
        return {
          id: `agent-${key.replace(/\s+/g, '-')}`,
          rank: 0,
          name: userByKey.get(key) ?? key,
          agentKey: key,
          medal: false,
          trend: delta >= 0 ? 'up' as const : 'down' as const,
          sla: stats.slaTotal ? `${Math.round((stats.slaOk / stats.slaTotal) * 100)}%` : '—',
          resolved: stats.resolved,
          inProgress: stats.inProgress,
          tma: stats.tmaN ? formatDurationMs(stats.tmaSum / stats.tmaN) : '—',
          tme: stats.tmeN ? formatDurationMs(stats.tmeSum / stats.tmeN) : '—',
          csat: stats.csatN ? Math.round((stats.csatSum / stats.csatN) * 10) / 10 : null,
          vsLastWeek: `${delta >= 0 ? '+' : ''}${delta}%`,
          shift: null,
          channel: null,
        };
      }),
  );

  return { ranking };
}

/**
 * Tickets "em-andamento" de um colaborador, do mais antigo para o mais novo (drill-down do leaderboard).
 * Usa a mesma canonicalização de `buildLeaderboard` (via userByKey) para agrupar corretamente
 * variações do campo `tabulacao.responsavel` (ex.: "victor.silva" e "victor silva" são a mesma pessoa).
 */
export async function getAgentInProgressTickets(agentKey: string) {
  const key = agentKey.trim().toLowerCase();
  if (!key) return [];
  const userByKey = await buildUserByKeyMap();
  const chamados = await ChamadoN1.find(lastStatusInFilter(['em-andamento']))
    .select(PANEL_CHAMADO_SELECT)
    .sort({ createdAt: 1 })
    .lean<IChamadoN1[]>();
  const inProgress = chamados.filter((c) => {
    const rawResp = (c.tabulacao?.[c.tabulacao.length - 1]?.responsavel ?? '').trim();
    if (!rawResp) return false;
    return canonicalAgentKey(rawResp, userByKey) === key;
  });
  return enrichTicketsForPanel(inProgress, () => 'em-andamento');
}

function buildReport(reportId: string, chamados: IChamadoN1[], query: Workspace360Query) {
  const { from, to } = periodRange(query.period ?? '7d');
  const cardMeta: Record<string, { icon: string; title: string; desc: string; action: string }> = {
    sla: { icon: 'ti-clock', title: 'SLA operacional', desc: 'Cumprimento de prazos por fila, canal e equipe.', action: 'Ver relatório SLA' },
    volume: { icon: 'ti-chart-bar', title: 'Volume de tickets', desc: 'Entradas, resolvidos e backlog por período.', action: 'Ver relatório de volume' },
    // Não existe pesquisa de NPS (0-10 "recomendaria") no sistema — este card reaproveita o
    // mesmo slot/rota (report=nps) para mostrar CSAT real (nota 1-5), sem inventar um NPS
    // que não é coletado.
    nps: { icon: 'ti-mood-smile', title: 'CSAT e satisfação', desc: 'Notas de atendimento (CSAT) e tendência semanal.', action: 'Ver relatório de CSAT' },
    team: { icon: 'ti-users', title: 'Performance da equipe', desc: 'TMA, TME e produtividade por agente.', action: 'Ver relatório de equipe' },
    monitoria: { icon: 'ti-headphones', title: 'Monitoria', desc: 'Scorecards, avaliações de qualidade e feedback por agente.', action: 'Abrir monitoria' },
  };

  const meta = cardMeta[reportId];
  if (!meta) return null;

  if (reportId === 'nps') {
    const responded = chamados.filter((c) => c.csat?.respondido && typeof c.csat.nota === 'number');
    const totalNota = responded.reduce((sum, c) => sum + (c.csat!.nota as number), 0);
    const notaMedia = responded.length ? Math.round((totalNota / responded.length) * 10) / 10 : null;

    const byWeek = new Map<string, { sum: number; n: number }>();
    responded.forEach((c) => {
      const at = c.csat!.respondidoEm ? new Date(c.csat!.respondidoEm as unknown as string) : null;
      if (!at) return;
      const key = weekKeyOf(at);
      if (!byWeek.has(key)) byWeek.set(key, { sum: 0, n: 0 });
      const bucket = byWeek.get(key)!;
      bucket.sum += c.csat!.nota as number;
      bucket.n++;
    });
    const weekKeys = [...byWeek.keys()].sort();
    const rows = weekKeys.map((key, index) => {
      const bucket = byWeek.get(key)!;
      const media = Math.round((bucket.sum / bucket.n) * 10) / 10;
      const prev = index > 0 ? byWeek.get(weekKeys[index - 1])! : null;
      const prevMedia = prev ? prev.sum / prev.n : null;
      const tendencia = prevMedia == null ? '—' : media >= prevMedia ? '↑' : media < prevMedia ? '↓' : '—';
      return [weekLabelOf(key), media.toFixed(1), String(bucket.n), tendencia];
    });

    return {
      ...meta,
      id: reportId,
      generatedAt: new Date().toLocaleString('pt-BR'),
      filters: { period: query.period, channel: query.channel, team: query.team },
      summary: [
        { label: 'CSAT médio', value: notaMedia != null ? notaMedia.toFixed(1) : '—' },
        { label: 'Respostas', value: String(responded.length) },
        { label: 'Tickets no período', value: String(chamados.length) },
      ],
      columns: ['Semana', 'CSAT', 'Respostas', 'Tendência'],
      rows,
    };
  }

  if (reportId === 'monitoria') {
    return {
      ...meta,
      id: reportId,
      generatedAt: new Date().toLocaleString('pt-BR'),
      filters: { period: query.period, channel: query.channel, team: query.team },
      summary: [
        { label: 'Score médio', value: '—' },
        { label: 'Avaliações', value: 'Sem dados' },
        { label: 'Feedback pendente', value: '—' },
      ],
      columns: ['Agente', 'Score', 'Avaliações', 'Conformidade', 'Feedback'],
      rows: [],
    };
  }

  if (reportId === 'sla') {
    const rows: string[][] = [];
    const statuses = ['novo', 'em-aberto', 'em-andamento', 'pendente'];
    statuses.forEach((st) => {
      ['email', 'whatsapp', 'portal'].forEach((ch) => {
        const subset = chamados.filter((c) => currentStatus(c) === st && inferChannel(c) === ch);
        if (!subset.length) return;
        const ok = subset.filter((c) => !isSlaAtRisk(c)).length;
        rows.push([
          st,
          ch,
          'N1',
          `${Math.round((ok / subset.length) * 100)}%`,
          '—',
        ]);
      });
    });
    const resolved = chamados.filter((c) => {
      if (currentStatus(c) !== 'resolvido') return false;
      const at = getResolvedAt(c);
      return at ? at >= from && at <= to : false;
    });
    const compliant = resolved.filter((c) => !wasResolvedWithSlaBreach(c)).length;
    return {
      ...meta,
      id: reportId,
      generatedAt: new Date().toLocaleString('pt-BR'),
      filters: { period: query.period, channel: query.channel, team: query.team },
      summary: [
        { label: 'SLA médio', value: resolved.length ? `${Math.round((compliant / resolved.length) * 100)}%` : '—' },
        { label: 'Dentro do prazo', value: String(compliant) },
        { label: 'Fora do prazo', value: String(resolved.length - compliant) },
      ],
      columns: ['Fila', 'Canal', 'Equipe', 'SLA', 'Tempo médio'],
      rows,
    };
  }

  if (reportId === 'volume') {
    const dayMap = new Map<string, { in: number; out: number }>();
    chamados.forEach((c) => {
      const created = c.createdAt ? new Date(c.createdAt) : null;
      if (created && created >= from && created <= to) {
        const k = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(created);
        if (!dayMap.has(k)) dayMap.set(k, { in: 0, out: 0 });
        dayMap.get(k)!.in++;
      }
      const resolvedAt = getResolvedAt(c);
      if (resolvedAt && resolvedAt >= from && resolvedAt <= to) {
        const k = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(resolvedAt);
        if (!dayMap.has(k)) dayMap.set(k, { in: 0, out: 0 });
        dayMap.get(k)!.out++;
      }
    });
    const rows = [...dayMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, v]) => [day, String(v.in), String(v.out), String(Math.max(0, v.in - v.out)), '—']);
    const totalIn = [...dayMap.values()].reduce((s, v) => s + v.in, 0);
    const totalOut = [...dayMap.values()].reduce((s, v) => s + v.out, 0);
    return {
      ...meta,
      id: reportId,
      generatedAt: new Date().toLocaleString('pt-BR'),
      filters: { period: query.period, channel: query.channel, team: query.team },
      summary: [
        { label: 'Entradas', value: String(totalIn) },
        { label: 'Resolvidos', value: String(totalOut) },
        { label: 'Backlog', value: String(Math.max(0, totalIn - totalOut)) },
      ],
      columns: ['Dia', 'Entradas', 'Resolvidos', 'Backlog', 'Variação'],
      rows,
    };
  }

  if (reportId === 'team') {
    const lb = buildReportTeamRows(chamados, from, to);
    return {
      ...meta,
      id: reportId,
      generatedAt: new Date().toLocaleString('pt-BR'),
      filters: { period: query.period, channel: query.channel, team: query.team },
      summary: lb.summary,
      columns: ['Agente', 'Resolvidos', 'TMA', 'TME', 'CSAT'],
      rows: lb.rows,
    };
  }

  return null;
}

function buildReportTeamRows(chamados: IChamadoN1[], from: Date, to: Date) {
  const agents = new Map<string, { name: string; resolved: number; tmaSum: number; tmaN: number; tmeSum: number; tmeN: number; csatSum: number; csatN: number }>();
  chamados.forEach((c) => {
    const resp = (c.tabulacao?.[c.tabulacao.length - 1]?.responsavel ?? '').trim();
    if (!resp) return;
    const key = resp.toLowerCase();
    if (!agents.has(key)) agents.set(key, { name: resp, resolved: 0, tmaSum: 0, tmaN: 0, tmeSum: 0, tmeN: 0, csatSum: 0, csatN: 0 });
    const row = agents.get(key)!;
    if (currentStatus(c) !== 'resolvido') return;
    const resolvedAt = getResolvedAt(c);
    if (!resolvedAt || resolvedAt < from || resolvedAt > to) return;
    row.resolved++;
    const start = c.createdAt ? new Date(c.createdAt) : resolvedAt;
    row.tmaSum += resolvedAt.getTime() - start.getTime();
    row.tmaN++;
    const firstAgent = getFirstAgentResponseAt(c);
    if (firstAgent) {
      row.tmeSum += firstAgent.getTime() - start.getTime();
      row.tmeN++;
    }
    if (c.csat?.respondido && typeof c.csat.nota === 'number') {
      row.csatSum += c.csat.nota;
      row.csatN++;
    }
  });
  const rows = [...agents.values()]
    .filter((a) => a.resolved > 0)
    .sort((a, b) => b.resolved - a.resolved)
    .map((a) => [
      a.name,
      String(a.resolved),
      a.tmaN ? formatDurationMs(a.tmaSum / a.tmaN) : '—',
      a.tmeN ? formatDurationMs(a.tmeSum / a.tmeN) : '—',
      a.csatN ? (Math.round((a.csatSum / a.csatN) * 10) / 10).toFixed(1) : '—',
    ]);
  let tmaAll = 0;
  let tmaN = 0;
  let tmeAll = 0;
  let tmeN = 0;
  agents.forEach((a) => {
    if (a.tmaN) { tmaAll += a.tmaSum / a.tmaN; tmaN++; }
    if (a.tmeN) { tmeAll += a.tmeSum / a.tmeN; tmeN++; }
  });
  const totalResolved = rows.reduce((sum, row) => sum + Number(row[1] || 0), 0);
  return {
    summary: [
      { label: 'TMA médio', value: tmaN ? formatDurationMs(tmaAll / tmaN) : '—' },
      { label: 'TME médio', value: tmeN ? formatDurationMs(tmeAll / tmeN) : '—' },
      { label: 'Tickets/agente', value: agents.size ? String((totalResolved / agents.size).toFixed(1)) : '—' },
    ],
    rows,
  };
}

export async function buildReportPayload(authUser: AuthPayload, query: Workspace360Query) {
  const { from, to } = periodRange(query.period ?? '7d');
  const chamados = await loadSupervisorChamados(from, to);
  const filtered = chamados.filter((c) => channelMatchesFilter(c, query.channel ?? 'all'));
  const reportId = query.report ?? 'sla';
  return buildReport(reportId, filtered, query);
}
