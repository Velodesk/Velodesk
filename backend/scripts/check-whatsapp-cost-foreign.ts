/** check-whatsapp-cost-foreign v1.0.0 — dry-run do purge-foreign + status. */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import {
  getWhatsappCostStatus,
  purgeForeignWhatsappCostDocs,
} from '../src/services/twilio/whatsappCostSync.service';

async function main() {
  await connectDatabase();
  const status = await getWhatsappCostStatus();
  console.log('=== Status whatsapp_message_costs ===');
  console.log(JSON.stringify(status, null, 2));
  console.log('\n=== Dry-run purge-foreign ===');
  const dry = await purgeForeignWhatsappCostDocs(true);
  console.log(JSON.stringify(dry, null, 2));
  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
