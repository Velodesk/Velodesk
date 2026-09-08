/**
 * whatsappInbound.service v2.0.0 — WhatsApp nunca abre ticket por iniciativa do cliente:
 * sem chamado reabrível (janela 48h pra resolvido; fechado/cancelado nunca reabrem), a
 * mensagem não cria ticket derivado — cliente recebe orientação padrão (telefone/app).
 */
import twilio from 'twilio';
import { env } from '../../config/env';
import { ChamadoN1 } from '../../models/ChamadoN1';
import { ChamadoIaAnalise } from '../../models/ChamadoIaAnalise';
import { publishTicketEvent } from '../realtime/ticketEventsBroadcast.service';
import {
  appendStatusTransition,
  currentStatus,
  normalizeStatusValue,
  resolveInboundClientReplyStatus,
  shouldSpawnNewTicketOnInbound,
} from '../chamado.mapper';
import {
  getTwilioActiveAccountSid,
  getTwilioCredentialMode,
  isTwilioConfigured,
} from './twilioClient.util';
import { resolveWhatsAppStatusCallbackUrl } from './whatsappCallbackUrl.util';
import type { TwilioWhatsAppWebhookPayload } from './whatsappInbound.types';
import {
  parseTwilioInboundMedia,
  persistTwilioInboundMedia,
  type PersistedTwilioInboundMedia,
} from './twilioMediaInbound.service';
import {
  appendWhatsAppMensagemToChamado,
  normalizeWaChatId,
  readWhatsAppMensagens,
  WHATSAPP_THREAD_SOURCE,
} from './whatsappThread.service';
import {
  deactivateWaActiveConversationsForTicket,
  findActiveWaConversationsByPhone,
  upsertWaActiveConversation,
} from './waActiveConversation.service';

const { MessagingResponse } = twilio.twiml;

function readField(body: Record<string, unknown>, key: string): string {
  return String(body[key] ?? '').trim();
}

export function parseTwilioWhatsAppWebhook(body: Record<string, unknown>): TwilioWhatsAppWebhookPayload {
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (value == null) continue;
    raw[key] = String(value);
  }

  const numMediaRaw = readField(body, 'NumMedia');
  const numMedia = Number.parseInt(numMediaRaw || '0', 10);
  const normalizedNumMedia = Number.isFinite(numMedia) ? Math.max(0, numMedia) : 0;

  return {
    messageSid: readField(body, 'MessageSid') || readField(body, 'SmsMessageSid'),
    from: readField(body, 'From'),
    to: readField(body, 'To'),
    body: readField(body, 'Body'),
    numMedia: normalizedNumMedia,
    media: parseTwilioInboundMedia(raw, normalizedNumMedia),
    profileName: readField(body, 'ProfileName'),
    waId: readField(body, 'WaId'),
    accountSid: readField(body, 'AccountSid'),
    raw,
  };
}

export function buildInboundTwimlReply(message?: string): string {
  const twiml = new MessagingResponse();
  const configured = message !== undefined
    ? String(message).trim()
    : String(env.twilioWhatsappAutoReply ?? '').trim();
  if (!configured) {
    return twiml.toString();
  }
  twiml.message(configured);
  return twiml.toString();
}

function hasWhatsAppMessageSid(chamado: InstanceType<typeof ChamadoN1>, messageSid: string): boolean {
  if (!messageSid) return false;
  for (const reg of chamado.registro ?? []) {
    if (readWhatsAppMensagens(reg).some((item) => item.twilioMessageSid === messageSid)) {
      return true;
    }
  }
  return false;
}

