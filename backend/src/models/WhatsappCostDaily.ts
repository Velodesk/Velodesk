/**
 * WhatsappCostDaily v1.0.0 — 1 doc por dia civil BRT (America/Sao_Paulo).
 *
 * Agregado barato pro relatório de custo WhatsApp. Alimentado pelo rollup diário
 * que varre os últimos ~15 dias de `whatsapp_message_costs` e faz upsert por
 * `date` — se a Twilio reprecificar uma mensagem em D+N (comum: null → valor),
 * o run seguinte sobrescreve o doc do dia afetado. Dias com mais de ~15 dias
 * não são reagregados: a Twilio já estabilizou e o número congela.
 *
 * Também cobre crons que falharam em dias anteriores — como a janela é fixa de
 * 15 dias, o próximo run bem-sucedido reagrega todo mundo.
 *
 * Mesma conexão de `chamados_n1` (padrão A, igual `WhatsappMessageCost`).
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IWhatsappCostDaily extends Document {
  /** "YYYY-MM-DD" no fuso America/Sao_Paulo. Unique. */
  date: string;
  /** Soma de `price` do dia em USD (POSITIVO). Mensagens com `price=null` ficam fora. */
  totalUsd: number;
  /** Mensagens outbound-* no dia (nós → cliente). */
  qtdEnviadas: number;
  /** Mensagens inbound no dia (cliente → nós). */
  qtdRecebidas: number;
  /** Mensagens do dia ainda sem `price` (aguardando precificação tardia da Twilio). */
  qtdSemPrice: number;
  /** Último run que gravou/atualizou este doc. */
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsappCostDailySchema = new Schema<IWhatsappCostDaily>(
  {
    date: { type: String, required: true, unique: true },
    totalUsd: { type: Number, required: true, default: 0 },
    qtdEnviadas: { type: Number, required: true, default: 0 },
    qtdRecebidas: { type: Number, required: true, default: 0 },
    qtdSemPrice: { type: Number, required: true, default: 0 },
    calculatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, collection: 'whatsapp_cost_daily' },
);

WhatsappCostDailySchema.index({ date: -1 });

export const WhatsappCostDaily = mongoose.model<IWhatsappCostDaily>(
  'WhatsappCostDaily',
  WhatsappCostDailySchema,
);
