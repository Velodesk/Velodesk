/** DeskAgentQueueBox v1.3.0 — criterios[] com valores[] (multi-seleção por categoria) */
import { Schema, Document, Model } from 'mongoose';
import { getDeskPreferencesConnection } from '../config/database';

export interface IDeskAgentQueueBoxCriterio {
  tipo: string;
  campo?: string;
  operador?: string;
  /** Legado — primeiro valor selecionado */
  valor: string;
  /** Multi-seleção na mesma categoria (OR dentro da linha) */
  valores?: string[];
}
export interface IDeskAgentQueueBox extends Document {
  boxId: string;
  email: string;
  userId: string;
  name: string;
  action: string;
  actionLabel: string;
  dot: string;
  order: number;
  isCustom: boolean;
  criterios: IDeskAgentQueueBoxCriterio[];
  createdAt: Date;
  updatedAt: Date;
}

const CriterioSchema = new Schema<IDeskAgentQueueBoxCriterio>(
  {
    tipo: { type: String, required: true, trim: true },
    campo: { type: String, default: '', trim: true },
    operador: { type: String, default: 'equals', trim: true },
    valor: { type: String, default: '', trim: true },
    valores: { type: [String], default: [] },  },
  { _id: false },
);

const DeskAgentQueueBoxSchema = new Schema<IDeskAgentQueueBox>(
  {
    boxId: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    userId: { type: String, default: '' },
    name: { type: String, required: true, trim: true },
    action: { type: String, default: 'em-andamento', trim: true },
    actionLabel: { type: String, default: '' },
    dot: { type: String, default: '#6366f1' },
    order: { type: Number, default: 0 },
    isCustom: { type: Boolean, default: true },
    criterios: { type: [CriterioSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'desk_agent_boxes',
  },
);

DeskAgentQueueBoxSchema.index({ email: 1, order: 1 });
DeskAgentQueueBoxSchema.index({ email: 1, boxId: 1 }, { unique: true });

export function getDeskAgentQueueBoxModel(): Model<IDeskAgentQueueBox> {
  const conn = getDeskPreferencesConnection();
  if (conn.models.DeskAgentQueueBox) {
    return conn.models.DeskAgentQueueBox as Model<IDeskAgentQueueBox>;
  }
  return conn.model<IDeskAgentQueueBox>('DeskAgentQueueBox', DeskAgentQueueBoxSchema);
}
