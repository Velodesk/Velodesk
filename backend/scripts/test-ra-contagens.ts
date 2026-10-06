/** test-ra-contagens — agregação de contagens do RA bate com o total da coleção. */
import { connectDatabase } from '../src/config/database';
import { countByOrgao, countContagensByOrgao } from '../src/services/reclamacoes/reclamacao.service';

async function main() {
  await connectDatabase();
  const c = await countContagensByOrgao('reclame_aqui');
  const total = await countByOrgao('reclame_aqui', {});
  console.log(JSON.stringify(c));
  const soma = c ? Object.values(c.grupos).reduce((a, b) => a + b, 0) : -1;
  const ok = !!c && soma === total && c.total === total;
  console.log(ok ? `PASSOU: soma dos grupos (${soma}) = total (${total})` : `FALHOU: soma=${soma} total=${total}`);
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
