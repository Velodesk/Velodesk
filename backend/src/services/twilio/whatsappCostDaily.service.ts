/**
 * whatsappCostDaily.service v1.0.0 — rollup diário de custo WhatsApp.
 *
 * Agrega `whatsapp_message_costs` por dia civil BRT (America/Sao_Paulo) e grava em
 * `whatsapp_cost_daily`. Janela padrão de 15 dias no run diário — cobre dois casos:
 *
 *  1) A Twilio precifica algumas mensagens só dias depois (`price=null` → valor).
 *     Reagregar os últimos 15 dias garante que o número do dia 10 reflita o preço
 *     final mesmo quando chega em D+2/D+3.
 *  2) Cron que falhou em dias anteriores (deploy, 504, OOM). Como a janela é fixa,
 *     o próximo run bem-sucedido reagrega todo mundo da janela.
 *
 * Dias com mais de ~15 dias NÃO são tocados: a Twilio já estabilizou o preço,
 * o número congela. Pra reagregação forçada de período histórico, há
 * `rollupWhatsappCostRange` (chamado pelo endpoint manual).
 *
 * Upsert por `date` (YYYY-MM-DD BRT) — idempotente.
 */
import { WhatsappCostDaily } from '../../models/WhatsappCostDaily';
import { WhatsappMessageCost } from '../../models/WhatsappMessageCost';
import { getBrasiliaDateString } from '../dates/brasilDay';

/** Janela padrão do run diário — cobre repricing tardio da Twilio + crons perdidos. */
const DEFAULT_WINDOW_DAYS = 15;

/** BRT = UTC−3, sem horário de verão. Converte "YYYY-MM-DD" BRT em instante UTC. */
function brasiliaDayStartUtc(dateStr: string): Date {
  return new Date(`${dateStr}T03:00:00.000Z`);
}

/** Lista dias BRT entre `fromStr` e `toStr` (inclusive), ordem crescente. */
function enumerateDays(fromStr: string, toStr: string): string[] {
  const out: string[] = [];
  let cursor = brasiliaDayStartUtc(fromStr);
  const limit = brasiliaDayStartUtc(toStr);
  while (cursor.getTime() <= limit.getTime()) {
    out.push(getBrasiliaDateString(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

export interface WhatsappCostDailyRollupResult {
  startedAt: string;
  finishedAt: string;
  fromDate: string;
  toDate: string;
  diasProcessados: number;
  diasComMensagem: number;
  diasZerados: number;
}

/**
 * Reagrega um range de dias BRT. Upsert por `date`. Dias sem mensagem na janela
 * recebem doc zerado — útil pro relatório não ter "furo" visual.
 */
export async function rollupWhatsappCostRange(
  fromDate: string,
  toDate: string,
): Promise<WhatsappCostDailyRollupResult> {
  const startedAt = new Date();
  const days = enumerateDays(fromDate, toDate);
  if (!days.length) {
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      fromDate,
      toDate,
      diasProcessados: 0,
      diasComMensagem: 0,
      diasZerados: 0,
    };
  }

  const windowStart = brasiliaDayStartUtc(days[0]);
  const windowEnd = new Date(brasiliaDayStartUtc(days[days.length - 1]).getTime() + 24 * 60 * 60 * 1000);

  // Agrega direto no Mongo: 1 query cobre o range inteiro. $dateToString com timezone
  // bucketiza por dia civil BRT (não por dia UTC — crucial pra bater com o relatório).
  const rows = await WhatsappMessageCost.aggregate<{
    _id: string;
    totalUsd: number;
    qtdEnviadas: number;
    qtdRecebidas: number;
    qtdSemPrice: number;
  }>([
    {
      $match: {
        dateSent: { $gte: windowStart, $lt: windowEnd },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$dateSent',
            timezone: 'America/Sao_Paulo',
          },
        },
        totalUsd: { $sum: { $ifNull: ['$price', 0] } },
        qtdEnviadas: {
          $sum: {
            $cond: [{ $regexMatch: { input: '$direction', regex: /^outbound/ } }, 1, 0],
          },
        },
        qtdRecebidas: {
          $sum: { $cond: [{ $eq: ['$direction', 'inbound'] }, 1, 0] },
        },
        qtdSemPrice: {
          $sum: { $cond: [{ $eq: ['$price', null] }, 1, 0] },
        },
      },
    },
  ]);

  const byDate = new Map(rows.map((r) => [r._id, r]));
  const now = new Date();
  let diasComMensagem = 0;
  let diasZerados = 0;

  const bulkOps = days.map((date) => {
    const r = byDate.get(date);
    if (r) diasComMensagem += 1;
    else diasZerados += 1;
    return {
      updateOne: {
        filter: { date },
        update: {
          $set: {
            date,
            totalUsd: r?.totalUsd ?? 0,
            qtdEnviadas: r?.qtdEnviadas ?? 0,
            qtdRecebidas: r?.qtdRecebidas ?? 0,
            qtdSemPrice: r?.qtdSemPrice ?? 0,
            calculatedAt: now,
          },
        },
        upsert: true as const,
      },
    };
  });

  if (bulkOps.length) {
    await WhatsappCostDaily.bulkWrite(bulkOps, { ordered: false });
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    fromDate: days[0],
    toDate: days[days.length - 1],
    diasProcessados: days.length,
    diasComMensagem,
    diasZerados,
  };
}

/**
 * Envelope pro cron diário: reagrega últimos 15 dias BRT. Chamado após o
 * `syncWhatsappCostDaily` no endpoint `/sync/scheduled`.
 */
export async function rollupWhatsappCostDaily(
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<WhatsappCostDailyRollupResult> {
  const dias = Math.max(1, Math.min(90, Math.trunc(windowDays)));
  const hoje = getBrasiliaDateString(new Date());
  const inicio = getBrasiliaDateString(
    new Date(brasiliaDayStartUtc(hoje).getTime() - (dias - 1) * 24 * 60 * 60 * 1000),
  );
  return rollupWhatsappCostRange(inicio, hoje);
}

/** Status pro endpoint `GET /whatsapp-cost/daily`. */
export async function getWhatsappCostDailyStatus(limit = 30): Promise<{
  dias: Array<{
    date: string;
    totalUsd: number;
    qtdEnviadas: number;
    qtdRecebidas: number;
    qtdSemPrice: number;
    calculatedAt: string;
  }>;
}> {
  const docs = await WhatsappCostDaily.find()
    .sort({ date: -1 })
    .limit(Math.max(1, Math.min(365, Math.trunc(limit))))
    .lean();
  return {
    dias: docs.map((d) => ({
      date: d.date,
      totalUsd: d.totalUsd,
      qtdEnviadas: d.qtdEnviadas,
      qtdRecebidas: d.qtdRecebidas,
      qtdSemPrice: d.qtdSemPrice,
      calculatedAt: new Date(d.calculatedAt).toISOString(),
    })),
  };
}
