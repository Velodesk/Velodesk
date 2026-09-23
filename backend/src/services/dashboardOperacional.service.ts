/**
 * dashboardOperacional.service v1.1.0 — payload agregado do painel operacional Desk.
 *
 * v1.1.0:
 *  - Separa KPIs em "agora" (snapshot; não filtram por período) e "no período" (filtram
 *    por hoje/ontem/mês/personalizado).
 *  - Alinha a contagem de "fila aberta" com o Desk: exclui canais especiais
 *    (Bacen/RA/Procon/Consumidor.gov) e tickets absorvidos por fusão. Isso corrige o
 *    número enganoso que aparecia no dashboard antes ("128" vs. fila real do Desk).
 *  - Adiciona 5 KPIs de período (criados, resolvidos, TMA, TME, CSAT) além dos 4 snapshot.
 *
 * Composição:
 *  - `getVolumeSummary(query)` (gestaoInsights) — dá `totalAbertos` (criados no período)
 *    e `tmaMedio/tmeMedio` (dos resolvidos no período).
 *  - `buildSupervisor360Payload` — leaderboard, channelVision, escalated (breach).
 *  - `getCsatSummary(query)` — nota média do período.
 *  - `listOnlineEligiblePresenceKeys` — quem tá online agora.
 *  - Uma agregação Mongo local com `$facet` — os 4 contadores snapshot, já com as
 *    exclusões do Desk aplicadas na base.
 */
import type { AuthPayload } from '../middleware/auth';
import { ChamadoN1, type IChamadoN1 } from '../models/ChamadoN1';
import { getWorkflowDefinicaoModel, type IWorkflowPassoConfig } from '../models/WorkflowDefinicao';
import { excludeEspeciaisChannelsMongoFilter } from './chamado.mapper';
import { excludeFusaoAbsorvidosFilter } from './ticketFusao.helpers';
import { buildSupervisor360Payload } from './workspace360.service';
import {
  getCsatSummary,
  resolvePeriodRange,
  type GestaoInsightsQuery,
} from './gestaoInsights.service';
import { listOnlineEligiblePresenceKeys } from './agentPresence.service';

const CACHE_TTL_MS = 60_000;
const SLA_LIMIT_HOURS_BY_STATUS: Record<string, number> = {
  'em-aberto': 4,
  'em-andamento': 8,
};
/** Horizonte do KPI "Vencendo em X" — mesmo prazo do SLA `em-aberto` (4h). */
const VENCENDO_HORIZON_MIN = 4 * 60;

/** Variantes de status que o Desk considera "ativo" (mesmas de STATUS_VARIANTS em chamado.mapper). */
const NOVO_VARIANTS = ['novo'];
const EM_ANDAMENTO_VARIANTS = ['em-andamento', 'em andamento', 'em-aberto', 'em aberto'];
const PENDENTE_VARIANTS = ['pendente'];
const ACTIVE_LAST_STATUS_VARIANTS = [...NOVO_VARIANTS, ...EM_ANDAMENTO_VARIANTS, ...PENDENTE_VARIANTS];

interface SnapshotCounters {
  filaAberta: number;
  naoAtribuidos: number;
  novosNaCaixa: number;
  vencendoEm4h: number;
}

/**
 * Uma agregação Mongo única com `$facet` que devolve os 4 contadores de "snapshot"
 * (estado agora), já aplicando as MESMAS exclusões que a sidebar do Desk faz:
 * canais especiais fora + tickets absorvidos por fusão fora. A base do `$facet` é o
 * conjunto pré-filtrado — cada faceta parte do mesmo universo.
 */
