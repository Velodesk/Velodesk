/**
 * drop-telephony-collections.ts — remove telephony_calls e telephony_ia_analise
 * Executar SOMENTE após backup mesclado confirmado e validado pelo usuário.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { TelephonyCall } from '../src/models/TelephonyCall';
import { TelephonyIaAnalise } from '../src/models/TelephonyIaAnalise';

async function main() {
  await connectDatabase();

  const callsBefore = await TelephonyCall.countDocuments();
  const analisesBefore = await TelephonyIaAnalise.countDocuments();
  console.log(`Antes — telephony_calls: ${callsBefore}, telephony_ia_analise: ${analisesBefore}`);

  await TelephonyCall.collection.drop();
  console.log('telephony_calls removida.');

  await TelephonyIaAnalise.collection.drop();
  console.log('telephony_ia_analise removida.');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
