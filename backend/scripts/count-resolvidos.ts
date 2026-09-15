import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { currentStatus } from '../src/services/chamado.mapper';

async function main() {
  await connectDatabase();
  const total = await ChamadoN1.countDocuments();
  const chamados = await ChamadoN1.find().select('registro chamadoProtocolo').lean();

  const counts: Record<string, number> = {};
  for (const c of chamados) {
    const status = currentStatus(c as any);
    counts[status] = (counts[status] || 0) + 1;
  }

  console.log('Total de chamados:', total);
  console.log('Por status:');
  for (const [status, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${n}`);
  }

  await disconnectDatabase();
}
main().catch((e) => { console.error(e); process.exit(1); });
