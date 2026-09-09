/**
 * AiUsageLog v1.0.1 — feature casos_especiais (Agente 4)
 * VERSION: v1.0.1 | DATE: 2026-08-07
 */
import mongoose, { Schema, Document } from 'mongoose';

export type AiUsageProvider = 'openai' | 'gemini';

export type AiUsageFeature =
  | 'atendimento'
  | 'auditoria'
  | 'criticidade_triagem'
  | 'gestao_chamados'
  | 'casos_especiais'
  | 'casos_especiais_relacionados'
  | 'ticket_suggest_legacy'
  | 'refinar_rascunho'
  | 'chamado_ia_analise'
  | 'telephony_ia_analise'
  | 'assunto_semelhante';

export interface IAiUsageLog extends Document {
  provider: AiUsageProvider;
  /** Nome do modelo de IA usado na chamada (ex. gpt-4.1-mini, gemini-2.5-flash). Chamado `modelName` para não colidir com `Document.model`. */
  modelName: string;
  feature: AiUsageFeature;
  inputTokens: number;
  outputTokens: number;
  /** Subconjunto de inputTokens servido via cache da OpenAI (usage.input_tokens_details.cached_tokens) — cobrado mais barato. Ausente para Gemini. */
  cachedInputTokens?: number;
  /** Tokens de raciocínio interno consumidos (usage.output_tokens_details.reasoning_tokens), cobrados como output. Ausente para Gemini e modelos sem raciocínio. */
  reasoningTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  pricingSource: 'catalog' | 'fallback';
  ticketId?: string;
  protocolo?: string;
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AiUsageLogSchema = new Schema<IAiUsageLog>(
  {
    provider: { type: String, required: true },
    modelName: { type: String, required: true },
    feature: { type: String, required: true },
    inputTokens: { type: Number, required: true, default: 0 },
    outputTokens: { type: Number, required: true, default: 0 },
    cachedInputTokens: { type: Number, required: false },
    reasoningTokens: { type: Number, required: false },
    totalTokens: { type: Number, required: true, default: 0 },
    estimatedCostUsd: { type: Number, required: true, default: 0 },
    pricingSource: { type: String, required: true, default: 'catalog' },
    ticketId: { type: String },
    protocolo: { type: String },
    userId: { type: String },
  },
  { timestamps: true, collection: 'ai_usage_logs' },
);

AiUsageLogSchema.index({ createdAt: 1 });
AiUsageLogSchema.index({ provider: 1, modelName: 1, feature: 1, createdAt: 1 });

export const AiUsageLog = mongoose.model<IAiUsageLog>('AiUsageLog', AiUsageLogSchema);
