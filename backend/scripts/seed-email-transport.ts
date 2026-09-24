/** seed-email-transport.ts v1.0.0 — insere desk_config.email_transport a partir de JSON local */
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { getEmailTransportModel } from '../src/models/EmailTransportConfig';

function loadServiceAccountJson(): Record<string, unknown> | null {
  const inline = process.env.DESK_SERVICE_ACCOUNT_JSON?.trim();
  if (inline) {
    return JSON.parse(inline) as Record<string, unknown>;
  }

  const filePath = process.env.DESK_SERVICE_ACCOUNT_FILE?.trim()
    || path.join(process.cwd(), 'secrets', 'desk-gmail-sa.json');

  if (!fs.existsSync(filePath)) {
    console.error(`Arquivo SA não encontrado: ${filePath}`);
    console.error('Use DESK_SERVICE_ACCOUNT_FILE ou DESK_SERVICE_ACCOUNT_JSON');
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function loadTransportMode(): 'gmail_api' | 'smtp' {
  const raw = String(process.env.DESK_EMAIL_TRANSPORT_MODE ?? 'gmail_api').trim().toLowerCase();
  if (raw !== 'gmail_api' && raw !== 'smtp') {
    console.error(`DESK_EMAIL_TRANSPORT_MODE inválido: "${raw}" (use "gmail_api" ou "smtp")`);
    process.exit(1);
  }
  return raw;
}

async function main() {
  const fromEmail = String(process.env.DESK_EMAIL_FROM ?? '').trim().toLowerCase();
  const delegated = String(process.env.DESK_EMAIL_DELEGATED ?? fromEmail).trim().toLowerCase();
  const transportMode = loadTransportMode();
  const sa = loadServiceAccountJson();

  if (!fromEmail.includes('@') || !delegated.includes('@') || !sa) {
    process.exit(1);
  }

  await connectDatabase();
  const Model = getEmailTransportModel();

  await Model.findOneAndUpdate(
    { configKey: env.deskEmailTransportDocumentId },
    {
      $set: {
        configKey: env.deskEmailTransportDocumentId,
        transportMode,
        defaultFromEmail: fromEmail,
        delegatedUserEmail: delegated,
        serviceAccountJson: sa,
      },
    },
    { upsert: true, new: true }
  );

  console.log(`OK — desk_config.${env.deskEmailTransportCollection} / ${env.deskEmailTransportDocumentId}`);
  console.log(`  transportMode=${transportMode} from=${fromEmail} delegated=${delegated}`);

  await disconnectDatabase();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
