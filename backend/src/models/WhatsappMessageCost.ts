/**
 * WhatsappMessageCost v1.0.0 — 1 doc por mensagem WhatsApp da Twilio (custo real).
 *
 * Ingestão fiel do que a Twilio devolve — WFM consome pra agregar custo por cliente/período.
 * Chave = `sid` do Twilio (unique). Idempotente: reprocessar mesmo período faz upsert (útil
 * porque a Twilio precifica algumas mensagens só dias depois — `price=null` inicial vira
 * um valor no upsert seguinte).
 *
 * Mesma conexão de `chamados_n1` (`b2c_chamados`) pra que o WFM leia com a credencial
 * que já tem — Padrão A (mongoose.model global), igual `AiUsageLog`.
 */
import mongoose, { Schema, Document } from 'mongoose';

/** Direções da Twilio Messages API. `outbound-*` = nós iniciamos/respondemos; `inbound` = cliente. */
export type WhatsappMessageDirection =
  | 'inbound'
  | 'outbound-api'
  | 'outbound-call'
  | 'outbound-reply';

export interface IWhatsappMessageCost extends Document {
  /** Twilio Message SID (MMxxxxxxxx…) — unique. */
  sid: string;
  /** Subaccount ou parent que originou a mensagem. */
  accountSid: string;
  direction: WhatsappMessageDirection;
  /** "whatsapp:+55…" — como a Twilio devolve. */
  from: string;
  to: string;
  /** Telefone do cliente normalizado (só dígitos com prefixo +), pra agregar por cliente
   *  no WFM sem parsear string toda hora. Derivado de `from`/`to` conforme a direção. */
  clientPhoneE164: string;
  /** Status da entrega: sent/delivered/failed/undelivered/received etc. */
  status: string;
  /** Custo em USD, POSITIVO (Twilio devolve negativo, normalizamos). `null` se ainda não foi precificado. */
  price: number | null;
  priceUnit: string | null;
  numSegments: number | null;
  errorCode: number | null;
  dateSent: Date | null;
  dateCreated: Date | null;
  dateUpdated: Date | null;
  /** _id do ChamadoN1 que contém este SID em `registro.metadados.whatsappMensagens[]`.
   *  Preenchido no sync via lookup; `null` se o SID não foi encontrado (mensagem antiga
   *  anterior ao velodesk, ou fora do fluxo normal). */
  ticketId: string | null;
  /** Timestamp do último sync que gravou/atualizou este doc. */
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsappMessageCostSchema = new Schema<IWhatsappMessageCost>(
  {
    sid: { type: String, required: true, unique: true },
    accountSid: { type: String, required: true },
    direction: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    clientPhoneE164: { type: String, required: true, default: '' },
    status: { type: String, required: true, default: '' },
    price: { type: Number, required: false, default: null },
    priceUnit: { type: String, required: false, default: null },
    numSegments: { type: Number, required: false, default: null },
    errorCode: { type: Number, required: false, default: null },
    dateSent: { type: Date, required: false, default: null },
    dateCreated: { type: Date, required: false, default: null },
    dateUpdated: { type: Date, required: false, default: null },
    ticketId: { type: String, required: false, default: null },
    syncedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true, collection: 'whatsapp_message_costs' },
);

WhatsappMessageCostSchema.index({ dateSent: 1 });
WhatsappMessageCostSchema.index({ clientPhoneE164: 1, dateSent: 1 });
WhatsappMessageCostSchema.index({ ticketId: 1 });
WhatsappMessageCostSchema.index({ direction: 1, dateSent: 1 });

export const WhatsappMessageCost = mongoose.model<IWhatsappMessageCost>(
  'WhatsappMessageCost',
  WhatsappMessageCostSchema,
);
