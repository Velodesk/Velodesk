/**
 * migrate-ra-status-from-hugme — alinha o status do CHAMADO (chamados_n1) ao status Hugme da
 * reclamação do Reclame Aqui (reclamacoes_reclameAqui.statusHugme).
 *
 * Regra: Hugme "Novo" fica `novo`; qualquer outro (Respondido, Pendente, Fechado) = `resolvido`.
 * Só migra chamados cujo ÚLTIMO status ainda é `novo` — nunca sobrescreve atendimento em curso nem
 * chamado já resolvido/fechado. Hugme vazio e reclamação sem chamado são ignorados.
 *
 * Driver nativo, sem Mongoose: não dispara hooks (sem webhook de saída, sem CSAT/e-mail), não cria
 * índices, não altera `updatedAt` e grava `statusAtual` junto. A guarda `$expr` por documento evita
 * corrida com um atendente que mude o status durante a execução. Idempotente.
 *
 * Uso (o alvo é MIGRATION_MONGODB_URI, ou MONGODB_URI se ausente):
 *   npx tsx scripts/migrate-ra-status-from-hugme.ts            # dry-run (padrão, só lê)
 *   npx tsx scripts/migrate-ra-status-from-hugme.ts --apply    # grava
 *   opções: --limit=N (processa só N reclamações, para teste)
 *   env opcionais: MONGODB_DB_NAME (b2c_chamados), MONGODB_RECLAMACOES_DB_NAME (chamados_reclamacoes),
 *                  DNS_SERVERS=8.8.8.8,1.1.1.1 (quando o DNS local não resolve SRV do Atlas)
 */
import dns from 'dns';
import { MongoClient, ObjectId } from 'mongodb';
import { mapTicketStatusFromHugme } from '../src/services/reclame-aqui/hugmeSpreadsheet.service';

const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const BATCH = 200;
const PAUSE_MS = 100;

