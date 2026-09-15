/**
 * migrate-to-prod-cluster.ts — copia as collections críticas de operação do cluster
 * velodesk-dev (origem, .env atual) para o novo cluster Velodesk-CRM (destino).
 *
 * Só LEITURA na origem — nunca apaga nem altera nada lá. Escreve por upsert (bulkWrite
 * replaceOne com upsert:true, preservando _id) no destino, então é seguro rodar mais de
 * uma vez (reprocessar um doc já migrado apenas sobrescreve com o estado mais recente).
 * Índices são recriados no destino a partir dos índices existentes na origem (exceto o
 * _id, que o Mongo já cria sozinho).
 *
 * Uso:
 *   TARGET_MONGODB_URI="mongodb+srv://usuario:senha@velodesk-crm.xxxx.mongodb.net" \
 *     npx tsx scripts/migrate-to-prod-cluster.ts
 *
 * A URI de origem vem do .env já carregado pelo backend (mesma fonte que o app usa).
 * A URI de destino NUNCA é lida de arquivo — só da env var TARGET_MONGODB_URI passada
 * na hora de rodar, pra não deixar credencial de produção em disco/histórico de shell
 * além do necessário.
 */
import { MongoClient, Db } from 'mongodb';
import { env } from '../src/config/env';
import { resolveAtlasSrvUri, maskMongoUri } from '../src/config/resolveAtlasUri';

interface MigrationTarget {
  dbName: string;
  collections: string[];
}

// Mesmo dbName da origem em cada banco — só o cluster muda, a organização permanece idêntica.
const MIGRATION_PLAN: MigrationTarget[] = [
  { dbName: env.mongoDbName, collections: ['chamados_n1', 'boxes'] }, // b2c_chamados
  { dbName: env.mongoCadastrosDbName, collections: ['clientes'] }, // b2c_cadastros
  {
    dbName: env.mongoDeskConfigDbName, // desk_config
    collections: [
      'tabulacao_campos',
      'tabulacao_opcoes',
      'desk_funcoes_permissoes',
      'workflow_definicoes',
      'email_conteudos',
      'email_transport',
      'email_assinatura',
      'gmail_watch_state',
      'mail_ignorado',
      'mail_priority',
      'mail_spam',
      'macros',
    ],
  },
  { dbName: env.mongoDeskPreferencesDbName, collections: ['desk_agent_boxes'] }, // desk_preferences
];

interface CollectionResult {
  db: string;
  collection: string;
  sourceCount: number;
  copied: number;
  indexesRecreated: number;
  skipped?: string;
}

async function connectSource(): Promise<MongoClient> {
  const raw = (env.mongoUri || '').trim();
  if (!raw) throw new Error('MONGODB_URI (origem) ausente no .env');
  const { uri, method } = await resolveAtlasSrvUri(raw);
  console.log(`[origem] conectando — ${maskMongoUri(uri)} (${method})`);
  const client = new MongoClient(uri);
  await client.connect();
  return client;
}

async function connectTarget(): Promise<MongoClient> {
  const raw = (process.env.TARGET_MONGODB_URI || '').trim();
  if (!raw) {
    throw new Error(
      'TARGET_MONGODB_URI ausente — passe a connection string do cluster Velodesk-CRM como variável de ambiente na hora de rodar o script.',
    );
  }
  const { uri, method } = await resolveAtlasSrvUri(raw);
  console.log(`[destino] conectando — ${maskMongoUri(uri)} (${method})`);
  const client = new MongoClient(uri);
  await client.connect();
  return client;
}

async function migrateCollection(
  sourceDb: Db,
  targetDb: Db,
  dbName: string,
  collectionName: string,
): Promise<CollectionResult> {
  const sourceCol = sourceDb.collection(collectionName);
  const targetCol = targetDb.collection(collectionName);

  const sourceCount = await sourceCol.countDocuments();
  if (sourceCount === 0) {
    console.log(`  - ${dbName}.${collectionName}: 0 documentos na origem — nada a copiar.`);
    return { db: dbName, collection: collectionName, sourceCount: 0, copied: 0, indexesRecreated: 0 };
  }

  // Índices (exceto o _id_ default, que já existe em qualquer collection nova).
  const sourceIndexes = await sourceCol.indexes();
  const toCreate = sourceIndexes.filter((idx) => idx.name !== '_id_');
  let indexesRecreated = 0;
  for (const idx of toCreate) {
    const { key, name, ...options } = idx;
    try {
      await targetCol.createIndex(key as Record<string, 1 | -1>, { name, ...options });
      indexesRecreated += 1;
    } catch (err) {
      console.warn(`    [aviso] índice ${name} em ${dbName}.${collectionName} falhou (segue sem ele):`, (err as Error).message);
    }
  }

  const BATCH_SIZE = 500;
  let copied = 0;
  const cursor = sourceCol.find({});
  let batch: Record<string, unknown>[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const ops = batch.map((doc) => ({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: doc,
        upsert: true,
      },
    }));
    await targetCol.bulkWrite(ops, { ordered: false });
    copied += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    batch.push(doc as Record<string, unknown>);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(`  - ${dbName}.${collectionName}: ${copied}/${sourceCount} documentos copiados, ${indexesRecreated} índice(s) recriado(s).`);
  return { db: dbName, collection: collectionName, sourceCount, copied, indexesRecreated };
}

async function main() {
  const sourceClient = await connectSource();
  const targetClient = await connectTarget();

  const results: CollectionResult[] = [];

  try {
    for (const target of MIGRATION_PLAN) {
      const sourceDb = sourceClient.db(target.dbName);
      const targetDb = targetClient.db(target.dbName);
      console.log(`\n=== ${target.dbName} ===`);
      for (const collectionName of target.collections) {
        const result = await migrateCollection(sourceDb, targetDb, target.dbName, collectionName);
        results.push(result);
      }
    }
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }

  console.log('\n=== Resumo ===');
  let totalSource = 0;
  let totalCopied = 0;
  for (const r of results) {
    totalSource += r.sourceCount;
    totalCopied += r.copied;
    console.log(`${r.db}.${r.collection}: origem=${r.sourceCount} copiado=${r.copied} índices=${r.indexesRecreated}`);
  }
  console.log(`\nTotal: ${totalCopied}/${totalSource} documentos migrados em ${results.length} collections.`);

  const mismatches = results.filter((r) => r.copied !== r.sourceCount);
  if (mismatches.length) {
    console.warn('\n[ATENÇÃO] Divergência de contagem em:', mismatches.map((m) => `${m.db}.${m.collection}`).join(', '));
    process.exitCode = 1;
  } else {
    console.log('\nTodas as collections bateram 100% entre origem e destino.');
  }
}

main().catch((err) => {
  console.error('\n[ERRO] Migração interrompida:', err);
  process.exit(1);
});
