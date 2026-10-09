/**
 * jobLock v1.0.0 — trava de líder entre instâncias do Cloud Run para jobs periódicos.
 *
 * Cada instância tem o próprio setInterval; sem trava, N instâncias executam o mesmo job N vezes
 * por período (e cada subida de instância dispara uma execução imediata). A trava é um documento
 * em `sequence_counters` com `until`: só quem conseguir avançar `until` (a partir de um valor já
 * vencido ou ausente) executa; as demais instâncias saem sem fazer nada.
 */
import mongoose from 'mongoose';

type LockDoc = { _id: string; until: Date };

/** true = esta instância é a líder neste período e pode rodar o job. */
export async function acquireJobLock(lockId: string, ttlMs: number): Promise<boolean> {
  const now = new Date();
  const collection = mongoose.connection.collection<LockDoc>('sequence_counters');
  try {
    const res = await collection.findOneAndUpdate(
      { _id: lockId, $or: [{ until: { $lt: now } }, { until: { $exists: false } }] },
      { $set: { until: new Date(now.getTime() + ttlMs) } },
      { upsert: true, returnDocument: 'after' },
    );
    return Boolean(res);
  } catch {
    // upsert colide com o documento já travado por outra instância (duplicate key) = não é líder
    return false;
  }
}
