/**
 * gestaoChamadosAgent.service v1.1.0 — ciclo horário com snapshot completo de tickets ativos
 * VERSION: v1.1.0 | DATE: 2026-07-14
 */
import { reasoningParams } from './openaiAgent.util';
import { AgentGestaoAlert } from '../../models/AgentGestaoAlert';
import { env } from '../../config/env';
import { chamadoToTicket } from '../chamado.mapper';
import { ChamadoN1 } from '../../models/ChamadoN1';
import { getGestaoChamadosPersona } from './personas/gestaoChamadosPersona';
import {
  buildGestaoHourlySnapshot,
  formatTicketsForGestaoLlm,
  persistGestaoSnapshot,
  type GestaoHourlySnapshot,
  type GestaoSnapshotAggregates,
} from './gestaoSnapshot.service';
import {
  createOpenAiClient,
  extractOutputText,
  isAgentsConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { logAiUsage } from '../aiUsage.service';

export type GestaoSnapshot = GestaoHourlySnapshot;

function buildGestaoUserBlock(snapshot: GestaoHourlySnapshot): string {
  const agg = snapshot.aggregates;
  return [
    `## Ciclo de monitoramento (snapshot horário)`,
    `Timestamp: ${snapshot.snapshotAt}`,
    `Janela de pico: ${snapshot.spikeWindowMin} minutos`,
    `Tickets ativos no inventário: ${snapshot.ticketCount}`,
    '',
    '## Contagens por status',
    Object.entries(snapshot.countsByStatus).map(([k, v]) => `${k}: ${v}`).join(' | '),
    '',
    '## SLA estourados',
    agg.slaBreached.map((s) => `${s.protocolo} (${s.status}, ${s.hours}h)`).join('\n') || 'nenhum',
    '',
    '## Sem responsável',
    agg.semResponsavel.map((s) => `${s.protocolo} (${s.minutes} min)`).join('\n') || 'nenhum',
    '',
    '## Parados',
    agg.parados.map((s) => `${s.protocolo} (${s.hours}h)`).join('\n') || 'nenhum',
    '',
    '## Pico inbound',
    `volume_janela: ${agg.spike.volume}`,
    `volume_baseline: ${agg.spike.baseline}`,
    `variacao_percentual: ${agg.spike.variationPct}%`,
    '',
    '## Temas agrupados',
    agg.themes.map((t) => `${t.key}: ${t.count}`).join('\n') || 'nenhum',
    '',
    '## Inventário completo de tickets ativos',
    'Formato: protocolo | status | responsável | produto | motivo | idle | SLA',
    formatTicketsForGestaoLlm(snapshot.tickets),
  ].join('\n');
}

const GESTAO_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resumoExecutivo: { type: 'string' },
    severidade: { type: 'string' },
    temasRecorrentes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tema: { type: 'string' },
          volume: { type: 'number' },
          tendencia: { type: 'string' },
        },
        required: ['tema', 'volume', 'tendencia'],
      },
    },
    alertas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tipo: { type: 'string' },
          protocolo: { type: 'string' },
          descricao: { type: 'string' },
          severidade: { type: 'string' },
        },
        required: ['tipo', 'protocolo', 'descricao', 'severidade'],
      },
    },
    acoesRecomendadas: { type: 'array', items: { type: 'string' } },
  },
  required: ['resumoExecutivo', 'severidade', 'temasRecorrentes', 'alertas', 'acoesRecomendadas'],
} as const;

