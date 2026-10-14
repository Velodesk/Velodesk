/**
 * AgentesConfig v1.0.0 — configuração global dos agentes de IA (desk_config.acionamento_servicos)
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Um documento por agente (singleton por key; hoje 'agente_autonomo'). O liga/desliga vive aqui e é
 * alterado pela tela Configurações > Agentes de IA — sem variável de ambiente.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export type AgentesModoEnvio = 'fila_aprovacao' | 'envio_direto';

export interface IAgentesConfig extends Document {
  key: string;
  autonomiaHabilitada: boolean;
  modoEnvio: AgentesModoEnvio;
  /** Nota mínima do auditor para o caminho autônomo (régua estrita). */
  minAuditScoreEstrito: number;
  /** Hidrata o prompt dos agentes com dados reais da conta do cliente (produto citado). */
  hidratacaoConsulta: boolean;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AgentesConfigSchema = new Schema<IAgentesConfig>(
  {
    key: { type: String, required: true, default: 'global' },
    autonomiaHabilitada: { type: Boolean, default: false },
    modoEnvio: { type: String, enum: ['fila_aprovacao', 'envio_direto'], default: 'fila_aprovacao' },
    minAuditScoreEstrito: { type: Number, default: 95, min: 0, max: 100 },
    hidratacaoConsulta: { type: Boolean, default: false },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'acionamento_servicos' },
);

AgentesConfigSchema.index({ key: 1 }, { unique: true });

export function getAgentesConfigModel(): Model<IAgentesConfig> {
  const conn = getDeskConfigConnection();
  if (conn.models.AgentesConfig) {
    return conn.models.AgentesConfig as Model<IAgentesConfig>;
  }
  return conn.model<IAgentesConfig>('AgentesConfig', AgentesConfigSchema);
}