async function listChamadosForWhatsAppInbound(waFrom: string) {
  const digits = normalizeWaChatId(waFrom);
  if (!digits || digits.length < 8) return [];
  const suffix = digits.slice(-8);

  return ChamadoN1.find({
    $or: [
      { 'registro.metadados.source': WHATSAPP_THREAD_SOURCE, 'registro.metadados.waChatId': { $regex: `${suffix}$` } },
      { 'registro.metadados.waChatId': { $regex: `${suffix}$` } },
      { 'registro.metadados.waFrom': { $regex: `${suffix}$` } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(30);
}

export async function findChamadoForWhatsAppInbound(waFrom: string) {
  const viaPointer = await resolveChamadoViaActivePointer(waFrom);
  if (viaPointer) return viaPointer;
  const candidates = await listChamadosForWhatsAppInbound(waFrom);
  return candidates.find((chamado) => !shouldSpawnNewTicketOnInbound(chamado)) || null;
}

/**
 * Caminho rápido e não-ambíguo: resolve direto pelo ponteiro WaActiveConversation em vez do
 * scan por sufixo de telefone (que não distingue canal). Só cobre ticketCollection
 * 'chamados_n1' por enquanto — os módulos de casos especiais ainda não têm WhatsApp real
 * (Fase 4 do plano). Ponteiro apontando pra ticket já terminal é desativado e ignorado aqui —
 * correção "lazy", sem precisar instrumentar todo call site de fechamento de ticket.
 */
async function resolveChamadoViaActivePointer(
  waFrom: string,
): Promise<InstanceType<typeof ChamadoN1> | null> {
  const digits = normalizeWaChatId(waFrom);
  if (!digits) return null;

  const pointers = await findActiveWaConversationsByPhone(digits);
  for (const pointer of pointers) {
    if (pointer.canal !== 'whatsapp' || pointer.ticketCollection !== 'chamados_n1') continue;
    const chamado = await ChamadoN1.findById(pointer.ticketId);
    if (!chamado || shouldSpawnNewTicketOnInbound(chamado)) {
      await deactivateWaActiveConversationsForTicket(pointer.ticketId, pointer.ticketCollection);
      continue;
    }
    return chamado;
  }
  return null;
}

function appendInboundWhatsAppToChamado(
  chamado: InstanceType<typeof ChamadoN1>,
  payload: TwilioWhatsAppWebhookPayload,
  storedMedia: PersistedTwilioInboundMedia[],
): string {
  const texto = String(payload.body ?? '').trim();
  const attachmentUrls = storedMedia.map((item) => item.url);
  const mediaContentTypes = storedMedia.map((item) => item.contentType);
  const anexosScanStatus = storedMedia.map((item) => item.scanStatus);
  const hasAudio = mediaContentTypes.some((value) => value.toLowerCase().startsWith('audio/'));
  const waChatId = normalizeWaChatId(payload.waId || payload.from);
  appendWhatsAppMensagemToChamado(chamado, {
    origin: 'cliente',
    autor: payload.profileName || waChatId,
    texto: texto || (hasAudio ? '[Áudio recebido]' : '[Mídia recebida]'),
    anexos: attachmentUrls,
    waChatId,
    twilioMessageSid: payload.messageSid || undefined,
    mediaContentTypes,
    anexosScanStatus,
    transcriptionStatus: hasAudio ? 'available' : undefined,
  });
  return waChatId;
}

async function saveWhatsAppReplyOnChamado(
  chamado: InstanceType<typeof ChamadoN1>,
  payload: TwilioWhatsAppWebhookPayload,
  storedMedia: PersistedTwilioInboundMedia[],
): Promise<void> {
  const waChatId = appendInboundWhatsAppToChamado(chamado, payload, storedMedia);
  const reopenStatus = resolveInboundClientReplyStatus(chamado);
  if (reopenStatus && reopenStatus !== normalizeStatusValue(currentStatus(chamado))) {
    appendStatusTransition(chamado, reopenStatus, {
      origin: 'cliente',
      autor: payload.profileName || waChatId,
      metadados: { trigger: 'whatsapp-inbound-reply' },
    });
  }
  chamado.markModified('registro');
  await chamado.save();
  void publishTicketEvent(chamado._id.toString(), 'whatsapp-inbound');
  void upsertWaActiveConversation({
    phoneE164: waChatId,
    canal: 'whatsapp',
    ticketId: chamado._id.toString(),
    ticketCollection: 'chamados_n1',
    ticketProtocolo: chamado.chamadoProtocolo,
  });
  await ChamadoIaAnalise.updateOne(
    { chamadoId: chamado._id, origem: { $ne: 'manual' } },
    { $set: { needsReanalysis: true } },
  );
}

/**
 * Política: WhatsApp nunca abre ticket por iniciativa do cliente — a conversa só existe depois
 * que o agente Velotax manda a mensagem inicial (template) a partir de um ticket já aberto.
 * Uma mensagem inbound sem chamado reabrível (nenhum candidato, ou todos fechado/cancelado/
 * resolvido fora da janela de 48h) não cria ticket derivado — o cliente recebe esta resposta
 * padrão orientando a abrir contato pelos canais corretos.
 */
export const WHATSAPP_NO_TICKET_REPLY_TEXT =
  'Não localizamos um atendimento em aberto para esta conversa. Para dar continuidade, '
  + 'entre em contato com a nossa Central de Atendimento por telefone ou abra um novo chamado '
  + 'pelo aplicativo Velotax.';

export type WhatsAppInboundOutcome =
  | 'attached'
  | 'duplicate'
  | 'rejected_no_ticket'
  | 'ignored_empty';

export async function processInboundWhatsAppMessage(
  payload: TwilioWhatsAppWebhookPayload,
): Promise<WhatsAppInboundOutcome> {
  console.info('[whatsapp-inbound] mensagem recebida', {
    messageSid: payload.messageSid,
    from: payload.from,
    to: payload.to,
    profileName: payload.profileName || null,
    bodyPreview: payload.body.slice(0, 120) || '[sem texto]',
    numMedia: payload.numMedia,
  });

  const texto = String(payload.body ?? '').trim();
  if (!texto && payload.numMedia <= 0) return 'ignored_empty';

  // Caminho rápido e não-ambíguo pelo ponteiro; só faz o scan legado por sufixo de telefone
  // (que não distingue canal) se não houver ponteiro ativo pra esse número ainda.
  let reopenable = await resolveChamadoViaActivePointer(payload.from);
  let candidates: InstanceType<typeof ChamadoN1>[] = reopenable ? [reopenable] : [];
  if (!reopenable) {
    candidates = await listChamadosForWhatsAppInbound(payload.from);
    reopenable = candidates.find((chamado) => !shouldSpawnNewTicketOnInbound(chamado)) || null;
  }

  if (payload.messageSid && candidates.some((item) => hasWhatsAppMessageSid(item, payload.messageSid))) {
    console.info('[whatsapp-inbound] mensagem duplicada ignorada', { messageSid: payload.messageSid });
    return 'duplicate';
  }

  const storedMedia = payload.media.length
    ? await persistTwilioInboundMedia(payload.messageSid, payload.accountSid, payload.media)
    : [];

  if (reopenable) {
    await saveWhatsAppReplyOnChamado(reopenable, payload, storedMedia);
    console.info('[whatsapp-inbound] mensagem anexada ao ticket', {
      chamadoProtocolo: reopenable.chamadoProtocolo,
      ticketId: reopenable._id.toString(),
      attachments: storedMedia.length,
    });
    return 'attached';
  }

  // Nenhum chamado reabrível (nenhum candidato, ou todos fechado/cancelado/resolvido fora da
  // janela) — política: não cria ticket. Cliente recebe a orientação padrão via TwiML (ver
  // rota inbound.routes.ts, que usa WHATSAPP_NO_TICKET_REPLY_TEXT para este outcome).
  console.info('[whatsapp-inbound] sem ticket reabrível — resposta padrão enviada, nenhum ticket criado', {
    from: payload.from,
    candidatos: candidates.length,
  });
  return 'rejected_no_ticket';
}

export function getWhatsAppInboundHealth(baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  return {
    status: 'ok' as const,
    enabled: env.whatsappInboundEnabled,
    provider: 'twilio',
    twilioConfigured: isTwilioConfigured(),
    twilioCredentialMode: getTwilioCredentialMode(),
    twilioAccountSid: getTwilioActiveAccountSid() || null,
    webhookUrl: `${normalizedBase}/api/inbound/whatsapp/messages`,
    statusCallbackUrl: resolveWhatsAppStatusCallbackUrl(normalizedBase) || null,
    sandboxFromDefault: env.twilioWhatsappFrom || 'whatsapp:+14155238886',
  };
}
