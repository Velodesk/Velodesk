/**
 * reabrir-casos-especiais-fechados — devolve para "resolvido" os tickets de casos especiais
 * (RA/Procon/Bacen/Consumidor.gov) que o job de 48h fechou indevidamente.
 *
 *   npx tsx scripts/reabrir-casos-especiais-fechados.ts            # dry-run (não grava nada)
 *   npx tsx scripts/reabrir-casos-especiais-fechados.ts --apply    # grava
 *   ... --incluir-manuais   # também reabre os fechados manualmente (por padrão só os do job)
 *   ... --meses=N           # janela pela DATA DA RECLAMAÇÃO (não da criação do doc); padrão 6
 *
 * Opera no banco apontado pelo .env de quem executa.
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import {
  getReclamacaoBacenModel,
  getReclamacaoConsumidorGovModel,
  getReclamacaoProconModel,
  getReclamacaoReclameAquiModel,
} from '../src/models/reclamacoes/reclamacaoModels';
import { appendStatusTransition, lastStatusInFilter } from '../src/services/chamado.mapper';

const APPLY = process.argv.includes('--apply');
const INCLUIR_MANUAIS = process.argv.includes('--incluir-manuais');
const MESES = Number((process.argv.find((a) => a.startsWith('--meses=')) ?? '--meses=6').split('=')[1]) || 6;

async function main() {
  await connectDatabase();
  const models = [
    getReclamacaoReclameAquiModel(),
    getReclamacaoProconModel(),
    getReclamacaoBacenModel(),
    getReclamacaoConsumidorGovModel(),
  ] as unknown as Array<{ distinct: (f: string, q?: unknown) => { exec: () => Promise<unknown[]> }; updateMany: (...a: unknown[]) => { exec: () => Promise<unknown> }; countDocuments: (q: unknown) => { exec: () => Promise<number> } }>;

  // Janela pela data da reclamação: doc.dataReclamacao e, nos imports antigos (que só gravaram
  // meta.dataReclamacao como ISO string), esse fallback. Sem nenhuma data → fora da janela.
  const corte = new Date();
  corte.setMonth(corte.getMonth() - MESES);
  const noPeriodo = {
    $or: [
      { dataReclamacao: { $gte: corte } },
      { dataReclamacao: { $in: [null] }, 'meta.dataReclamacao': { $gte: corte.toISOString() } },
    ],
  };
  const ids = new Set<string>();
  const todos = new Set<string>();
  for (const M of models) {
    (await M.distinct('chamadoId').exec()).forEach((i) => i && todos.add(String(i)));
    (await M.distinct('chamadoId', noPeriodo).exec()).forEach((i) => i && ids.add(String(i)));
  }
  const all = [...ids];
  let semData = 0;
  for (const M of models) {
    semData += await M.countDocuments({ dataReclamacao: { $in: [null] }, $or: [{ 'meta.dataReclamacao': { $in: [null, ''] } }] }).exec();
  }
  console.log(`[reabrir] reclamações sem nenhuma data (ficam de fora): ${semData}`);
  console.log(`[reabrir] janela: reclamações de ${corte.toISOString().slice(0, 10)} até hoje (${MESES} meses, pela data da reclamação)`);
  console.log(`[reabrir] chamados com reclamação vinculada: ${todos.size} | dentro da janela: ${all.length} | fora/sem data: ${todos.size - all.length}`);

  let fechadosTotal = 0;
  let doJob = 0;
  let manuais = 0;
  let aplicados = 0;
  const alvo: string[] = [];

  for (let i = 0; i < all.length; i += 500) {
    const slice = all.slice(i, i + 500);
    const chamados = await ChamadoN1.find({ _id: { $in: slice }, ...lastStatusInFilter(['fechado']) });
    for (const ch of chamados) {
      fechadosTotal += 1;
      const last = ch.registro?.[ch.registro.length - 1];
      const source = String((last?.metadados as Record<string, unknown> | undefined)?.source ?? '');
      const automatico = source === 'close-resolved-job';
      if (automatico) doJob += 1; else manuais += 1;
      if (!automatico && !INCLUIR_MANUAIS) continue;
      alvo.push(String(ch._id));
      if (!APPLY) continue;
      appendStatusTransition(ch, 'resolvido', {
        autor: 'sistema',
        anotacaoInterna: 'Caso especial reaberto para Resolvido: havia sido fechado pela regra automática de 48h, que não se aplica a casos especiais.',
        metadados: { source: 'repair-casos-especiais-fechados' },
      });
      await ch.save();
      aplicados += 1;
    }
  }

  if (APPLY && alvo.length) {
    for (const M of models) {
      await M.updateMany({ chamadoId: { $in: alvo } }, { $set: { ticketStatus: 'resolvido' } }).exec();
    }
  }

  console.log(`[reabrir] fechados entre os casos especiais: ${fechadosTotal} (pelo job de 48h: ${doJob} | manuais/outros: ${manuais})`);
  console.log(APPLY
    ? `[reabrir] reabertos para resolvido: ${aplicados}`
    : `[reabrir] DRY-RUN — seriam reabertos: ${alvo.length}. Rode com --apply para gravar.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
