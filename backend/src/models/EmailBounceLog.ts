/** EmailBounceLog v1.0.0 — desk_config.email_bounce_log (bounces/DSN descartados sem virar ticket) */
import { Schema, Document, Model, Types } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IEmailBounceLog extends Document {
  _id: Types.ObjectId;
  fromEmail: string;
  subject: string;
  messageId: string;
  receivedAt: Date;
  viewed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmailBounceLogSchema = new Schema<IEmailBounceLog>(
  {
    fromEmail: { type: String, required: true, index: true },
    subject: { type: String, default: '' },
    messageId: { type: String, default: '' },
    receivedAt: { type: Date, required: true },
    viewed: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    collection: 'email_bounce_log',
  },
);

EmailBounceLogSchema.index({ viewed: 1, receivedAt: -1 });

export function getEmailBounceLogModel(): Model<IEmailBounceLog> {
  const conn = getDeskConfigConnection();
  if (conn.models.EmailBounceLog) {
    return conn.models.EmailBounceLog as Model<IEmailBounceLog>;
  }
  return conn.model<IEmailBounceLog>('EmailBounceLog', EmailBounceLogSchema);
}
