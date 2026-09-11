/** EmailDisparoLog v1.0.0 — desk_config.email_disparos_log (idempotência) */
import { Schema, Document, Model, Types } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IEmailDisparoLog extends Document {
  chamadoId: Types.ObjectId;
  protocolo: string;
  conteudoId: Types.ObjectId;
  eventKey: string;
  sentAt: Date;
}

const EmailDisparoLogSchema = new Schema<IEmailDisparoLog>(
  {
    chamadoId: { type: Schema.Types.ObjectId, required: true, index: true },
    protocolo: { type: String, default: '' },
    conteudoId: { type: Schema.Types.ObjectId, required: true },
    eventKey: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
  },
  {
    timestamps: false,
    versionKey: false,
    collection: 'email_disparos_log',
  },
);

EmailDisparoLogSchema.index({ chamadoId: 1, conteudoId: 1, eventKey: 1 }, { unique: true });
/** Ciclo útil do ticket (resolvido→fechado 48h + repescagem CSAT 48h) não passa de ~4 dias; 10 dias dá folga. */
EmailDisparoLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 10 * 24 * 60 * 60 });

export function getEmailDisparoLogModel(): Model<IEmailDisparoLog> {
  const conn = getDeskConfigConnection();
  if (conn.models.EmailDisparoLog) {
    return conn.models.EmailDisparoLog as Model<IEmailDisparoLog>;
  }
  return conn.model<IEmailDisparoLog>('EmailDisparoLog', EmailDisparoLogSchema);
}