async function createGestaoAlertsFromSnapshot(
  snapshot: GestaoHourlySnapshot,
  llmSummary?: Record<string, unknown>,
): Promise<number> {
  let alertsCreated = 0;
  const agg = snapshot.aggregates;

  if (agg.spike.volume >= env.gestaoSpikeThreshold) {
    await AgentGestaoAlert.create({
      tipo: 'pico_inbound',
      severidade: agg.spike.variationPct > 100 ? 'alta' : 'media',
      resumo: `Pico inbound: ${agg.spike.volume} chamados em ${snapshot.spikeWindowMin} min (+${agg.spike.variationPct}%)`,
      detalhes: { snapshotAt: snapshot.snapshotAt, ticketCount: snapshot.ticketCount, llmSummary },
    });
    alertsCreated += 1;
  }

  for (const item of agg.slaBreached.slice(0, 20)) {
    await AgentGestaoAlert.create({
      tipo: 'sla_estourado',
      severidade: 'alta',
      protocolo: item.protocolo,
      resumo: `SLA estourado — ${item.protocolo} (${item.status}, ${item.hours}h)`,
      detalhes: item,
    });
    alertsCreated += 1;
  }

  for (const item of agg.semResponsavel.slice(0, 20)) {
    await AgentGestaoAlert.create({
      tipo: 'sem_responsavel',
      severidade: 'media',
      protocolo: item.protocolo,
      resumo: `Sem responsável — ${item.protocolo} (${item.minutes} min)`,
      detalhes: item,
    });
    alertsCreated += 1;
  }

  return alertsCreated;
}

export async function runGestaoChamadosCycle(): Promise<{
  success: boolean;
  snapshot?: GestaoHourlySnapshot;
  snapshotId?: string;
  llmSummary?: Record<string, unknown>;
  alertsCreated?: number;
  error?: string;
}> {
  try {
    const snapshot = await buildGestaoHourlySnapshot();
    let llmSummary: Record<string, unknown> | undefined;
    let alertsCreated = 0;

    const agg = snapshot.aggregates;
    const hasAnomaly = agg.slaBreached.length > 0
      || agg.semResponsavel.length > 0
      || agg.parados.length > 0
      || agg.spike.volume >= env.gestaoSpikeThreshold
      || snapshot.ticketCount > 0;

    if (hasAnomaly && isAgentsConfigured()) {
      try {
        const openai = createOpenAiClient();
        const response = await openai.responses.create({
          model: env.openaiModel,
          ...reasoningParams(),
          input: [
            { role: 'system', content: getGestaoChamadosPersona() },
            { role: 'user', content: buildGestaoUserBlock(snapshot) },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'agent_gestao',
              schema: GESTAO_JSON_SCHEMA,
              strict: true,
            },
          },
        });
        if (response.usage) {
          void logAiUsage({
            provider: 'openai',
            model: response.model || env.openaiModel,
            feature: 'gestao_chamados',
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
            reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
          });
        }

        const raw = extractOutputText(response);
        llmSummary = parseAiJson<Record<string, unknown>>(raw) || undefined;
      } catch (llmErr) {
        console.warn('[agent-gestao] LLM resumo falhou:', (llmErr as Error).message);
      }
    }

    alertsCreated = await createGestaoAlertsFromSnapshot(snapshot, llmSummary);

    const persisted = await persistGestaoSnapshot({
      snapshot,
      llmSummary,
      alertsCreated,
    });

    console.info('[agent-gestao] snapshot horário concluído', {
      snapshotId: String(persisted._id),
      ticketCount: snapshot.ticketCount,
      slaBreached: agg.slaBreached.length,
      semResponsavel: agg.semResponsavel.length,
      parados: agg.parados.length,
      spike: agg.spike.volume,
      alertsCreated,
    });

    return {
      success: true,
      snapshot,
      snapshotId: String(persisted._id),
      llmSummary,
      alertsCreated,
    };
  } catch (err) {
    console.error('[agent-gestao]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}

/** @deprecated use buildGestaoHourlySnapshot — mantido para compatibilidade interna */
export async function buildGestaoSnapshot(): Promise<GestaoHourlySnapshot> {
  return buildGestaoHourlySnapshot();
}

export type { GestaoSnapshotAggregates };

export async function getGestaoTicketsPreview(limit = 10) {
  const chamados = await ChamadoN1.find({}).sort({ updatedAt: -1 }).limit(limit);
  return Promise.all(chamados.map((c) => chamadoToTicket(c)));
}
