/**
 * test-hugme-legado-colunas — monta um buffer .xlsx em memória com o cabeçalho real da base
 * histórica (incluindo as novas colunas "Produto"/"Motivo" e "Status Hugme"), roda pelo parser
 * + upsertRaTicketFromSource de verdade, e confirma:
 *  - linha com Status Hugme = "Novo" nasce com ticket aberto (status novo);
 *  - linha com Status Hugme != "Novo" nasce resolvida;
 *  - Produto/Motivo das novas colunas são roteados pro ticket E pra reclamacoes_reclameAqui,
 *    inclusive um produto que não existe no catálogo ativo (grava literal, sem exigir match).
 * Remove os dados de teste no final.
 */
import * as XLSX from 'xlsx';
import { connectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { getReclamacaoReclameAquiModel } from '../src/models/reclamacoes/reclamacaoModels';
import { prepareHugmeImport } from '../src/services/reclame-aqui/hugmeSpreadsheet.service';
import {
  parsedRowToRaTicketSource,
  upsertRaTicketFromSource,
} from '../src/services/reclame-aqui/reclameAquiTicketCreate.service';
import { currentStatus } from '../src/services/chamado.mapper';

const MARKER = `TESTE-LEGADO-${Date.now()}`;

const HEADERS = [
  'Origem', 'Id Origem', 'Data Reclamação', 'Status Hugme', 'Status RA', 'Nome', 'CPF/CNPJ',
  'Seu problema foi resolvido?', 'Voltaria a fazer negócio?', 'Nota', 'Moderações neste ticket',
  'Data de Desativação RA', 'Motivo de Desativação RA', 'Avaliações desconsideradas RA',
  'Moderação status', 'Nome social do consumidor', 'Email', 'Telefones', 'Cidade', 'Estado',
  'Resposta da empresa', 'Data de Resposta', 'Título', 'Texto da Reclamação',
  'Consideração Consumidor', 'Data Consideração Consumidor', 'Tempo primeira resposta (público)',
  'Comentários na reclamação*', 'Data Avaliacao', 'Motivo da Reclamação RA', 'Sentimento RA*',
  'Moderação motivo', 'Moderação data de solicitação', 'Moderação data da resposta',
  'Categoria RA', 'Problema RA', 'Produto RA', 'Réplicas na reclamação RA', 'Id HugMe',
  'Produto', 'Motivo',
];

function buildRow(overrides: Record<string, unknown>): unknown[] {
  const row = new Array(HEADERS.length).fill('');
  for (const [key, value] of Object.entries(overrides)) {
    const idx = HEADERS.indexOf(key);
    if (idx < 0) throw new Error(`coluna desconhecida: ${key}`);
    row[idx] = value;
  }
  return row;
}

async function main() {
  await connectDatabase();

  const rowNovo = buildRow({
    Origem: 'ReclameAQUI',
    'Id Origem': `${MARKER}-NOVO`,
    Nome: `Cliente Novo ${MARKER}`,
    'CPF/CNPJ': '00000000000',
    'Status Hugme': 'Novo',
    Título: `[${MARKER}] Assunto novo`,
    'Texto da Reclamação': 'Descrição do caso ainda em aberto.',
    'Produto RA': 'Produto RA legado (não é o produto do Desk)',
    Produto: 'Antecipação 2026', // existe no catálogo ativo
    Motivo: 'Cobrança indevida',
  });

  const rowFechado = buildRow({
    Origem: 'ReclameAQUI',
    'Id Origem': `${MARKER}-FECHADO`,
    Nome: `Cliente Fechado ${MARKER}`,
    'CPF/CNPJ': '00000000000',
    'Status Hugme': 'Fechado',
    Título: `[${MARKER}] Assunto fechado`,
    'Texto da Reclamação': 'Descrição do caso já encerrado historicamente.',
    Produto: 'Veloprime', // NÃO existe no catálogo ativo — deve gravar literal mesmo assim
    Motivo: 'Dúvidas Restituição',
  });

  const matrix = [[' '], ['Base Completa'], [], HEADERS, rowNovo, rowFechado];
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planilha1');
  const buffer = XLSX.write(wb, { type: 'buffer' });

  // Mesma leitura que parseHugmeBuffer faz internamente, evitando duplicar a detecção de cabeçalho.
  const readBack = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = readBack.Sheets[readBack.SheetNames[0]];
  const fullMatrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as unknown[][];
  const headerRowIndex = 3;
  const headers = (fullMatrix[headerRowIndex] || []).map((h) => String(h ?? ''));
  const rawRows = fullMatrix.slice(headerRowIndex + 1);
  const parsed = prepareHugmeImport(rawRows, headers, { headerRowIndex });

  console.log('[test] linhas parseadas:', parsed.stats);
  if (parsed.stats.valid !== 2) {
    throw new Error(`esperava 2 linhas válidas, veio ${JSON.stringify(parsed.stats)} — erros: ${JSON.stringify(parsed.rows.map((r) => r.errors))}`);
  }

  const created: { chamadoId: string; reclamacaoId: string; idOrigem: string }[] = [];
  let passed = true;

  try {
    for (const row of parsed.rows) {
      const source = parsedRowToRaTicketSource(row);
      const result = await upsertRaTicketFromSource(source, 'sistema-teste', 'hugme-import');
      created.push({
        chamadoId: String(result.chamadoId),
        reclamacaoId: String(result.reclamacaoId),
        idOrigem: row.idOrigem,
      });
    }

    const RaModel = getReclamacaoReclameAquiModel();

    for (const c of created) {
      const chamado = await ChamadoN1.findById(c.chamadoId);
      const reclamacao = await RaModel.findById(c.reclamacaoId).select('produto motivo').lean();
      const isNovo = c.idOrigem.endsWith('-NOVO');
      const expectedStatus = isNovo ? 'novo' : 'resolvido';
      const expectedProduto = isNovo ? 'Antecipação 2026' : 'Veloprime';
      const expectedMotivo = isNovo ? 'Cobrança indevida' : 'Dúvidas Restituição';

      const chamadoStatus = chamado ? currentStatus(chamado) : '(chamado não encontrado)';
      const tabProduto = chamado?.tabulacao?.[0]?.produto;
      const tabMotivo = chamado?.tabulacao?.[0]?.motivo;

      console.log(`\n[test] ${c.idOrigem}`);
      console.log('  chamado.status:', chamadoStatus, '| esperado:', expectedStatus);
      console.log('  tabulacao.produto:', tabProduto, '| esperado:', expectedProduto);
      console.log('  tabulacao.motivo:', tabMotivo, '| esperado:', expectedMotivo);
      console.log('  reclamacao.produto:', reclamacao?.produto, '| reclamacao.motivo:', reclamacao?.motivo);

      const ok = chamadoStatus === expectedStatus
        && tabProduto === expectedProduto
        && tabMotivo === expectedMotivo
        && reclamacao?.produto === expectedProduto
        && reclamacao?.motivo === expectedMotivo;

      if (!ok) passed = false;
      console.log('  =>', ok ? 'OK' : 'FALHOU');
    }

    console.log('\n=== RESULTADO ===');
    console.log(passed
      ? 'PASSOU: status novo/resolvido por linha, produto/motivo roteados (incl. produto fora do catálogo ativo, gravado literal).'
      : 'FALHOU: ver detalhes acima.');

    process.exitCode = passed ? 0 : 1;
  } catch (err) {
    console.error('[test] ERRO:', err);
    process.exitCode = 1;
  } finally {
    console.log('\n[test] limpando dados de teste…');
    for (const c of created) {
      await ChamadoN1.deleteOne({ _id: c.chamadoId });
      await getReclamacaoReclameAquiModel().deleteOne({ _id: c.reclamacaoId });
    }
    console.log('[test] limpeza concluída.');
    process.exit(process.exitCode ?? 0);
  }
}

main().catch((err) => {
  console.error('[test] ERRO fatal:', err);
  process.exit(1);
});
