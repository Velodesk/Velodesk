/** MailPrioritySubject v1.0.0 — desk_config.mail_priority_subject (assunto/corpo prioritário → Agente 4) */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export type MailPrioritySubjectArea = 'assunto' | 'corpo';
export type MailPrioritySubjectMatch = 'igual' | 'contem';
// Vazio = sem órgão fixo ("outras instituições equivalentes"); o Agente 4 ainda dispara,
// mas a classificação de órgão fica a cargo do LLM.
export type MailPrioritySubjectOrgao = 'reclame_aqui' | 'procon' | 'bacen' | 'consumidor_gov' | '';

export interface IMailPrioritySubject extends Document {
  area: MailPrioritySubjectArea;
  matchType: MailPrioritySubjectMatch;
  value: string;
  orgao?: MailPrioritySubjectOrgao;
  note?: string;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const MailPrioritySubjectSchema = new Schema<IMailPrioritySubject>(
  {
    area: { type: String, enum: ['assunto', 'corpo'], required: true },
    matchType: { type: String, enum: ['igual', 'contem'], required: true },
    value: { type: String, required: true, trim: true },
    orgao: { type: String, enum: ['reclame_aqui', 'procon', 'bacen', 'consumidor_gov', ''], default: '' },
    note: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
    createdBy: { type: String, default: '' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

MailPrioritySubjectSchema.index({ area: 1, matchType: 1, value: 1 }, { unique: true });
MailPrioritySubjectSchema.index({ active: 1 });

export function getMailPrioritySubjectModel(): Model<IMailPrioritySubject> {
  const conn = getDeskConfigConnection();
  const modelName = 'MailPrioritySubject';
  if (conn.models[modelName]) {
    return conn.models[modelName] as Model<IMailPrioritySubject>;
  }
  return conn.model<IMailPrioritySubject>(modelName, MailPrioritySubjectSchema, 'mail_priority_subject');
}
