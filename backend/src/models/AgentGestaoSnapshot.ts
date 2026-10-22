/**
 * AgentGestaoSnapshot v1.1.0 — TTL de 24 h
 * VERSION: v1.1.0 | DATE: 2026-10-22
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IGestaoTicketSnapshotEntry {
  ticketId: string;
  protocolo: string;
  status: string;
  titulo: string;
  produto: string;
  motivo: string;
  responsavel: string;
  atribuido: string;
  slaBreached: boolean;
  idleHours: number;
  minutesOpen: number;
  lastInteractionAt: string;
  createdAt: string;
}

export interface IAgentGestaoSnapshot extends Document {
  snapshotAt: Date;
  ticketCount: number;
  countsByStatus: Record<string, number>;
  tickets: IGestaoTicketSnapshotEntry[];
  aggregates: Record<string, unknown>;
  llmSummary?: Record<string, unknown>;
  alertsCreated: number;
  createdAt: Date;
  updatedAt: Date;
}

const GestaoTicketSnapshotEntrySchema = new Schema<IGestaoTicketSnapshotEntry>(
  {
    ticketId: { type: String, required: true },
    protocolo: { type: String, required: true, default: 'sem-protocolo' },
    status: { type: String, required: true },
    titulo: { type: String, default: '' },
    produto: { type: String, default: '' },
    motivo: { type: String, default: '' },
    responsavel: { type: String, default: '' },
    atribuido: { type: String, default: '' },
    slaBreached: { type: Boolean, default: false },
    idleHours: { type: Number, default: 0 },
    minutesOpen: { type: Number, default: 0 },
    lastInteractionAt: { type: String, default: '' },
    createdAt: { type: String, default: '' },
  },
  { _id: false },
);

const AgentGestaoSnapshotSchema = new Schema<IAgentGestaoSnapshot>(
  {
    snapshotAt: { type: Date, required: true, index: true },
    ticketCount: { type: Number, required: true },
    countsByStatus: { type: Schema.Types.Mixed, default: {} },
    tickets: { type: [GestaoTicketSnapshotEntrySchema], default: [] },
    aggregates: { type: Schema.Types.Mixed, default: {} },
    llmSummary: { type: Schema.Types.Mixed },
    alertsCreated: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'agent_gestao_snapshots' },
);

// Só o último dia interessa: o Mongo apaga cada snapshot ao completar 24 h (varredura do TTL a cada ~1 min).
AgentGestaoSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60, name: 'ttl_createdAt_1d' });

export const AgentGestaoSnapshot = mongoose.model<IAgentGestaoSnapshot>(
  'AgentGestaoSnapshot',
  AgentGestaoSnapshotSchema,
);
