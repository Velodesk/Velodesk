/**
 * whatsappCostSync.service v1.0.0 — pagina Twilio Messages API e persiste custo real
 * por mensagem no Mongo (`whatsapp_message_costs`). WFM consome pra agregar por período.
 *
 * Filtra em memória por `whatsapp:*` (a conta Twilio pode ter SMS/voz também).
 * Idempotente via upsert por `sid`. Preenche `ticketId` fazendo lookup em `chamados_n1.registro.metadados.whatsappMensagens[].twilioMessageSid` em batches.
 *
 * Reprocessar mesmo período NÃO duplica; atualiza — útil porque a Twilio precifica
 * algumas mensagens só dias depois (`price=null` inicial vira valor real na próxima).
 */
import { ChamadoN1 } from '../../models/ChamadoN1';
import {
  WhatsappMessageCost,
  type IWhatsappMessageCost,
  type WhatsappMessageDirection,
} from '../../models/WhatsappMessageCost';
import { getTwilioClient, isTwilioConfigured } from './twilioClient.util';

const PAGE_SIZE = 1000;
const TICKET_LOOKUP_BATCH = 200;
/** Overlap de 1h contra fronteira de horário / mensagens em atraso na Twilio. */
const OVERLAP_MS = 60 * 60 * 1000;

export interface WhatsappCostSyncResult {
  startedAt: string;
  finishedAt: string;
  from: string;
  to: string;
  fetched: number;
  matched: number;
  inserted: number;
  modified: number;
  upserted: number;
  comTicket: number;
  semPrice: number;
  pages: number;
}

/** Extrai o telefone do cliente com base na direção da mensagem: inbound → from; outbound → to. */
function extractClientPhone(direction: string, from: string, to: string): string {
  const raw = direction === 'inbound' ? from : to;
  // "whatsapp:+5511999999999" → "+5511999999999"
  return raw.replace(/^whatsapp:/i, '').trim();
}

/** Twilio devolve `price` como string negativa (ex.: "-0.00500"). Normaliza pra número positivo em USD. */
function normalizePrice(rawPrice: string | number | null | undefined): number | null {
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') return null;
  const n = Number(rawPrice);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n);
}

/** Só mensagens WhatsApp — a conta Twilio pode ter SMS/voz. */
function isWhatsappMessage(from: string | null | undefined, to: string | null | undefined): boolean {
  return String(from ?? '').startsWith('whatsapp:') || String(to ?? '').startsWith('whatsapp:');
}

interface TwilioMessageInstance {
  sid: string;
  accountSid: string;
  direction: string;
  from: string;
  to: string;
  status: string;
  price: string | null;
  priceUnit: string | null;
  numSegments: string | number | null;
  errorCode: number | null;
  dateSent: Date | null;
  dateCreated: Date | null;
  dateUpdated: Date | null;
}

/** Lookup batch em `chamados_n1` — pra cada sid, tenta achar o `_id` do ticket que o contém. */
async function resolveTicketIdsBySids(sids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!sids.length) return result;

  for (let i = 0; i < sids.length; i += TICKET_LOOKUP_BATCH) {
    const batch = sids.slice(i, i + TICKET_LOOKUP_BATCH);
    const rows = await ChamadoN1.aggregate<{ _id: unknown; sids: string[] }>([
      {
        $match: {
          'registro.metadados.whatsappMensagens.twilioMessageSid': { $in: batch },
        },
      },
      {
        $project: {
          _id: 1,
          sids: {
            $reduce: {
              input: { $ifNull: ['$registro', []] },
              initialValue: [],
              in: {
                $concatArrays: [
                  '$$value',
                  {
                    $map: {
                      input: { $ifNull: ['$$this.metadados.whatsappMensagens', []] },
                      as: 'm',
                      in: '$$m.twilioMessageSid',
                    },
                  },
                ],
              },
            },
          },
        },
      },
    ]);
    for (const row of rows) {
      const ticketId = String(row._id);
      for (const s of row.sids ?? []) {
        if (s && batch.includes(String(s))) {
          result.set(String(s), ticketId);
        }
      }
    }
  }
  return result;
}

/** Converte um instance da Twilio no payload do doc Mongo. */
function toDocPayload(
  m: TwilioMessageInstance,
  ticketId: string | null,
  now: Date,
): Partial<IWhatsappMessageCost> {
  const direction = m.direction as WhatsappMessageDirection;
  return {
    sid: m.sid,
    accountSid: m.accountSid,
    direction,
    from: m.from ?? '',
    to: m.to ?? '',
    clientPhoneE164: extractClientPhone(direction, m.from ?? '', m.to ?? ''),
    status: m.status ?? '',
    price: normalizePrice(m.price),
    priceUnit: m.priceUnit ?? null,
    numSegments: m.numSegments != null ? Number(m.numSegments) : null,
    errorCode: m.errorCode ?? null,
    dateSent: m.dateSent ?? null,
    dateCreated: m.dateCreated ?? null,
    dateUpdated: m.dateUpdated ?? null,
    ticketId,
    syncedAt: now,
  };
}

