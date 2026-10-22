/** backfill-ra-dataReclamacao — popula reclamacoes_reclameAqui.dataReclamacao a partir da coluna
 * bruta "Data Reclamação" (dadosPlanilha), nos docs importados antes da correção do Bug 2 do
 * handoff RA-datas (enrichRaReclamacaoFirstClassFields nunca gravava esse campo). */
import { connectDatabase } from '../src/config/database';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';

function findRawDataReclamacao(dadosPlanilha: Record<string, string> | undefined): string | undefined {
  if (!dadosPlanilha) return undefined;
  const key = Object.keys(dadosPlanilha).find((k) => {
    const nk = k.toLowerCase();
    return nk.includes('data reclamacao') || nk.includes('data reclamação')
      || nk.includes('data da reclamacao') || nk.includes('data da reclamação');
  });
  return key ? dadosPlanilha[key] : undefined;
}

async function main() {
  await connectDatabase();
  const Model = getReclamacaoReclameAquiModel();
  const cursor = Model.find({ $or: [{ dataReclamacao: null }, { dataReclamacao: { $exists: false } }] })
    .select('_id idOrigem dadosPlanilha')
    .lean()
    .cursor();

  let batch: Array<{ updateOne: { filter: Record<string, unknown>; update: Record<string, unknown> } }> = [];
  let updated = 0;
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    const r = await Model.bulkWrite(batch as never);
    updated += r.modifiedCount;
    batch = [];
  };

  for await (const doc of cursor) {
    const raw = findRawDataReclamacao((doc as unknown as { dadosPlanilha?: Record<string, string> }).dadosPlanilha);
    if (!raw) {
      skipped += 1;
      continue;
    }
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      skipped += 1;
      continue;
    }
    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { dataReclamacao: d } },
      },
    });
    if (batch.length >= 500) await flush();
  }
  await flush();

  console.log(`[backfill] reclamações RA atualizadas: ${updated} | sem dado bruto aproveitável: ${skipped}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
