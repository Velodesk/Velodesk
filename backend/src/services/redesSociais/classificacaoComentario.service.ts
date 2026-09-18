/** classificacaoComentario.service v1.0.0 — classifica comentário/avaliação de rede social
 * (sentimento + motivo) via OpenAI, mesmo padrão dos demais agentes do Velodesk. */
import { env } from '../../config/env';
import {
  createOpenAiClient,
  extractOutputText,
  isOpenAiApiKeyConfigured,
  parseAiJson,
} from '../agents/openaiAgent.util';
import { logAiUsage } from '../aiUsage.service';
import { REDES_SOCIAIS_MOTIVOS, RedesSociaisMotivo, RedesSociaisSentimento } from '../../models/RedesSociaisComentario';
import type { ComentarioParaClassificar } from './redesSociaisComentario.service';

const SENTIMENTOS_POSSIVEIS: RedesSociaisSentimento[] = ['positivo', 'neutro', 'negativo'];

const CLASSIFICACAO_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sentimento: { type: 'string', enum: SENTIMENTOS_POSSIVEIS },
    motivo: { type: 'string', enum: REDES_SOCIAIS_MOTIVOS },
    confianca: { type: 'integer', description: 'Confiança da classificação, de 0 a 100' },
  },
  required: ['sentimento', 'motivo', 'confianca'],
} as const;

const PERSONA = [
  'Você classifica comentários/avaliações de clientes de uma empresa de tecnologia',
  'tributária (Velotax), recebidos via Facebook, Instagram ou Google Play.',
  '',
  'Responda com sentimento (positivo/neutro/negativo), motivo (a opção da lista que',
  'melhor descreve o comentário) e confiança (0 a 100) da sua própria classificação.',
].join('\n');

export interface ResultadoClassificacao {
  sentimento: RedesSociaisSentimento;
  motivo: RedesSociaisMotivo;
  confianca: number;
}

interface ClassificacaoParsed {
  sentimento?: RedesSociaisSentimento;
  motivo?: RedesSociaisMotivo;
  confianca?: number;
}

function buildUserBlock(comentario: ComentarioParaClassificar): string {
  return [
    `Canal: ${comentario.canal}`,
    comentario.notaEstrelas ? `Nota dada pelo cliente: ${comentario.notaEstrelas} estrelas` : null,
    `Comentário do cliente: "${comentario.mensagem}"`,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Classifica um comentário/avaliação. Retorna `null` (em vez de lançar) quando a IA não
 * está configurada ou a resposta vem fora do formato esperado — quem chama decide se pula
 * o item ou tenta de novo num ciclo seguinte; nunca derruba o ciclo de captação inteiro.
 */
export async function classificarComentario(
  comentario: ComentarioParaClassificar,
): Promise<ResultadoClassificacao | null> {
  if (!isOpenAiApiKeyConfigured()) return null;

  try {
    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: PERSONA },
        { role: 'user', content: buildUserBlock(comentario) },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'redes_sociais_classificacao',
          schema: CLASSIFICACAO_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model: response.model || env.openaiModel,
        feature: 'redes_sociais_classificacao',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
      });
    }

    const parsed = parseAiJson<ClassificacaoParsed>(extractOutputText(response));
    if (
      !parsed?.sentimento
      || !SENTIMENTOS_POSSIVEIS.includes(parsed.sentimento)
      || !parsed?.motivo
      || !REDES_SOCIAIS_MOTIVOS.includes(parsed.motivo)
    ) {
      return null;
    }

    return {
      sentimento: parsed.sentimento,
      motivo: parsed.motivo,
      confianca: Math.min(100, Math.max(0, Math.round(parsed.confianca ?? 0))),
    };
  } catch (err) {
    console.warn('[redes-sociais-classificacao] falha ao classificar:', (err as Error).message);
    return null;
  }
}
