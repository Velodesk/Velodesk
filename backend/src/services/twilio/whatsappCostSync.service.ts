/**
 * whatsappCostSync.service v1.2.0 — pagina Twilio Messages API e persiste custo real
 * por mensagem no Mongo (`whatsapp_message_costs`). WFM consome pra agregar por período.
 *
 * v1.2.0 — FLUSH POR PÁGINA. Antes acumulava tudo em memória e fazia um único
 * `bulkWrite` no fim: se o processo caísse no meio (504 do proxy, deploy, OOM) o run
 * inteiro era perdido. Agora cada página é gravada assim que chega — se cortar no
 * meio, o que já veio fica salvo e o próximo run é idempotente (upsert por `sid`
 * reconhece os docs existentes).
 *
 * v1.1.0 — FILTRA PELO SENDER DO DESK. A conta Twilio é compartilhada com a empresa
 * inteira; sem filtro, o sync trazia todas as mensagens WhatsApp de todos os produtos
 * (milhares de registros irrelevantes). A Messages API aceita `From` OU `To`, mas não
 * um OR entre os dois — então rodamos duas paginações por número (outbound via `From`,
 * inbound via `To`) e deduplicamos por `sid`. Isso também reduz muito o volume
 * trafegado, porque o filtro passa a ser server-side na Twilio.
 *
 * Idempotente via upsert por `sid`. Preenche `ticketId` fazendo lookup em
 * `chamados_n1.registro.metadados.whatsappMensagens[].twilioMessageSid` em batches.
 *
 * Reprocessar mesmo período NÃO duplica; atualiza — útil porque a Twilio precifica
 * algumas mensagens só dias depois (`price=null` inicial vira valor real na próxima).
 */
import { env } from '../../config/env';
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

/** Normaliza pra "whatsapp:+E164" — aceita entrada com ou sem prefixo/espaços. */
function toWhatsappAddress(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const bare = trimmed.replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
  if (!bare) return '';
  return `whatsapp:${bare.startsWith('+') ? bare : `+${bare}`}`;
}

/**
 * Números do Desk cujas mensagens entram no custo. Configurável por
 * `WHATSAPP_COST_SYNC_NUMBERS` (lista separada por vírgula) — a conta Twilio é
 * compartilhada com a empresa, então esse filtro é o que separa "custo do Desk" de
 * "custo de outro produto".
 */
export function getWhatsappCostSyncNumbers(): string[] {
  return [...new Set(
    env.whatsappCostSyncNumbers
      .map(toWhatsappAddress)
      .filter(Boolean),
  )];
}

export interface WhatsappCostSyncResult {
  startedAt: string;
  finishedAt: string;
  from: string;
  to: string;
  /** Números do Desk usados como filtro — se vier vazio, o sync aborta em vez de varrer a conta toda. */
  numeros: string[];
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

/** Totais acumulados ao longo do run — mutados pela função de flush. */
interface RunTotals {
  fetched: number;
  matched: number;
  inserted: number;
  modified: number;
  upserted: number;
  comTicket: number;
  semPrice: number;
  pages: number;
}

/**
 * Grava uma página de resultados: resolve ticketIds em batch, monta upserts, dispara
 * bulkWrite e atualiza os contadores do run. Chamado ao fim de cada página da Twilio —
 * se o processo cair no meio, o que já veio fica salvo e o próximo run reaproveita
 * (upsert por `sid` é idempotente).
 */
async function flushPage(
  pageItems: TwilioMessageInstance[],
  totals: RunTotals,
  now: Date,
): Promise<void> {
  if (!pageItems.length) return;

  const sids = pageItems.map((m) => m.sid);
  const ticketMap = await resolveTicketIdsBySids(sids);

  const bulkOps: Array<{
    updateOne: {
      filter: { sid: string };
      update: { $set: Partial<IWhatsappMessageCost> };
      upsert: true;
    };
  }> = [];
  for (const m of pageItems) {
    const ticketId = ticketMap.get(m.sid) ?? null;
    if (ticketId) totals.comTicket += 1;
    const payload = toDocPayload(m, ticketId, now);
    if (payload.price === null) totals.semPrice += 1;
    bulkOps.push({
      updateOne: { filter: { sid: m.sid }, update: { $set: payload }, upsert: true },
    });
  }

  totals.fetched += pageItems.length;
  const res = await WhatsappMessageCost.bulkWrite(bulkOps, { ordered: false });
  totals.matched += res.matchedCount ?? 0;
  totals.inserted += res.insertedCount ?? 0;
  totals.modified += res.modifiedCount ?? 0;
  totals.upserted += res.upsertedCount ?? 0;
}

/**
 * Sync completo de um range arbitrário. Idempotente: seguros dois runs no mesmo período.
 * Overlap de 1h automático na fronteira anterior — evita perder mensagens perto do limite.
 *
 * v1.2.0: grava a cada página. Em caso de corte no meio (504 do proxy, deploy), o que já
 * veio fica salvo — o próximo run reaproveita via upsert e termina o que faltou.
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

  const numeros = getWhatsappCostSyncNumbers();
  if (!numeros.length) {
    // Fail-closed de propósito: sem filtro, a paginação varreria a conta Twilio inteira
    // (compartilhada com a empresa) e encheria a coleção de mensagens de outros produtos.
    throw new Error(
      'WHATSAPP_COST_SYNC_NUMBERS vazio — defina o(s) número(s) do Desk antes de sincronizar custo',
    );
  }

  const client = getTwilioClient();
  const totals: RunTotals = {
    fetched: 0,
    matched: 0,
    inserted: 0,
    modified: 0,
    upserted: 0,
    comTicket: 0,
    semPrice: 0,
    pages: 0,
  };
  const now = new Date();
  // Dedup entre páginas e entre as duas varreduras (From + To) do mesmo número — um sid
  // nunca é gravado duas vezes no mesmo run, poupa idas ao Mongo.
  const seenSids = new Set<string>();

  /** Pagina a Messages API com um filtro fixo (From ou To) e faz flush a cada página. */
  async function collectWithFilter(filter: { from: string } | { to: string }): Promise<void> {
    // Twilio SDK devolve `MessagePage | undefined` no nextPage, mas o generic Page do inicial não bate
    // exatamente — usamos `any` pontual pra silenciar o conflito de tipos (o shape é compatível em runtime).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let page: any = await client.messages.page({
      ...filter,
      dateSentAfter: from,
      dateSentBefore: to,
      pageSize: PAGE_SIZE,
    });

    while (page) {
      totals.pages += 1;
      const pageItems: TwilioMessageInstance[] = [];
      for (const m of page.instances) {
        if (!isWhatsappMessage(m.from, m.to)) continue;
        if (seenSids.has(m.sid)) continue;
        seenSids.add(m.sid);
        pageItems.push({
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
      await flushPage(pageItems, totals, now);
      if (!page.nextPageUrl) break;
      page = await page.nextPage();
    }
  }

  for (const numero of numeros) {
    await collectWithFilter({ from: numero }); // outbound: Desk → cliente
    await collectWithFilter({ to: numero }); // inbound: cliente → Desk
  }

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    numeros,
    fetched: totals.fetched,
    matched: totals.matched,
    inserted: totals.inserted,
    modified: totals.modified,
    upserted: totals.upserted,
    comTicket: totals.comTicket,
    semPrice: totals.semPrice,
    pages: totals.pages,
  };
}

