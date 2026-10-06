/** backfill-ra-ticket-status — copia o status atual do chamado para reclamacao.ticketStatus (RA). */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';

async function main() {
  await connectDatabase();
  const Model = getReclamacaoReclameAquiModel();
  const cursor = Model.find({ $or: [{ ticketStatus: '' }, { ticketStatus: null }, { ticketStatus: { $exists: false } }] })
    .select('_id chamadoId').lean().cursor();
  let batch: { _id: unknown; chamadoId: unknown }[] = [];
  let updated = 0;
  const flush = async () => {
    if (!batch.length) return;
    const chamados = await ChamadoN1.find({ _id: { $in: batch.map((b) => b.chamadoId) } })
      .select('registro.status').lean();
    const statusById = new Map(chamados.map((c) => [String(c._id), String(c.registro?.[c.registro.length - 1]?.status ?? '').toLowerCase()]));
    const ops = batch
      .map((b) => ({ id: b._id, st: statusById.get(String(b.chamadoId)) }))
      .filter((o) => o.st)
      .map((o) => ({ updateOne: { filter: { _id: o.id }, update: { $set: { ticketStatus: o.st } } } }));
    if (ops.length) {
      const r = await Model.bulkWrite(ops as never);
      updated += r.modifiedCount;
    }
    batch = [];
  };
  for await (const doc of cursor) {
    batch.push(doc as never);
    if (batch.length >= 500) await flush();
  }
  await flush();
  console.log(`[backfill] reclamações RA atualizadas: ${updated}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
