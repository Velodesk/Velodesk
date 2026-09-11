/** hugmeModels v2.0.0 — models Hugme em chamados_reclamacoes (registro descontinuado 2026-09-11) */
import type { Model } from 'mongoose';
import { getReclamacoesConnection } from '../../config/database';
import {
  ReclameAquiHugmeImportBatchSchema,
  type IReclameAquiHugmeImportBatch,
} from './ReclameAquiHugmeImportBatch.schema';

export function getReclameAquiHugmeImportBatchModel(): Model<IReclameAquiHugmeImportBatch> {
  const conn = getReclamacoesConnection();
  if (conn.models.ReclameAquiHugmeImportBatch) {
    return conn.models.ReclameAquiHugmeImportBatch as Model<IReclameAquiHugmeImportBatch>;
  }
  return conn.model<IReclameAquiHugmeImportBatch>(
    'ReclameAquiHugmeImportBatch',
    ReclameAquiHugmeImportBatchSchema,
    'reclame_aqui_hugme_import_batches',
  );
}

export type { IReclameAquiHugmeImportBatch };
