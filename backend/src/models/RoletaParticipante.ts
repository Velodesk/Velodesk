/**
 * RoletaParticipante v1.0.0 — desk_config.desk_roleta_participantes
 *
 * Override manual e explícito de quem participa da roleta de distribuição
 * automática de tickets — independente do campo `atuacao` do cadastro
 * (console_funcionarios), que hoje decide sozinho e às vezes erra (ex.:
 * alguém com atuação "Atendimento" no cadastro mas que não atende ticket
 * na prática, como QA/produto).
 *
 * Sem documento para o e-mail → sem override, vale a regra padrão
 * (atuacao/afastado) em assignmentRouter.service.ts.
 * Com documento → `ativo` decide sozinho, sem outras condições.
 *
 * Ainda sem tela no front — gestão por enquanto via API (ver agents.routes.ts,
 * rotas /agents/roleta/participantes) ou direto no banco.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IRoletaParticipante extends Document {
  email: string;
  ativo: boolean;
  motivo: string;
  atualizadoPor: string;
  createdAt: Date;
  updatedAt: Date;
}

const RoletaParticipanteSchema = new Schema<IRoletaParticipante>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    ativo: { type: Boolean, required: true },
    motivo: { type: String, default: '' },
    atualizadoPor: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'desk_roleta_participantes',
  },
);

RoletaParticipanteSchema.index({ email: 1 }, { unique: true });

export function getRoletaParticipanteModel(): Model<IRoletaParticipante> {
  const conn = getDeskConfigConnection();
  if (conn.models.RoletaParticipante) {
    return conn.models.RoletaParticipante as Model<IRoletaParticipante>;
  }
  return conn.model<IRoletaParticipante>('RoletaParticipante', RoletaParticipanteSchema);
}
