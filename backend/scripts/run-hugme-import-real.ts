/**
 * run-hugme-import-real — sobe a planilha real da base histórica do Reclame Aqui via
 * POST /reclame-aqui/hugme/import (mesma rota que o front usa), e faz polling do status do
 * lote até terminar, reportando estatísticas finais e as primeiras linhas com erro (se houver).
 */
import { connectDatabase } from '../src/config/database';
import { signToken } from '../src/middleware/auth';
import { User } from '../src/models/User';
import fs from 'fs';

const API_BASE = 'http://localhost:8001/api';
const FILE_PATH = 'C:/Users/lucas/Downloads/4358_base-completa_1790113000002-1.xlsx';

async function main() {
  await connectDatabase();

  const user = await User.findOne({ email: 'lucas.gravina@velotax.com.br' }).lean();
  if (!user) throw new Error('Usuário lucas.gravina@velotax.com.br não encontrado.');
  const token = signToken({ userId: String(user._id), email: user.email, role: user.role, name: user.name });
  const authHeaders = { Authorization: `Bearer ${token}` };

  const buffer = fs.readFileSync(FILE_PATH);
  const fileName = FILE_PATH.split('/').pop()!;
  console.log(`[import] arquivo: ${fileName} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

  const form = new FormData();
  form.append('file', new Blob([buffer]), fileName);

  const startRes = await fetch(`${API_BASE}/reclame-aqui/hugme/import?modo=base_inicial`, {
    method: 'POST',
    headers: authHeaders,
    body: form,
  });
  const startBody = await startRes.json();
  if (!startRes.ok) {
    throw new Error(`import falhou ao iniciar (${startRes.status}): ${JSON.stringify(startBody)}`);
  }
  console.log('[import] lote iniciado:', JSON.stringify(startBody, null, 2));

  const batchId = startBody.batchId;
  if (!batchId) {
    console.log('[import] sem batchId — provavelmente já terminou sincronamente. Resultado:', startBody);
    process.exit(0);
  }

  console.log(`[import] acompanhando lote ${batchId}…`);
  let lastProcessed = -1;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const statusRes = await fetch(`${API_BASE}/reclame-aqui/hugme/import-batches/${batchId}`, { headers: authHeaders });
    const statusBody = await statusRes.json();
    if (!statusRes.ok) {
      console.warn('[import] falha ao consultar status:', statusRes.status, statusBody);
      continue;
    }
    if (statusBody.processed !== lastProcessed) {
      console.log(`[import] progresso: ${statusBody.processed}/${statusBody.total} (inserted=${statusBody.inserted} updated=${statusBody.updated} skipped=${statusBody.skipped} failed=${statusBody.failed})`);
      lastProcessed = statusBody.processed;
    }
    if (!statusBody.running) {
      console.log('\n[import] === LOTE CONCLUÍDO ===');
      console.log(JSON.stringify(statusBody, null, 2));
      process.exit(0);
    }
  }
  console.warn('[import] timeout de acompanhamento (30min) — o lote pode continuar rodando em background no servidor.');
  process.exit(1);
}

main().catch((err) => {
  console.error('[import] ERRO fatal:', err);
  process.exit(1);
});
