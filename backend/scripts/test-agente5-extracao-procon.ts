/**
 * test-agente5-extracao-procon — cria um chamado + reclamação Procon de TESTE (roteados pelo
 * Agente 4 via fast-path, sem LLM), chama diretamente o Agente 5 (extractCasosEspeciaisFields)
 * com um corpo de e-mail fictício de Procon, e confirma que os campos extraídos batem e foram
 * persistidos sem sobrescrever o que já existia. Remove os dados de teste no final.
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { createChamadoFromBody } from '../src/services/chamado.mapper';
import { routeCasoEspecialFormal } from '../src/services/agents/casosEspeciaisRouting.service';
import { buildFastPathTriagem } from '../src/services/agents/casosEspeciaisAgent.service';
import { resolveReclamacaoModel } from '../src/services/reclamacoes/reclamacao.service';
import { extractCasosEspeciaisFields } from '../src/services/agents/casosEspeciaisExtracao.service';
import { env } from '../src/config/env';

const MARKER = `TESTE-AGENTE5-${Date.now()}`;

const FAKE_PROCON_EMAIL_BODY = `
Prezados,

O Procon-SP (Fundação de Proteção e Defesa do Consumidor) notifica a empresa sobre a reclamação
registrada abaixo, para conhecimento e providências no prazo legal de 10 dias.

Consumidor: Maria da Silva Teste ${MARKER}
CPF: 123.456.789-00
Telefone: (11) 98888-7777
Cidade/UF: São Paulo/SP

Nº do processo: PC-${MARKER}-2026

Produto/Serviço: Empréstimo consignado

Relato do consumidor: Fiz um empréstimo consignado em fevereiro e até hoje não recebi o contrato
assinado nem o comprovante de quitação da parcela de março, mesmo já tendo sido descontado do
meu benefício.

Prazo de resposta: 25/09/2026
Data de abertura: 10/09/2026
`.trim();

async function main() {
  await connectDatabase();

  const payload = {
    chamadoTitulo: `[${MARKER}] Reclamação Procon`,
    title: `[${MARKER}] Reclamação Procon`,
    text: FAKE_PROCON_EMAIL_BODY,
    description: FAKE_PROCON_EMAIL_BODY,
    status: 'novo',
    clientName: `Maria da Silva Teste ${MARKER}`,
    author: 'sistema-teste',
    lateralForm: {
      classificacaoTipo: 'Reclamação',
      tipoChamado: 'Reclamação',
      canal: 'E-mail',
      clienteNome: `Maria da Silva Teste ${MARKER}`,
    },
  };

  const partial = await createChamadoFromBody(payload, 'novo');
  const chamado = await ChamadoN1.create(partial);
  console.log(`[test] chamado de teste criado: ${chamado._id} (${chamado.chamadoProtocolo})`);

  let reclamacaoId: string | null = null;

  try {
    const triagem = {
      ...buildFastPathTriagem('procon', ['teste-automatizado']),
      signals: ['teste-automatizado'],
      at: new Date().toISOString(),
    };

    const routed = await routeCasoEspecialFormal(chamado, triagem, { origemEntrada: 'teste-automatizado' });
    console.log('[test] routeCasoEspecialFormal (Agente 4):', { success: routed.success, error: routed.error });
    if (!routed.success) throw new Error(`roteamento falhou: ${routed.error}`);

    const ProconModel = resolveReclamacaoModel('procon')!;
    const doc = await ProconModel.findOne({ chamadoId: chamado._id }).exec();
    if (!doc) throw new Error('reclamação Procon não foi criada pelo roteamento');
    reclamacaoId = String(doc._id);
    console.log(`[test] reclamação Procon criada: ${reclamacaoId}`);
    console.log('[test] estado ANTES do Agente 5:', {
      protocoloExterno: doc.protocoloExterno,
      consumidor: doc.consumidor,
      produto: doc.produto,
      prazoLegal: doc.prazoLegal,
    });

    // Chama o Agente 5 direto, ignorando o feature flag (o teste quer validar o mecanismo em si).
    const wasEnabled = env.agentCasosEspeciaisExtracaoEnabled;
    (env as any).agentCasosEspeciaisExtracaoEnabled = true;
    const extraction = await extractCasosEspeciaisFields({
      chamado,
      orgao: 'procon',
      reclamacaoId: doc._id as any,
    });
    (env as any).agentCasosEspeciaisExtracaoEnabled = wasEnabled;

    console.log('[test] resultado Agente 5:', extraction);

    const updated = await ProconModel.findById(reclamacaoId).exec();
    console.log('[test] estado DEPOIS do Agente 5:', {
      protocoloExterno: updated?.protocoloExterno,
      consumidor: updated?.consumidor,
      produto: updated?.produto,
      cidade: updated?.cidade,
      uf: updated?.uf,
      prazoLegal: updated?.prazoLegal,
      dataReclamacao: updated?.dataReclamacao,
      assunto: updated?.assunto,
    });

    const passed = Boolean(
      extraction.ran
      && !extraction.error
      && updated?.protocoloExterno?.includes(MARKER)
      && updated?.produto
      && updated?.prazoLegal,
    );

    console.log('\n=== RESULTADO ===');
    console.log(passed
      ? 'PASSOU: Agente 5 extraiu e persistiu protocolo/produto/prazo do corpo do e-mail fictício.'
      : 'FALHOU: campos esperados não foram extraídos/persistidos corretamente.');

    process.exitCode = passed ? 0 : 1;
  } catch (err) {
    console.error('[test] ERRO:', err);
    process.exitCode = 1;
  } finally {
    console.log('[test] limpando dados de teste…');
    await ChamadoN1.deleteOne({ _id: chamado._id });
    if (reclamacaoId) {
      await resolveReclamacaoModel('procon')!.deleteOne({ _id: reclamacaoId });
    }
    console.log('[test] limpeza concluída.');
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  console.error('[test] ERRO fatal:', err);
  process.exit(1);
});
