/**
 * gestaoSnapshot.service v1.0.1 — fallback de protocolo ausente no inventário
 * VERSION: v1.0.1 | DATE: 2026-07-16
 */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import {
  AgentGestaoSnapshot,
  type IGestaoTicketSnapshotEntry,
  type IAgentGestaoSnapshot,
} from '../../models/AgentGestaoSnapshot';
import { env } from '../../config/env';
import {
  activeTicketsStatusFilter,
  currentStatus,
  excludeEspeciaisChannelsMongoFilter,
  isSlaBreached,
  MEUS_CHAMADOS_COLUMNS,
} from '../chamado.mapper';

export interface GestaoSnapshotAggregates {
  slaBreached: Array<{ protocolo: string; status: string; hours: number }>;
  slaAtRisk: Array<{ protocolo: string; status: string; minutesLeft: number }>;
  semResponsavel: Array<{ protocolo: string; minutes: number }>;
  parados: Array<{ protocolo: string; hours: number }>;
  spike: { volume: number; baseline: number; variationPct: number };
  themes: Array<{ key: string; count: number }>;
}

export interface GestaoHourlySnapshot {
  snapshotAt: string;
  ticketCount: number;
  countsByStatus: Record<string, number>;
  tickets: IGestaoTicketSnapshotEntry[];
  aggregates: GestaoSnapshotAggregates;
  spikeWindowMin: number;
}

function hoursSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

function minutesSince(date: Date): number {
  return (Date.now() - date.getTime()) / (1000 * 60);
}

function readResponsavel(chamado: IChamadoN1): string {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1] || chamado.tabulacao?.[0];
  return String(tab?.responsavel ?? '').trim();
}

function readAtribuido(chamado: IChamadoN1): string {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1] || chamado.tabulacao?.[0];
  return String(tab?.atribuido ?? '').trim();
}

function readTabField(chamado: IChamadoN1, field: 'produto' | 'motivo'): string {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1] || chamado.tabulacao?.[0];
  return String(tab?.[field] ?? '').trim();
}

function lastInteractionDate(chamado: IChamadoN1): Date {
  const regs = chamado.registro || [];
  if (regs.length === 0) return chamado.updatedAt || chamado.createdAt;
  return regs[regs.length - 1]?.data || chamado.updatedAt || chamado.createdAt;
}

function extractThemeKey(chamado: IChamadoN1): string {
  const parts = [readTabField(chamado, 'produto'), readTabField(chamado, 'motivo'), chamado.chamadoTitulo]
    .filter(Boolean);
  return parts.join(' — ').slice(0, 120) || 'sem tema';
}

function resolveProtocolo(chamado: IChamadoN1): string {
  const protocolo = String(chamado.chamadoProtocolo || '').trim();
  if (protocolo) return protocolo;
  const ticketId = String(chamado._id || '').trim();
  return ticketId ? `ticket:${ticketId}` : 'sem-protocolo';
}

function buildTicketEntry(chamado: IChamadoN1): IGestaoTicketSnapshotEntry {
  const status = currentStatus(chamado);
  const lastInteraction = lastInteractionDate(chamado);
  return {
    ticketId: String(chamado._id || ''),
    protocolo: resolveProtocolo(chamado),
    status,
    titulo: String(chamado.chamadoTitulo || '').slice(0, 200),
    produto: readTabField(chamado, 'produto'),
    motivo: readTabField(chamado, 'motivo'),
    responsavel: readResponsavel(chamado),
    atribuido: readAtribuido(chamado),
    slaBreached: isSlaBreached(chamado),
    idleHours: Math.round(hoursSince(lastInteraction)),
    minutesOpen: Math.round(minutesSince(chamado.createdAt)),
    lastInteractionAt: lastInteraction.toISOString(),
    createdAt: chamado.createdAt?.toISOString?.() || new Date().toISOString(),
  };
}

/**
 * Só o que o snapshot usa: status, SLA e última interação dependem apenas do ÚLTIMO registro;
 * produto/motivo/responsável/atribuído, da última tabulação. Sem a projeção cada execução trazia
 * o histórico completo (mensagens, anexos) de todos os tickets ativos.
 * Casos especiais (Procon, Consumidor.gov, BACEN, Reclame Aqui) ficam fora do monitoramento.
 */
const GESTAO_SNAPSHOT_PROJECTION = {
  chamadoProtocolo: 1,
  chamadoTitulo: 1,
  createdAt: 1,
  updatedAt: 1,
  registro: { $slice: -1 },
  tabulacao: { $slice: -1 },
} as const;

export async function fetchActiveTicketsLean(): Promise<IChamadoN1[]> {
  const rows = await ChamadoN1.find(
    { $and: [activeTicketsStatusFilter(), excludeEspeciaisChannelsMongoFilter()] },
    GESTAO_SNAPSHOT_PROJECTION,
  )
    .sort({ updatedAt: -1 })
    .lean();
  return rows as unknown as IChamadoN1[];
}

