/**
 * run-hugme-import-direct — roda a importação da planilha real chamando os serviços
 * diretamente (sem passar pelo servidor HTTP compartilhado, que outra sessão está editando
 * em paralelo e fica reiniciando via tsx watch, matando o processamento no meio). Mesmo
 * caminho de código que a rota /reclame-aqui/hugme/import usa (beginHugmeImport +
 * runHugmeImportLoop), só que dentro deste processo isolado, que ninguém reinicia.
 */
import fs from 'fs';
import { connectDatabase } from '../src/config/database';
import { beginHugmeImport, runHugmeImportLoop } from '../src/services/reclame-aqui/hugmeImport.service';

const FILE_PATH = 'C:/Users/lucas/Downloads/4358_base-completa_1790113000002-1.xlsx';

async function main() {
  await connectDatabase();

  const buffer = fs.readFileSync(FILE_PATH);
  console.log(`[import] arquivo: ${FILE_PATH.split('/').pop()} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const started = await beginHugmeImport(buffer, {
    modo: 'base_inicial',
    fileName: FILE_PATH.split('/').pop()!,
    importedBy: 'lucas.gravina@velotax.com.br',
  });

  console.log('[import] lote iniciado:', {
    batchId: started.batchId,
    parseStats: started.parse.stats,
    missingColumns: started.parse.missingColumns,
  });

  if (started.parse.missingColumns.length) {
    console.warn('[import] ATENÇÃO — colunas obrigatórias ausentes:', started.parse.missingColumns);
  }

  const result = await runHugmeImportLoop(started);

  console.log('\n[import] === CONCLUÍDO ===');
  console.log('stats:', result.stats);
  console.log('erros (primeiros 20):', JSON.stringify(result.errors.slice(0, 20), null, 2));
  console.log(`total de erros: ${result.errors.length}`);

  process.exit(result.stats.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[import] ERRO fatal:', err);
  process.exit(1);
});
