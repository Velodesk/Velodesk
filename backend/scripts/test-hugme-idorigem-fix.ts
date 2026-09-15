/**
 * test-hugme-idorigem-fix — reproduz o bug relatado (E11000 dup key idOrigem: null) criando
 * DUAS reclamações RA novas em sequência pelo mesmo caminho do hugme import
 * (upsertRaTicketFromSource, route:false), e confirma que ambas persistem idOrigem
 * corretamente sem colidir no índice único. Remove os dados de teste no final.
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { upsertRaTicketFromSource } from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';

const MARKER = `TESTE-IDORIGEM-${Date.now()}`;

async function main() {
  await connectDatabase();
  const RaModel = getReclamacaoReclameAquiModel();

  const created: { chamadoId: string; reclamacaoId: string }[] = [];
  let passed = true;

  try {
    for (let i = 1; i <= 2; i += 1) {
      const idOrigem = `${MARKER}-${i}`;
      console.log(`[test] criando reclamação nova #${i} (idOrigem=${idOrigem})…`);
      const result = await upsertRaTicketFromSource(
        {
          idOrigem,
          consumidor: `Cliente ${MARKER} ${i}`,
          cpf: '00000000000',
          assunto: `[${MARKER}] Assunto de teste ${i}`,
          descricao: `[${MARKER}] Descrição de teste ${i} — não é uma reclamação real.`,
          produto: 'Outros',
          statusRa: 'nao-respondida',
        },
        'sistema-teste',
        'hugme-import',
      );
      created.push({ chamadoId: String(result.chamadoId), reclamacaoId: String(result.reclamacaoId) });
      console.log(`[test] #${i} OK — chamadoId=${result.chamadoId} reclamacaoId=${result.reclamacaoId}`);
    }

    for (let i = 0; i < created.length; i += 1) {
      const doc = await RaModel.findById(created[i].reclamacaoId).select('idOrigem').lean();
      const expected = `${MARKER}-${i + 1}`;
      const ok = doc?.idOrigem === expected;
      console.log(`[test] verificação #${i + 1}: idOrigem persistido="${doc?.idOrigem}" esperado="${expected}" ${ok ? 'OK' : 'FALHOU'}`);
      if (!ok) passed = false;
    }

    console.log('\n=== RESULTADO ===');
    console.log(passed
      ? 'PASSOU: duas reclamações RA novas em sequência, sem colisão E11000, idOrigem persistido corretamente em cada uma.'
      : 'FALHOU: bug ainda presente.');
  } catch (err) {
    passed = false;
    console.error('[test] ERRO (bug ainda presente, ou outra falha):', err);
  } finally {
    console.log('[test] limpando dados de teste…');
    for (const c of created) {
      await ChamadoN1.deleteOne({ _id: c.chamadoId });
      await RaModel.deleteOne({ _id: c.reclamacaoId });
    }
    console.log('[test] limpeza concluída.');
  }

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[test] ERRO fatal:', err);
  process.exit(1);
});
