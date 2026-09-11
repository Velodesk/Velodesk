/**
 * whatsappCostSync.job v1.0.0 — cron diário 03:00 BRT + backfill inicial 30d se coleção vazia.
 *
 * Padrão setInterval do repo (running flag, guards, log condicional). Como o cron precisa
 * cair num horário fixo (não em intervalo qualquer), o startup calcula quantos ms faltam
 * pra próxima 03:00 BRT, agenda setTimeout até lá, executa, e então entra num setInterval
 * de 24h estáveis. Assim continua acertando 03:00 BRT todos os dias (sem depender de cron
 * externo tipo node-cron).
 */
import { env } from '../config/env';
import { isMongoConnected } from '../config/database';
import { WhatsappMessageCost } from '../models/WhatsappMessageCost';
import {
  syncWhatsappCostBackfill,
  syncWhatsappCostDaily,
  type WhatsappCostSyncResult,
} from '../services/twilio/whatsappCostSync.service';
import { isTwilioConfigured } from '../services/twilio/twilioClient.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_DIAS = 30;
/** 03:00 BRT = 06:00 UTC (BRT é UTC-3, sem horário de verão desde 2019). */
const CRON_HOUR_UTC = 6;

let dailyTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function msUntilNextBrt3AM(): number {
  const now = new Date();
  const target = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    CRON_HOUR_UTC,
    0,
    0,
    0,
  ));
  if (target.getTime() <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function runCycleSafe(): Promise<void> {
  if (running || !env.whatsappCostSyncEnabled || !isMongoConnected() || !isTwilioConfigured()) {
    return;
  }
  running = true;
  try {
    let result: WhatsappCostSyncResult;
    const total = await WhatsappMessageCost.countDocuments({});
    if (total === 0) {
      console.info(`[whatsapp-cost-sync-job] coleção vazia — backfill inicial ${BACKFILL_DIAS} dias`);
      result = await syncWhatsappCostBackfill(BACKFILL_DIAS);
    } else {
      result = await syncWhatsappCostDaily();
    }
    console.info('[whatsapp-cost-sync-job]', {
      fetched: result.fetched,
      inserted: result.inserted,
      modified: result.modified,
      upserted: result.upserted,
      comTicket: result.comTicket,
      semPrice: result.semPrice,
      pages: result.pages,
    });
  } catch (err) {
    console.warn('[whatsapp-cost-sync-job]', (err as Error).message);
  } finally {
    running = false;
  }
}

export function startWhatsappCostSyncJob(): void {
  if (!env.whatsappCostSyncEnabled) {
    console.info('[whatsapp-cost-sync-job] WHATSAPP_COST_SYNC_ENABLED=false — job não iniciado.');
    return;
  }
  if (dailyTimer || startupTimer) return;

  const msUntilFirst = msUntilNextBrt3AM();
  const nextRun = new Date(Date.now() + msUntilFirst).toISOString();
  console.info(
    `[whatsapp-cost-sync-job] iniciado — próxima execução ${nextRun} (03:00 BRT), depois a cada 24h`,
  );

  startupTimer = setTimeout(() => {
    startupTimer = null;
    void runCycleSafe();
    dailyTimer = setInterval(() => {
      void runCycleSafe();
    }, DAY_MS);
  }, msUntilFirst);
}

export function stopWhatsappCostSyncJob(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  if (dailyTimer) {
    clearInterval(dailyTimer);
    dailyTimer = null;
  }
}

/** Dispara o ciclo agora — usado por endpoint sob demanda ou testes. Não interfere no timer. */
export async function runWhatsappCostSyncNow(): Promise<WhatsappCostSyncResult | { skipped: string }> {
  if (!env.whatsappCostSyncEnabled) return { skipped: 'WHATSAPP_COST_SYNC_ENABLED=false' };
  if (!isMongoConnected()) return { skipped: 'MongoDB indisponível' };
  if (!isTwilioConfigured()) return { skipped: 'Twilio não configurado' };
  if (running) return { skipped: 'Já em execução' };
  running = true;
  try {
    const total = await WhatsappMessageCost.countDocuments({});
    if (total === 0) return await syncWhatsappCostBackfill(BACKFILL_DIAS);
    return await syncWhatsappCostDaily();
  } finally {
    running = false;
  }
}
