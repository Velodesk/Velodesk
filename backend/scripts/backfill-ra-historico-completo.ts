/**
 * backfill-ra-historico-completo — corrige, a partir de `dadosPlanilha` já salvo (sem reler o
 * .xlsx original), o histórico de tickets Reclame Aqui importados antes das correções de hoje
 * (handoff RA-datas): data da mensagem de resposta pública, mensagem de consideração do
 * consumidor (texto + data), nota/"problema resolvido?"/"voltaria a fazer negócio?", moderação
 * (solicitada/aceita/quantidade) e remoção do texto de consideração que hoje vem colado dentro
 * da mensagem original da reclamação.
 *
 * Por padrão roda em modo RELATÓRIO (não grava nada). Use --apply para gravar de verdade.
 * --limit=N limita quantos docs processar (default 10 — pensado pro dry-run de amostra).
 * --idOrigem=XXXX processa só um ticket específico (ex.: --idOrigem=151551257).
 *
 * Uso:
 *   npx tsx scripts/backfill-ra-historico-completo.ts                       (relatório, 10 docs)
 *   npx tsx scripts/backfill-ra-historico-completo.ts --idOrigem=151551257  (relatório, 1 ticket)
 *   npx tsx scripts/backfill-ra-historico-completo.ts --apply --limit=10    (grava, 10 docs)
 *   npx tsx scripts/backfill-ra-historico-completo.ts --apply --limit=0     (grava, todos)
 */
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import type { IChamadoN1, IRegistro } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { buildParsedRowFromDadosPlanilha } from '../src/services/reclame-aqui/hugmeSpreadsheet.service';
import {
  parsedRowToRaTicketSource,
  buildRaFirstClassSet,
  parseReclamacaoDate,
} from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';

const CONSIDERACAO_MARKER = '\n\nConsideração do consumidor:\n';

interface Args {
  apply: boolean;
  limit: number;
  onlyIdOrigem?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;
  const idArg = argv.find((a) => a.startsWith('--idOrigem='));
  const onlyIdOrigem = idArg ? idArg.split('=')[1].trim() : undefined;
  return { apply, limit: Number.isFinite(limit) ? limit : 10, onlyIdOrigem };
}

function stripConsideracaoMarker(text: string): { stripped: string; changed: boolean } {
  const idx = text.indexOf(CONSIDERACAO_MARKER);
  if (idx < 0) return { stripped: text, changed: false };
  return { stripped: text.slice(0, idx).trimEnd(), changed: true };
}

function findRegistroIdx(registro: IRegistro[], source: string): number {
  return registro.findIndex((r) => String(r.metadados?.source ?? '').toLowerCase() === source);
}

