/**
 * AgentAutonomyRule v1.1.0 — regras configuráveis de envio autônomo (escopo = árvore de tabulação)
 * VERSION: v1.1.0 | DATE: 2026-10-07
 *
 * Escopo hierárquico: produto (obrigatório) > motivo > detalhe. Campo vazio = curinga para baixo.
 * `tipo` é legado: mantido no schema, mas não usado como filtro.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentAutonomyRule extends Document {
  enabled: boolean;
  tipo?: string;
  produto?: string;
  motivo?: string;
  detalhe?: string;
  minAuditScore: number;
  maxMessagesInThread: number;
  canais: string[];
  bloqueios: string[];
  prioridade: number;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentAutonomyRuleSchema = new Schema<IAgentAutonomyRule>(
  {
    enabled: { type: Boolean, default: true },
    tipo: { type: String },
    produto: { type: String },
    motivo: { type: String },
    detalhe: { type: String },
    minAuditScore: { type: Number, default: 85 },
    maxMessagesInThread: { type: Number, default: 2 },
    canais: { type: [String], default: [] },
    bloqueios: { type: [String], default: [] },
    prioridade: { type: Number, default: 0 },
    createdBy: { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'agent_autonomy_rules' },
);

AgentAutonomyRuleSchema.index({ produto: 1, motivo: 1, detalhe: 1 });

export const AgentAutonomyRule = mongoose.model<IAgentAutonomyRule>(
  'AgentAutonomyRule',
  AgentAutonomyRuleSchema,
);
