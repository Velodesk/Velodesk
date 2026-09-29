/** legacyOctaConnection v1.0.0 — conexão dedicada ao cluster do módulo "Legado Octa" */
import mongoose, { Connection } from 'mongoose';
import { env } from './env';
import { MONGO_DRIVER_OPTIONS } from './mongoUri';
import { resolveAtlasSrvUri } from './resolveAtlasUri';

let legacyOctaConnection: Connection | null = null;
let connectInFlight: Promise<Connection> | null = null;

export function requireLegacyOctaUri(): string {
  const uri = String(env.mongoLegacyOctaUri || '').trim();
  if (!uri) {
    throw new Error('MONGODB_LEGADO_OCTA_URI ausente — defina no backend/.env (não commitar).');
  }
  return uri;
}

/**
 * Cada rota de legado-octa chama connectLegacyOcta() no início do handler — sob tráfego
 * concorrente, múltiplas requisições podem cair aqui antes da primeira conexão ficar pronta
 * (readyState ainda não é 1). Sem o guard de promise em andamento, cada uma criava sua própria
 * mongoose.createConnection() e todas escreviam na mesma variável module-level, deixando
 * chamadas mais lentas "roubarem" a conexão de outras (uma await numa Connection que outra
 * requisição já substituiu) — causa raiz de 500s intermitentes em /legado-octa/search.
 */
export async function connectLegacyOcta(): Promise<Connection> {
  if (legacyOctaConnection?.readyState === 1) {
    return legacyOctaConnection;
  }
  if (connectInFlight) {
    return connectInFlight;
  }

  connectInFlight = (async () => {
    const uri = requireLegacyOctaUri();
    const { uri: resolvedUri } = await resolveAtlasSrvUri(uri);
    const conn = mongoose.createConnection(resolvedUri, {
      dbName: env.mongoLegacyOctaDbName,
      ...MONGO_DRIVER_OPTIONS,
    });

    await conn.asPromise();
    legacyOctaConnection = conn;
    console.log(`[legacy-octa] conectado: ${env.mongoLegacyOctaDbName}`);
    return conn;
  })();

  try {
    return await connectInFlight;
  } finally {
    connectInFlight = null;
  }
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
