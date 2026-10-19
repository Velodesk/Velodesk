/**
 * Semeia/atualiza o documento do agente autônomo em desk_config.acionamento_servicos.
 * Uso: npm run seed:acionamento-servicos            (liga, fila de aprovação)
 *      npm run seed:acionamento-servicos -- off     (desliga)
 * O liga/desliga normal é feito pela tela Configurações > Agentes de IA.
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { resolveAtlasSrvUri } from '../src/config/resolveAtlasUri';

async function main() {
  const ligar = process.argv[2] !== 'off';
  const { uri, method } = await resolveAtlasSrvUri(String(process.env.MONGODB_URI));
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const dbName = process.env.MONGODB_DESK_CONFIG_DB_NAME || 'desk_config';
    const col = client.db(dbName).collection('acionamento_servicos');
    const now = new Date();
    const r = await col.updateOne(
      { key: 'agente_autonomo' },
      {
        $set: { autonomiaHabilitada: ligar, updatedBy: 'seed-acionamento-servicos', updatedAt: now },
        $setOnInsert: { key: 'agente_autonomo', modoEnvio: 'fila_aprovacao', minAuditScoreEstrito: 85, createdAt: now },
      },
      { upsert: true },
    );
    const doc = await col.findOne({ key: 'agente_autonomo' }, { projection: { _id: 0 } });
    console.log(`[${dbName}.acionamento_servicos] via ${method} — criado=${r.upsertedCount} alterado=${r.modifiedCount}`);
    console.log(JSON.stringify(doc));
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('ERRO:', (err as Error).message);
  process.exit(1);
});
