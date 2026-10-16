/** test-ra-lista-por-grupo — listByOrgaoGrupo pagina por grupo e bate com as contagens. */
import { connectDatabase } from '../src/config/database';
import {
  countContagensByOrgao, listByOrgaoFiltro, listByOrgaoGrupo, RECLAMACAO_GRUPOS,
} from '../src/services/reclamacoes/reclamacao.service';

async function main() {
  await connectDatabase();
  const c = await countContagensByOrgao('reclame_aqui');
  let ok = !!c;
  for (const g of RECLAMACAO_GRUPOS) {
    const p1 = await listByOrgaoGrupo('reclame_aqui', g, { limit: 50, skip: 0 });
    const p2 = await listByOrgaoGrupo('reclame_aqui', g, { limit: 50, skip: 50 });
    const dup = p1.items.some((a) => p2.items.some((b) => String(a._id) === String(b._id)));
    const esperado = c?.grupos[g] ?? -1;
    const good = p1.total === esperado && !dup && p1.items.length === Math.min(50, esperado);
    console.log(g, `total=${p1.total} esperado=${esperado} p1=${p1.items.length} p2=${p2.items.length} dup=${dup}`, good ? 'OK' : 'FALHOU');
    if (!good) ok = false;
  }
  // visão de gestão (tabela do RA): chips batem com cards/KPIs
  const total = c ? Object.values(c.grupos).reduce((a, b) => a + b, 0) : 0;
  const casos: Array<[string, string[], number]> = [
    ['gestao sem chips (sem finalizadas)', [], total - (c?.grupos.finalizadas ?? 0)],
    ['chip finalizadas', ['finalizadas'], c?.grupos.finalizadas ?? -1],
    ['chip nao-respondidas', ['nao-respondidas'], c?.kpis.naoRespondidas ?? -1],
    ['chip vencendo-hoje', ['vencendo-hoje'], c?.kpis.vencendoHoje ?? -1],
    ['chip passivel-nota', ['passivel-nota'], c?.kpis.passivelNota ?? -1],
  ];
  for (const [nome, chips, esperado] of casos) {
    const r = await listByOrgaoFiltro('reclame_aqui', { gestao: true, chips, limit: 50, skip: 0 });
    const good = r.total === esperado;
    console.log(nome, `total=${r.total} esperado=${esperado}`, good ? 'OK' : 'FALHOU');
    if (!good) ok = false;
  }
  console.log(ok ? 'PASSOU' : 'FALHOU');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