async function main() {
  const { apply, limit, onlyIdOrigem } = parseArgs();
  console.log(`[backfill-ra-historico] modo=${apply ? 'APPLY (grava no banco)' : 'DRY-RUN (só relatório, nada é gravado)'} limit=${limit || 'sem limite'} idOrigem=${onlyIdOrigem || '(todos)'}`);

  await connectDatabase();
  const RaModel = getReclamacaoReclameAquiModel();

  const query: Record<string, unknown> = {
    dadosPlanilha: { $exists: true, $ne: {} },
    // Exclui lixo residual de scripts de teste (TESTE-NNNN / TESTE-XXXX-timestamp) que ficou
    // órfão (reclamação sem chamado) em bancos de dev — nunca é um ticket real.
    idOrigem: { $not: /^TESTE/ },
  };
  if (onlyIdOrigem) query.idOrigem = onlyIdOrigem;

  const cursorQuery = RaModel.find(query).sort({ _id: 1 });
  if (limit > 0) cursorQuery.limit(limit);
  const cursor = cursorQuery.cursor();

  let processed = 0;
  let semChamado = 0;
  const stats = {
    dataReclamacaoMsgCorrigida: 0,
    dataRespostaMsgCorrigida: 0,
    considMsgInserida: 0,
    considSemData: 0,
    textoDuplicadoRemovido: 0,
    reclamacaoAtualizada: 0,
  };

  for await (const doc of cursor) {
    processed += 1;
    const idOrigem = doc.idOrigem;
    console.log(`\n=== [${processed}] idOrigem=${idOrigem} reclamacaoId=${doc._id} chamadoId=${doc.chamadoId} ===`);

    const parsedRow = buildParsedRowFromDadosPlanilha(doc.dadosPlanilha as Record<string, string>, processed);
    const source = parsedRowToRaTicketSource(parsedRow);

    // --- 1) Campos de primeira classe da reclamação (nota, resolvido, voltaria, moderação,
    // dataReclamacao/dataResposta, e respostaPublica/consideracaoConsumidor só se ainda vazios) ---
    const reclamacaoSet = buildRaFirstClassSet(source, {
      respostaPublicaToApply: doc.respostaPublica ? undefined : (source.respostaPublica || undefined),
      consideracaoConsumidorToApply: doc.consideracaoConsumidor ? undefined : (source.consideracaoConsumidor || undefined),
    });
    console.log('[reclamacao] $set proposto:', JSON.stringify(reclamacaoSet, null, 2));

    if (apply) {
      await RaModel.updateOne({ _id: doc._id }, { $set: reclamacaoSet }).exec();
      stats.reclamacaoAtualizada += 1;
    }

    if (!doc.chamadoId) {
      semChamado += 1;
      console.log('[chamado] sem chamadoId vinculado — pulando correções de chat.');
      continue;
    }

    const chamado = await ChamadoN1.findById(doc.chamadoId);
    if (!chamado) {
      semChamado += 1;
      console.log(`[chamado] ${doc.chamadoId} não encontrado — pulando correções de chat.`);
      continue;
    }

    const registro = chamado.registro ?? [];
    let registroChanged = false;

    // --- 2) Remove o texto de consideração que hoje vem colado na mensagem original, e corrige
    // a DATA dela também — muitos tickets históricos têm a mensagem da reclamação datada com o
    // momento da importação (mesmo bug da resposta pública), e isso bagunça a ordem cronológica
    // do chat na hora de reordenar (passo 5) se não for corrigido aqui também. ---
    const complaintIdx = findRegistroIdx(registro, 'reclame-aqui');
    const dataReclamacaoReal = parseReclamacaoDate(source.dataReclamacao)
      || (doc.dataReclamacao ? new Date(doc.dataReclamacao) : null);
    if (complaintIdx >= 0) {
      const atual = String(registro[complaintIdx].mensagemPublica || '');
      const { stripped, changed } = stripConsideracaoMarker(atual);
      if (changed) {
        console.log(`[chat] mensagem original (idx ${complaintIdx}) tem texto de consideração embutido — será removido.`);
        console.log(`  antes: ...${atual.slice(-80)}`);
        console.log(`  depois: ...${stripped.slice(-80)}`);
        if (apply) {
          registro[complaintIdx].mensagemPublica = stripped;
          registroChanged = true;
        }
        stats.textoDuplicadoRemovido += 1;
      }

      const dataAtualComplaint = registro[complaintIdx].data;
      const precisaCorrigirComplaint = dataReclamacaoReal
        && (!dataAtualComplaint || new Date(dataAtualComplaint).getTime() !== dataReclamacaoReal.getTime());
      if (precisaCorrigirComplaint) {
        console.log(`[chat] mensagem original (idx ${complaintIdx}) — data atual=${dataAtualComplaint} → corrigida=${dataReclamacaoReal!.toISOString()}`);
        if (apply) {
          registro[complaintIdx].data = dataReclamacaoReal!;
          registroChanged = true;
        }
        stats.dataReclamacaoMsgCorrigida += 1;
      }
    }

    // --- 3) Corrige a data da mensagem de resposta pública (hoje = momento da importação) ---
    const respostaIdx = findRegistroIdx(registro, 'hugme-import-resposta');
    const dataRespostaReal = parseReclamacaoDate(source.dataResposta) || (doc.dataResposta ? new Date(doc.dataResposta) : null);
    if (respostaIdx >= 0 && dataRespostaReal) {
      const dataAtual = registro[respostaIdx].data;
      const precisaCorrigir = !dataAtual || new Date(dataAtual).getTime() !== dataRespostaReal.getTime();
      if (precisaCorrigir) {
        console.log(`[chat] mensagem de resposta pública (idx ${respostaIdx}) — data atual=${dataAtual} → corrigida=${dataRespostaReal.toISOString()}`);
        if (apply) {
          registro[respostaIdx].data = dataRespostaReal;
          registroChanged = true;
        }
        stats.dataRespostaMsgCorrigida += 1;
      }
    } else if (respostaIdx >= 0 && !dataRespostaReal) {
      console.log('[chat] mensagem de resposta pública existe mas não há Data de Resposta aproveitável — data NÃO corrigida.');
    }

    // --- 4) Insere mensagem de consideração do consumidor, se faltar e houver texto+data ---
    const considExisteIdx = findRegistroIdx(registro, 'hugme-import-consideracao');
    const considTexto = String(source.consideracaoConsumidor || '').trim();
    const considData = parseReclamacaoDate(source.dataConsideracaoConsumidor);
    if (considExisteIdx < 0 && considTexto) {
      if (!considData) {
        console.log('[chat] há texto de consideração do consumidor mas SEM data aproveitável — mensagem NÃO inserida (ficaria sem data confiável).');
        stats.considSemData += 1;
      } else {
        console.log(`[chat] inserindo mensagem de consideração do consumidor, data=${considData.toISOString()}, texto="${considTexto.slice(0, 60)}..."`);
        if (apply) {
          const clienteNome = (chamado.cliente?.[0] as { clienteNome?: string } | undefined)?.clienteNome
            || source.consumidor || 'Consumidor';
          registro.push({
            data: considData,
            origin: 'cliente',
            autor: clienteNome,
            mensagemPublica: considTexto,
            anexosMensagemPublica: [],
            anotacaoInterna: '',
            anexosAnotacaoInterna: [],
            alteracoes: [],
            metadados: { source: 'hugme-import-consideracao' },
            status: 'novo',
          } as IRegistro);
          registroChanged = true;
        }
        stats.considMsgInserida += 1;
      }
    }

    // --- 5) Reordena o chat cronologicamente (a mensagem de consideração pode ter ficado fora
    // de ordem ao ser inserida no fim; a de resposta também pode ter mudado de posição) ---
    if (apply && registroChanged) {
      registro.sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());
      chamado.markModified('registro');
      await (chamado as IChamadoN1).save();
      console.log('[chamado] registro[] salvo (reordenado cronologicamente).');
    }
  }

  console.log('\n=== RESUMO ===');
  console.log(`processados: ${processed} | sem chamado vinculado: ${semChamado}`);
  console.log(JSON.stringify(stats, null, 2));
  console.log(apply ? 'Modo APPLY — alterações acima foram gravadas.' : 'Modo DRY-RUN — nada foi gravado. Rode com --apply pra aplicar de verdade.');

  process.exit(0);
}

main().catch((err) => {
  console.error('[backfill-ra-historico] ERRO:', err);
  process.exit(1);
});
