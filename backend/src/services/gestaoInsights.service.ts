/**
 * gestaoInsights.service v1.1.0 — cards analíticos da Gestão
 * Volume diário (abertos/encerrados) + nota média, top motivos por produto e casos especiais.
 * v1.1.0: volume/resumo/motivos movidos para agregação no MongoDB (mesma semântica dos
 * helpers JS abaixo) + índices createdAt/registro.data — elimina varredura de coleção.
 */
import { ChamadoN1, IChamadoN1 } from '../models/ChamadoN1';
import {
  bacenChannelMongoFilter,
  consumidorGovChannelMongoFilter,
  proconChannelMongoFilter,
  reclameAquiChannelMongoFilter,
} from './chamado.mapper';

const TZ = 'America/Sao_Paulo';
// Data de resolução = quando o ticket foi marcado 'resolvido', não quando foi 'fechado'
// (fechamento é apenas encerramento automático ~48h depois, sem relação com o SLA de resolução).
const RESOLVED_STATUS = 'resolvido';

/**
 * Expressões de agregação que espelham EXATAMENTE os helpers JS abaixo, para permitir
 * mover as contagens/somatórios para o MongoDB sem alterar os números entregues:
 * - `resolvedAtExpr`  === getResolvedAt (último registro com status 'resolvido', na ordem do array)
 * - `firstResponseExpr` === getFirstAgentResponseAt (1ª resposta pública do atendente)
 * - `lastStatusExpr`  === lastStatus (status do último registro, '' ou vazio => 'novo')
 */
const resolvedAtExpr = {
  $reduce: {
    input: { $ifNull: ['$registro', []] },
    initialValue: null,
    in: {
      $cond: [
        { $eq: ['$$this.status', RESOLVED_STATUS] },
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

const lastStatusExpr = {
  $let: {
    vars: {
      // $ifNull externo coage "missing" (array vazio => arrayElemAt sem resultado) para null.
      s: { $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$registro.status', []] }, -1] }, null] },
    },
    in: {
      $cond: [
        { $or: [{ $eq: ['$$s', null] }, { $eq: ['$$s', ''] }] },
        'novo',
        '$$s',
      ],
    },
  },
};

/** dayKey (YYYY-MM-DD no fuso da Gestão) para uma expressão de data em agregação. */
function dayKeyExpr(dateExpr: unknown) {
  return { $dateToString: { format: '%Y-%m-%d', date: dateExpr, timezone: TZ } };
}

export interface GestaoInsightsQuery {
  period?: string;
  from?: string;
  to?: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export function dayKey(date: Date, tz = TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

function startOfDayInTz(date: Date): Date {
  return new Date(`${dayKey(date)}T00:00:00-03:00`);
}

function endOfDayInTz(date: Date): Date {
  return new Date(`${dayKey(date)}T23:59:59.999-03:00`);
}

/**
 * Resolve o intervalo de datas a partir do período informado (hoje | ontem | mes | personalizado).
 * `7d` é um período interno usado apenas como estado inicial do card de volume (não exposto como pill).
 * Padrão (sem período válido): mês corrente.
 */
export function resolvePeriodRange(query: GestaoInsightsQuery = {}): DateRange {
  const period = String(query.period ?? 'mes').trim().toLowerCase();
  const now = new Date();

  if (period === '7d') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { start: startOfDayInTz(start), end: endOfDayInTz(now) };
  }

  if (period === 'hoje') {
    return { start: startOfDayInTz(now), end: endOfDayInTz(now) };
  }

  if (period === 'ontem') {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return { start: startOfDayInTz(yesterday), end: endOfDayInTz(yesterday) };
  }

  if (period === 'personalizado' && query.from && query.to) {
    const start = startOfDayInTz(new Date(query.from));
    const end = endOfDayInTz(new Date(query.to));
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start <= end) {
      return { start, end };
    }
  }

  const start = new Date(now);
  start.setDate(1);
  return { start: startOfDayInTz(start), end: endOfDayInTz(now) };
}

/** Sequência de chaves de dia (YYYY-MM-DD) entre start e end, inclusive. */
export function dayKeysBetween(range: DateRange): string[] {
  const keys: string[] = [];
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys.length ? keys : [dayKey(range.start)];
}

/** Chave de mês (YYYY-MM) no fuso da Gestão — usada na visão "mês fechado" dos gráficos. */
export function monthKey(date: Date, tz = TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(date);
}

const MONTH_LABELS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export function labelForMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const idx = Math.min(11, Math.max(0, (m || 1) - 1));
  return `${MONTH_LABELS_PT[idx]}/${String(y).slice(-2)}`;
}

/** Sequência de chaves de mês (YYYY-MM) entre start e end, inclusive — dedup por dia para evitar armadilhas de calendário/DST. */
export function monthKeysBetween(range: DateRange): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const cursor = new Date(range.start);
  while (cursor <= range.end) {
    const key = monthKey(cursor);
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys.length ? keys : [monthKey(range.start)];
}

/** Granularidade de exibição dos gráficos da Gestão: dia a dia ou mês fechado (jan/fev/mar…). */
export type ChartGranularity = 'dia' | 'mes';

export function resolveGranularity(query: { granularity?: string } = {}): ChartGranularity {
  return query.granularity === 'mes' ? 'mes' : 'dia';
}

/**
 * Intervalo de datas usado para montar a série do gráfico, considerando a granularidade:
 * - `dia`: respeita o período selecionado (Hoje/Ontem/Mês/Personalizado), como já era.
 * - `mes`: ignora o período diário e sempre mostra o ano corrente (jan → mês atual), permitindo
 *   comparar "mês fechado" contra mês fechado.
 */
export function resolveSeriesRange(query: GestaoInsightsQuery & { granularity?: string } = {}): {
  range: DateRange;
  granularity: ChartGranularity;
} {
  const granularity = resolveGranularity(query);
  const range = granularity === 'mes' ? getCurrentYearRange() : resolvePeriodRange(query);
  return { range, granularity };
}

export type ComparisonMode = 'mom' | 'yoy';

/**
 * Deriva o período anterior equivalente para comparação:
 * - `yoy`: mesmo intervalo de datas, um ano antes.
 * - `mom`: intervalo de mesma duração, imediatamente anterior ao início do período atual
 *   (aproxima "mês anterior" para o período "Mês" e mantém a lógica consistente para
 *   qualquer outro período — Hoje/Ontem/Personalizado).
 */
export function resolveComparisonRange(range: DateRange, mode: ComparisonMode): DateRange {
  if (mode === 'yoy') {
    const start = new Date(range.start);
    start.setFullYear(start.getFullYear() - 1);
    const end = new Date(range.end);
    end.setFullYear(end.getFullYear() - 1);
    return { start, end };
  }

  const spanMs = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime() - 1000);
  const start = new Date(end.getTime() - spanMs);
  return { start: startOfDayInTz(start), end: endOfDayInTz(end) };
}

/** Início/fim do mês e do ano corrente (usados nos totais compactos dos cards de detalhe). */
export function getCurrentMonthRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: startOfDayInTz(start), end: endOfDayInTz(now) };
}

export function getCurrentYearRange(): DateRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return { start: startOfDayInTz(start), end: endOfDayInTz(now) };
}

