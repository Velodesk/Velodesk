/**
 * WaActiveConversation v1.0.0 — desk_config.wa_active_conversations
 * Ponteiro telefone+canal → ticket ativo, usado pra desambiguar roteamento de inbound do
 * WhatsApp quando o mesmo número tem conversas abertas em canais diferentes (ticket padrão vs.
 * um dos módulos de casos especiais). Índice único parcial garante no máximo um ponteiro ATIVO
 * por telefone+canal — ponteiros inativos (ticket fechado) ficam de histórico, sem violar isso.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export const WA_CONVERSATION_CANAIS = [
  'whatsapp',
  'reclame_aqui',
  'procon',
  'bacen',
  'consumidor_gov',
] as const;
export type WaConversationCanal = (typeof WA_CONVERSATION_CANAIS)[number];

export const WA_TICKET_COLLECTIONS = [
  'chamados_n1',
  'reclamacoes_reclameAqui',
  'reclamacoes_procon',
  'reclamacoes_bacen',
  'reclamacoes_consumidorGov',
] as const;
export type WaTicketCollection = (typeof WA_TICKET_COLLECTIONS)[number];

export interface IWaActiveConversation extends Document {
  phoneDigits: string;
  phoneE164: string;
  canal: WaConversationCanal;
  ticketId: string;
  ticketCollection: WaTicketCollection;
  ticketProtocolo: string;
  active: boolean;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const WaActiveConversationSchema = new Schema<IWaActiveConversation>(
  {
    phoneDigits: { type: String, required: true, trim: true },
    phoneE164: { type: String, default: '' },
    canal: { type: String, required: true, enum: WA_CONVERSATION_CANAIS },
    ticketId: { type: String, required: true },
    ticketCollection: { type: String, required: true, enum: WA_TICKET_COLLECTIONS },
    ticketProtocolo: { type: String, default: '' },
    active: { type: Boolean, default: true },
    closedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'wa_active_conversations',
  },
);

// Único parcial: no máximo um ponteiro ATIVO por telefone+canal — ponteiros desativados
// (ticket fechado/cancelado/resolvido fora da janela) não contam pra unicidade.
WaActiveConversationSchema.index(
  { phoneDigits: 1, canal: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
WaActiveConversationSchema.index({ phoneDigits: 1, active: 1 });
WaActiveConversationSchema.index({ ticketId: 1, ticketCollection: 1 });
/** Ponteiro inativo não tem consumidor (só find({active:true}) é lido) — expira 30 dias após
 * fechar. closedAt fica null enquanto ativo, e o Mongo nunca expira campo TTL nulo/ausente. */
WaActiveConversationSchema.index({ closedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export function getWaActiveConversationModel(): Model<IWaActiveConversation> {
  const conn = getDeskConfigConnection();
  if (conn.models.WaActiveConversation) {
    return conn.models.WaActiveConversation as Model<IWaActiveConversation>;
  }
  return conn.model<IWaActiveConversation>('WaActiveConversation', WaActiveConversationSchema);
}
