/**
 * AgentAutonomyRule v2.0.0 — escopo do agente autônomo pela árvore de tabulação
 * VERSION: v2.0.0 | DATE: 2026-10-19
 *
 * Escopo hierárquico: produto (obrigatório) > motivo > detalhe. Campo vazio = curinga para baixo.
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IAgentAutonomyRule extends Document {
  enabled: boolean;
  produto?: string;
  motivo?: string;
  detalhe?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentAutonomyRuleSchema = new Schema<IAgentAutonomyRule>(
  {
    enabled: { type: Boolean, default: true },
    produto: { type: String },
    motivo: { type: String },
    detalhe: { type: String },
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
