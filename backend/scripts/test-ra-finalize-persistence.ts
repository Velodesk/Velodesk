/**
 * test-ra-finalize-persistence — cria ticket+reclamação de TESTE via o mesmo path do hugme
 * import, chama a API HTTP real (como o frontend faz) pra finalizar, e verifica se o status
 * fica persistido no Mongo depois de "recarregar" (nova query, sem cache). Remove tudo no fim.
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { upsertRaTicketFromSource } from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';
import { signToken } from '../src/middleware/auth';
import { User } from '../src/models/User';

const API_BASE = 'http://localhost:8001/api';
const MARKER = `TESTE-FINALIZE-${Date.now()}`;

async function main() {
  await connectDatabase();

  const user = await User.findOne({ email: 'lucas.gravina@velotax.com.br' }).lean();
  if (!user) throw new Error('Usuário lucas.gravina@velotax.com.br não encontrado — aborta teste.');
  const token = signToken({
    userId: String(user._id),
    email: user.email,
    role: user.role,
    name: user.name,
  });
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  console.log(`[test] criando ticket RA de teste (marker=${MARKER})…`);
  const created = await upsertRaTicketFromSource(
    {
      idOrigem: MARKER,
      consumidor: `Cliente ${MARKER}`,
      cpf: '00000000000',
      assunto: `[${MARKER}] Assunto de teste`,
      descricao: `[${MARKER}] Descrição de teste — não é uma reclamação real.`,
      produto: 'Outros',
      statusRa: 'nao-respondida',
    },
    'sistema-teste',
    'teste-automatizado',
  );
  const chamadoId = String(created.chamadoId);
  const reclamacaoId = String(created.reclamacaoId);
  console.log(`[test] criado chamadoId=${chamadoId} reclamacaoId=${reclamacaoId}`);

  // Garante responsável + tabulação completa (senão o commit de status terminal falha por
  // regra de negócio antes mesmo de chegar no bug que estamos testando)
  await ChamadoN1.updateOne(
    { _id: chamadoId },
    {
      $set: {
        'tabulacao.0.responsavel': 'Lucas Gravina (teste)',
        'tabulacao.0.produto': 'Outros',
        'tabulacao.0.tipoChamado': 'Reclamação',
        'tabulacao.0.motivo': 'Motivo de teste',
      },
    },
  );

  let cleanupOk = false;
  try {
    // 1) Finalizar = commitTicketViaApi (status resolvido) — replica buildEspeciaisCommitPayload
    console.log('[test] POST /tickets/:id/commit (status=resolvido)…');
    const commitRes = await fetch(`${API_BASE}/tickets/${chamadoId}/commit`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ status: 'resolvido', text: '', internalText: '' }),
    });
    const commitBody = await commitRes.json();
    if (!commitRes.ok) {
      throw new Error(`commit falhou (${commitRes.status}): ${JSON.stringify(commitBody)}`);
    }
    const ticketStatusAfterCommit = commitBody?.status;
    console.log(`[test] commit OK — ticket.status=${ticketStatusAfterCommit}`);

    // 2) PATCH na reclamação (o que o frontend faz em especiaisTicketCommitService.js)
    console.log('[test] PATCH /reclamacoes/reclame-aqui/:id (statusCanal, aberta, ticketStatus)…');
    const patchRes = await fetch(`${API_BASE}/reclamacoes/reclame-aqui/${reclamacaoId}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        statusCanal: 'respondida',
        aberta: false,
        ticketStatus: ticketStatusAfterCommit || 'resolvido',
      }),
    });
    const patchBody = await patchRes.json();
    if (!patchRes.ok) {
      throw new Error(`patch falhou (${patchRes.status}): ${JSON.stringify(patchBody)}`);
    }
    console.log('[test] patch OK — resposta:', JSON.stringify({
      statusCanal: patchBody.statusCanal,
      aberta: patchBody.aberta,
      ticketStatus: patchBody.ticketStatus,
    }));

    // 3) Simula "sair e voltar ao módulo": nova query stateless no Mongo, sem nenhum cache
    console.log('[test] simulando reload — GET /reclamacoes/reclame-aqui/:id (fresh)…');
    const reloadRes = await fetch(`${API_BASE}/reclamacoes/reclame-aqui/${reclamacaoId}`, {
      headers: authHeaders,
    });
    const reloadBody = await reloadRes.json();
    if (!reloadRes.ok) {
      throw new Error(`reload GET falhou (${reloadRes.status}): ${JSON.stringify(reloadBody)}`);
    }
    console.log('[test] estado após reload:', JSON.stringify({
      statusCanal: reloadBody.statusCanal,
      aberta: reloadBody.aberta,
      ticketStatus: reloadBody.ticketStatus,
    }));

    // 4) Também via list (o endpoint que o front chama ao reabrir o módulo)
    const listRes = await fetch(`${API_BASE}/reclamacoes/reclame-aqui?limit=500`, { headers: authHeaders });
    const listBody = await listRes.json();
    const listItems = Array.isArray(listBody) ? listBody : (listBody?.items || []);
    const fromList = listItems.find((i: any) => String(i.id) === reclamacaoId);
    console.log('[test] estado no LIST (o que o front usa ao reabrir o módulo):', fromList
      ? JSON.stringify({ statusCanal: fromList.statusCanal, aberta: fromList.aberta, ticketStatus: fromList.ticketStatus })
      : '(não encontrado na lista — ver filtros/paginação)');

    const persistedClosed = reloadBody.aberta === false
      && reloadBody.statusCanal === 'respondida'
      && reloadBody.ticketStatus === 'resolvido';

    console.log('\n=== RESULTADO ===');
    console.log(persistedClosed
      ? 'PASSOU: aberta=false, statusCanal=respondida e ticketStatus=resolvido persistidos e lidos de volta do banco (fresh query, sem cache).'
      : 'FALHOU: o estado lido de volta do banco não bate com o que foi finalizado — bug ainda presente.');

    cleanupOk = true;
  } finally {
    console.log('[test] limpando dados de teste…');
    await ChamadoN1.deleteOne({ _id: chamadoId });
    const ReclamacaoModel = getReclamacaoReclameAquiModel();
    await ReclamacaoModel.deleteOne({ _id: reclamacaoId });
    console.log('[test] limpeza concluída.', cleanupOk ? '' : '(execução interrompida por erro acima)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[test] ERRO:', err);
    process.exit(1);
  });
