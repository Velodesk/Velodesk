/**
 * backfill-status-atual — preenche `chamados_n1.statusAtual` (espelho do último registro.status)
 * nos documentos que ainda não têm o campo. Idempotente; usa a collection nativa, então não mexe
 * em `updatedAt` e não dispara hooks. Rodar ANTES de ligar STATUS_ATUAL_QUERIES_ENABLED=true.
 *
 * Uso: npx ts-node scripts/backfill-status-atual.ts [--dry-run]
 * Roda contra o Mongo do ambiente atual (respeita backend/.env).
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await connectDatabase();
  const coll = ChamadoN1.collection;

  const total = await coll.countDocuments({});
  const missing = await coll.countDocuments({ statusAtual: { $exists: false } });
  console.log({ total, semStatusAtual: missing, dryRun: DRY_RUN });

  if (!DRY_RUN && missing > 0) {
    const res = await coll.updateMany(
      { statusAtual: { $exists: false } },
      [
        {
          $set: {
            statusAtual: {
              $ifNull: [{ $arrayElemAt: [{ $ifNull: ['$registro.status', []] }, -1] }, 'novo'],
            },
          },
        },
      ],
    );
    console.log({ matched: res.matchedCount, modified: res.modifiedCount });
  }

  const restante = await coll.countDocuments({ statusAtual: { $exists: false } });
  const porStatus = await coll
    .aggregate([{ $group: { _id: '$statusAtual', n: { $sum: 1 } } }, { $sort: { n: -1 } }])
    .toArray();
  console.log({ restanteSemCampo: restante });
  console.table(porStatus.map((row) => ({ statusAtual: row._id, n: row.n })));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
