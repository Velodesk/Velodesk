/**
 * loadFonteVelodeskEnv.cjs v2.2.3 — x-api-key (Customer Data API) preservado da fonte da verdade
 *
 * VeloHubCentral (colaboradores): MONGO_ENV da FONTE DA VERDADE/.env — fonte da verdade.
 */
'use strict';

const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  VELODESK: '8000',
  VELODESK_BACKEND: '8001',
};

function cleanMongoUri(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/(@[^/?]+)\/\?/, '$1?');
}

function normalizeMongoEnv() {
  if (!process.env.MONGODB_URI && process.env.MONGO_URI) {
    process.env.MONGODB_URI = process.env.MONGO_URI;
  }
  if (process.env.MONGODB_URI) {
    process.env.MONGODB_URI = cleanMongoUri(process.env.MONGODB_URI);
  }

  // VeloHubCentral — somente MONGO_ENV (nunca reutilizar MONGO_URI / MONGODB_URI do Desk)
  const mongoEnv = cleanMongoUri(process.env.MONGO_ENV);
  if (mongoEnv) {
    process.env.MONGO_ENV = mongoEnv;
  }
}

function normalizeQuotedEnv(key) {
  const raw = process.env[key];
  if (!raw) return;
  process.env[key] = String(raw).trim().replace(/^["']|["']$/g, '').trim();
}

function normalizeGoogleEnv() {
  normalizeQuotedEnv('GOOGLE_CLIENT_ID');
  normalizeQuotedEnv('VITE_GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_ID && process.env.VITE_GOOGLE_CLIENT_ID) {
    process.env.GOOGLE_CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID;
  }
}

function applyDefaults() {
  if (!process.env.VELODESK) process.env.VELODESK = DEFAULTS.VELODESK;
  if (!process.env.VELODESK_BACKEND) process.env.VELODESK_BACKEND = DEFAULTS.VELODESK_BACKEND;
  normalizeMongoEnv();
  normalizeGoogleEnv();
}

function loadDotenvFile(envPath, override = false) {
  if (!envPath || !fs.existsSync(envPath)) return false;
  try {
    require('dotenv').config({ path: envPath, override });
    return true;
  } catch (err) {
    console.warn(`loadFonteVelodeskEnv v2.2.0: falha ao carregar ${envPath}:`, err.message);
    return false;
  }
}

function findFonteDir(startDir) {
  let d = path.resolve(startDir);
  for (let i = 0; i < 16; i++) {
    const fonteDir = path.join(d, 'FONTE DA VERDADE');
    if (fs.existsSync(fonteDir)) return fonteDir;
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return null;
}

function hydrateCustomerDataApiKey(envPaths) {
  const keyPattern = /^x-api-key\s*=\s*(.+)\s*$/i;
  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    let content = '';
    try {
      content = fs.readFileSync(envPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(keyPattern);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, '').trim();
      if (value) process.env['x-api-key'] = value;
    }
  }
}

/**
 * MONGODB_LEGACY (cluster dedicado do módulo Legado Octa) vem anotado na fonte da verdade
 * com um prefixo tipo "(legado-octa) MONGODB_LEGACY=..." — dotenv não reconhece isso como
 * KEY=VALUE (a chave inteira, com parênteses e espaço, não bate no formato) e a linha é
 * silenciosamente ignorada. Leitura explícita, mesmo padrão do x-api-key acima.
 */
function hydrateLegacyOctaUri(envPaths) {
  if (process.env.MONGODB_LEGACY) return;
  const keyPattern = /MONGODB_LEGACY\s*=\s*(.+)\s*$/i;
  for (const envPath of envPaths) {
    if (!envPath || !fs.existsSync(envPath)) continue;
    let content = '';
    try {
      content = fs.readFileSync(envPath, 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(keyPattern);
      if (!match) continue;
      const value = match[1].trim().replace(/^["']|["']$/g, '').trim();
      if (value) {
        process.env.MONGODB_LEGACY = value;
        return;
      }
    }
  }
}

function loadFrom(startDir) {
  const backendDir = path.resolve(startDir);
  const backendEnvPath = path.join(backendDir, '.env');
  const fonteDir = findFonteDir(backendDir);
  const fonteEnvPath = fonteDir ? path.join(fonteDir, '.env-velodesk') : null;
  const fonteHubEnvPath = fonteDir ? path.join(fonteDir, '.env') : null;

  let source = 'defaults';
  let envPath = null;
  let loaded = false;

  // VeloHubCentral (MONGO_ENV) primeiro, sem override
  if (fonteHubEnvPath && loadDotenvFile(fonteHubEnvPath, false)) {
    envPath = fonteHubEnvPath;
    source = 'fonte-da-verdade-env';
    loaded = true;
  }

  if (fonteEnvPath && loadDotenvFile(fonteEnvPath, true)) {
    envPath = fonteEnvPath;
    source = loaded ? 'fonte-da-verdade+velodesk' : 'fonte-da-verdade';
    loaded = true;
  }

  if (loadDotenvFile(backendEnvPath, true)) {
    envPath = backendEnvPath;
    source = loaded ? `${source}+backend-dotenv` : 'backend-dotenv';
    loaded = true;
  }

  const custom = process.env.VELODESK_DOTENV_PATH;
  if (custom && fs.existsSync(custom)) {
    loadDotenvFile(custom, true);
    envPath = custom;
    source = 'VELODESK_DOTENV_PATH';
    loaded = true;
  }

  // dotenv não suporta chaves com hífen (x-api-key) — leitura explícita dos arquivos
  hydrateCustomerDataApiKey([
    fonteHubEnvPath,
    fonteEnvPath,
    backendEnvPath,
    custom,
  ].filter(Boolean));

  // MONGODB_LEGACY vem anotado com prefixo "(legado-octa) " — mesma limitação do dotenv
  hydrateLegacyOctaUri([
    fonteHubEnvPath,
    fonteEnvPath,
    backendEnvPath,
    custom,
  ].filter(Boolean));

  applyDefaults();
  return { envPath, loaded, source, fonteEnvPath, fonteHubEnvPath, backendEnvPath };
}

module.exports = { loadFrom };
