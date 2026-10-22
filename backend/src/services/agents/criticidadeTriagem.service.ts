/**
 * criticidadeTriagem.service v1.0.0 — avalia se palavra-chave crítica detectada por regex
 * (criticalKeywords.service) representa ameaça real antes do handoff mecânico pro Agente Gestor.
 */
import { reasoningParams } from './openaiAgent.util';
import { env } from '../../config/env';
import { getCriticidadeTriagemPersona } from './personas/criticidadeTriagemPersona';
import {
  createOpenAiClient,
  extractOutputText,
  isAgentsConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { logAiUsage } from '../aiUsage.service';

export interface CriticidadeTriagemResult {
  ameacaReal: boolean;
  motivo: string;
}

interface TriagemParsed {
  ameacaReal?: boolean;
  motivo?: string;
}

const TRIAGEM_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ameacaReal: { type: 'boolean' },
    motivo: { type: 'string' },
  },
  required: ['ameacaReal', 'motivo'],
  additionalProperties: false,
} as const;

/**
 * Falha segura escolhida pra este gatilho: erro na chamada de IA = trata como coincidência
 * (não escalona). Prioriza evitar alarme falso a bloquear o fluxo por instabilidade da API.
 */
const FAIL_OPEN_RESULT: CriticidadeTriagemResult = {
  ameacaReal: false,
  motivo: 'Avaliação de triagem indisponível — tratado como coincidência (falha segura).',
};

export async function avaliarAmeacaCritica(
  contextText: string,
  keywords: string[],
  opts: { protocolo?: string; userId?: string } = {},
): Promise<CriticidadeTriagemResult> {
  if (!isAgentsConfigured()) return FAIL_OPEN_RESULT;

  const texto = String(contextText || '').trim();
  if (!texto) return FAIL_OPEN_RESULT;

  try {
    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      ...reasoningParams(),
      input: [
        { role: 'system', content: getCriticidadeTriagemPersona() },
        {
          role: 'user',
          content: `Palavras-gatilho detectadas: ${keywords.join(', ')}\n\nConversa do ticket:\n${texto}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'criticidade_triagem',
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
        feature: 'criticidade_triagem',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        protocolo: opts.protocolo,
        userId: opts.userId,
      });
    }

    const rawText = extractOutputText(response);
    const parsed = parseAiJson<TriagemParsed>(rawText);
    if (!parsed || typeof parsed.ameacaReal !== 'boolean') return FAIL_OPEN_RESULT;

    return {
      ameacaReal: parsed.ameacaReal,
      motivo: String(parsed.motivo || '').trim() || (parsed.ameacaReal ? 'Ameaça real confirmada.' : 'Coincidência.'),
    };
  } catch (err) {
    console.error('[criticidade-triagem]', mapOpenAiErrorMessage(err));
    return FAIL_OPEN_RESULT;
  }
}
