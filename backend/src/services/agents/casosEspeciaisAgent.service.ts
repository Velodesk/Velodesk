/**
 * casosEspeciaisAgent.service v1.0.0 — classificação LLM do Agente 4
 * VERSION: v1.0.0 | DATE: 2026-08-07
 */
import { reasoningParams } from './openaiAgent.util';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { adaptChamadoToTicketIa, buildTicketIaText } from '../ticketIaAdapter.service';
import {
  createOpenAiClient,
  extractOutputText,
  isAgentsConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { getCasosEspeciaisPersona } from './personas/casosEspeciaisPersona';
import type {
  CasoEspecialClassificacao,
  CasoEspecialConfianca,
  CasoEspecialOrgao,
  CasoEspecialTriagemResult,
} from './casosEspeciais.types';
import { logAiUsage } from '../aiUsage.service';

const TRIAGEM_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    classificacao: {
      type: 'string',
      enum: ['caso_formal_real', 'ameaca_vazia', 'falso_positivo'],
    },
    orgao: {
      type: 'string',
      enum: ['reclame_aqui', 'procon', 'bacen', 'consumidor_gov', 'indefinido'],
    },
    confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    evidencia: { type: 'string' },
    justificativa: { type: 'string' },
  },
  required: ['classificacao', 'orgao', 'confianca', 'evidencia', 'justificativa'],
} as const;

interface TriagemParsed {
  classificacao?: CasoEspecialClassificacao;
  orgao?: CasoEspecialOrgao;
  confianca?: CasoEspecialConfianca;
  evidencia?: string;
  justificativa?: string;
}

function buildUserBlock(
  chamado: IChamadoN1,
  signals: string[],
  origemProvavel: CasoEspecialOrgao | null,
): string {
  const payload = adaptChamadoToTicketIa(chamado);
  const texto = payload ? buildTicketIaText(payload, 4000) : String(chamado.chamadoTitulo ?? '');
  return [
    `Protocolo: ${chamado.chamadoProtocolo || '(sem protocolo)'}`,
    `Sinais detectados: ${signals.join(', ') || 'nenhum'}`,
    `Origem provável (pré-check): ${origemProvavel || 'indefinido'}`,
    '',
    'Contexto do ticket:',
    texto,
  ].join('\n');
}

export async function classifyCasosEspeciais(params: {
  chamado: IChamadoN1;
  signals: string[];
  origemProvavel: CasoEspecialOrgao | null;
}): Promise<{ success: boolean; result?: CasoEspecialTriagemResult; error?: string }> {
  if (!isAgentsConfigured()) {
    return { success: false, error: 'OpenAI não configurado' };
  }

  try {
    const openai = createOpenAiClient();
    const userBlock = buildUserBlock(params.chamado, params.signals, params.origemProvavel);

    const response = await openai.responses.create({
      model: env.openaiModel,
      ...reasoningParams(),
      input: [
        { role: 'system', content: getCasosEspeciaisPersona() },
        { role: 'user', content: userBlock },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_casos_especiais',
          schema: TRIAGEM_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const model = response.model || env.openaiModel;
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model,
        feature: 'casos_especiais',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: String(params.chamado._id),
        protocolo: params.chamado.chamadoProtocolo,
      });
    }

    const parsed = parseAiJson<TriagemParsed>(extractOutputText(response));
    if (!parsed?.classificacao) {
      return { success: false, error: 'Resposta de triagem inválida' };
    }

    return {
      success: true,
      result: {
        classificacao: parsed.classificacao,
        orgao: parsed.orgao || params.origemProvavel || 'indefinido',
        confianca: parsed.confianca || 'media',
        evidencia: String(parsed.evidencia ?? '').trim(),
        justificativa: String(parsed.justificativa ?? '').trim(),
      },
    };
  } catch (err) {
    console.error('[agent-casos-especiais]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}

export function buildFastPathTriagem(
  orgao: CasoEspecialOrgao | null,
  signals: string[],
): CasoEspecialTriagemResult {
  return {
    classificacao: 'caso_formal_real',
    orgao: orgao || 'indefinido',
    confianca: 'alta',
    evidencia: signals.join(', ') || 'canal formal + remetente institucional',
    justificativa: 'Fast-path: origem formal confirmada sem necessidade de LLM.',
  };
}
