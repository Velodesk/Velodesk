import { connectDatabase } from '../src/config/database';
import { getReclameAquiHugmeImportBatchModel } from '../src/models/reclamacoes/hugmeModels';

async function main() {
  await connectDatabase();
  const Model = getReclameAquiHugmeImportBatchModel();
  const batches = await Model.find({}).sort({ updatedAt: -1 }).limit(5).lean();
  for (const batch of batches) {
    console.log({
      batchId: batch.batchId,
      importedAt: batch.importedAt,
      updatedAt: (batch as any).updatedAt,
      total: batch.total,
      inserted: batch.inserted,
      updated: batch.updated,
      failed: batch.failed,
      ticketsCreated: batch.ticketsCreated,
    });
  }
  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });
