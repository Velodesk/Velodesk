/**
 * test-casos-especiais-fora-dos-jobs — chamado com reclamação RA vinculada é reconhecido como
 * caso especial (fica fora dos jobs de 48h); chamado sem reclamação não. Não executa os jobs
 * (varreriam tickets reais do banco).
 */
import { Types } from 'mongoose';
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { upsertRaTicketFromSource } from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';
import { findChamadoIdsComCasoEspecial } from '../src/services/reclamacoes/reclamacao.service';

async function main() {
  await connectDatabase();
  const idOrigem = `TESTE-JOBS-${Date.now()}`;
  let chamadoId: string | undefined;
  let reclamacaoId: string | undefined;
  let ok = false;
  try {
    const r = await upsertRaTicketFromSource(
      { idOrigem, consumidor: 'Teste Jobs', cpf: '00000000000', assunto: `[${idOrigem}]`, descricao: 'teste', produto: 'Outros', statusHugme: 'Fechado' },
      'sistema-teste',
      'hugme-import',
    );
    chamadoId = String(r.chamadoId);
    reclamacaoId = String(r.reclamacaoId);
    const comum = new Types.ObjectId();
    const found = await findChamadoIdsComCasoEspecial([new Types.ObjectId(chamadoId), comum]);
    ok = found.has(chamadoId) && !found.has(String(comum));
    console.log(`caso especial reconhecido=${found.has(chamadoId)} | ticket comum ignorado=${!found.has(String(comum))}`);
    console.log(ok ? 'PASSOU' : 'FALHOU');
  } finally {
    if (chamadoId) await ChamadoN1.deleteOne({ _id: chamadoId });
    if (reclamacaoId) await getReclamacaoReclameAquiModel().deleteOne({ _id: reclamacaoId });
  }
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