function getResolvedAt(chamado: IChamadoN1): Date | null {
  const regs = chamado.registro ?? [];
  for (let i = regs.length - 1; i >= 0; i--) {
    if (regs[i].status === RESOLVED_STATUS) return new Date(regs[i].data);
  }
  return null;
}

/** Primeira resposta pública do atendente (usada no prazo de 1ª resposta). */
function getFirstAgentResponseAt(chamado: IChamadoN1): Date | null {
  for (const reg of chamado.registro ?? []) {
    if (reg.origin === 'agente' && String(reg.mensagemPublica ?? '').trim()) {
      return new Date(reg.data);
    }
  }
  return null;
}

function formatDurationMs(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function labelForDay(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
}

export interface VolumeSeriesDay {
  date: string;
  label: string;
  abertos: number;
  encerrados: number;
  /** Nota média de CSAT das respostas recebidas naquele dia; null se ninguém respondeu. */
  notaMedia: number | null;
}

export interface VolumeSeriesResult {
  range: { start: string; end: string };
  series: VolumeSeriesDay[];
  granularity: ChartGranularity;
  mock: { notaMedia: false };
}

/** Agrega uma série diária em buckets de mês fechado (soma para contagens, média para a nota). */
function aggregateVolumeByMonth(daily: VolumeSeriesDay[]): VolumeSeriesDay[] {
  const buckets = new Map<string, { abertos: number; encerrados: number; notaSum: number; notaN: number }>();
  const order: string[] = [];
  daily.forEach((day) => {
    const key = monthKey(new Date(`${day.date}T12:00:00`));
    if (!buckets.has(key)) {
      buckets.set(key, { abertos: 0, encerrados: 0, notaSum: 0, notaN: 0 });
      order.push(key);
    }
    const bucket = buckets.get(key)!;
    bucket.abertos += day.abertos;
    bucket.encerrados += day.encerrados;
    if (day.notaMedia != null) {
      bucket.notaSum += day.notaMedia;
      bucket.notaN += 1;
    }
  });
  return order.map((key) => {
    const bucket = buckets.get(key)!;
    return {
      date: key,
      label: labelForMonth(key),
      abertos: bucket.abertos,
      encerrados: bucket.encerrados,
      notaMedia: bucket.notaN > 0 ? Math.round((bucket.notaSum / bucket.notaN) * 10) / 10 : null,
    };
  });
}

/**
 * Volume de tickets abertos/encerrados no período + nota média real de CSAT (respostas
 * recebidas no dia). `granularity=dia` (padrão) respeita o período selecionado;
 * `granularity=mes` sempre mostra os meses fechados do ano corrente (jan, fev, mar…),
 * permitindo comparar mês a mês.
 */
export async function getVolumeSeries(
  query: GestaoInsightsQuery & { granularity?: string } = {},
): Promise<VolumeSeriesResult> {
  const { range, granularity } = resolveSeriesRange(query);
  const keys = dayKeysBetween(range);

  const abertosMap = new Map<string, number>(keys.map((k) => [k, 0]));
  const encerradosMap = new Map<string, number>(keys.map((k) => [k, 0]));
  const notaMediaMap = new Map<string, number>(); // sem entrada = sem resposta naquele dia

  // Contagens feitas no MongoDB (índices createdAt / registro.data / csat.respondidoEm),
  // sem transferir os arrays `registro` de todos os chamados do período. Mantém a mesma
  // semântica do JS: abertos = por dia de createdAt; encerrados = por dia do último
  // registro terminal; notaMedia = média de csat.nota por dia de csat.respondidoEm.
  const [abertosRows, encerradosRows, csatRows] = await Promise.all([
    ChamadoN1.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
      { $group: { _id: dayKeyExpr('$createdAt'), n: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{ _id: string; n: number }>([
      { $match: { 'registro.data': { $gte: range.start, $lte: range.end } } },
      { $addFields: { __resolvedAt: resolvedAtExpr } },
      { $match: { __resolvedAt: { $gte: range.start, $lte: range.end } } },
      { $group: { _id: dayKeyExpr('$__resolvedAt'), n: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{ _id: string; avgNota: number }>([
      {
        $match: {
          'csat.respondido': true,
          'csat.respondidoEm': { $gte: range.start, $lte: range.end },
        },
      },
      { $group: { _id: dayKeyExpr('$csat.respondidoEm'), avgNota: { $avg: '$csat.nota' } } },
    ]),
  ]);

  abertosRows.forEach((row) => {
    if (abertosMap.has(row._id)) abertosMap.set(row._id, row.n);
  });
  encerradosRows.forEach((row) => {
    if (encerradosMap.has(row._id)) encerradosMap.set(row._id, row.n);
  });
  csatRows.forEach((row) => {
    notaMediaMap.set(row._id, Math.round(row.avgNota * 10) / 10);
  });

  const dailySeries: VolumeSeriesDay[] = keys.map((key) => ({
    date: key,
    label: labelForDay(key),
    abertos: abertosMap.get(key) ?? 0,
    encerrados: encerradosMap.get(key) ?? 0,
    notaMedia: notaMediaMap.get(key) ?? null,
  }));

  const series = granularity === 'mes' ? aggregateVolumeByMonth(dailySeries) : dailySeries;

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    series,
    granularity,
    mock: { notaMedia: false },
  };
}

/** Status considerados "Em Aberto" para os cards de resumo (não inclui o status literal `em-aberto`, a pedido). */
const EM_ABERTO_STATUSES = ['novo', 'em-andamento', 'pendente'];

function lastStatus(chamado: IChamadoN1): string {
  const regs = chamado.registro ?? [];
  return regs.length ? regs[regs.length - 1].status || 'novo' : 'novo';
}

/** Filtro Mongo — chamados cujo último status esteja entre os informados. */
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

export interface OldestAbertoEntry {
  id: string;
  protocolo: string;
  titulo: string;
  produto: string;
  motivo: string;
  status: string;
  createdAt: string;
  ageDays: number;
}

export interface VolumeSummaryResult {
  range: { start: string; end: string };
  totalAbertos: number;
  totalNovo: number;
  totalEmAberto: number;
  oldestAbertos: OldestAbertoEntry[];
  tmaMedio: string | null;
  tmeMedio: string | null;
}

/**
 * Resumo do card de Volume de tickets: totais no período selecionado (abertos, novos, em aberto),
 * TMA/TME médios dos tickets resolvidos no período + os 10 tickets "em aberto" mais antigos
 * (sempre em relação ao acervo completo, não filtrado por período).
 */
export async function getVolumeSummary(query: GestaoInsightsQuery = {}): Promise<VolumeSummaryResult> {
  const range = resolvePeriodRange(query);

  // Totais por último status (createdAt no período) + TMA/TME dos resolvidos no período,
  // ambos calculados no MongoDB para não trafegar os arrays `registro`. Semântica idêntica
  // aos helpers JS (lastStatus / getResolvedAt / getFirstAgentResponseAt).
  const [statusAgg, tempoAgg] = await Promise.all([
    ChamadoN1.aggregate<{ total: number; novo: number; emAberto: number }>([
      { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
      { $addFields: { __lastStatus: lastStatusExpr } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          novo: { $sum: { $cond: [{ $eq: ['$__lastStatus', 'novo'] }, 1, 0] } },
          emAberto: { $sum: { $cond: [{ $in: ['$__lastStatus', EM_ABERTO_STATUSES] }, 1, 0] } },
        },
      },
    ]),
    ChamadoN1.aggregate<{ tmaSum: number; tmaN: number; tmeSum: number; tmeN: number }>([
      { $match: { 'registro.data': { $gte: range.start, $lte: range.end } } },
      { $addFields: { __resolvedAt: resolvedAtExpr, __firstResp: firstResponseExpr } },
      { $match: { __resolvedAt: { $gte: range.start, $lte: range.end } } },
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
    ]),
  ]);

  const totalAbertos = statusAgg[0]?.total ?? 0;
  const totalNovo = statusAgg[0]?.novo ?? 0;
  const totalEmAberto = statusAgg[0]?.emAberto ?? 0;

  const tmaSumMs = tempoAgg[0]?.tmaSum ?? 0;
  const tmaN = tempoAgg[0]?.tmaN ?? 0;
  const tmeSumMs = tempoAgg[0]?.tmeSum ?? 0;
  const tmeN = tempoAgg[0]?.tmeN ?? 0;

  const oldestDocs = await ChamadoN1.find(lastStatusInFilter(EM_ABERTO_STATUSES))
    .sort({ createdAt: 1 })
    .limit(10)
    .select('chamadoProtocolo chamadoTitulo createdAt tabulacao registro.status')
    .lean<IChamadoN1[]>();

  const now = Date.now();
  const oldestAbertos: OldestAbertoEntry[] = oldestDocs.map((chamado) => {
    const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
    const createdAt = chamado.createdAt ? new Date(chamado.createdAt) : new Date();
    return {
      id: String((chamado as unknown as { _id: unknown })._id),
      protocolo: chamado.chamadoProtocolo ?? '',
      titulo: chamado.chamadoTitulo || tab?.motivo || 'Sem título',
      produto: tab?.produto ?? '',
      motivo: tab?.motivo ?? '',
      status: lastStatus(chamado),
      createdAt: createdAt.toISOString(),
      ageDays: Math.max(0, Math.floor((now - createdAt.getTime()) / 86400000)),
    };
  });

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    totalAbertos,
    totalNovo,
    totalEmAberto,
    oldestAbertos,
    tmaMedio: tmaN > 0 ? formatDurationMs(tmaSumMs / tmaN) : null,
    tmeMedio: tmeN > 0 ? formatDurationMs(tmeSumMs / tmeN) : null,
  };
}

export interface TopMotivoEntry {
  produto: string;
  motivo: string;
  count: number;
  pct: number;
}

export interface TopMotivosResult {
  range: { start: string; end: string };
  total: number;
  items: TopMotivoEntry[];
}

/** Top motivos de acionamento (consolidado da tabulação), separados por produto, no período. */
export async function getTopMotivosPorProduto(
  query: GestaoInsightsQuery = {},
  limit = 10
): Promise<TopMotivosResult> {
  const range = resolvePeriodRange(query);

  // Consolida no MongoDB pela última tabulação de cada chamado (mesma regra do JS:
  // produto/motivo com trim; ignora vazios). Total = soma das entradas qualificadas.
  const rows = await ChamadoN1.aggregate<{ _id: { produto: string; motivo: string }; count: number }>([
    { $match: { createdAt: { $gte: range.start, $lte: range.end } } },
    { $addFields: { __tab: { $arrayElemAt: [{ $ifNull: ['$tabulacao', []] }, -1] } } },
    {
      $addFields: {
        __produto: { $trim: { input: { $ifNull: ['$__tab.produto', ''] } } },
        __motivo: { $trim: { input: { $ifNull: ['$__tab.motivo', ''] } } },
      },
    },
    { $match: { __produto: { $ne: '' }, __motivo: { $ne: '' } } },
    { $group: { _id: { produto: '$__produto', motivo: '$__motivo' }, count: { $sum: 1 } } },
  ]);

  const counts = new Map<string, TopMotivoEntry>();
  let total = 0;

  rows.forEach((row) => {
    const produto = String(row._id.produto ?? '').trim();
    const motivo = String(row._id.motivo ?? '').trim();
    if (!produto || !motivo) return;
    total += row.count;
    counts.set(`${produto}::${motivo}`, { produto, motivo, count: row.count, pct: 0 });
  });

  const items = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => ({
      ...entry,
      pct: total > 0 ? Math.round((entry.count / total) * 1000) / 10 : 0,
    }));

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    total,
    items,
  };
}

export interface CasoEspecialEntry {
  id: 'bacen' | 'procon' | 'consumidorGov' | 'reclameAqui';
  label: string;
  total: number;
  mock?: boolean;
}

export interface CasosEspeciaisResult {
  range: { start: string; end: string };
  items: CasoEspecialEntry[];
  mock: boolean;
}

export const CASOS_ESPECIAIS_ORGAOS: { id: CasoEspecialEntry['id']; label: string }[] = [
  { id: 'bacen', label: 'Bacen' },
  { id: 'procon', label: 'Procon' },
  { id: 'consumidorGov', label: 'Consumidor.gov' },
  { id: 'reclameAqui', label: 'Reclame Aqui' },
];

const CASO_ESPECIAL_CHANNEL_FILTER: Record<CasoEspecialEntry['id'], () => Record<string, unknown>> = {
  bacen: bacenChannelMongoFilter,
  procon: proconChannelMongoFilter,
  consumidorGov: consumidorGovChannelMongoFilter,
  reclameAqui: reclameAquiChannelMongoFilter,
};

function buildCasoEspecialMatch(orgaoId: CasoEspecialEntry['id'], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...CASO_ESPECIAL_CHANNEL_FILTER[orgaoId](),
    ...extra,
  };
}

async function countCasoEspecialInRange(orgaoId: CasoEspecialEntry['id'], range: DateRange): Promise<number> {
  return ChamadoN1.countDocuments({
    ...buildCasoEspecialMatch(orgaoId),
    createdAt: { $gte: range.start, $lte: range.end },
  });
}

async function getCasoEspecialDailyCounts(
  orgaoId: CasoEspecialEntry['id'],
  range: DateRange,
): Promise<Map<string, number>> {
  const rows = await ChamadoN1.aggregate<{ _id: string; total: number }>([
    {
      $match: {
        ...buildCasoEspecialMatch(orgaoId),
        createdAt: { $gte: range.start, $lte: range.end },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TZ },
        },
        total: { $sum: 1 },
      },
    },
  ]);
  const map = new Map<string, number>();
  rows.forEach((row) => map.set(String(row._id), row.total));
  return map;
}