async function loadSnapshotCounters(): Promise<SnapshotCounters> {
  const now = new Date();
  const baseMatch = {
    $and: [
      excludeEspeciaisChannelsMongoFilter(),
      excludeFusaoAbsorvidosFilter(),
      {
        $expr: {
          $in: [
            { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
            ACTIVE_LAST_STATUS_VARIANTS,
          ],
        },
      },
    ],
  };

  const pipeline = [
    { $match: baseMatch },
    {
      $addFields: {
        __lastStatus: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
        __lastRegistroAt: { $arrayElemAt: ['$registro.data', -1] },
        __lastResponsavel: { $arrayElemAt: ['$tabulacao.responsavel', -1] },
      },
    },
    {
      $facet: {
        filaAberta: [{ $count: 'total' }],
        naoAtribuidos: [
          {
            $match: {
              $or: [
                { __lastResponsavel: { $exists: false } },
                { __lastResponsavel: null },
                { __lastResponsavel: '' },
              ],
            },
          },
          { $count: 'total' },
        ],
        novosNaCaixa: [
          { $match: { __lastStatus: { $in: NOVO_VARIANTS } } },
          { $count: 'total' },
        ],
        vencendoEm4h: [
          { $match: { __lastStatus: { $in: EM_ANDAMENTO_VARIANTS } } },
          {
            $addFields: {
              __limitHours: {
                $cond: [
                  { $in: ['$__lastStatus', ['em-aberto', 'em aberto']] },
                  SLA_LIMIT_HOURS_BY_STATUS['em-aberto'],
                  SLA_LIMIT_HOURS_BY_STATUS['em-andamento'],
                ],
              },
              __statusSince: { $ifNull: ['$__lastRegistroAt', '$createdAt'] },
            },
          },
          {
            $addFields: {
              __remainingMin: {
                $subtract: [
                  { $multiply: ['$__limitHours', 60] },
                  { $divide: [{ $subtract: [now, '$__statusSince'] }, 60_000] },
                ],
              },
            },
          },
          { $match: { __remainingMin: { $gte: 0, $lte: VENCENDO_HORIZON_MIN } } },
          { $count: 'total' },
        ],
      },
    },
  ];

  const [result] = await ChamadoN1.aggregate(pipeline);
  return {
    filaAberta: result?.filaAberta?.[0]?.total ?? 0,
    naoAtribuidos: result?.naoAtribuidos?.[0]?.total ?? 0,
    novosNaCaixa: result?.novosNaCaixa?.[0]?.total ?? 0,
    vencendoEm4h: result?.vencendoEm4h?.[0]?.total ?? 0,
  };
}

// ─── Métricas com cancelados EXCLUÍDOS ────────────────────────────────────────
/**
 * O velodesk tem 3 status "terminais": resolvido / fechado / cancelado.
 *   - Resolvido → fechado é uma transição natural (fechamento automático X horas depois de resolver).
 *   - Cancelado é outra coisa: majoritariamente testes/duplicidade — não conta como demanda real.
 * Todos os cards do dashboard excluem cancelados. Os helpers compartilhados
 * (`getVolumeSummary`, `getVolumeSeries`, `getTopMotivosPorProduto`) NÃO são alterados —
 * outras telas do time dependem deles com semântica atual (que inclui cancelados como terminal).
 */
const RESOLVIDO_STATUSES_SEM_CANCELADO = ['resolvido', 'fechado'];
const CANCELADO_STATUSES = ['cancelado'];
// Data de resolução = quando o ticket foi marcado 'resolvido', não quando foi 'fechado'
// (fechamento é encerramento automático ~48h depois; usar 'fechado' aqui faria o TMA/TME
// pular para a data de fechamento em vez da resolução real).
const RESOLVED_STATUS_ONLY = 'resolvido';

/** Contagem de tickets criados no período, EXCLUINDO cancelados. */
async function countCriadosNoPeriodoSemCancelados(start: Date, end: Date): Promise<number> {
  const result = await ChamadoN1.aggregate<{ total: number }>([
    { $match: { createdAt: { $gte: start, $lte: end } } },
    {
      $addFields: {
        __lastStatus: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
      },
    },
    { $match: { __lastStatus: { $nin: CANCELADO_STATUSES } } },
    { $count: 'total' },
  ]);
  return result[0]?.total ?? 0;
}

/** Contagem de tickets encerrados (resolvido/fechado) no período. NÃO conta cancelados. */
async function countResolvidosNoPeriodo(start: Date, end: Date): Promise<number> {
  const result = await ChamadoN1.aggregate<{ total: number }>([
    {
      $match: {
        registro: { $elemMatch: { status: { $in: RESOLVIDO_STATUSES_SEM_CANCELADO } } },
      },
    },
    {
      $addFields: {
        __lastRegistro: { $arrayElemAt: ['$registro', -1] },
      },
    },
    {
      $match: {
        '__lastRegistro.status': { $in: RESOLVIDO_STATUSES_SEM_CANCELADO },
        '__lastRegistro.data': { $gte: start, $lte: end },
      },
    },
    { $count: 'total' },
  ]);
  return result[0]?.total ?? 0;
}

/** TMA e TME (1ª resposta) médios dos tickets **resolvidos/fechados** (sem cancelados) no período.
 *  Replica localmente a lógica do `getVolumeSummary` (mesma agregação Mongo), mas com o filtro
 *  ajustado — evita alterar o service compartilhado, que outras telas usam com o comportamento atual. */
async function computeTmaTmeSemCancelados(
  start: Date,
  end: Date,
): Promise<{ tmaLabel: string; tmaMs: number | null; tmeLabel: string; tmeMs: number | null }> {
  const resolvedAtExpr = {
    $reduce: {
      input: { $ifNull: ['$registro', []] },
      initialValue: null,
      in: {
        $cond: [
          { $eq: ['$$this.status', RESOLVED_STATUS_ONLY] },
          '$$this.data',
          '$$value',
        ],
      },
    },
  };
  const firstResponseExpr = {
    $reduce: {
      input: { $ifNull: ['$registro', []] },
      initialValue: null,
      in: {
        $cond: [
          { $ne: ['$$value', null] },
          '$$value',
          {
            $cond: [
              {
                $and: [
                  { $eq: ['$$this.origin', 'agente'] },
                  { $ne: [{ $trim: { input: { $ifNull: ['$$this.mensagemPublica', ''] } } }, ''] },
                ],
              },
              '$$this.data',
              null,
            ],
          },
        ],
      },
    },
  };

  const [row] = await ChamadoN1.aggregate<{ tmaSum: number; tmaN: number; tmeSum: number; tmeN: number }>([
    { $match: { 'registro.data': { $gte: start, $lte: end } } },
    { $addFields: { __resolvedAt: resolvedAtExpr, __firstResp: firstResponseExpr } },
    { $match: { __resolvedAt: { $gte: start, $lte: end } } },
    { $addFields: { __createdEff: { $ifNull: ['$createdAt', '$__resolvedAt'] } } },
    {
      $group: {
        _id: null,
        tmaSum: { $sum: { $subtract: ['$__resolvedAt', '$__createdEff'] } },
        tmaN: { $sum: 1 },
        tmeSum: {
          $sum: {
            $cond: [
              { $ne: ['$__firstResp', null] },
              { $subtract: ['$__firstResp', '$__createdEff'] },
              0,
            ],
          },
        },
        tmeN: { $sum: { $cond: [{ $ne: ['$__firstResp', null] }, 1, 0] } },
      },
    },
  ]);

  const tmaMs = row && row.tmaN > 0 ? row.tmaSum / row.tmaN : null;
  const tmeMs = row && row.tmeN > 0 ? row.tmeSum / row.tmeN : null;
  return {
    tmaMs,
    tmeMs,
    tmaLabel: tmaMs != null ? formatDurationMs(tmaMs) : '—',
    tmeLabel: tmeMs != null ? formatDurationMs(tmeMs) : '—',
  };
}

/** Formata ms como "M:SS" ou "H:MM:SS". Mesma regra do `formatDurationMs` compartilhado
 *  (evitando importar do supervisor360 pra não pegar dep pesada só por isso). */
function formatDurationMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Série diária (abertos por createdAt + encerrados por resolvedAt + notaMedia CSAT), EXCLUINDO
 *  cancelados nas contagens de abertos/encerrados. `notaMedia` é intocada — CSAT já ignora
 *  cancelamentos por definição (só conta pesquisas respondidas). */
async function loadSerieSemCancelados(
  start: Date,
  end: Date,
): Promise<Array<{ date: string; label: string; abertos: number; encerrados: number; notaMedia: number | null }>> {
  const resolvedAtExpr = {
    $reduce: {
      input: { $ifNull: ['$registro', []] },
      initialValue: null,
      in: {
        $cond: [
          { $eq: ['$$this.status', RESOLVED_STATUS_ONLY] },
          '$$this.data',
          '$$value',
        ],
      },
    },
  };
  const dayKeyExprLocal = (dateExpr: unknown) => ({
    $dateToString: { format: '%Y-%m-%d', date: dateExpr, timezone: 'America/Sao_Paulo' },
  });

  const [abertosRows, encerradosRows, csatRows] = await Promise.all([
    ChamadoN1.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $addFields: {
          __lastStatus: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
        },
      },
      { $match: { __lastStatus: { $nin: CANCELADO_STATUSES } } },
      { $group: { _id: dayKeyExprLocal('$createdAt'), n: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{ _id: string; n: number }>([
      { $match: { 'registro.data': { $gte: start, $lte: end } } },
      { $addFields: { __resolvedAt: resolvedAtExpr } },
      { $match: { __resolvedAt: { $gte: start, $lte: end } } },
      { $group: { _id: dayKeyExprLocal('$__resolvedAt'), n: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{ _id: string; avgNota: number }>([
      {
        $match: {
          'csat.respondido': true,
          'csat.respondidoEm': { $gte: start, $lte: end },
        },
      },
      { $group: { _id: dayKeyExprLocal('$csat.respondidoEm'), avgNota: { $avg: '$csat.nota' } } },
    ]),
  ]);

  // Reconstrói série contínua por dia
  const days: Array<{ date: string; label: string; abertos: number; encerrados: number; notaMedia: number | null }> = [];
  const cursor = new Date(start);
  const abertosMap = new Map(abertosRows.map((r) => [r._id, r.n]));
  const encerradosMap = new Map(encerradosRows.map((r) => [r._id, r.n]));
  const csatMap = new Map(csatRows.map((r) => [r._id, Math.round(r.avgNota * 10) / 10]));
  while (cursor <= end) {
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(cursor);
    const label = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    }).format(cursor);
    days.push({
      date: key,
      label,
      abertos: abertosMap.get(key) ?? 0,
      encerrados: encerradosMap.get(key) ?? 0,
      notaMedia: csatMap.get(key) ?? null,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

// ─── Workflow pendencies ───────────────────────────────────────────────────────
/**
 * Cross-database: `workflow_definicoes` vive em `desk_config`, e `chamados_n1` em `b2c_chamados`.
 * Mongo $lookup não cruza databases, então fazemos: (1) fetch das definições ativas (~10 docs)
 * (2) fetch dos chamados em workflow ativo (dezenas), (3) merge em memória.
 */
export type WorkflowClassificacao = 'no-prazo' | 'atrasado' | 'sem-prazo';

interface WorkflowPendingTicket {
  id: string;
  protocolo: string;
  subject: string;
  passoNome: string;
  area: string;
  classificacao: WorkflowClassificacao;
  atrasoMs: number | null;
  restanteMs: number | null;
}

export interface WorkflowAreaTicketDetalhe {
  id: string;
  protocolo: string;
  subject: string;
  passoNome: string;
  classificacao: WorkflowClassificacao;
  /** minutos de atraso (positivo). Só para classificacao=atrasado. */
  atrasoMin: number | null;
  /** minutos restantes até vencer. Só para classificacao=no-prazo. */
  restanteMin: number | null;
}

export interface WorkflowAreaSummary {
  area: string;
  total: number;
  noPrazo: number;
  atrasados: number;
  semPrazo: number;
  /** Todos os tickets pendentes da área (limitado a 50 por área). Ordenados:
   *  atrasados por atraso desc → no-prazo por menor restante → sem-prazo. */
  tickets: WorkflowAreaTicketDetalhe[];
  ticketsExibidos: number;
}

export interface WorkflowPendenciesPayload {
  total: number;
  noPrazo: number;
  atrasados: number;
  semPrazo: number;
  porArea: WorkflowAreaSummary[];
}

const WORKFLOW_TERMINAL_STATUSES = new Set(['resolvido', 'cancelado', 'fechado']);

interface PassoInfo {
  nome: string;
  slaHoras: number | null;
  atribuicao?: IWorkflowPassoConfig['atribuicao'];
}

interface DefinitionInfo {
  titulo: string;
  passos: Map<string, PassoInfo>;
}

async function fetchWorkflowDefinitionsMap(): Promise<Map<string, DefinitionInfo>> {
  const Model = getWorkflowDefinicaoModel();
  const definitions = await Model.find({}, { titulo: 1, passos: 1 }).lean();
  const map = new Map<string, DefinitionInfo>();
  for (const def of definitions) {
    const passos = new Map<string, PassoInfo>();
    for (const envelope of def.passos ?? []) {
      if (!envelope?._id) continue;
      const cfg = envelope.passo;
      passos.set(String(envelope._id), {
        nome: cfg?.nome ?? '',
        slaHoras: cfg?.slaHoras ?? null,
        atribuicao: cfg?.atribuicao,
      });
    }
    map.set(String(def._id), { titulo: def.titulo ?? '', passos });
  }
  return map;
}

/** Deriva a "área" responsável agora a partir do prefixo `funcao:` da tabulação, com fallbacks
 *  no passo config (tipo colaborador/responsavel_ticket/funcaoSlug/grupoSlug). */
function deriveAreaSlug(chamado: IChamadoN1, passo: PassoInfo | undefined): string {
  const rawAtribuido = String(chamado.tabulacao?.[0]?.atribuido ?? '').trim();
  if (rawAtribuido.startsWith('funcao:')) {
    return rawAtribuido.slice('funcao:'.length).trim().toLowerCase() || '__nao_identificado__';
  }
  const atrib = passo?.atribuicao;
  if (atrib?.tipo === 'colaborador') return '__colaborador__';
  if (atrib?.tipo === 'responsavel_ticket') return '__responsavel_ticket__';
  if (atrib?.funcaoSlug) return atrib.funcaoSlug.trim().toLowerCase();
  if (atrib?.grupoSlug) return atrib.grupoSlug.trim().toLowerCase();
  return '__nao_identificado__';
}

/** Marco temporal do passo atual: última entrada de `registro[]` cujo
 *  `metadados.workflowAdvance.passoId === passoIdStr`. Fallback: `workflow.startedAt`. */
function derivePassoStartedAt(chamado: IChamadoN1, passoIdStr: string): Date | null {
  const regs = chamado.registro ?? [];
  for (let i = regs.length - 1; i >= 0; i--) {
    const reg = regs[i];
    const advPasso = (reg as { metadados?: { workflowAdvance?: { passoId?: unknown } } })
      ?.metadados?.workflowAdvance?.passoId;
    if (advPasso && String(advPasso) === passoIdStr) {
      return reg.data ? new Date(reg.data) : null;
    }
  }
  if (chamado.workflow?.startedAt) return new Date(chamado.workflow.startedAt);
  return null;
}

const MAX_TICKETS_POR_AREA = 50;

/** Peso de ordenação: atrasado < no-prazo < sem-prazo (menor = aparece primeiro). */
const CLASSIFICACAO_ORDEM: Record<WorkflowClassificacao, number> = {
  'atrasado': 0,
  'no-prazo': 1,
  'sem-prazo': 2,
};

function compareTickets(a: WorkflowPendingTicket, b: WorkflowPendingTicket): number {
  const wA = CLASSIFICACAO_ORDEM[a.classificacao];
  const wB = CLASSIFICACAO_ORDEM[b.classificacao];
  if (wA !== wB) return wA - wB;
  if (a.classificacao === 'atrasado') return (b.atrasoMs ?? 0) - (a.atrasoMs ?? 0);
  if (a.classificacao === 'no-prazo') return (a.restanteMs ?? Infinity) - (b.restanteMs ?? Infinity);
  return 0;
}

async function loadWorkflowPendencies(): Promise<WorkflowPendenciesPayload> {
  const [defMap, chamados] = await Promise.all([
    fetchWorkflowDefinitionsMap(),
    ChamadoN1.find({
      'workflow.active': true,
      'workflow.workflowStatus': { $nin: ['finished', 'cancel'] },
      'workflow.workflowId': { $ne: null },
    })
      .select('chamadoProtocolo chamadoTitulo workflow tabulacao registro')
      .lean<IChamadoN1[]>(),
  ]);

  const now = Date.now();
  const totals = { total: 0, noPrazo: 0, atrasados: 0, semPrazo: 0 };
  const byArea = new Map<string, { area: string; total: number; noPrazo: number; atrasados: number; semPrazo: number; pool: WorkflowPendingTicket[] }>();

  for (const chamado of chamados) {
    // Exclui tickets em status terminal (predicado de `isWorkflowOperable`).
    const lastStatus = chamado.registro?.[chamado.registro.length - 1]?.status ?? 'novo';
    if (WORKFLOW_TERMINAL_STATUSES.has(lastStatus)) continue;

    const wf = chamado.workflow;
    if (!wf?.workflowId) continue;
    const wfIdStr = String(wf.workflowId);
    const passoIdStr = wf.passoId ? String(wf.passoId) : '';
    const defInfo = defMap.get(wfIdStr);
    const passo = passoIdStr ? defInfo?.passos.get(passoIdStr) : undefined;

    const slaHoras = passo?.slaHoras ?? null;
    const passoStartedAt = passoIdStr ? derivePassoStartedAt(chamado, passoIdStr) : null;

    let classificacao: WorkflowClassificacao;
    let atrasoMs: number | null = null;
    let restanteMs: number | null = null;
    if (slaHoras == null || passoStartedAt == null) {
      classificacao = 'sem-prazo';
    } else {
      const deadline = passoStartedAt.getTime() + slaHoras * 3_600_000;
      if (now > deadline) {
        classificacao = 'atrasado';
        atrasoMs = now - deadline;
      } else {
        classificacao = 'no-prazo';
        restanteMs = deadline - now;
      }
    }

    const area = deriveAreaSlug(chamado, passo);
    const entry: WorkflowPendingTicket = {
      id: String((chamado as unknown as { _id: unknown })._id),
      protocolo: chamado.chamadoProtocolo ?? '',
      subject: chamado.chamadoTitulo ?? '',
      passoNome: passo?.nome ?? '',
      area,
      classificacao,
      atrasoMs,
      restanteMs,
    };

    totals.total += 1;
    if (classificacao === 'no-prazo') totals.noPrazo += 1;
    else if (classificacao === 'atrasado') totals.atrasados += 1;
    else totals.semPrazo += 1;

    if (!byArea.has(area)) {
      byArea.set(area, { area, total: 0, noPrazo: 0, atrasados: 0, semPrazo: 0, pool: [] });
    }
    const bucket = byArea.get(area)!;
    bucket.total += 1;
    if (classificacao === 'no-prazo') bucket.noPrazo += 1;
    else if (classificacao === 'atrasado') bucket.atrasados += 1;
    else bucket.semPrazo += 1;
    bucket.pool.push(entry);
  }

  const porArea: WorkflowAreaSummary[] = [...byArea.values()]
    .map(({ pool, ...rest }) => {
      const sorted = pool.sort(compareTickets).slice(0, MAX_TICKETS_POR_AREA);
      const tickets: WorkflowAreaTicketDetalhe[] = sorted.map((t) => ({
        id: t.id,
        protocolo: t.protocolo,
        subject: t.subject,
        passoNome: t.passoNome,
        classificacao: t.classificacao,
        atrasoMin: t.atrasoMs != null ? Math.round(t.atrasoMs / 60_000) : null,
        restanteMin: t.restanteMs != null ? Math.round(t.restanteMs / 60_000) : null,
      }));
      return { ...rest, tickets, ticketsExibidos: tickets.length };
    })
    .sort((a, b) => b.atrasados - a.atrasados || b.total - a.total);

  return { ...totals, porArea };
}

export interface DashboardOperacionalPayload {
  updatedAt: string;
  periodo: { label: string; startIso: string; endIso: string };
  /** Estado atual — não afetado pelo filtro de período. */
  agora: {
    filaAberta: number;
    naoAtribuidos: number;
    novosNaCaixa: number;
    vencendoEm4h: number;
    slaCritical: number;
    warRoom: boolean;
  };
  /** Agregações do período selecionado. */
  noPeriodo: {
    criados: number;
    resolvidos: number;
    tmaLabel: string;
    tmaMs: number | null;
    tmeLabel: string;
    tmeMs: number | null;
    csatMedio: number | null;
    slaPct: number;
  };
  channelVision: unknown;
  leaderboard: unknown;
  breachTickets: unknown[];
  agentsOnline: string[];
  workflow: WorkflowPendenciesPayload;
}

/** Traduz `period` do frontend (hoje/ontem/mes/personalizado) → vocabulário do
 *  supervisor360 (today/month/…), pra alinhar as janelas de leaderboard/channelVision. */
function toSupervisor360Period(period?: string): string {
  if (period === 'hoje') return 'today';
  if (period === 'mes') return 'month';
  return '7d';
}

function labelForPeriod(period?: string, from?: string, to?: string): string {
  if (period === 'hoje') return 'Hoje';
  if (period === 'ontem') return 'Ontem';
  if (period === 'mes') return 'Este mês';
  if (period === 'personalizado' && from && to) return `${from} até ${to}`;
  return 'Últimos 7 dias';
}

async function computeDashboardOperacional(
  authUser: AuthPayload,
  query: GestaoInsightsQuery,
): Promise<DashboardOperacionalPayload> {
  const supervisor360Period = toSupervisor360Period(query.period);
  const range = resolvePeriodRange(query);

  const [
    supervisor360,
    csatSummary,
    onlineKeys,
    snapshot,
    criados,
    resolvidos,
    tempos,
    workflow,
  ] = await Promise.all([
    buildSupervisor360Payload(authUser, {
      period: supervisor360Period,
      leaderboardPeriod: supervisor360Period,
      leaderboardFrom: query.from,
      leaderboardTo: query.to,
    }),
    getCsatSummary(query),
    listOnlineEligiblePresenceKeys(),
    loadSnapshotCounters(),
    countCriadosNoPeriodoSemCancelados(range.start, range.end),
    countResolvidosNoPeriodo(range.start, range.end),
    computeTmaTmeSemCancelados(range.start, range.end),
    loadWorkflowPendencies(),
  ]);

  const breachTickets =
    supervisor360.escalated?.groups?.find((g: { id: string }) => g.id === 'sla-critico')?.entries?.map(
      (entry: { ticket: unknown }) => entry.ticket,
    ) ?? [];

  const kpis = supervisor360.kpis ?? {};

  return {
    updatedAt: new Date().toISOString(),
    periodo: {
      label: labelForPeriod(query.period, query.from, query.to),
      startIso: range.start.toISOString(),
      endIso: range.end.toISOString(),
    },
    agora: {
      filaAberta: snapshot.filaAberta,
      naoAtribuidos: snapshot.naoAtribuidos,
      novosNaCaixa: snapshot.novosNaCaixa,
      vencendoEm4h: snapshot.vencendoEm4h,
      slaCritical: supervisor360.escalated?.slaCriticalCount ?? 0,
      warRoom: kpis.warRoom ?? false,
    },
    noPeriodo: {
      criados,
      resolvidos,
      tmaLabel: tempos.tmaLabel,
      tmaMs: tempos.tmaMs,
      tmeLabel: tempos.tmeLabel,
      tmeMs: tempos.tmeMs,
      csatMedio: typeof csatSummary?.notaMedia === 'number' ? csatSummary.notaMedia : null,
      slaPct: Number(kpis.slaPct ?? 0),
    },
    channelVision: supervisor360.channelVision,
    leaderboard: supervisor360.leaderboard,
    breachTickets,
    agentsOnline: onlineKeys,
    workflow,
  };
}

/** Chave de cache = userId + período (hoje/ontem/mês/personalizado com range). */
function cacheKey(authUser: AuthPayload, query: GestaoInsightsQuery): string {
  return JSON.stringify({
    u: String(authUser.userId ?? 'anonymous'),
    p: query.period ?? '7d',
    f: query.from ?? null,
    t: query.to ?? null,
  });
}

const payloadCache = new Map<string, { at: number; promise: Promise<DashboardOperacionalPayload> }>();

// ─── Trend (gráfico 7d + top motivos) ─────────────────────────────────────────
/**
 * Payload separado do "bloco de tendência" — série de volume/CSAT + top motivos, com filtro
 * de período próprio (independente do filtro do painel principal). Exclui cancelados do top
 * motivos (motivo de ticket cancelado costuma ser engano/duplicidade e distorce o ranking).
 */
export interface DashboardTrendPayload {
  updatedAt: string;
  periodo: { label: string; startIso: string; endIso: string };
  serie: Array<{ date: string; label: string; abertos: number; notaMedia: number | null }>;
  motivos: {
    items: Array<{ produto: string; motivo: string; count: number; pct: number }>;
    totalTabulado: number;
    totalCriado: number;
    canceladosExcluidos: number;
  };
}

function labelForTrendPeriod(period?: string, from?: string, to?: string): string {
  if (period === 'hoje') return 'Hoje';
  if (period === 'ontem') return 'Ontem';
  if (period === 'mes') return 'Este mês';
  if (period === 'personalizado' && from && to) return `${from} até ${to}`;
  return 'Últimos 7 dias';
}

/** Top motivos EXCLUINDO cancelados. Fórmula igual à `getTopMotivosPorProduto`, mas filtra
 *  tickets cujo último status é `cancelado`. Também devolve os totais brutos pra o card
 *  mostrar "N tabulados de M criados". */
async function loadTopMotivosSemCancelados(
  start: Date,
  end: Date,
  limit: number,
): Promise<DashboardTrendPayload['motivos']> {
  const CANCELADO_STATUSES = ['cancelado'];
  const [rows, totals] = await Promise.all([
    ChamadoN1.aggregate<{ _id: { produto: string; motivo: string }; count: number }>([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $addFields: {
          __lastStatus: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
          __tab: { $arrayElemAt: [{ $ifNull: ['$tabulacao', []] }, -1] },
        },
      },
      { $match: { __lastStatus: { $nin: CANCELADO_STATUSES } } },
      {
        $addFields: {
          __produto: { $trim: { input: { $ifNull: ['$__tab.produto', ''] } } },
          __motivo: { $trim: { input: { $ifNull: ['$__tab.motivo', ''] } } },
        },
      },
      { $match: { __produto: { $ne: '' }, __motivo: { $ne: '' } } },
      { $group: { _id: { produto: '$__produto', motivo: '$__motivo' }, count: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{ _id: null; totalCriado: number; canceladosExcluidos: number }>([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      {
        $addFields: {
          __lastStatus: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] },
        },
      },
      {
        $group: {
          _id: null,
          totalCriado: { $sum: 1 },
          canceladosExcluidos: {
            $sum: { $cond: [{ $in: ['$__lastStatus', CANCELADO_STATUSES] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  let totalTabulado = 0;
  const counts: Array<{ produto: string; motivo: string; count: number; pct: number }> = [];
  for (const row of rows) {
    const produto = String(row._id.produto ?? '').trim();
    const motivo = String(row._id.motivo ?? '').trim();
    if (!produto || !motivo) continue;
    totalTabulado += row.count;
    counts.push({ produto, motivo, count: row.count, pct: 0 });
  }

  const items = counts
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      pct: totalTabulado > 0 ? Math.round((entry.count / totalTabulado) * 1000) / 10 : 0,
    }));

  return {
    items,
    totalTabulado,
    totalCriado: totals[0]?.totalCriado ?? 0,
    canceladosExcluidos: totals[0]?.canceladosExcluidos ?? 0,
  };
}

async function computeDashboardTrend(query: GestaoInsightsQuery): Promise<DashboardTrendPayload> {
  const effectiveQuery: GestaoInsightsQuery = query.period
    ? query
    : { period: '7d' };
  const range = resolvePeriodRange(effectiveQuery);

  const [serie, motivos] = await Promise.all([
    loadSerieSemCancelados(range.start, range.end),
    loadTopMotivosSemCancelados(range.start, range.end, 3),
  ]);

  return {
    updatedAt: new Date().toISOString(),
    periodo: {
      label: labelForTrendPeriod(effectiveQuery.period, effectiveQuery.from, effectiveQuery.to),
      startIso: range.start.toISOString(),
      endIso: range.end.toISOString(),
    },
    serie: serie.map((d) => ({
      date: d.date,
      label: d.label,
      abertos: d.abertos,
      notaMedia: d.notaMedia,
    })),
    motivos,
  };
}

const trendCache = new Map<string, { at: number; promise: Promise<DashboardTrendPayload> }>();

export async function getDashboardTrend(query: GestaoInsightsQuery = {}): Promise<DashboardTrendPayload> {
  const key = JSON.stringify({ p: query.period ?? '7d', f: query.from ?? null, t: query.to ?? null });
  const now = Date.now();
  const cached = trendCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = computeDashboardTrend(query);
  trendCache.set(key, { at: now, promise });
  try {
    return await promise;
  } catch (err) {
    trendCache.delete(key);
    throw err;
  }
}

export async function getDashboardOperacional(
  authUser: AuthPayload,
  query: GestaoInsightsQuery = {},
): Promise<DashboardOperacionalPayload> {
  const key = cacheKey(authUser, query);
  const now = Date.now();
  const cached = payloadCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = computeDashboardOperacional(authUser, query);
  payloadCache.set(key, { at: now, promise });
  try {
    return await promise;
  } catch (err) {
    payloadCache.delete(key);
    throw err;
  }
}
