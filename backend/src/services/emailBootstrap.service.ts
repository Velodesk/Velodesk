/** emailBootstrap.service v1.1.0 — garante índice de idempotência inbound no bootstrap */
import { env } from '../config/env';
import { isAllMongoReady, isDeskConfigConnected } from '../config/database';
import { ensureGmailInboundMessageIndexes } from '../models/GmailInboundMessage';
import { loadEmailTransport, isEmailTransportReady } from './emailTransport.service';
import { loadMailRules } from './mailRules.service';
import { loadMailPrioritySubjectRules } from './mailPrioritySubjectRules.service';
import {
  ensureGmailWatchFresh,
  setupGmailWatch,
  setupLegacyGmailWatch,
  startGmailWatchRenewalLoop,
} from './gmail/gmailWatch.service';
import { ensureInboundAttachmentDir } from './inboundAttachmentStorage.service';

const DESK_CONFIG_POLL_MS = 500;
const DESK_CONFIG_MAX_WAIT_MS = 90_000;
const WATCH_SETUP_RETRY_MS = 15_000;
const WATCH_SETUP_MAX_ATTEMPTS = 6;

let transportBootstrapDone = false;
let watchBootstrapStarted = false;

async function waitForDeskConfig(): Promise<boolean> {
  const deadline = Date.now() + DESK_CONFIG_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    if (isDeskConfigConnected()) return true;
    await new Promise((resolve) => setTimeout(resolve, DESK_CONFIG_POLL_MS));
  }
  return isDeskConfigConnected();
}

async function trySetupGmailWatchWithRetries(): Promise<void> {
  if (!env.gmailInboundEnabled) return;

  startGmailWatchRenewalLoop();

  for (let attempt = 1; attempt <= WATCH_SETUP_MAX_ATTEMPTS; attempt++) {
    if (!isEmailTransportReady()) {
      console.warn(`[emailBootstrap] watch adiado — transport não pronto (tentativa ${attempt}/${WATCH_SETUP_MAX_ATTEMPTS})`);
      await new Promise((resolve) => setTimeout(resolve, WATCH_SETUP_RETRY_MS));
      continue;
    }

    if (!isDeskConfigConnected()) {
      const ready = await waitForDeskConfig();
      if (!ready) {
        console.warn(`[emailBootstrap] watch adiado — desk_config indisponível (tentativa ${attempt}/${WATCH_SETUP_MAX_ATTEMPTS})`);
        await new Promise((resolve) => setTimeout(resolve, WATCH_SETUP_RETRY_MS));
        continue;
      }
    }

    const result = await setupGmailWatch();
    if (result) {
      console.log(`[emailBootstrap] Gmail watch ativo na tentativa ${attempt}/${WATCH_SETUP_MAX_ATTEMPTS}`);
      break;
    }

    if (attempt < WATCH_SETUP_MAX_ATTEMPTS) {
      console.warn(
        `[emailBootstrap] watch falhou — nova tentativa em ${WATCH_SETUP_RETRY_MS / 1000}s (${attempt}/${WATCH_SETUP_MAX_ATTEMPTS})`,
      );
      await new Promise((resolve) => setTimeout(resolve, WATCH_SETUP_RETRY_MS));
    } else {
      console.error('[emailBootstrap] Gmail watch não ativado após todas as tentativas');
    }
  }

  if (env.gmailLegacyInboundEnabled) {
    const legacyResult = await setupLegacyGmailWatch();
    if (legacyResult) {
      console.log('[emailBootstrap] Gmail watch legado ativo (mailbox em transição, somente inbound)');
    } else {
      console.error('[emailBootstrap] Gmail watch legado não ativado — verifique GMAIL_LEGACY_DELEGATED_USER_EMAIL');
    }
  }
}

export async function bootstrapEmailServices(): Promise<void> {
  if (!isAllMongoReady()) {
    console.warn('[emailBootstrap] adiado — MongoDB/desk_config ainda não pronto');
    return;
  }

  if (!await waitForDeskConfig()) {
    console.error('[emailBootstrap] desk_config indisponível após timeout');
    return;
  }

  if (!transportBootstrapDone) {
    await loadEmailTransport();
    try {
      await loadMailRules();
    } catch (err) {
      console.warn('[emailBootstrap] mail rules não carregadas:', (err as Error).message);
    }
    try {
      await loadMailPrioritySubjectRules();
    } catch (err) {
      console.warn('[emailBootstrap] assuntos prioritários não carregados:', (err as Error).message);
    }
    try {
      await ensureGmailInboundMessageIndexes();
    } catch (err) {
      console.warn('[emailBootstrap] índice de idempotência inbound:', (err as Error).message);
    }
    try {
      await ensureInboundAttachmentDir();
    } catch (err) {
      console.warn('[emailBootstrap] diretório de anexos inbound:', (err as Error).message);
    }
    transportBootstrapDone = true;
  }

  if (!env.gmailInboundEnabled) return;

  if (!isEmailTransportReady()) {
    if (env.emailEnabled) {
      console.warn('[emailBootstrap] GMAIL_INBOUND_ENABLED mas desk_config.email_transport incompleto');
    }
    return;
  }

  if (!watchBootstrapStarted) {
    watchBootstrapStarted = true;
    void trySetupGmailWatchWithRetries();
  }

  void ensureGmailWatchFresh().catch((err) => {
    console.error('[emailBootstrap] ensureGmailWatchFresh:', (err as Error).message);
  });
}
