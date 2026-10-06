/** AgentSession v1.0.0 — desk_config.desk_agent_sessions — substitui AgentPresence */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IAgentSession extends Document {
  userId: string;
  email: string;
  responsavelKey: string;
  displayName: string;
  online: boolean;
  lastSeenAt: Date | null;
  lastOfflineAt: Date | null;
  lastLoginAt: Date | null;
  forceLogoffAt: Date | null;
  forceLogoffBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AgentSessionSchema = new Schema<IAgentSession>(
  {
    userId: { type: String, required: true },
    email: { type: String, required: true },
    responsavelKey: { type: String, default: '' },
    displayName: { type: String, default: '' },
    online: { type: Boolean, default: false },
    lastSeenAt: { type: Date, default: null },
    lastOfflineAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    forceLogoffAt: { type: Date, default: null },
    forceLogoffBy: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'desk_agent_sessions',
  },
);

AgentSessionSchema.index({ userId: 1 }, { unique: true });
AgentSessionSchema.index({ email: 1 });
AgentSessionSchema.index({ online: 1, lastSeenAt: -1 });

export function getAgentSessionModel(): Model<IAgentSession> {
  const conn = getDeskConfigConnection();
  if (conn.models.AgentSession) {
    return conn.models.AgentSession as Model<IAgentSession>;
  }
  return conn.model<IAgentSession>('AgentSession', AgentSessionSchema);
}
