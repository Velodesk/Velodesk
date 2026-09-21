/** legacyOctaConnection v1.0.0 — conexão dedicada ao cluster do módulo "Legado Octa" */
import mongoose, { Connection } from 'mongoose';
import { env } from './env';
import { MONGO_DRIVER_OPTIONS } from './mongoUri';
import { resolveAtlasSrvUri } from './resolveAtlasUri';

let legacyOctaConnection: Connection | null = null;

export function requireLegacyOctaUri(): string {
  const uri = String(env.mongoLegacyOctaUri || '').trim();
  if (!uri) {
    throw new Error('MONGODB_LEGADO_OCTA_URI ausente — defina no backend/.env (não commitar).');
  }
  return uri;
}

export async function connectLegacyOcta(): Promise<Connection> {
  if (legacyOctaConnection?.readyState === 1) {
    return legacyOctaConnection;
  }

  const uri = requireLegacyOctaUri();
  const { uri: resolvedUri } = await resolveAtlasSrvUri(uri);
  legacyOctaConnection = mongoose.createConnection(resolvedUri, {
    dbName: env.mongoLegacyOctaDbName,
    ...MONGO_DRIVER_OPTIONS,
  });

  await legacyOctaConnection.asPromise();
  console.log(`[legacy-octa] conectado: ${env.mongoLegacyOctaDbName}`);
  return legacyOctaConnection;
}

export async function disconnectLegacyOcta(): Promise<void> {
  if (legacyOctaConnection) {
    await legacyOctaConnection.close();
    legacyOctaConnection = null;
  }
}

export function getLegacyOctaConnection(): Connection {
  if (!legacyOctaConnection) {
    throw new Error('Conexão legacy-octa não inicializada — chame connectLegacyOcta() primeiro.');
  }
  return legacyOctaConnection;
}
