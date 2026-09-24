/** GmailWatchState v1.0.1 — desk_config.gmail_watch_state */
import { Schema, Document, Model } from 'mongoose';
import { env } from '../config/env';
import { getDeskConfigConnection } from '../config/database';

export interface IGmailWatchState extends Document {
  configKey: string;
  mailbox: string;
  historyId: string;
  expiration: number;
  lastWatchAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GmailWatchStateSchema = new Schema<IGmailWatchState>(
  {
    configKey: { type: String, required: true, unique: true, default: () => env.gmailWatchStateDocumentId },
    mailbox: { type: String, default: '' },
    historyId: { type: String, default: '' },
    expiration: { type: Number, default: 0 },
    lastWatchAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: env.gmailWatchStateCollection,
  }
);

export function getGmailWatchStateModel(): Model<IGmailWatchState> {
  const conn = getDeskConfigConnection();
  if (conn.models.GmailWatchState) {
    return conn.models.GmailWatchState as Model<IGmailWatchState>;
  }
  return conn.model<IGmailWatchState>('GmailWatchState', GmailWatchStateSchema);
}

export async function findGmailWatchSingleton() {
  const Model = getGmailWatchStateModel();
  return Model.findOne({ configKey: env.gmailWatchStateDocumentId }).lean().exec();
}
