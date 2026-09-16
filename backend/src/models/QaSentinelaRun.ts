/**
 * QaSentinelaRun v1.0.0 — desk_config.qa_sentinela_runs
 *
 * Histórico (um documento por rodada, chave = runId) gravado pelo agente de
 * QA em qa/src/estadoSentinela.ts. Sem schema fixo (strict: false) — este
 * model só expõe leitura pra rota GET /api/inbound/qa-sentinela/runs
 * alimentar o gráfico de tendência do dashboard Sentinela Velodesk.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IQaSentinelaRun extends Document<string> {
  iniciadoEm?: string;
  finalizadoEm?: string;
  [key: string]: unknown;
}

const QaSentinelaRunSchema = new Schema<IQaSentinelaRun>(
  { _id: { type: String }, iniciadoEm: { type: String }, finalizadoEm: { type: String } },
  { strict: false, collection: 'qa_sentinela_runs' },
);

export function getQaSentinelaRunModel(): Model<IQaSentinelaRun> {
  const conn = getDeskConfigConnection();
  if (conn.models.QaSentinelaRun) {
    return conn.models.QaSentinelaRun as Model<IQaSentinelaRun>;
  }
  return conn.model<IQaSentinelaRun>('QaSentinelaRun', QaSentinelaRunSchema);
}
