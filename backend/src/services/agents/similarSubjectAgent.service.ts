/**
 * similarSubjectAgent.service v1.0.0 — compara o assunto da reclamação atual com o histórico
 * de tickets do cliente (por CPF), pra destacar reclamações sobre o mesmo tema.
 */
import { env } from '../../config/env';
import {
  createOpenAiClient,
  extractOutputText,
  isOpenAiApiKeyConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { getSimilarSubjectPersona } from './personas/similarSubjectPersona';
import { logAiUsage } from '../aiUsage.service';

const SIMILAR_SUBJECT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          motivo: { type: 'string' },
        },
        required: ['id', 'motivo'],
      },
    },
  },
  required: ['matches'],
} as const;

interface SimilarSubjectParsed {
  matches?: { id?: string; motivo?: string }[];
}

export interface SimilarSubjectCandidate {
  id: string;
  title: string;
}

export interface SimilarSubjectMatch {
  id: string;
  motivo: string;
}

function buildUserBlock(currentSubject: string, candidates: SimilarSubjectCandidate[]): string {
  const lista = candidates
    .map((c) => `- id: ${c.id} | assunto: ${c.title}`)
    .join('\n');
  return [
    `Assunto da reclamação atual: ${currentSubject}`,
    '',
    'Tickets anteriores do mesmo cliente:',
    lista,
  ].join('\n');
}

export async function findSimilarSubjectTickets(params: {
  currentSubject: string;
  candidates: SimilarSubjectCandidate[];
  ticketId?: string;
  protocolo?: string;
  userId?: string;
}): Promise<{ success: boolean; matches?: SimilarSubjectMatch[]; error?: string }> {
  if (!isOpenAiApiKeyConfigured()) {
    return { success: false, error: 'OpenAI não configurado' };
  }

  try {
    const openai = createOpenAiClient();
    const userBlock = buildUserBlock(params.currentSubject, params.candidates);

    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: getSimilarSubjectPersona() },
        { role: 'user', content: userBlock },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_assunto_semelhante',
          schema: SIMILAR_SUBJECT_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const model = response.model || env.openaiModel;
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model,
        feature: 'assunto_semelhante',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: params.ticketId,
        protocolo: params.protocolo,
        userId: params.userId,
      });
    }

    const parsed = parseAiJson<SimilarSubjectParsed>(extractOutputText(response));
    const matches = (parsed?.matches ?? [])
      .filter((m): m is { id: string; motivo: string } => Boolean(m?.id))
      .map((m) => ({ id: String(m.id), motivo: String(m.motivo ?? '').trim() }));

    return { success: true, matches };
  } catch (err) {
    console.error('[agent-assunto-semelhante]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}
