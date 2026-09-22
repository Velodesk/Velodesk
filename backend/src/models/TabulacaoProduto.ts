/** TabulacaoProduto v1.0.0 — desk_config.tabulacao_campos (doc por produto) */
import { Schema, Document, Model } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export interface ITabulacaoDetalhe {
  detalhe: string;
  ordem: number;
  ativo: boolean;
}

export interface ITabulacaoMotivo {
  motivo: string;
  ordem: number;
  ativo: boolean;
  detalhes: ITabulacaoDetalhe[];
}

export interface ITabulacaoProduto extends Document {
  produto: string;
  ordem: number;
  ativo: boolean;
  apenasInterno: boolean;
  motivos: ITabulacaoMotivo[];
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const DetalheSchema = new Schema<ITabulacaoDetalhe>(
  {
    detalhe: { type: String, required: true },
    ordem: { type: Number, default: 0 },
    ativo: { type: Boolean, default: true },
  },
  { _id: false }
);

const MotivoSchema = new Schema<ITabulacaoMotivo>(
  {
    motivo: { type: String, required: true },
    ordem: { type: Number, default: 0 },
    ativo: { type: Boolean, default: true },
    detalhes: { type: [DetalheSchema], default: [] },
  },
  { _id: false }
);

const TabulacaoProdutoSchema = new Schema<ITabulacaoProduto>(
  {
    produto: { type: String, required: true },
    ordem: { type: Number, default: 0 },
    ativo: { type: Boolean, default: true },
    apenasInterno: { type: Boolean, default: false },
    motivos: { type: [MotivoSchema], default: [] },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'tabulacao_campos',
  }
);

TabulacaoProdutoSchema.index({ produto: 1 }, { unique: true });
TabulacaoProdutoSchema.index({ ativo: 1, ordem: 1 });

export function getTabulacaoProdutoModel(): Model<ITabulacaoProduto> {
  const conn = getDeskConfigConnection();
  if (conn.models.TabulacaoProduto) {
    return conn.models.TabulacaoProduto as Model<ITabulacaoProduto>;
  }
  return conn.model<ITabulacaoProduto>('TabulacaoProduto', TabulacaoProdutoSchema);
}