/**
 * Sync completo de um range arbitrário. Idempotente: seguros dois runs no mesmo período.
 * Overlap de 1h automático na fronteira anterior — evita perder mensagens perto do limite.
 */
export async function syncWhatsappCostRange(
  fromDate: Date,
  toDate: Date,
): Promise<WhatsappCostSyncResult> {
  if (!isTwilioConfigured()) {
    throw new Error('Twilio não configurado — sync abortado');
  }
  const startedAt = new Date();
  const from = new Date(fromDate.getTime() - OVERLAP_MS);
  const to = toDate;

  const client = getTwilioClient();
  const collected: TwilioMessageInstance[] = [];
  let pages = 0;
  // Twilio SDK devolve `MessagePage | undefined` no nextPage, mas o generic Page do inicial não bate
  // exatamente — usamos `any` pontual pra silenciar o conflito de tipos (o shape é compatível em runtime).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let page: any = await client.messages.page({
    dateSentAfter: from,
    dateSentBefore: to,
    pageSize: PAGE_SIZE,
  });

  while (page) {
    pages += 1;
    for (const m of page.instances) {
      if (!isWhatsappMessage(m.from, m.to)) continue;
      collected.push({
        sid: m.sid,
        accountSid: m.accountSid,
        direction: String(m.direction ?? ''),
        from: String(m.from ?? ''),
        to: String(m.to ?? ''),
        status: String(m.status ?? ''),
        price: m.price as string | null,
        priceUnit: m.priceUnit ?? null,
        numSegments: m.numSegments as string | number | null,
        errorCode: m.errorCode as number | null,
        dateSent: m.dateSent ?? null,
        dateCreated: m.dateCreated ?? null,
        dateUpdated: m.dateUpdated ?? null,
      });
    }
    if (!page.nextPageUrl) break;
    page = await page.nextPage();
  }

  const sids = collected.map((m) => m.sid);
  const ticketMap = await resolveTicketIdsBySids(sids);

  const now = new Date();
  let comTicket = 0;
  let semPrice = 0;
  const bulkOps: Array<{
    updateOne: {
      filter: { sid: string };
      update: { $set: Partial<IWhatsappMessageCost> };
      upsert: true;
    };
  }> = [];
  for (const m of collected) {
    const ticketId = ticketMap.get(m.sid) ?? null;
    if (ticketId) comTicket += 1;
    const payload = toDocPayload(m, ticketId, now);
    if (payload.price === null) semPrice += 1;
    bulkOps.push({
      updateOne: {
        filter: { sid: m.sid },
        update: { $set: payload },
        upsert: true,
      },
    });
  }

  let matched = 0;
  let inserted = 0;
  let modified = 0;
  let upserted = 0;
  if (bulkOps.length) {
    const res = await WhatsappMessageCost.bulkWrite(bulkOps, { ordered: false });
    matched = res.matchedCount ?? 0;
    inserted = res.insertedCount ?? 0;
    modified = res.modifiedCount ?? 0;
    upserted = res.upsertedCount ?? 0;
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    fetched: collected.length,
    matched,
    inserted,
    modified,
    upserted,
    comTicket,
    semPrice,
    pages,
  };
}

/** Envelope pro cron diário: sincroniza últimas ~25h (overlap embutido). */
export async function syncWhatsappCostDaily(): Promise<WhatsappCostSyncResult> {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return syncWhatsappCostRange(from, to);
}

/** Backfill inicial de N dias — rodado só se a coleção estiver vazia no startup. */
export async function syncWhatsappCostBackfill(dias = 30): Promise<WhatsappCostSyncResult> {
  const to = new Date();
  const from = new Date(to.getTime() - dias * 24 * 60 * 60 * 1000);
  return syncWhatsappCostRange(from, to);
}

/** Quick status pro endpoint `GET /whatsapp-cost/status`. */
export async function getWhatsappCostStatus(): Promise<{
  total: number;
  semPrice: number;
  ultimoSyncedAt: string | null;
  ultimoDateSent: string | null;
}> {
  const [total, semPrice, ultimoSync, ultimoSent] = await Promise.all([
    WhatsappMessageCost.countDocuments({}),
    WhatsappMessageCost.countDocuments({ price: null }),
    WhatsappMessageCost.findOne().sort({ syncedAt: -1 }).select('syncedAt').lean(),
    WhatsappMessageCost.findOne().sort({ dateSent: -1 }).select('dateSent').lean(),
  ]);
  return {
    total,
    semPrice,
    ultimoSyncedAt: ultimoSync?.syncedAt ? new Date(ultimoSync.syncedAt).toISOString() : null,
    ultimoDateSent: ultimoSent?.dateSent ? new Date(ultimoSent.dateSent).toISOString() : null,
  };
}