async function buildCasoEspecialDailySeries(
  orgaoId: CasoEspecialEntry['id'],
  range: DateRange,
  comparisonRange?: DateRange,
): Promise<CasoEspecialSeriesDay[]> {
  const [currentCounts, previousCounts] = await Promise.all([
    getCasoEspecialDailyCounts(orgaoId, range),
    comparisonRange ? getCasoEspecialDailyCounts(orgaoId, comparisonRange) : Promise.resolve(new Map<string, number>()),
  ]);
  const keys = dayKeysBetween(range);
  const comparisonKeys = comparisonRange ? dayKeysBetween(comparisonRange) : [];
  return keys.map((key, idx) => {
    const prevKey = comparisonKeys[idx];
    return {
      date: key,
      label: labelForDay(key),
      total: currentCounts.get(key) ?? 0,
      ...(prevKey ? { totalAnterior: previousCounts.get(prevKey) ?? 0 } : {}),
    };
  });
}

async function getCasoEspecialMotivosPorProduto(
  orgaoId: CasoEspecialEntry['id'],
  range: DateRange,
): Promise<CasoEspecialMotivoProduto[]> {
  const rows = await ChamadoN1.aggregate<{
    _id: { produto: string; motivo: string };
    count: number;
  }>([
    {
      $match: {
        ...buildCasoEspecialMatch(orgaoId),
        createdAt: { $gte: range.start, $lte: range.end },
      },
    },
    { $unwind: '$tabulacao' },
    {
      $match: {
        'tabulacao.produto': { $nin: [null, ''] },
        'tabulacao.motivo': { $nin: [null, ''] },
      },
    },
    {
      $group: {
        _id: { produto: '$tabulacao.produto', motivo: '$tabulacao.motivo' },
        count: { $sum: 1 },
      },
    },
  ]);

  const byProduto = new Map<string, Map<string, number>>();
  rows.forEach((row) => {
    const produto = String(row._id.produto ?? '').trim();
    const motivo = String(row._id.motivo ?? '').trim();
    if (!produto || !motivo) return;
    if (!byProduto.has(produto)) byProduto.set(produto, new Map());
    byProduto.get(produto)!.set(motivo, row.count);
  });

  return Array.from(byProduto.entries())
    .map(([produto, motivosMap]) => {
      const motivos = Array.from(motivosMap.entries())
        .map(([motivo, count]) => ({ motivo, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      const total = motivos.reduce((sum, item) => sum + item.count, 0);
      return {
        produto,
        total,
        motivos: motivos.map((item) => ({
          ...item,
          pct: total > 0 ? Math.round((item.count / total) * 1000) / 10 : 0,
        })),
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

/** Totais de casos especiais por órgão/canal, a partir de tickets reais marcados com o canal (`registro.metadados.source`). */
export async function getCasosEspeciais(query: GestaoInsightsQuery = {}): Promise<CasosEspeciaisResult> {
  const range = resolvePeriodRange(query);

  const items = await Promise.all(
    CASOS_ESPECIAIS_ORGAOS.map(async (org) => {
      const total = await countCasoEspecialInRange(org.id, range);
      return { id: org.id, label: org.label, total, mock: false };
    }),
  );

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    items,
    mock: false,
  };
}

export interface CasoEspecialSeriesDay {
  date: string;
  label: string;
  total: number;
  totalAnterior?: number;
}

export interface CasoEspecialMotivoProduto {
  produto: string;
  total: number;
  motivos: { motivo: string; count: number; pct: number }[];
}

export interface CasoEspecialDetailResult {
  orgao: { id: CasoEspecialEntry['id']; label: string };
  range: { start: string; end: string };
  totals: { currentMonth: number; currentYear: number };
  series: CasoEspecialSeriesDay[];
  granularity: ChartGranularity;
  comparison?: { mode: ComparisonMode; range: { start: string; end: string } };
  motivosPorProduto: CasoEspecialMotivoProduto[];
  mock: boolean;
}

/** Agrega a série diária de um caso especial em buckets de mês fechado (soma de casos). */
function aggregateCasoEspecialByMonth(daily: CasoEspecialSeriesDay[]): CasoEspecialSeriesDay[] {
  const buckets = new Map<string, { total: number; totalAnterior: number; hasAnterior: boolean }>();
  const order: string[] = [];
  daily.forEach((day) => {
    const key = monthKey(new Date(`${day.date}T12:00:00`));
    if (!buckets.has(key)) {
      buckets.set(key, { total: 0, totalAnterior: 0, hasAnterior: false });
      order.push(key);
    }
    const bucket = buckets.get(key)!;
    bucket.total += day.total;
    if (day.totalAnterior != null) {
      bucket.totalAnterior += day.totalAnterior;
      bucket.hasAnterior = true;
    }
  });
  return order.map((key) => {
    const bucket = buckets.get(key)!;
    return {
      date: key,
      label: labelForMonth(key),
      total: bucket.total,
      ...(bucket.hasAnterior ? { totalAnterior: bucket.totalAnterior } : {}),
    };
  });
}

/**
 * Detalhe de um órgão/canal de caso especial: totais mês/ano, série do gráfico
 * (com comparativo opcional MoM/YoY, em granularidade dia ou mês fechado) e principais motivos por produto,
 * a partir de tickets reais marcados com o canal (`registro.metadados.source`).
 */
export async function getCasoEspecialDetail(
  orgaoId: string,
  query: GestaoInsightsQuery & { compare?: string; granularity?: string } = {},
): Promise<CasoEspecialDetailResult | null> {
  const org = CASOS_ESPECIAIS_ORGAOS.find((o) => o.id === orgaoId);
  if (!org) return null;

  const { range, granularity } = resolveSeriesRange(query);
  const compareMode: ComparisonMode | undefined =
    query.compare === 'mom' || query.compare === 'yoy' ? query.compare : undefined;

  let comparisonRange: DateRange | undefined;
  if (compareMode) {
    comparisonRange = resolveComparisonRange(range, compareMode);
  }

  const [currentMonth, currentYear, dailySeries, motivosPorProduto] = await Promise.all([
    countCasoEspecialInRange(org.id, getCurrentMonthRange()),
    countCasoEspecialInRange(org.id, getCurrentYearRange()),
    buildCasoEspecialDailySeries(org.id, range, comparisonRange),
    getCasoEspecialMotivosPorProduto(org.id, range),
  ]);
  const series = granularity === 'mes' ? aggregateCasoEspecialByMonth(dailySeries) : dailySeries;

  return {
    orgao: { id: org.id, label: org.label },
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    totals: { currentMonth, currentYear },
    series,
    granularity,
    comparison:
      compareMode && comparisonRange
        ? {
            mode: compareMode,
            range: { start: comparisonRange.start.toISOString(), end: comparisonRange.end.toISOString() },
          }
        : undefined,
    motivosPorProduto,
    mock: false,
  };
}

/** Início/fim (no fuso da Gestão) do mês indicado pela chave YYYY-MM. */
function monthRangeFor(key: string): DateRange {
  const [y, m] = key.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, 1);
  const end = new Date(y, m || 1, 0); // dia 0 do mês seguinte = último dia do mês atual
  return { start: startOfDayInTz(start), end: endOfDayInTz(end) };
}

/** Chave do mês anterior a partir de uma chave YYYY-MM. */
function previousMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const date = new Date(y, (m || 1) - 2, 1);
  return monthKey(date);
}

/** As N últimas chaves de mês (mais antiga → mais recente), terminando no mês corrente. */
function lastNMonthKeys(n: number): string[] {
  const keys: string[] = [];
  let key = monthKey(new Date());
  for (let i = 0; i < n; i++) {
    keys.unshift(key);
    key = previousMonthKey(key);
  }
  return keys;
}

export interface CsatAgentBreakdown {
  responsavel: string;
  notaMedia: number;
  respostas: number;
}

export interface CsatComentario {
  protocolo: string;
  nota: number;
  comentario: string;
  respondidoEm: string;
}

export interface CsatSummaryResult {
  range: { start: string; end: string };
  notaMedia: number | null;
  totalRespostas: number;
  porAtendente: CsatAgentBreakdown[];
  comentariosRecentes: CsatComentario[];
  tendencia: { date: string; label: string; notaMedia: number | null; respostas: number }[];
}

/**
 * Resumo de CSAT real (nota 1-5) no período: nota média geral, nota média por atendente,
 * comentários recentes e tendência diária. Base para o painel dedicado de CSAT.
 */
export async function getCsatSummary(query: GestaoInsightsQuery = {}): Promise<CsatSummaryResult> {
  const range = resolvePeriodRange(query);
  const respondedMatch = {
    'csat.respondido': true,
    'csat.respondidoEm': { $gte: range.start, $lte: range.end },
  };

  const [overallAgg, porAtendenteAgg, comentariosRows, tendenciaAgg] = await Promise.all([
    ChamadoN1.aggregate<{ _id: null; notaSum: number; notaN: number }>([
      { $match: respondedMatch },
      { $group: { _id: null, notaSum: { $sum: '$csat.nota' }, notaN: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{ _id: string; notaSum: number; notaN: number }>([
      { $match: respondedMatch },
      { $addFields: { __responsavel: { $trim: { input: { $ifNull: [{ $arrayElemAt: ['$tabulacao.responsavel', -1] }, ''] } } } } },
      { $match: { __responsavel: { $ne: '' } } },
      { $group: { _id: '$__responsavel', notaSum: { $sum: '$csat.nota' }, notaN: { $sum: 1 } } },
      { $sort: { notaN: -1 } },
    ]),
    ChamadoN1.find({ ...respondedMatch, 'csat.comentario': { $nin: [null, ''] } })
      .select('chamadoProtocolo csat.nota csat.comentario csat.respondidoEm')
      .sort({ 'csat.respondidoEm': -1 })
      .limit(20)
      .lean(),
    ChamadoN1.aggregate<{ _id: string; notaSum: number; notaN: number }>([
      { $match: respondedMatch },
      { $group: { _id: dayKeyExpr('$csat.respondidoEm'), notaSum: { $sum: '$csat.nota' }, notaN: { $sum: 1 } } },
    ]),
  ]);

  const overall = overallAgg[0];
  const notaMedia = overall?.notaN ? Math.round((overall.notaSum / overall.notaN) * 10) / 10 : null;

  const porAtendente: CsatAgentBreakdown[] = porAtendenteAgg.map((row) => ({
    responsavel: row._id,
    notaMedia: Math.round((row.notaSum / row.notaN) * 10) / 10,
    respostas: row.notaN,
  }));

  const comentariosRecentes: CsatComentario[] = comentariosRows.map((doc) => ({
    protocolo: String((doc as unknown as { chamadoProtocolo?: string }).chamadoProtocolo ?? ''),
    nota: Number((doc as unknown as { csat?: { nota?: number } }).csat?.nota ?? 0),
    comentario: String((doc as unknown as { csat?: { comentario?: string } }).csat?.comentario ?? ''),
    respondidoEm: (doc as unknown as { csat?: { respondidoEm?: Date } }).csat?.respondidoEm
      ? new Date((doc as unknown as { csat?: { respondidoEm?: Date } }).csat!.respondidoEm as Date).toISOString()
      : '',
  }));

  const tendenciaMap = new Map<string, { notaSum: number; notaN: number }>();
  tendenciaAgg.forEach((row) => tendenciaMap.set(row._id, { notaSum: row.notaSum, notaN: row.notaN }));
  const keys = dayKeysBetween(range);
  const tendencia = keys.map((key) => {
    const bucket = tendenciaMap.get(key);
    return {
      date: key,
      label: labelForDay(key),
      notaMedia: bucket ? Math.round((bucket.notaSum / bucket.notaN) * 10) / 10 : null,
      respostas: bucket?.notaN ?? 0,
    };
  });

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    notaMedia,
    totalRespostas: overall?.notaN ?? 0,
    porAtendente,
    comentariosRecentes,
    tendencia,
  };
}

export interface CsatMonthTab {
  key: string;
  label: string;
  atual: boolean;
}

export interface CsatKpi {
  value: number | null;
  delta: number | null;
}

export interface CsatCanalBreakdown {
  canal: string;
  notaMedia: number | null;
  respostas: number;
  notasBaixas: number;
  faixa: 'high' | 'mid' | 'low';
}

export interface CsatFunilStep {
  label: string;
  total: number;
  pct: number;
}

export interface CsatCaso {
  id: string;
  protocolo: string;
  respondidoEm: string;
  canal: string;
  nota: number;
  comentario: string | null;
}

export interface CsatDashboardResult {
  months: CsatMonthTab[];
  selectedMonth: string;
  kpis: {
    notaMediaPonderada: CsatKpi;
    taxaResposta: CsatKpi;
    notasBaixasPct: CsatKpi;
    avaliacoesNoPeriodo: { value: number; enviados: number };
  };
  tendencia: { date: string; label: string; notaMedia: number | null }[];
  porCanal: CsatCanalBreakdown[];
  funil: CsatFunilStep[];
  casos: CsatCaso[];
}

function classifyFaixa(nota: number | null): 'high' | 'mid' | 'low' {
  if (nota == null) return 'low';
  if (nota >= 4.5) return 'high';
  if (nota >= 4) return 'mid';
  return 'low';
}

/** Nota média + total de respostas (por csat.respondidoEm) num intervalo — usado pro KPI e pro delta do mês anterior. */
async function computeNotaMediaNoRange(range: DateRange): Promise<{ notaMedia: number | null; totalRespostas: number }> {
  const rows = await ChamadoN1.aggregate<{ _id: null; notaSum: number; notaN: number }>([
    { $match: { 'csat.respondido': true, 'csat.respondidoEm': { $gte: range.start, $lte: range.end } } },
    { $group: { _id: null, notaSum: { $sum: '$csat.nota' }, notaN: { $sum: 1 } } },
  ]);
  const row = rows[0];
  return {
    notaMedia: row?.notaN ? Math.round((row.notaSum / row.notaN) * 10) / 10 : null,
    totalRespostas: row?.notaN ?? 0,
  };
}

/**
 * Funil de envio/resposta do CSAT para um mês (coorte por `csat.enviadoEm` — quando o
 * e-mail original foi disparado, para que E5/E5.2 e resposta fiquem no mesmo grupo mesmo
 * que a resposta tenha chegado já no mês seguinte). "Respondeu no E5" x "Respondeu na
 * repescagem (E5.2)" são inferidos comparando `csat.respondidoEm` com
 * `csat.repescagemEnviadaEm` (não há flag dedicada gravada na resposta).
 */
async function computeFunilEEnviados(range: DateRange): Promise<{ funil: CsatFunilStep[]; enviados: number }> {
  const enviadoMatch = { 'csat.enviado': true, 'csat.enviadoEm': { $gte: range.start, $lte: range.end } };

  const [fechadosRows, funilRows] = await Promise.all([
    ChamadoN1.aggregate<{ _id: null; n: number }>([
      { $match: { 'registro.data': { $gte: range.start, $lte: range.end } } },
      { $addFields: { __resolvedAt: resolvedAtExpr } },
      { $match: { __resolvedAt: { $gte: range.start, $lte: range.end } } },
      { $group: { _id: null, n: { $sum: 1 } } },
    ]),
    ChamadoN1.aggregate<{
      _id: null;
      enviados: number;
      respondeuE5: number;
      repescagemEnviada: number;
      respondeuRepescagem: number;
      comentario: number;
    }>([
      { $match: enviadoMatch },
      {
        $group: {
          _id: null,
          enviados: { $sum: 1 },
          respondeuE5: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$csat.respondido', true] },
                    {
                      $or: [
                        { $ne: ['$csat.repescagemEnviada', true] },
                        { $lt: ['$csat.respondidoEm', '$csat.repescagemEnviadaEm'] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          repescagemEnviada: { $sum: { $cond: [{ $eq: ['$csat.repescagemEnviada', true] }, 1, 0] } },
          respondeuRepescagem: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$csat.respondido', true] },
                    { $eq: ['$csat.repescagemEnviada', true] },
                    { $gte: ['$csat.respondidoEm', '$csat.repescagemEnviadaEm'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          comentario: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$csat.respondido', true] }, { $ne: ['$csat.comentario', ''] }, { $ne: ['$csat.comentario', null] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const fechados = fechadosRows[0]?.n ?? 0;
  const row = funilRows[0];
  const enviados = row?.enviados ?? 0;
  const base = fechados > 0 ? fechados : enviados;
  const pct = (n: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : 0);

  const funil: CsatFunilStep[] = [
    { label: 'Tickets fechados', total: fechados, pct: 100 },
    { label: 'E5 enviado', total: enviados, pct: pct(enviados) },
    { label: 'Respondeu no E5', total: row?.respondeuE5 ?? 0, pct: pct(row?.respondeuE5 ?? 0) },
    { label: 'E5.2 (repescagem)', total: row?.repescagemEnviada ?? 0, pct: pct(row?.repescagemEnviada ?? 0) },
    { label: 'Respondeu no E5.2', total: row?.respondeuRepescagem ?? 0, pct: pct(row?.respondeuRepescagem ?? 0) },
    { label: 'Escreveu comentário', total: row?.comentario ?? 0, pct: pct(row?.comentario ?? 0) },
  ];

  return { funil, enviados };
}

/**
 * Painel dedicado de CSAT (mês fechado): tabs dos últimos 7 meses, KPIs com variação vs.
 * mês anterior, tendência de 7 meses, quebra por canal, funil de envio/resposta e lista
 * de casos avaliados (pra filtro por nota + link pro ticket original).
 */
export async function getCsatDashboard(query: { month?: string } = {}): Promise<CsatDashboardResult> {
  const monthKeys = lastNMonthKeys(7);
  const currentKey = monthKeys[monthKeys.length - 1];
  const selectedMonth = monthKeys.includes(String(query.month ?? '')) ? String(query.month) : currentKey;

  const range = monthRangeFor(selectedMonth);
  const prevRange = monthRangeFor(previousMonthKey(selectedMonth));
  const trendStart = monthRangeFor(monthKeys[0]).start;

  const respondedMatch = { 'csat.respondido': true, 'csat.respondidoEm': { $gte: range.start, $lte: range.end } };

  const [
    current,
    previous,
    { funil, enviados },
    canalRows,
    trendRows,
    casosRows,
  ] = await Promise.all([
    computeNotaMediaNoRange(range),
    computeNotaMediaNoRange(prevRange),
    computeFunilEEnviados(range),
    ChamadoN1.aggregate<{ _id: string; notaSum: number; notaN: number; baixas: number }>([
      { $match: respondedMatch },
      { $addFields: { __canal: { $trim: { input: { $ifNull: [{ $arrayElemAt: ['$tabulacao.canal', -1] }, ''] } } } } },
      { $match: { __canal: { $ne: '' } } },
      {
        $group: {
          _id: '$__canal',
          notaSum: { $sum: '$csat.nota' },
          notaN: { $sum: 1 },
          baixas: { $sum: { $cond: [{ $lte: ['$csat.nota', 3] }, 1, 0] } },
        },
      },
      { $sort: { notaN: -1 } },
    ]),
    ChamadoN1.aggregate<{ _id: string; notaSum: number; notaN: number }>([
      { $match: { 'csat.respondido': true, 'csat.respondidoEm': { $gte: trendStart, $lte: range.end } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$csat.respondidoEm', timezone: TZ } },
          notaSum: { $sum: '$csat.nota' },
          notaN: { $sum: 1 },
        },
      },
    ]),
    ChamadoN1.find({ ...respondedMatch })
      .select('chamadoProtocolo tabulacao.canal csat.nota csat.comentario csat.respondidoEm')
      .sort({ 'csat.respondidoEm': -1 })
      .limit(50)
      .lean(),
  ]);

  // Taxa de resposta / notas baixas do mês selecionado e do anterior (pra delta).
  const respondeuNoMes = (funil.find((f) => f.label === 'Respondeu no E5')?.total ?? 0) +
    (funil.find((f) => f.label === 'Respondeu no E5.2')?.total ?? 0);
  const taxaResposta = enviados > 0 ? Math.round((respondeuNoMes / enviados) * 1000) / 10 : null;
  const { funil: prevFunil, enviados: prevEnviados } = await computeFunilEEnviados(prevRange);
  const prevRespondeu = (prevFunil.find((f) => f.label === 'Respondeu no E5')?.total ?? 0) +
    (prevFunil.find((f) => f.label === 'Respondeu no E5.2')?.total ?? 0);
  const prevTaxaResposta = prevEnviados > 0 ? Math.round((prevRespondeu / prevEnviados) * 1000) / 10 : null;

  const notasBaixasAgg = await ChamadoN1.aggregate<{ _id: null; n: number; total: number }>([
    { $match: respondedMatch },
    { $group: { _id: null, n: { $sum: { $cond: [{ $lte: ['$csat.nota', 3] }, 1, 0] } }, total: { $sum: 1 } } },
  ]);
  const notasBaixasPct = notasBaixasAgg[0]?.total ? Math.round((notasBaixasAgg[0].n / notasBaixasAgg[0].total) * 1000) / 10 : null;
  const prevNotasBaixasAgg = await ChamadoN1.aggregate<{ _id: null; n: number; total: number }>([
    { $match: { 'csat.respondido': true, 'csat.respondidoEm': { $gte: prevRange.start, $lte: prevRange.end } } },
    { $group: { _id: null, n: { $sum: { $cond: [{ $lte: ['$csat.nota', 3] }, 1, 0] } }, total: { $sum: 1 } } },
  ]);
  const prevNotasBaixasPct = prevNotasBaixasAgg[0]?.total
    ? Math.round((prevNotasBaixasAgg[0].n / prevNotasBaixasAgg[0].total) * 1000) / 10
    : null;

  const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
  const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : round1(a - b));

  const porCanal: CsatCanalBreakdown[] = canalRows.map((row) => {
    const notaMedia = Math.round((row.notaSum / row.notaN) * 10) / 10;
    return { canal: row._id, notaMedia, respostas: row.notaN, notasBaixas: row.baixas, faixa: classifyFaixa(notaMedia) };
  });

  const trendMap = new Map<string, { notaSum: number; notaN: number }>();
  trendRows.forEach((row) => {
    if (row._id) trendMap.set(row._id, { notaSum: row.notaSum, notaN: row.notaN });
  });
  const tendencia = monthKeys.map((key) => {
    const bucket = trendMap.get(key);
    return {
      date: key,
      label: labelForMonth(key),
      notaMedia: bucket ? Math.round((bucket.notaSum / bucket.notaN) * 10) / 10 : null,
    };
  });

  const casos: CsatCaso[] = casosRows.map((doc) => {
    const raw = doc as unknown as {
      _id: unknown;
      chamadoProtocolo?: string;
      tabulacao?: { canal?: string }[];
      csat?: { nota?: number; comentario?: string; respondidoEm?: Date };
    };
    const tab = raw.tabulacao?.[raw.tabulacao.length - 1];
    return {
      id: String(raw._id),
      protocolo: raw.chamadoProtocolo ?? '',
      respondidoEm: raw.csat?.respondidoEm ? new Date(raw.csat.respondidoEm).toISOString() : '',
      canal: tab?.canal || '',
      nota: Number(raw.csat?.nota ?? 0),
      comentario: raw.csat?.comentario ? raw.csat.comentario : null,
    };
  });

  return {
    months: monthKeys.map((key) => ({ key, label: labelForMonth(key), atual: key === currentKey })),
    selectedMonth,
    kpis: {
      notaMediaPonderada: { value: current.notaMedia, delta: delta(current.notaMedia, previous.notaMedia) },
      taxaResposta: { value: taxaResposta, delta: delta(taxaResposta, prevTaxaResposta) },
      notasBaixasPct: { value: notasBaixasPct, delta: delta(notasBaixasPct, prevNotasBaixasPct) },
      avaliacoesNoPeriodo: { value: current.totalRespostas, enviados },
    },
    tendencia,
    porCanal,
    funil,
    casos,
  };
}
