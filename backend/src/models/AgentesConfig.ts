/**
 * AgentesConfig v1.1.0 — configuração global dos agentes de IA (desk_config.acionamento_servicos)
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Um documento por agente (singleton por key; hoje 'agente_autonomo'). O liga/desliga vive aqui e é
 * alterado pela tela Configurações > Agentes de IA — sem variável de ambiente.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';
import { CANAIS_AUTONOMOS } from '../config/agenteAutonomo';

export type AgentesModoEnvio = 'fila_aprovacao' | 'envio_direto';

export interface IAgentesConfig extends Document {
  key: string;
  autonomiaHabilitada: boolean;
  modoEnvio: AgentesModoEnvio;
  /** Nota mínima do auditor (0–100): abaixo dela a resposta é refeita e só chega à fila acima dela. */
  minAuditScoreEstrito: number;
  /** Canais de entrada liberados para o agente autônomo (um switch por origem). */
  canaisHabilitados: Record<string, boolean>;
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
    minAuditScoreEstrito: { type: Number, default: 85, min: 0, max: 100 },
    canaisHabilitados: Object.fromEntries(CANAIS_AUTONOMOS.map((c) => [c, { type: Boolean, default: false }])),
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
