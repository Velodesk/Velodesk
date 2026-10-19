/**
 * GratitudeLearnedExample v1.0.0 — desk_config.desk_gratitude_learned_examples
 *
 * "Base de exemplos" que cresce sozinha: toda vez que o Agente 1 + Agente 2 concordam que uma
 * resposta de cliente é agradecimento puro (ver gratitudeReplyGate.service.ts), a frase
 * normalizada é registrada aqui. Só depois de se repetir em GRATITUDE_LEARNING_PROMOTION_THRESHOLD
 * tickets diferentes ela vira `promoted: true` e passa a entrar na checagem rápida (sem custo de
 * IA) — exigir repetição é de propósito: um único acerto duvidoso da IA não vira regra permanente
 * sem nenhuma segunda checada.
 */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface IGratitudeLearnedExample extends Document {
  normalizedKey: string;
  exampleText: string;
  occurrences: number;
  promoted: boolean;
  ticketProtocols: string[];
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const GratitudeLearnedExampleSchema = new Schema<IGratitudeLearnedExample>(
  {
    normalizedKey: { type: String, required: true },
    exampleText: { type: String, required: true },
    occurrences: { type: Number, default: 1 },
    promoted: { type: Boolean, default: false },
    ticketProtocols: { type: [String], default: [] },
    firstSeenAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  {
    collection: 'desk_gratitude_learned_examples',
  },
);

GratitudeLearnedExampleSchema.index({ normalizedKey: 1 }, { unique: true });
GratitudeLearnedExampleSchema.index({ promoted: 1 });

export function getGratitudeLearnedExampleModel(): Model<IGratitudeLearnedExample> {
  const conn = getDeskConfigConnection();
  if (conn.models.GratitudeLearnedExample) {
    return conn.models.GratitudeLearnedExample as Model<IGratitudeLearnedExample>;
  }
  return conn.model<IGratitudeLearnedExample>('GratitudeLearnedExample', GratitudeLearnedExampleSchema);
}
