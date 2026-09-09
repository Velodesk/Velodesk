/**
 * test-agente5-relacionados — dispara manualmente o Agente 5 (tickets relacionados) contra uma
 * reclamação Reclame Aqui real do dev DB, escolhendo o CPF com mais histórico disponível.
 * Script de diagnóstico único — não faz parte do pipeline normal da aplicação.
 */
import { connectDatabase, disconnectDatabase, isReclamacoesConnected } from '../src/config/database';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { fetchCpfHistoryChamadosRaw } from '../src/services/ticketSearch.service';
import { findReclamacoesByCpf } from '../src/services/reclamacoes/reclamacao.service';
import { runCasosEspeciaisRelacionadosAnalise } from '../src/services/agents/casosEspeciaisRelacionadosTrigger.service';
import { ChamadoN1 } from '../src/models/ChamadoN1';

function maskCpf(cpf: string): string {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11) return '(cpf inválido)';
  return `${d.slice(0, 3)}.***.***-${d.slice(-2)}`;
}

async function main(): Promise<void> {
  await connectDatabase();
  if (!isReclamacoesConnected()) {
    console.error('chamados_reclamacoes indisponível — abortando.');
    process.exit(1);
  }

  const Model = getReclamacaoReclameAquiModel();
  const candidatos = await Model.find({ cpf: { $exists: true, $ne: '' } })
    .sort({ createdAt: -1 })
    .limit(30)
    .exec();

  if (!candidatos.length) {
    console.log('Nenhuma reclamação Reclame Aqui com CPF encontrada no dev DB.');
    await disconnectDatabase();
    return;
  }

  console.log(`Avaliando histórico de ${candidatos.length} reclamações recentes para escolher a de maior histórico...`);

  let melhor: { doc: (typeof candidatos)[number]; historico: number } | null = null;
  for (const doc of candidatos) {
    const cpf = String(doc.cpf || '').replace(/\D/g, '');
    if (cpf.length !== 11) continue;
    const [chamados, reclamacoes] = await Promise.all([
      fetchCpfHistoryChamadosRaw(cpf, { excludeChamadoId: String(doc.chamadoId) }),
      findReclamacoesByCpf(cpf, 100),
    ]);
    const total = chamados.length + reclamacoes.filter((r) => String(r._id) !== String(doc._id)).length;
    if (!melhor || total > melhor.historico) {
      melhor = { doc, historico: total };
    }
  }

  if (!melhor || melhor.historico === 0) {
    console.log('Nenhum CPF com histórico anterior encontrado entre as reclamações recentes — escolhendo a mais recente mesmo assim.');
    melhor = { doc: candidatos[0], historico: 0 };
  }

  const alvo = melhor.doc;
  console.log('--- Alvo escolhido ---');
  console.log('Protocolo:', alvo.chamadoProtocolo);
  console.log('CPF:', maskCpf(alvo.cpf));
  console.log('Itens de histórico disponíveis (fora o próprio):', melhor.historico);
  console.log('Status analiseRelacionados ANTES:', alvo.analiseRelacionados?.status || '(nunca rodou)');

  console.log('--- Rodando Agente 5 ---');
  const result = await runCasosEspeciaisRelacionadosAnalise(alvo, { source: 'test-script' });
  console.log('Resultado runCasosEspeciaisRelacionadosAnalise:', result);

  const atualizado = await Model.findById(alvo._id);
  console.log('--- analiseRelacionados APÓS ---');
  console.log(JSON.stringify(atualizado?.analiseRelacionados, null, 2));

  if (atualizado?.analiseRelacionados?.notaInternaCriada) {
    const chamado = await ChamadoN1.findById(atualizado.chamadoId).select('registro chamadoProtocolo');
    const ultimoRegistro = chamado?.registro?.[chamado.registro.length - 1];
    console.log('--- Nota interna criada no ticket', chamado?.chamadoProtocolo, '---');
    console.log('Autor:', ultimoRegistro?.autor);
    console.log('Anotação:', ultimoRegistro?.anotacaoInterna);
  }

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('Falha no script de teste:', err);
  process.exit(1);
});
