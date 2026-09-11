/** GmailInboundMessage v1.0.0 — desk_config.gmail_inbound_messages (idempotência inbound) */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export const GMAIL_INBOUND_MESSAGES_COLLECTION = 'gmail_inbound_messages';

export type GmailInboundMessageStatus = 'processing' | 'done' | 'failed';

export interface IGmailInboundMessage extends Document {
  messageId: string;
  status: GmailInboundMessageStatus;
  action?: string;
  chamadoProtocolo?: string;
  ticketId?: string;
  error?: string;
  attempts: number;
  claimedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GmailInboundMessageSchema = new Schema<IGmailInboundMessage>(
  {
    messageId: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: ['processing', 'done', 'failed'], default: 'processing' },
    action: { type: String, default: '' },
    chamadoProtocolo: { type: String, default: '' },
    ticketId: { type: String, default: '' },
    error: { type: String, default: '' },
    attempts: { type: Number, default: 1 },
    claimedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: GMAIL_INBOUND_MESSAGES_COLLECTION,
  },
);

GmailInboundMessageSchema.index({ status: 1, claimedAt: 1 });
/** Só serve pra dedupe de reentrega do Pub/Sub (janela de retry de horas) — 7 dias dá folga ampla. */
GmailInboundMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

export function getGmailInboundMessageModel(): Model<IGmailInboundMessage> {
  const conn = getDeskConfigConnection();
  if (conn.models.GmailInboundMessage) {
    return conn.models.GmailInboundMessage as Model<IGmailInboundMessage>;
  }
  return conn.model<IGmailInboundMessage>('GmailInboundMessage', GmailInboundMessageSchema);
}

export async function ensureGmailInboundMessageIndexes(): Promise<void> {
  const Model = getGmailInboundMessageModel();
  await Model.collection.createIndex({ messageId: 1 }, { unique: true, name: 'messageId_unique' });
}