type ReclamacaoRow = { _id: ObjectId; chamadoId?: unknown; statusHugme?: string };
type LastRegistro = { registro?: Array<{ status?: string }>; chamadoProtocolo?: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toObjectId(value: unknown): ObjectId | null {
  const raw = String(value ?? '').trim();
  return ObjectId.isValid(raw) && raw.length === 24 ? new ObjectId(raw) : null;
}

function bump(map: Record<string, number>, key: string, n = 1) {
  map[key] = (map[key] || 0) + n;
}

async function main() {
  const uri = (process.env.MIGRATION_MONGODB_URI || process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');
  if (!uri) throw new Error('Defina MIGRATION_MONGODB_URI (ou MONGODB_URI).');
  if (process.env.DNS_SERVERS) dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()));

  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 15000 }).connect();
  const chamadosDbName = process.env.MONGODB_DB_NAME || 'b2c_chamados';
  const reclamacoesDbName = process.env.MONGODB_RECLAMACOES_DB_NAME || 'chamados_reclamacoes';
  const chamados = client.db(chamadosDbName).collection('chamados_n1');
  const reclamacoes = client.db(reclamacoesDbName).collection('reclamacoes_reclameAqui');

  const host = (uri.match(/@([^/?]+)/) || [])[1] || '(host?)';
  console.log(`Alvo: ${host} | ${chamadosDbName}.chamados_n1 + ${reclamacoesDbName}.reclamacoes_reclameAqui`);
  console.log(APPLY ? '>>> MODO APPLY (grava)' : '>>> DRY-RUN (só lê; use --apply para gravar)');

  const stats = {
    reclamacoesLidas: 0,
    semChamado: 0,
    hugmeVazio: 0,
    hugmeNovo: 0,
    candidatas: 0,
    chamadoNaoEncontrado: 0,
    migrados: 0,
    perdeuCorrida: 0,
  };
  const porHugme: Record<string, number> = {};
  const puladosPorStatusAtual: Record<string, number> = {};
  const amostra: string[] = [];

  const cursor = reclamacoes
    .find({ chamadoId: { $exists: true, $nin: [null, ''] } }, { projection: { chamadoId: 1, statusHugme: 1 } })
    .sort({ _id: 1 });

  let batch: Array<{ rec: ReclamacaoRow; chamadoOid: ObjectId; hugme: string }> = [];

  const flush = async () => {
    if (!batch.length) return;
    const ids = batch.map((b) => b.chamadoOid);
    const docs = (await chamados
      .find({ _id: { $in: ids } }, { projection: { chamadoProtocolo: 1, registro: { $slice: -1 } } })
      .toArray()) as unknown as Array<LastRegistro & { _id: ObjectId }>;
    const byId = new Map(docs.map((d) => [String(d._id), d]));

    const chamadoOps: Array<Record<string, unknown>> = [];
    const reclamacaoOps: Array<Record<string, unknown>> = [];
    const candidatos: ObjectId[] = []; // alinhado índice a índice com chamadoOps/reclamacaoOps
    const now = new Date();

    for (const item of batch) {
      const doc = byId.get(String(item.chamadoOid));
      if (!doc) {
        stats.chamadoNaoEncontrado += 1;
        continue;
      }
      const lastStatus = String(doc.registro?.[0]?.status || 'novo').toLowerCase();
      if (lastStatus !== 'novo') {
        bump(puladosPorStatusAtual, lastStatus);
        continue;
      }

      stats.candidatas += 1;
      if (amostra.length < 8) amostra.push(String(doc.chamadoProtocolo || doc._id));

      candidatos.push(item.chamadoOid);
      chamadoOps.push({
        updateOne: {
          filter: {
            _id: item.chamadoOid,
            // guarda contra corrida: o último status ainda tem de ser `novo` no momento da escrita
            $expr: { $eq: [{ $toLower: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] } }, 'novo'] },
          },
          update: {
            $push: {
              registro: {
                data: now,
                origin: 'sistema',
                autor: 'Importação RA',
                mensagemPublica: '',
                anexosMensagemPublica: [],
                anotacaoInterna: `Status alinhado ao Hugme ("${item.hugme}") — migração única.`,
                anexosAnotacaoInterna: [],
                alteracoes: [{ status: 'resolvido' }],
                metadados: { source: 'reclame-aqui-status-sync', statusHugme: item.hugme, migracao: 'ra-status-hugme' },
                status: 'resolvido',
              },
            },
            $set: { statusAtual: 'resolvido' },
          },
        },
      });
      reclamacaoOps.push({
        updateOne: { filter: { _id: item.rec._id }, update: { $set: { ticketStatus: 'resolvido' } } },
      });
    }

    if (APPLY && chamadoOps.length) {
      const res = await chamados.bulkWrite(chamadoOps as never, { ordered: false });
      stats.migrados += res.modifiedCount;
      stats.perdeuCorrida += chamadoOps.length - res.modifiedCount;

      // ticketStatus denormalizado: só nas reclamações cujo chamado de fato ficou `resolvido`.
      // Se alguma escrita perdeu a corrida (atendente mexeu no chamado no meio), confere por leitura.
      let opsReclamacao = reclamacaoOps;
      if (res.modifiedCount !== chamadoOps.length) {
        const after = (await chamados
          .find({ _id: { $in: candidatos } }, { projection: { registro: { $slice: -1 } } })
          .toArray()) as unknown as Array<LastRegistro & { _id: ObjectId }>;
        const resolvidos = new Set(
          after.filter((d) => String(d.registro?.[0]?.status) === 'resolvido').map((d) => String(d._id)),
        );
        opsReclamacao = reclamacaoOps.filter((_, i) => resolvidos.has(String(candidatos[i])));
      }
      if (opsReclamacao.length) await reclamacoes.bulkWrite(opsReclamacao as never, { ordered: false });
    }
    batch = [];
    if (APPLY) await sleep(PAUSE_MS);
  };

  for await (const rec of cursor as unknown as AsyncIterable<ReclamacaoRow>) {
    if (LIMIT && stats.reclamacoesLidas >= LIMIT) break;
    stats.reclamacoesLidas += 1;

    const chamadoOid = toObjectId(rec.chamadoId);
    if (!chamadoOid) {
      stats.semChamado += 1;
      continue;
    }
    const hugme = String(rec.statusHugme ?? '').trim();
    bump(porHugme, hugme || '(vazio)');
    if (!hugme) {
      stats.hugmeVazio += 1;
      continue;
    }
    if (mapTicketStatusFromHugme(hugme) === 'novo') {
      stats.hugmeNovo += 1;
      continue;
    }
    batch.push({ rec, chamadoOid, hugme });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  console.log('\n== Resumo ==');
  console.table(stats);
  console.log('statusHugme das reclamações lidas:', porHugme);
  console.log('Chamados PULADOS (último status não era "novo"):', puladosPorStatusAtual);
  console.log('Amostra de protocolos', APPLY ? 'migrados:' : 'que seriam migrados:', amostra.join(', '));
  if (!APPLY) console.log('\nNada foi gravado. Rode com --apply para aplicar.');
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
