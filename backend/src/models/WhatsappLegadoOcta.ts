/** WhatsappLegadoOcta v1.0.0 — conversas de WhatsApp do Octadesk, cluster dedicado (Legado Octa) */
import { Schema, Document, Model } from 'mongoose';
import { getLegacyOctaConnection } from '../config/legacyOctaConnection';

export interface IWhatsappLegadoOctaMessage {
  dateCreation: Date;
  isAgent: boolean;
  authorName: string;
  content: string;
}

export interface IWhatsappLegadoOcta extends Document {
  octadeskRoomId: string;
  protocoloExibicao: string;
  clientPhone: string;
  clientName: string;
  clientCpf: string;
  startedAt: Date | null;
  lastMessageAt: Date | null;
  messages: IWhatsappLegadoOctaMessage[];
  importadoEm: Date;
}

const MessageSchema = new Schema<IWhatsappLegadoOctaMessage>(
  {
    dateCreation: { type: Date, default: null },
    isAgent: { type: Boolean, default: false },
    authorName: { type: String, default: '' },
    content: { type: String, default: '' },
  },
  { _id: false },
);

const WhatsappLegadoOctaSchema = new Schema<IWhatsappLegadoOcta>(
  {
    octadeskRoomId: { type: String, required: true },
    protocoloExibicao: { type: String, default: '' },
    clientPhone: { type: String, default: '' },
    clientName: { type: String, default: '' },
    clientCpf: { type: String, default: '' },
    startedAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    messages: { type: [MessageSchema], default: [] },
    importadoEm: { type: Date, default: Date.now },
  },
  {
    collection: 'whatsapp',
  },
);

WhatsappLegadoOctaSchema.index({ octadeskRoomId: 1 }, { unique: true, name: 'octadeskRoomId_1' });
WhatsappLegadoOctaSchema.index({ clientCpf: 1 }, { name: 'clientCpf_1' });
WhatsappLegadoOctaSchema.index({ clientPhone: 1 }, { name: 'clientPhone_1' });
WhatsappLegadoOctaSchema.index({ protocoloExibicao: 1 }, { name: 'protocoloExibicao_1' });
WhatsappLegadoOctaSchema.index({ lastMessageAt: -1 }, { name: 'lastMessageAt_-1' });

export function getWhatsappLegadoOctaModel(): Model<IWhatsappLegadoOcta> {
  const conn = getLegacyOctaConnection();
  if (conn.models.WhatsappLegadoOcta) {
    return conn.models.WhatsappLegadoOcta as Model<IWhatsappLegadoOcta>;
  }
  return conn.model<IWhatsappLegadoOcta>('WhatsappLegadoOcta', WhatsappLegadoOctaSchema);
}
