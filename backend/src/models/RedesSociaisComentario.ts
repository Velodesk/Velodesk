/** RedesSociaisComentario v1.0.0 — desk_config.redes_sociais_comentarios
 * Comentários/avaliações captados via Graph API (Facebook/Instagram) e Google Play,
 * já classificados por IA (sentimento/motivo). Ver services/redesSociais/.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export type RedesSociaisCanal = 'facebook' | 'instagram' | 'google_play';
export type RedesSociaisSentimento = 'positivo' | 'neutro' | 'negativo';

export const REDES_SOCIAIS_MOTIVOS = [
  'elogio',
  'reclamacao_atendimento',
  'reclamacao_prazo_restituicao',
  'reclamacao_cobranca_preco',
  'problema_tecnico_bug',
  'duvida_sobre_produto',
  'duvida_sobre_status',
  'spam_irrelevante',
  'outro',
] as const;
export type RedesSociaisMotivo = (typeof REDES_SOCIAIS_MOTIVOS)[number];

export interface IRedesSociaisComentario extends Document {
  /** Id único do comentário/avaliação na plataforma de origem — chave de deduplicação. */
  idOrigem: string;
  canal: RedesSociaisCanal;
  nomeCliente: string;
  mensagem: string;
  /** Quando o cliente comentou (não confundir com dataClassificacao). */
  dataHora: Date;
  linkOriginal?: string;
  /** Só existe pro Google Play — não se aplica a comentário de post do Facebook/Instagram. */
  notaEstrelas?: number;
  sentimento: RedesSociaisSentimento;
  motivo: RedesSociaisMotivo;
  confiancaIa?: number;
  /** Quando a IA classificou, não quando o cliente comentou. */
  dataClassificacao: Date;
  respondido: boolean;
  resposta?: string;
  respondidoEm?: Date;
  respondidoPor?: string;
  ignorado: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const RedesSociaisComentarioSchema = new Schema<IRedesSociaisComentario>(
  {
    idOrigem: { type: String, required: true, unique: true },
    canal: { type: String, enum: ['facebook', 'instagram', 'google_play'], required: true },
    nomeCliente: { type: String, required: true, trim: true },
    mensagem: { type: String, required: true },
    dataHora: { type: Date, required: true },
    linkOriginal: { type: String },
    notaEstrelas: { type: Number, min: 1, max: 5 },
    sentimento: { type: String, enum: ['positivo', 'neutro', 'negativo'], required: true },
    motivo: { type: String, enum: REDES_SOCIAIS_MOTIVOS, required: true },
    confiancaIa: { type: Number, min: 0, max: 100 },
    dataClassificacao: { type: Date, required: true },
    respondido: { type: Boolean, default: false },
    resposta: { type: String },
    respondidoEm: { type: Date },
    respondidoPor: { type: String },
    ignorado: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false },
);

RedesSociaisComentarioSchema.index({ canal: 1, dataHora: -1 });
RedesSociaisComentarioSchema.index({ respondido: 1, ignorado: 1 });
RedesSociaisComentarioSchema.index({ sentimento: 1 });

export function getRedesSociaisComentarioModel(): Model<IRedesSociaisComentario> {
  const conn = getDeskConfigConnection();
  const modelName = 'RedesSociaisComentario';
  if (conn.models[modelName]) {
    return conn.models[modelName] as Model<IRedesSociaisComentario>;
  }
  return conn.model<IRedesSociaisComentario>(modelName, RedesSociaisComentarioSchema, 'redes_sociais_comentarios');
}
