/**
 * backup-merge-telephony.ts — backup mesclado de telephony_calls + telephony_ia_analise
 * Somente LEITURA: não apaga nem altera nada. Gera um NDJSON com um documento por ligação,
 * incorporando a análise de IA correspondente (relação 1:1 via telephonyCallId) e removendo
 * campos duplicados. Ligações sem análise e análises órfãs (sem call correspondente) são
 * sinalizadas separadamente para não perder dado silenciosamente.
 */
import fs from 'fs';
import path from 'path';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { TelephonyCall } from '../src/models/TelephonyCall';
import { TelephonyIaAnalise } from '../src/models/TelephonyIaAnalise';

async function main() {
  await connectDatabase();

  const outDir = path.join(__dirname, '..', '..', 'backup');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `telephony-merged-${stamp}.ndjson`);
  const summaryFile = path.join(outDir, `telephony-merged-${stamp}.summary.json`);

  const totalCalls = await TelephonyCall.countDocuments();
  const totalAnalises = await TelephonyIaAnalise.countDocuments();

  console.log(`telephony_calls: ${totalCalls} documentos`);
  console.log(`telephony_ia_analise: ${totalAnalises} documentos`);

  const stream = fs.createWriteStream(outFile, { encoding: 'utf8' });

  const analiseCursor = TelephonyIaAnalise.find().lean().cursor();
  const analisesPorCallId = new Map<string, Record<string, unknown>>();
  const callIdsComAnalise = new Set<string>();
  let analiseSemCallCount = 0;

  for await (const analise of analiseCursor) {
    const callId = String(analise.telephonyCallId);
    callIdsComAnalise.add(callId);
    const {
      _id, telephonyCallId, externalCallId, callEndedAt, createdAt, updatedAt, __v,
      ...resto
    } = analise as Record<string, unknown> & { __v?: unknown };
    analisesPorCallId.set(callId, resto);
  }

  let callsComAnalise = 0;
  let callsSemAnalise = 0;

  const callCursor = TelephonyCall.find().lean().cursor();
  for await (const call of callCursor) {
    const callId = String(call._id);
    const iaAnalise = analisesPorCallId.get(callId) ?? null;
    if (iaAnalise) callsComAnalise += 1;
    else callsSemAnalise += 1;

    const merged = { ...call, iaAnalise };
    stream.write(JSON.stringify(merged) + '\n');
  }

  // análises cujo telephonyCallId não corresponde a nenhum call existente hoje
  const idsCalls = new Set((await TelephonyCall.find().select('_id').lean()).map((c) => String(c._id)));
  for (const callId of callIdsComAnalise) {
    if (!idsCalls.has(callId)) analiseSemCallCount += 1;
  }

  await new Promise((resolve) => stream.end(resolve));

  const summary = {
    geradoEm: new Date().toISOString(),
    totalCalls,
    totalAnalises,
    callsComAnalise,
    callsSemAnalise,
    analisesOrfas_semCallCorrespondente: analiseSemCallCount,
    arquivoBackup: path.basename(outFile),
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  console.log('---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nBackup salvo em: ${outFile}`);
  console.log(`Resumo salvo em: ${summaryFile}`);

  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
