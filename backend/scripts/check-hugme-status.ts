import { connectDatabase } from '../src/config/database';
import { getReclameAquiHugmeImportBatchModel } from '../src/models/reclamacoes/hugmeModels';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';

async function main() {
  await connectDatabase();
  const Model = getReclameAquiHugmeImportBatchModel();
  const batches = await Model.find({}).sort({ importedAt: -1 }).limit(3).lean();
  console.log('últimos lotes:');
  for (const batch of batches) {
    console.log({
      batchId: batch.batchId,
      importedAt: batch.importedAt,
      total: batch.total,
      inserted: batch.inserted,
      updated: batch.updated,
      failed: batch.failed,
      ticketsCreated: batch.ticketsCreated,
    });
  }

  const RaModel = getReclamacaoReclameAquiModel();
  const total = await RaModel.countDocuments({});
  console.log('\ntotal de reclamações RA no banco agora:', total);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
