/**
 * tmp-delete-duplicate-queue-boxes v1.0.0
 * Remove definitivamente, para TODOS os e-mails, as caixas personalizadas cujo
 * nome (case-insensitive) esteja na lista TARGET_NAMES. Uso pontual para limpar
 * as cópias criadas pelo bug de auto-migração (ver tmp-check-duplicate-queue-boxes.ts).
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getDeskAgentQueueBoxModel } from '../src/models/DeskAgentQueueBox';

const TARGET_NAMES = ['alouuuu', 'fofocaiada'];

async function main() {
  await connectDatabase();
  const Model = getDeskAgentQueueBoxModel();

  const nameRegexes = TARGET_NAMES.map((n) => new RegExp(`^${n.trim()}$`, 'i'));
  const docs = await Model.find({ name: { $in: nameRegexes } }).lean();

  if (!docs.length) {
    console.log('Nenhuma caixa encontrada com esses nomes.');
    await disconnectDatabase();
    return;
  }

  console.log(`Encontradas ${docs.length} caixa(s) para excluir:`);
  for (const doc of docs) {
    console.log(`  email=${doc.email}  boxId=${doc.boxId}  name="${doc.name}"`);
  }

  const result = await Model.deleteMany({ name: { $in: nameRegexes } });
  console.log(`\nExcluídas: ${result.deletedCount}`);

  await disconnectDatabase();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDatabase();
  process.exit(1);
});
