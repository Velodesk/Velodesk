/**
 * casosEspeciaisRelacionadosAgent.service v1.0.0 — Agente 5, correlação LLM de tickets relacionados
 * VERSION: v1.0.0 | DATE: 2026-09-09
 */
import { env } from '../../config/env';
import {
  createOpenAiClient,
  extractOutputText,
  isAgentsConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { getCasosEspeciaisRelacionadosPersona } from './personas/casosEspeciaisRelacionadosPersona';
import type {
  CasoRelacionadoCandidato,
  CasoRelacionadoCriterio,
  CasoRelacionadoLlmResult,
  CasoRelacionadoTicketBlock,
} from './casosEspeciaisRelacionados.types';
import { logAiUsage } from '../aiUsage.service';

const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id_ticket_atual: { type: 'string' },
    tickets_relacionados: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id_ticket: { type: 'string' },
          score_similaridade: { type: 'integer' },
          criterios: {
            type: 'array',
            items: {
              type: 'string',
              enum: [
                'mesmo_motivo_categoria',
                'mesmo_contrato_operacao',
                'recorrencia_nao_resolvida',
                'similaridade_semantica',
              ],
            },
          },
          motivo: { type: 'string' },
        },
        required: ['id_ticket', 'score_similaridade', 'criterios', 'motivo'],
      },
    },
    resumo_executivo: { type: 'string' },
  },
  required: ['id_ticket_atual', 'tickets_relacionados', 'resumo_executivo'],
} as const;

function buildUserBlock(
  ticketAtual: CasoRelacionadoTicketBlock,
  candidatos: CasoRelacionadoCandidato[],
): string {
  const payload = {
    ticket_atual: ticketAtual,
    historico_tickets: candidatos.map((c) => c.block),
  };
  return JSON.stringify(payload);
}

export async function classifyCasosEspeciaisRelacionados(params: {
  ticketAtual: CasoRelacionadoTicketBlock;
  candidatos: CasoRelacionadoCandidato[];
  ticketId: string;
  protocolo?: string;
}): Promise<{ success: boolean; result?: CasoRelacionadoLlmResult; error?: string }> {
  if (!isAgentsConfigured()) {
    return { success: false, error: 'OpenAI não configurado' };
  }

  try {
    const openai = createOpenAiClient();
    const userBlock = buildUserBlock(params.ticketAtual, params.candidatos);

    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: getCasosEspeciaisRelacionadosPersona() },
        { role: 'user', content: userBlock },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_casos_especiais_relacionados',
          schema: OUTPUT_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const model = response.model || env.openaiModel;
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model,
        feature: 'casos_especiais_relacionados',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: params.ticketId,
        protocolo: params.protocolo,
      });
    }

    const parsed = parseAiJson<CasoRelacionadoLlmResult>(extractOutputText(response));
    if (!parsed || !Array.isArray(parsed.tickets_relacionados)) {
      return { success: false, error: 'Resposta de correlação inválida' };
    }

    const validCriterios = new Set<CasoRelacionadoCriterio>([
      'mesmo_motivo_categoria',
      'mesmo_contrato_operacao',
      'recorrencia_nao_resolvida',
      'similaridade_semantica',
    ]);

    return {
      success: true,
      result: {
        id_ticket_atual: String(parsed.id_ticket_atual ?? params.ticketAtual.id_ticket),
        tickets_relacionados: parsed.tickets_relacionados
          .filter((item) => item && typeof item.id_ticket === 'string')
          .map((item) => ({
            id_ticket: item.id_ticket,
            score_similaridade: Math.max(0, Math.min(100, Math.round(Number(item.score_similaridade) || 0))),
            criterios: (Array.isArray(item.criterios) ? item.criterios : []).filter((c) =>
              validCriterios.has(c as CasoRelacionadoCriterio),
            ) as CasoRelacionadoCriterio[],
            motivo: String(item.motivo ?? '').trim(),
          })),
        resumo_executivo: String(parsed.resumo_executivo ?? '').trim(),
      },
    };
  } catch (err) {
    console.error('[agent-casos-especiais-relacionados]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}
