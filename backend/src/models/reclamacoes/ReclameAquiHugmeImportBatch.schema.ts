/** ReclameAquiHugmeImportBatch.schema v1.1.0 — log de lotes de importação Hugme */
import { Schema, Document } from 'mongoose';

export type HugmeOrigemImportacao = 'base_inicial' | 'incremental';

export interface IHugmeImportBatchError {
  rowIndex: number;
  idOrigem?: string;
  message: string;
}

export interface IReclameAquiHugmeImportBatch extends Document {
  batchId: string;
  modo: HugmeOrigemImportacao;
  fileName: string;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  ticketsCreated: number;
  failed: number;
  batchErrors: IHugmeImportBatchError[];
  importedAt: Date;
  importedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ReclameAquiHugmeImportBatchSchema = new Schema<IReclameAquiHugmeImportBatch>(
  {
    batchId: { type: String, required: true, unique: true, trim: true },
    modo: { type: String, enum: ['base_inicial', 'incremental'], required: true },
    fileName: { type: String, default: '' },
    total: { type: Number, default: 0 },
    inserted: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    ticketsCreated: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    batchErrors: {
      type: [{
        rowIndex: { type: Number, default: 0 },
        idOrigem: { type: String, default: '' },
        message: { type: String, default: '' },
      }],
      default: [],
    },
    importedAt: { type: Date, required: true },
    importedBy: { type: String, default: '' },
  },
  { timestamps: true },
);

ReclameAquiHugmeImportBatchSchema.index({ importedAt: -1 }, { name: 'importedAt_desc' });
