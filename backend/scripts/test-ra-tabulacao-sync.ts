/**
 * test-ra-tabulacao-sync — cria ticket+reclamação RA de TESTE, salva o ticket via
 * /tickets/:id/commit alterando produto/motivo (como o botão "Salvar ticket" do RA faz),
 * e confirma que reclamacoes_reclameAqui reflete produto/motivo depois — simulando "sair e
 * voltar pro ticket". Remove os dados de teste no final.
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { upsertRaTicketFromSource } from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';
import { signToken } from '../src/middleware/auth';
import { User } from '../src/models/User';

const API_BASE = 'http://localhost:8001/api';
const MARKER = `TESTE-TABULACAO-${Date.now()}`;

async function main() {
  await connectDatabase();

  const user = await User.findOne({ email: 'lucas.gravina@velotax.com.br' }).lean();
  if (!user) throw new Error('Usuário lucas.gravina@velotax.com.br não encontrado — aborta teste.');
  const token = signToken({ userId: String(user._id), email: user.email, role: user.role, name: user.name });
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const created = await upsertRaTicketFromSource(
    {
      idOrigem: MARKER,
      consumidor: `Cliente ${MARKER}`,
      cpf: '00000000000',
      assunto: `[${MARKER}] Assunto de teste`,
      descricao: `[${MARKER}] Descrição de teste.`,
      produto: 'Outros',
      statusRa: 'nao-respondida',
    },
    'sistema-teste',
    'teste-automatizado',
  );
  const chamadoId = String(created.chamadoId);
  const reclamacaoId = String(created.reclamacaoId);
  console.log(`[test] criado chamadoId=${chamadoId} reclamacaoId=${reclamacaoId}`);

  await ChamadoN1.updateOne(
    { _id: chamadoId },
    { $set: { 'tabulacao.0.responsavel': 'Lucas Gravina (teste)' } },
  );

  try {
    const NOVO_PRODUTO = 'Empréstimo Consignado';
    const NOVO_MOTIVO = 'Cobrança indevida';

    console.log(`[test] POST /tickets/:id/commit alterando produto="${NOVO_PRODUTO}" motivo="${NOVO_MOTIVO}"…`);
    const commitRes = await fetch(`${API_BASE}/tickets/${chamadoId}/commit`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        text: '',
        internalText: '',
        lateralForm: { produto: NOVO_PRODUTO, motivo: NOVO_MOTIVO },
      }),
    });
    const commitBody = await commitRes.json();
    if (!commitRes.ok) {
      throw new Error(`commit falhou (${commitRes.status}): ${JSON.stringify(commitBody)}`);
    }
    console.log('[test] commit OK');

    // syncFromChamado roda fire-and-forget dentro da rota — dá um instante pra terminar.
    await new Promise((r) => setTimeout(r, 1500));

    // Simula "sair e voltar": nova query stateless, sem cache.
    const RaModel = getReclamacaoReclameAquiModel();
    const reclamacaoDepois = await RaModel.findById(reclamacaoId).select('produto motivo').lean();
    console.log('[test] reclamacoes_reclameAqui após reload:', reclamacaoDepois);

    const passed = reclamacaoDepois?.produto === NOVO_PRODUTO && reclamacaoDepois?.motivo === NOVO_MOTIVO;

    console.log('\n=== RESULTADO ===');
    console.log(passed
      ? 'PASSOU: produto/motivo persistidos em reclamacoes_reclameAqui após salvar o ticket.'
      : 'FALHOU: produto/motivo não refletiram em reclamacoes_reclameAqui — bug ainda presente.');

    process.exitCode = passed ? 0 : 1;
  } catch (err) {
    console.error('[test] ERRO:', err);
    process.exitCode = 1;
  } finally {
    console.log('[test] limpando dados de teste…');
    await ChamadoN1.deleteOne({ _id: chamadoId });
    await getReclamacaoReclameAquiModel().deleteOne({ _id: reclamacaoId });
    console.log('[test] limpeza concluída.');
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  console.error('[test] ERRO fatal:', err);
  process.exit(1);
});
