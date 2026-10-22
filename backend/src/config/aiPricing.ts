/**
 * aiPricing v1.0.0 — tabela de preços por modelo para estimativa de custo de IA
 * VERSION: v1.0.0 | DATE: 2026-07-21
 *
 * IMPORTANTE: valores em USD por 1.000.000 de tokens, baseados nos preços públicos
 * de tabela (list price) mais recentes conhecidos na data acima. Eles NÃO refletem
 * necessariamente contratos/descontos negociados nem cobrança real das faturas —
 * revise e ajuste periodicamente conforme a fatura real da OpenAI/Google.
 */

export interface AiModelPricing {
  provider: 'openai' | 'gemini';
  inputPer1M: number;
  outputPer1M: number;
}

export const AI_MODEL_PRICING: Record<string, AiModelPricing> = {
  // OpenAI — Responses/Chat API (USD / 1M tokens)
  'gpt-4.1-mini': { provider: 'openai', inputPer1M: 0.40, outputPer1M: 1.60 },
  'gpt-4.1': { provider: 'openai', inputPer1M: 2.00, outputPer1M: 8.00 },
  'gpt-4o-mini': { provider: 'openai', inputPer1M: 0.15, outputPer1M: 0.60 },
  'gpt-4o': { provider: 'openai', inputPer1M: 2.50, outputPer1M: 10.00 },
  'gpt-5-mini': { provider: 'openai', inputPer1M: 0.25, outputPer1M: 2.00 },
  'gpt-6-luna': { provider: 'openai', inputPer1M: 0.10, outputPer1M: 0.50 },

  // Gemini — Generative AI API (USD / 1M tokens, faixa de contexto padrão)
  'gemini-2.5-flash': { provider: 'gemini', inputPer1M: 0.30, outputPer1M: 2.50 },
  'gemini-2.5-flash-lite': { provider: 'gemini', inputPer1M: 0.10, outputPer1M: 0.40 },
  'gemini-2.5-pro': { provider: 'gemini', inputPer1M: 1.25, outputPer1M: 10.00 },
};

/** Usado quando o modelo retornado pela API não está no catálogo acima — mantém o custo visível (marcado como estimativa grosseira) em vez de zerar silenciosamente. */
const FALLBACK_PRICING: AiModelPricing = { provider: 'openai', inputPer1M: 1.00, outputPer1M: 3.00 };

/** A OpenAI costuma devolver em `response.model` o snapshot datado resolvido do alias pedido (ex. "gpt-4.1-mini-2025-04-14" para um request de "gpt-4.1-mini") — removemos esse sufixo antes de comparar com o catálogo. */
function stripDatedSnapshotSuffix(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

export function resolveModelPricing(model: string): { pricing: AiModelPricing; source: 'catalog' | 'fallback' } {
  const normalized = stripDatedSnapshotSuffix(String(model || '').trim().toLowerCase());
  const found = Object.entries(AI_MODEL_PRICING).find(([key]) => key.toLowerCase() === normalized);
  if (found) return { pricing: found[1], source: 'catalog' };
  return { pricing: FALLBACK_PRICING, source: 'fallback' };
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): { costUsd: number; source: 'catalog' | 'fallback' } {
  const { pricing, source } = resolveModelPricing(model);
  const costUsd =
    (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPer1M
    + (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPer1M;
  return { costUsd, source };
}
