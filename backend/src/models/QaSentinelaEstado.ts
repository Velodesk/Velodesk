/**
 * QaSentinelaEstado v1.0.0 — desk_config.qa_sentinela_estado
 *
 * Retrato mais recente de uma rodada do agente de QA (Claudio Q.A.), gravado
 * pelo próprio script em qa/src/estadoSentinela.ts. O formato do documento é
 * definido lá, não aqui — este model só expõe leitura (strict: false, sem
 * schema fixo) pra rota GET /api/inbound/qa-sentinela/estado alimentar o
 * dashboard Sentinela Velodesk sem precisar de acesso direto ao Mongo.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IQaSentinelaEstado extends Document<string> {
  [key: string]: unknown;
}

const QaSentinelaEstadoSchema = new Schema<IQaSentinelaEstado>(
  { _id: { type: String } },
  { strict: false, collection: 'qa_sentinela_estado' },
);

export function getQaSentinelaEstadoModel(): Model<IQaSentinelaEstado> {
  const conn = getDeskConfigConnection();
  if (conn.models.QaSentinelaEstado) {
    return conn.models.QaSentinelaEstado as Model<IQaSentinelaEstado>;
  }
  return conn.model<IQaSentinelaEstado>('QaSentinelaEstado', QaSentinelaEstadoSchema);
}