export async function buildGestaoHourlySnapshot(): Promise<GestaoHourlySnapshot> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - env.gestaoSpikeWindowMin * 60 * 1000);
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [activeChamados, recentCreated, dayCreated] = await Promise.all([
    fetchActiveTicketsLean(),
    ChamadoN1.countDocuments({ createdAt: { $gte: windowStart } }),
    ChamadoN1.countDocuments({ createdAt: { $gte: dayStart } }),
  ]);

  const countsByStatus: Record<string, number> = {};
  for (const col of MEUS_CHAMADOS_COLUMNS) {
    countsByStatus[col.status] = 0;
  }
  countsByStatus['em-espera'] = 0;

  const slaBreached: GestaoSnapshotAggregates['slaBreached'] = [];
  const slaAtRisk: GestaoSnapshotAggregates['slaAtRisk'] = [];
  const semResponsavel: GestaoSnapshotAggregates['semResponsavel'] = [];
  const parados: GestaoSnapshotAggregates['parados'] = [];
  const themeMap = new Map<string, number>();
  const tickets: IGestaoTicketSnapshotEntry[] = [];

  for (const chamado of activeChamados) {
    const status = currentStatus(chamado);
    const protocolo = resolveProtocolo(chamado);
    countsByStatus[status] = (countsByStatus[status] || 0) + 1;
    tickets.push(buildTicketEntry(chamado));

    if (isSlaBreached(chamado)) {
      slaBreached.push({
        protocolo,
        status,
        hours: Math.round(hoursSince(lastInteractionDate(chamado))),
      });
    }

    if (status === 'novo' && !readResponsavel(chamado)) {
      const mins = minutesSince(chamado.createdAt);
      if (mins >= env.gestaoStuckNovoMinutes) {
        semResponsavel.push({ protocolo, minutes: Math.round(mins) });
      }
    }

    const idleHours = hoursSince(lastInteractionDate(chamado));
    if (idleHours >= env.gestaoStuckActiveHours && status !== 'novo') {
      parados.push({ protocolo, hours: Math.round(idleHours) });
    }

    const theme = extractThemeKey(chamado);
    themeMap.set(theme, (themeMap.get(theme) || 0) + 1);
  }

  const baseline = Math.max(1, Math.round(dayCreated / (24 * 60 / env.gestaoSpikeWindowMin)));
  const variationPct = Math.round(((recentCreated - baseline) / baseline) * 100);
  const themes = [...themeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));

  return {
    snapshotAt: now.toISOString(),
    ticketCount: tickets.length,
    countsByStatus,
    tickets,
    aggregates: {
      slaBreached,
      slaAtRisk,
      semResponsavel,
      parados,
      spike: { volume: recentCreated, baseline, variationPct },
      themes,
    },
    spikeWindowMin: env.gestaoSpikeWindowMin,
  };
}

export async function persistGestaoSnapshot(params: {
  snapshot: GestaoHourlySnapshot;
  llmSummary?: Record<string, unknown>;
  alertsCreated?: number;
}): Promise<IAgentGestaoSnapshot> {
  return AgentGestaoSnapshot.create({
    snapshotAt: new Date(params.snapshot.snapshotAt),
    ticketCount: params.snapshot.ticketCount,
    countsByStatus: params.snapshot.countsByStatus,
    tickets: params.snapshot.tickets,
    aggregates: params.snapshot.aggregates,
    llmSummary: params.llmSummary,
    alertsCreated: params.alertsCreated ?? 0,
  });
}

export async function getLatestGestaoSnapshot() {
  return AgentGestaoSnapshot.findOne().sort({ snapshotAt: -1 }).lean();
}

export async function listGestaoSnapshots(limit = 24) {
  return AgentGestaoSnapshot.find()
    .sort({ snapshotAt: -1 })
    .limit(Math.max(1, Math.min(limit, 168)))
    .lean();
}

export function formatTicketsForGestaoLlm(
  tickets: IGestaoTicketSnapshotEntry[],
  maxLines = 500,
): string {
  const lines = tickets.slice(0, maxLines).map((t) => [
    t.protocolo,
    t.status,
    t.responsavel || '—',
    t.produto || '—',
    t.motivo || '—',
    `${t.idleHours}h idle`,
    t.slaBreached ? 'SLA!' : 'ok',
  ].join(' | '));

  const omitted = tickets.length > maxLines ? tickets.length - maxLines : 0;
  const header = `Total no inventário: ${tickets.length}`;
  const body = lines.join('\n') || 'nenhum ticket ativo';
  if (omitted > 0) {
    return `${header}\n${body}\n… (+${omitted} tickets omitidos no resumo LLM; snapshot completo persistido)`;
  }
  return `${header}\n${body}`;
}
