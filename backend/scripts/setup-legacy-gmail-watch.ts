/**
 * setup-legacy-gmail-watch.ts v1.0.0 — registra o watch Gmail do mailbox legado
 * (ex.: suporte@velotax.com.br), mantido em modo somente-inbound durante a
 * transição para o e-mail oficial de atendimento (defaultFromEmail no
 * desk_config.email_transport). Não altera outbound.
 *
 * Requer no .env:
 *   GMAIL_LEGACY_INBOUND_ENABLED=true
 *   GMAIL_LEGACY_DELEGATED_USER_EMAIL=suporte@velotax.com.br
 * Usa a mesma service account/domain-wide delegation já configurada em
 * desk_config.email_transport — só precisa que o Workspace Admin tenha
 * delegado o escopo gmail.readonly também para esse mailbox.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase, isDeskConfigConnected } from '../src/config/database';
import { loadEmailTransport, isEmailTransportReady } from '../src/services/emailTransport.service';
import { setupLegacyGmailWatch, getLegacyGmailWatchHealth } from '../src/services/gmail/gmailWatch.service';
import { env } from '../src/config/env';

async function main() {
  if (!env.emailEnabled) {
    console.error('Defina EMAIL_ENABLED=true no .env');
    process.exit(1);
  }

  if (!env.gmailLegacyInboundEnabled || !env.gmailLegacyDelegatedUserEmail.includes('@')) {
    console.error('Defina GMAIL_LEGACY_INBOUND_ENABLED=true e GMAIL_LEGACY_DELEGATED_USER_EMAIL no .env');
    process.exit(1);
  }

  await connectDatabase();

  if (!isDeskConfigConnected()) {
    console.error('desk_config não conectou.');
    process.exit(1);
  }

  await loadEmailTransport();

  if (!isEmailTransportReady()) {
    console.error('email_transport incompleto. Rode: npm run seed:email-transport');
    process.exit(1);
  }

  console.log(`Configurando Gmail watch legado (mailbox=${env.gmailLegacyDelegatedUserEmail})...`);
  const result = await setupLegacyGmailWatch();

  if (!result) {
    console.error('setupLegacyGmailWatch falhou — verifique delegação gmail.readonly para este mailbox no Workspace Admin.');
    process.exit(1);
  }

  const health = await getLegacyGmailWatchHealth();
  console.log('OK — watch legado ativo:', JSON.stringify({ ...health, ...result }, null, 2));

  await disconnectDatabase();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
