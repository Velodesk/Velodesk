/**
 * test-hugme-date-reimport-fix — reproduz os bugs relatados pelo usuário após o import real de
 * 6.816 linhas: (1) data de criação/mensagem do cliente usando "hoje" em vez da data da planilha,
 * (2) responsável automaticamente atribuído a quem fez o upload. Cria um ticket novo via
 * upsertRaTicketFromSource com uma dataReclamacao antiga, confirma que createdAt/registro[0].data/
 * Reclamacao.dataReclamacao refletem essa data (não "hoje") e que responsavel/atendente ficam
 * vazios. Depois reimporta o MESMO idOrigem com uma dataReclamacao diferente (corrigida) e
 * confirma que o ticket existente é atualizado (sem duplicar) e as datas são corrigidas
 * retroativamente. Remove os dados de teste no final.
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { upsertRaTicketFromSource } from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';

const MARKER = `TESTE-DATA-REIMPORT-${Date.now()}`;
const idOrigem = `${MARKER}-1`;

const ORIGINAL_DATE = '2023-05-10T12:00:00.000Z';
const CORRECTED_DATE = '2023-03-02T09:30:00.000Z';

async function main() {
  await connectDatabase();
  const RaModel = getReclamacaoReclameAquiModel();

  let passed = true;
  let chamadoId: string | undefined;
  let reclamacaoId: string | undefined;

  try {
    console.log('[test] criando ticket novo com dataReclamacao antiga…');
    const created = await upsertRaTicketFromSource(
      {
        idOrigem,
        consumidor: `Cliente ${MARKER}`,
        cpf: '00000000000',
        assunto: `[${MARKER}] Assunto de teste`,
        descricao: `[${MARKER}] Descrição de teste — não é uma reclamação real.`,
        produto: 'Outros',
        statusRa: 'nao-respondida',
        dataReclamacao: ORIGINAL_DATE,
      },
      'agente-que-fez-upload',
      'hugme-import',
    );
    chamadoId = String(created.chamadoId);
    reclamacaoId = String(created.reclamacaoId);
    console.log(`[test] criado — chamadoId=${chamadoId} reclamacaoId=${reclamacaoId}`);

    const chamado = await ChamadoN1.findById(chamadoId).lean();
    const reclamacao = await RaModel.findById(reclamacaoId).lean();

    const createdAtOk = chamado?.createdAt
      && new Date(chamado.createdAt).toISOString() === ORIGINAL_DATE;
    const registroDataOk = chamado?.registro?.[0]?.data
      && new Date(chamado.registro[0].data).toISOString() === ORIGINAL_DATE;
    const reclamacaoDataOk = (reclamacao as { dataReclamacao?: Date } | null)?.dataReclamacao
      && new Date((reclamacao as { dataReclamacao?: Date }).dataReclamacao as Date).toISOString() === ORIGINAL_DATE;
    const lastTab = chamado?.tabulacao?.[chamado.tabulacao.length - 1];
    const responsavelVazio = !lastTab?.responsavel;
    const atendenteVazio = !(reclamacao as { atendente?: string } | null)?.atendente;

    console.log(`[test] createdAt correto (não "hoje"): ${createdAtOk ? 'OK' : 'FALHOU'} (valor=${chamado?.createdAt})`);
    console.log(`[test] registro[0].data correto: ${registroDataOk ? 'OK' : 'FALHOU'} (valor=${chamado?.registro?.[0]?.data})`);
    console.log(`[test] Reclamacao.dataReclamacao correto: ${reclamacaoDataOk ? 'OK' : 'FALHOU'}`);
    console.log(`[test] tabulacao.responsavel vazio (não uploader): ${responsavelVazio ? 'OK' : 'FALHOU'} (valor="${lastTab?.responsavel}")`);
    console.log(`[test] Reclamacao.atendente vazio (não uploader): ${atendenteVazio ? 'OK' : 'FALHOU'}`);
    if (!createdAtOk || !registroDataOk || !reclamacaoDataOk || !responsavelVazio || !atendenteVazio) passed = false;

    console.log('\n[test] reimportando mesmo idOrigem com dataReclamacao corrigida…');
    const reimported = await upsertRaTicketFromSource(
      {
        idOrigem,
        consumidor: `Cliente ${MARKER}`,
        cpf: '00000000000',
        assunto: `[${MARKER}] Assunto de teste (enriquecido)`,
        descricao: `[${MARKER}] Descrição enriquecida — não é uma reclamação real.`,
        produto: 'Outros',
        motivo: 'Motivo enriquecido',
        statusRa: 'nao-respondida',
        dataReclamacao: CORRECTED_DATE,
      },
      'agente-que-fez-upload',
      'hugme-import',
    );

    const noDuplication = String(reimported.chamadoId) === chamadoId
      && String(reimported.reclamacaoId) === reclamacaoId
      && reimported.updated === true;
    console.log(`[test] sem duplicação (mesmo chamado/reclamação, updated=true): ${noDuplication ? 'OK' : 'FALHOU'}`);
    if (!noDuplication) passed = false;

    const chamadoAfter = await ChamadoN1.findById(chamadoId).lean();
    const reclamacaoAfter = await RaModel.findById(reclamacaoId).lean();

    const createdAtCorrigido = chamadoAfter?.createdAt
      && new Date(chamadoAfter.createdAt).toISOString() === CORRECTED_DATE;
    const registroDataCorrigido = chamadoAfter?.registro?.[0]?.data
      && new Date(chamadoAfter.registro[0].data).toISOString() === CORRECTED_DATE;
    const reclamacaoDataCorrigida = (reclamacaoAfter as { dataReclamacao?: Date } | null)?.dataReclamacao
      && new Date((reclamacaoAfter as { dataReclamacao?: Date }).dataReclamacao as Date).toISOString() === CORRECTED_DATE;

    console.log(`[test] createdAt corrigido no reimport: ${createdAtCorrigido ? 'OK' : 'FALHOU'} (valor=${chamadoAfter?.createdAt})`);
    console.log(`[test] registro[0].data corrigido no reimport: ${registroDataCorrigido ? 'OK' : 'FALHOU'}`);
    console.log(`[test] Reclamacao.dataReclamacao corrigida no reimport: ${reclamacaoDataCorrigida ? 'OK' : 'FALHOU'}`);
    if (!createdAtCorrigido || !registroDataCorrigido || !reclamacaoDataCorrigida) passed = false;

    console.log('\n=== RESULTADO ===');
    console.log(passed
      ? 'PASSOU: datas corretas na criação, responsável vazio para import, e reimport corrige datas retroativamente sem duplicar.'
      : 'FALHOU: algum bug ainda presente.');
  } catch (err) {
    passed = false;
    console.error('[test] ERRO:', err);
  } finally {
    console.log('[test] limpando dados de teste…');
    if (chamadoId) await ChamadoN1.deleteOne({ _id: chamadoId });
    if (reclamacaoId) await RaModel.deleteOne({ _id: reclamacaoId });
    console.log('[test] limpeza concluída.');
  }

  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('[test] ERRO fatal:', err);
  process.exit(1);
});
