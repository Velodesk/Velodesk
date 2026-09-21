/** TicketLegadoOcta v1.0.0 — ticket "quase-cru" do Octadesk, cluster dedicado (módulo Legado Octa) */
import { Schema, Document, Model } from 'mongoose';
import { getLegacyOctaConnection } from '../config/legacyOctaConnection';

export interface ITicketLegadoOctaComment {
  content: string;
  isPublic: boolean;
}

export interface ITicketLegadoOctaAttachment {
  name: string;
  url: string;
}

export interface ITicketLegadoOctaInteraction {
  dateCreation: Date;
  personName: string;
  personEmail: string;
  comments: ITicketLegadoOctaComment[];
  attachments: ITicketLegadoOctaAttachment[];
  propertiesChanges: Record<string, unknown>;
}

export interface ITicketLegadoOcta extends Document {
  octadeskNumber: number;
  octadeskId: string;
  protocoloExibicao: string;
  summary: string;
  topicGroupName: string;
  topicName: string;
  requesterName: string;
  requesterMail: string;
  requesterCpf: string;
  openDate: Date | null;
  customField: Record<string, unknown>;
  interactions: ITicketLegadoOctaInteraction[];
  importadoEm: Date;
}

const CommentSchema = new Schema<ITicketLegadoOctaComment>(
  {
    content: { type: String, default: '' },
    isPublic: { type: Boolean, default: true },
  },
  { _id: false },
);

const AttachmentSchema = new Schema<ITicketLegadoOctaAttachment>(
  {
    name: { type: String, default: '' },
    url: { type: String, default: '' },
  },
  { _id: false },
);

const InteractionSchema = new Schema<ITicketLegadoOctaInteraction>(
  {
    dateCreation: { type: Date, default: null },
    personName: { type: String, default: '' },
    personEmail: { type: String, default: '' },
    comments: { type: [CommentSchema], default: [] },
    attachments: { type: [AttachmentSchema], default: [] },
    propertiesChanges: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false },
);

const TicketLegadoOctaSchema = new Schema<ITicketLegadoOcta>(
  {
    octadeskNumber: { type: Number, required: true },
    octadeskId: { type: String, default: '' },
    protocoloExibicao: { type: String, default: '' },
    summary: { type: String, default: '' },
    topicGroupName: { type: String, default: '' },
    topicName: { type: String, default: '' },
    requesterName: { type: String, default: '' },
    requesterMail: { type: String, default: '' },
    requesterCpf: { type: String, default: '' },
    openDate: { type: Date, default: null },
    customField: { type: Schema.Types.Mixed, default: {} },
    interactions: { type: [InteractionSchema], default: [] },
    importadoEm: { type: Date, default: Date.now },
  },
  {
    collection: 'tickets',
  },
);

TicketLegadoOctaSchema.index({ octadeskNumber: 1 }, { unique: true, name: 'octadeskNumber_1' });
TicketLegadoOctaSchema.index({ requesterCpf: 1 }, { name: 'requesterCpf_1' });
TicketLegadoOctaSchema.index({ protocoloExibicao: 1 }, { name: 'protocoloExibicao_1' });
TicketLegadoOctaSchema.index({ openDate: -1 }, { name: 'openDate_-1' });

export function getTicketLegadoOctaModel(): Model<ITicketLegadoOcta> {
  const conn = getLegacyOctaConnection();
  if (conn.models.TicketLegadoOcta) {
    return conn.models.TicketLegadoOcta as Model<ITicketLegadoOcta>;
  }
  return conn.model<ITicketLegadoOcta>('TicketLegadoOcta', TicketLegadoOctaSchema);
}
