/** RedesSociaisCaptacaoEstado v1.0.0 — desk_config.redes_sociais_captacao_estado
 * Cursor de captação (posts/mídias e comentários já conhecidos, e o último filho
 * visto em cada container) por canal — 1 documento por canal ('facebook'/'instagram').
 * Persistido pra sobreviver a reinício do processo (deploy, cold start do Cloud Run).
 * Ver services/redesSociais/redesSociaisCaptacaoEstado.service.ts.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export type CanalDeCaptacaoComEstado = 'facebook' | 'instagram';

export interface IRedesSociaisCaptacaoEstado extends Document {
  canal: CanalDeCaptacaoComEstado;
  /** Posts (Facebook) ou mídias (Instagram) já conhecidos. */
  containersConhecidos: string[];
  /** Comentários de topo já conhecidos — usado pra saber em quais vale checar resposta nova. */
  comentariosConhecidos: string[];
  /** containerId (post/mídia/comentário) -> id do último filho (comentário/resposta) conhecido. */
  cursores: Map<string, string>;
  atualizadoEm: Date;
}

const RedesSociaisCaptacaoEstadoSchema = new Schema<IRedesSociaisCaptacaoEstado>(
  {
    canal: { type: String, enum: ['facebook', 'instagram'], required: true, unique: true },
    containersConhecidos: { type: [String], default: [] },
    comentariosConhecidos: { type: [String], default: [] },
    cursores: { type: Map, of: String, default: () => new Map() },
    atualizadoEm: { type: Date, default: Date.now },
  },
  { versionKey: false },
);

export function getRedesSociaisCaptacaoEstadoModel(): Model<IRedesSociaisCaptacaoEstado> {
  const conn = getDeskConfigConnection();
  const modelName = 'RedesSociaisCaptacaoEstado';
  if (conn.models[modelName]) {
    return conn.models[modelName] as Model<IRedesSociaisCaptacaoEstado>;
  }
  return conn.model<IRedesSociaisCaptacaoEstado>(
    modelName,
    RedesSociaisCaptacaoEstadoSchema,
    'redes_sociais_captacao_estado',
  );
}
