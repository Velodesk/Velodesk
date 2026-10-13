/**
 * reabrir-casos-especiais-fechados — devolve para "resolvido" os tickets de casos especiais
 * (RA/Procon/Bacen/Consumidor.gov) que o job de 48h fechou indevidamente.
 *
 *   npx tsx scripts/reabrir-casos-especiais-fechados.ts            # dry-run (não grava nada)
 *   npx tsx scripts/reabrir-casos-especiais-fechados.ts --apply    # grava
 *   ... --incluir-manuais   # também reabre os fechados manualmente (por padrão só os do job)
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

async function main() {
  await connectDatabase();
  const models = [
    getReclamacaoReclameAquiModel(),
    getReclamacaoProconModel(),
    getReclamacaoBacenModel(),
    getReclamacaoConsumidorGovModel(),
  ] as unknown as Array<{ distinct: (f: string) => { exec: () => Promise<unknown[]> }; updateMany: (...a: unknown[]) => { exec: () => Promise<unknown> } }>;

  const ids = new Set<string>();
  for (const M of models) (await M.distinct('chamadoId').exec()).forEach((i) => i && ids.add(String(i)));
  const all = [...ids];
  console.log(`[reabrir] chamados com reclamação vinculada: ${all.length}`);

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