/** Envelope pro cron diário: sincroniza últimas ~25h (overlap embutido). */
export async function syncWhatsappCostDaily(): Promise<WhatsappCostSyncResult> {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return syncWhatsappCostRange(from, to);
}

/** Backfill de N dias — chamado sob demanda via endpoint. */
export async function syncWhatsappCostBackfill(dias = 30): Promise<WhatsappCostSyncResult> {
  const to = new Date();
  const from = new Date(to.getTime() - dias * 24 * 60 * 60 * 1000);
  return syncWhatsappCostRange(from, to);
}

/** Filtro Mongo dos docs que NÃO pertencem a nenhum número do Desk — lixo herdado da
 *  versão sem filtro (v1.0.0), que varria a conta Twilio inteira. */
function foreignDocsFilter(numeros: string[]): Record<string, unknown> {
  return {
    $nor: [
      { from: { $in: numeros } },
      { to: { $in: numeros } },
    ],
  };
}

/** Quick status pro endpoint `GET /whatsapp-cost/status`. */
export async function getWhatsappCostStatus(): Promise<{
  numeros: string[];
  total: number;
  doDesk: number;
  deOutrosProdutos: number;
  semPrice: number;
  ultimoSyncedAt: string | null;
  ultimoDateSent: string | null;
}> {
  const numeros = getWhatsappCostSyncNumbers();
  const [total, deOutrosProdutos, semPrice, ultimoSync, ultimoSent] = await Promise.all([
    WhatsappMessageCost.countDocuments({}),
    numeros.length ? WhatsappMessageCost.countDocuments(foreignDocsFilter(numeros)) : 0,
    WhatsappMessageCost.countDocuments({ price: null }),
    WhatsappMessageCost.findOne().sort({ syncedAt: -1 }).select('syncedAt').lean(),
    WhatsappMessageCost.findOne().sort({ dateSent: -1 }).select('dateSent').lean(),
  ]);
  return {
    numeros,
    total,
    doDesk: total - deOutrosProdutos,
    deOutrosProdutos,
    semPrice,
    ultimoSyncedAt: ultimoSync?.syncedAt ? new Date(ultimoSync.syncedAt).toISOString() : null,
    ultimoDateSent: ultimoSent?.dateSent ? new Date(ultimoSent.dateSent).toISOString() : null,
  };
}

/**
 * Remove os docs que não pertencem a nenhum número do Desk — limpeza do lixo que a v1.0.0
 * ingeriu ao varrer a conta Twilio compartilhada. Escopo cirúrgico: só apaga o que
 * comprovadamente não tem o número do Desk nem em `from` nem em `to`.
 *
 * `dryRun: true` (default) só conta, não apaga — pra conferir o número antes de executar.
 */
export async function purgeForeignWhatsappCostDocs(
  dryRun = true,
): Promise<{ numeros: string[]; candidatos: number; removidos: number; dryRun: boolean }> {
  const numeros = getWhatsappCostSyncNumbers();
  if (!numeros.length) {
    throw new Error('WHATSAPP_COST_SYNC_NUMBERS vazio — sem filtro não há como saber o que é lixo');
  }
  const filter = foreignDocsFilter(numeros);
  const candidatos = await WhatsappMessageCost.countDocuments(filter);
  if (dryRun) {
    return { numeros, candidatos, removidos: 0, dryRun: true };
  }
  const res = await WhatsappMessageCost.deleteMany(filter);
  return { numeros, candidatos, removidos: res.deletedCount ?? 0, dryRun: false };
}
