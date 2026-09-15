import { MongoClient } from 'mongodb';
import { resolveAtlasSrvUri, maskMongoUri } from '../src/config/resolveAtlasUri';

async function main() {
  const raw = process.env.TARGET_MONGODB_URI!;
  const { uri } = await resolveAtlasSrvUri(raw);
  const client = new MongoClient(uri);
  await client.connect();

  const admin = client.db().admin();
  const dbList = await admin.listDatabases({ nameOnly: false });
  console.log('=== Todas as databases no cluster ===');
  for (const d of dbList.databases) {
    console.log(`${d.name}: sizeOnDisk=${(d.sizeOnDisk! / 1024 / 1024).toFixed(2)} MB, empty=${d.empty}`);
  }

  for (const dbName of ['b2c_chamados', 'b2c_cadastros', 'desk_config', 'desk_preferences', 'local', 'admin', 'config']) {
    try {
      const stats = await client.db(dbName).stats();
      console.log(`\n--- ${dbName} ---`);
      console.log('dataSize:', (stats.dataSize / 1024 / 1024).toFixed(2), 'MB');
      console.log('storageSize:', (stats.storageSize / 1024 / 1024).toFixed(2), 'MB');
      console.log('indexSize:', (stats.indexSize / 1024 / 1024).toFixed(2), 'MB');
      console.log('collections:', stats.collections, 'objects:', stats.objects);
    } catch (e) {
      console.log(`${dbName}: erro —`, (e as Error).message);
    }
  }

  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
