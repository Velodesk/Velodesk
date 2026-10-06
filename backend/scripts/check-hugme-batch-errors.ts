import { connectDatabase } from '../src/config/database';
import { getReclameAquiHugmeImportBatchModel } from '../src/models/reclamacoes/hugmeModels';

async function main() {
  await connectDatabase();
  const Model = getReclameAquiHugmeImportBatchModel();
  const batch = await Model.findOne({}).sort({ importedAt: -1 }).lean();
  if (!batch) {
    console.log('nenhum lote encontrado');
    process.exit(0);
  }
  console.log('batch:', {
    batchId: batch.batchId,
    total: batch.total,
    inserted: batch.inserted,
    updated: batch.updated,
    skipped: batch.skipped,
    failed: batch.failed,
    ticketsCreated: batch.ticketsCreated,
  });
  const messages = (batch.batchErrors || []).map((e: any) => e.message);
  const uniqueMessages = [...new Set(messages)];
  console.log(`\ntotal de erros: ${messages.length}`);
  console.log('mensagens distintas de erro:', uniqueMessages);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
