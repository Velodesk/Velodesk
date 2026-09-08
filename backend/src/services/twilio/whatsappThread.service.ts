/** whatsappThread.service v1.7.0 — anexosScanStatus paralelo a anexos */
import type { IChamadoN1, IRegistro } from '../../models/ChamadoN1';
import { normalizePhoneE164 } from '../telephonyRecado.validation';

export const WHATSAPP_THREAD_SOURCE = 'whatsapp-thread';
export const WHATSAPP_MENSAGENS_KEY = 'whatsappMensagens';
/** Janela de atendimento WhatsApp (última msg do cliente). */
export const WHATSAPP_SESSION_MS = 24 * 60 * 60 * 1000;

export type WhatsAppDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'undelivered';

const DELIVERY_STATUS_RANK: Record<WhatsAppDeliveryStatus, number> = {
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  read: 5,
  failed: 0,
  undelivered: 0,
};

export interface WhatsAppMensagemItem {
  id: string;
  data: string;
  origin: 'cliente' | 'agente';
  autor: string;
  texto: string;
  anexos: string[];
  twilioMessageSid?: string;
  deliveryStatus?: WhatsAppDeliveryStatus;
  deliveryStatusAt?: string;
  deliveryErrorCode?: string;
  deliveryErrorMessage?: string;
  mediaContentTypes?: string[];
  anexosScanStatus?: string[];
  transcriptionStatus?: 'available' | 'pending' | 'processing' | 'completed' | 'failed';
  transcriptionText?: string;
  transcriptionError?: string;
}

export interface AppendWhatsAppMensagemInput {
  origin: 'cliente' | 'agente';
  autor?: string;
  texto: string;
  anexos?: string[];
  twilioMessageSid?: string;
  waChatId?: string;
  deliveryStatus?: WhatsAppDeliveryStatus;
  mediaContentTypes?: string[];
  anexosScanStatus?: string[];
  transcriptionStatus?: WhatsAppMensagemItem['transcriptionStatus'];
}

export function normalizeWhatsAppDeliveryStatus(raw: unknown): WhatsAppDeliveryStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'accepted':
    case 'queued':
      return 'queued';
    case 'sending':
      return 'sending';
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
      return 'read';
    case 'undelivered':
      return 'undelivered';
    case 'failed':
      return 'failed';
    default:
      return 'queued';
  }
}

function shouldApplyDeliveryStatus(
  current: WhatsAppDeliveryStatus | undefined,
  next: WhatsAppDeliveryStatus,
): boolean {
  if (next === 'failed' || next === 'undelivered') return true;
  const currentRank = DELIVERY_STATUS_RANK[current ?? 'queued'] ?? 0;
  const nextRank = DELIVERY_STATUS_RANK[next] ?? 0;
  return nextRank >= currentRank;
}

function writeWhatsAppMensagensToRegistro(reg: IRegistro, list: WhatsAppMensagemItem[]): void {
  const meta = registroMetadados(reg);
  meta[WHATSAPP_MENSAGENS_KEY] = list;
  reg.metadados = meta;
}

function currentStatus(chamado: IChamadoN1): string {
  const last = chamado.registro?.[chamado.registro.length - 1];
  return String(last?.status ?? 'novo').trim() || 'novo';
}

function registroMetadados(reg: IRegistro): Record<string, unknown> {
  return (reg.metadados ?? {}) as Record<string, unknown>;
}

export function normalizeWaChatId(value: unknown): string {
  const digits = String(value ?? '')
    .replace(/^whatsapp:/i, '')
    .replace(/\D/g, '')
    .trim();
  if (!digits) return '';
  const e164 = normalizePhoneE164(digits);
  return e164 ? e164.replace(/^\+/, '') : digits;
}

function toWhatsAppDestinationE164(value: unknown): string | null {
  const raw = String(value ?? '').replace(/^whatsapp:/i, '').trim();
  if (!raw) return null;
  return normalizePhoneE164(raw) ?? normalizePhoneE164(raw.replace(/\D/g, ''));
}

export function resolveWaChatIdFromChamado(chamado: IChamadoN1, hint?: string): string {
  const fromHint = normalizeWaChatId(hint);
  if (fromHint) return fromHint;

  for (let i = (chamado.registro?.length ?? 0) - 1; i >= 0; i -= 1) {
    const meta = registroMetadados(chamado.registro![i]);
    if (String(meta.source ?? '') === WHATSAPP_THREAD_SOURCE) {
      const fromMeta = normalizeWaChatId(meta.waChatId);
      if (fromMeta) return fromMeta;
    }
  }

  for (let i = (chamado.registro?.length ?? 0) - 1; i >= 0; i -= 1) {
    const meta = registroMetadados(chamado.registro![i]);
    const from = normalizeWaChatId(meta.waFrom);
    if (from) return from;
  }

  return '';
}

export function findWhatsAppThreadRegistro(
  chamado: IChamadoN1,
  waChatId?: string,
): { registro: IRegistro; index: number } | null {
  const targetChatId = normalizeWaChatId(waChatId);
  const registros = chamado.registro ?? [];

  for (let index = registros.length - 1; index >= 0; index -= 1) {
    const reg = registros[index];
    const meta = registroMetadados(reg);
    if (String(meta.source ?? '') !== WHATSAPP_THREAD_SOURCE) continue;
    if (!targetChatId) return { registro: reg, index };
    if (normalizeWaChatId(meta.waChatId) === targetChatId) return { registro: reg, index };
  }

  return null;
}

function createWhatsAppThreadRegistro(chamado: IChamadoN1, waChatId: string): IRegistro {
  return {
    data: new Date(),
    origin: '',
    autor: '',
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados: {
      source: WHATSAPP_THREAD_SOURCE,
      channel: 'whatsapp',
      waChatId: waChatId || undefined,
      [WHATSAPP_MENSAGENS_KEY]: [] as WhatsAppMensagemItem[],
    },
    status: currentStatus(chamado),
  };
}

export function getOrCreateWhatsAppThreadRegistro(
  chamado: IChamadoN1,
  waChatId?: string,
): { registro: IRegistro; index: number; created: boolean } {
  const chatId = resolveWaChatIdFromChamado(chamado, waChatId);
  const existing = findWhatsAppThreadRegistro(chamado, chatId || undefined);
  if (existing) return { ...existing, created: false };

  if (!chamado.registro) chamado.registro = [];
  const registro = createWhatsAppThreadRegistro(chamado, chatId);
  chamado.registro.push(registro);
  return {
    registro,
    index: chamado.registro.length - 1,
    created: true,
  };
}

export function readWhatsAppMensagens(reg: IRegistro): WhatsAppMensagemItem[] {
  const meta = registroMetadados(reg);
  const raw = meta[WHATSAPP_MENSAGENS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        id: String(row.id ?? '').trim(),
        data: String(row.data ?? '').trim(),
        origin: String(row.origin ?? '').trim() === 'cliente' ? 'cliente' : 'agente',
        autor: String(row.autor ?? '').trim(),
        texto: String(row.texto ?? row.text ?? '').trim(),
        anexos: Array.isArray(row.anexos)
          ? row.anexos.map((url) => String(url ?? '').trim()).filter(Boolean)
          : [],
        twilioMessageSid: String(row.twilioMessageSid ?? '').trim() || undefined,
        deliveryStatus: row.deliveryStatus || row.status
          ? normalizeWhatsAppDeliveryStatus(row.deliveryStatus ?? row.status)
          : undefined,
        deliveryStatusAt: String(row.deliveryStatusAt ?? '').trim() || undefined,
        deliveryErrorCode: String(row.deliveryErrorCode ?? row.errorCode ?? '').trim() || undefined,
        deliveryErrorMessage: String(row.deliveryErrorMessage ?? row.errorMessage ?? '').trim() || undefined,
        mediaContentTypes: Array.isArray(row.mediaContentTypes)
          ? row.mediaContentTypes.map((value) => String(value ?? '').trim()).filter(Boolean)
          : undefined,
        anexosScanStatus: Array.isArray(row.anexosScanStatus)
          ? row.anexosScanStatus.map((value) => String(value ?? '').trim())
          : undefined,
        transcriptionStatus: ['available', 'pending', 'processing', 'completed', 'failed'].includes(
          String(row.transcriptionStatus ?? ''),
        )
          ? row.transcriptionStatus as WhatsAppMensagemItem['transcriptionStatus']
          : undefined,
        transcriptionText: String(row.transcriptionText ?? '').trim() || undefined,
        transcriptionError: String(row.transcriptionError ?? '').trim() || undefined,
      } satisfies WhatsAppMensagemItem;
    })
    .filter((item) => item.texto || item.anexos.length);
}

export function appendWhatsAppMensagemToChamado(
  chamado: IChamadoN1,
  input: AppendWhatsAppMensagemInput,
): { registroIndex: number; mensagem: WhatsAppMensagemItem; createdThread: boolean } {
  const texto = String(input.texto ?? '').trim();
  const anexos = (input.anexos ?? []).map((item) => String(item ?? '').trim()).filter(Boolean);
  if (!texto && !anexos.length) {
    throw new Error('Texto ou anexo é obrigatório');
  }

  const waChatId = resolveWaChatIdFromChamado(chamado, input.waChatId);
  const { registro, index, created } = getOrCreateWhatsAppThreadRegistro(chamado, waChatId);
  const meta = registroMetadados(registro);
  const list = readWhatsAppMensagens(registro);
  const now = new Date();

  const mensagem: WhatsAppMensagemItem = {
    id: `wa-${now.getTime()}-${list.length}`,
    data: now.toISOString(),
    origin: input.origin,
    autor: String(input.autor ?? '').trim(),
    texto,
    anexos,
    twilioMessageSid: input.twilioMessageSid,
    deliveryStatus: input.origin === 'agente'
      ? (input.deliveryStatus ?? (input.twilioMessageSid ? 'sent' : 'queued'))
      : undefined,
    deliveryStatusAt: input.origin === 'agente' ? now.toISOString() : undefined,
    mediaContentTypes: input.mediaContentTypes,
    anexosScanStatus: input.anexosScanStatus,
    transcriptionStatus: input.transcriptionStatus,
  };

  list.push(mensagem);
  writeWhatsAppMensagensToRegistro(registro, list);
  meta.source = WHATSAPP_THREAD_SOURCE;
  meta.channel = 'whatsapp';
  if (waChatId) meta.waChatId = waChatId;
  registro.metadados = meta;
  registro.data = now;

  // metadados é Mixed — sem markModified o save() descarta a mutação silenciosamente
  chamado.markModified(`registro.${index}.metadados`);

  return {
    registroIndex: index,
    mensagem,
    createdThread: created,
  };
}

/** True se já existe alguma mensagem do agente nessa thread — usado para só incluir o
 * protocolo na primeira mensagem ativa enviada ao cliente. */
export function hasPriorAgentWhatsAppMessage(chamado: IChamadoN1, waChatId?: string): boolean {
  const thread = findWhatsAppThreadRegistro(chamado, waChatId);
  if (!thread) return false;
  return readWhatsAppMensagens(thread.registro).some((item) => item.origin === 'agente');
}

export function isWhatsAppCustomerSessionOpen(
  chamado: IChamadoN1,
  waChatId?: string,
): boolean {
  const chatId = resolveWaChatIdFromChamado(chamado, waChatId);
  const thread = findWhatsAppThreadRegistro(chamado, chatId || undefined);
  if (!thread) return false;

  const msgs = readWhatsAppMensagens(thread.registro);
  let lastClienteAt = 0;
  for (const msg of msgs) {
    if (msg.origin !== 'cliente') continue;
    const ts = new Date(msg.data).getTime();
    if (!Number.isNaN(ts) && ts > lastClienteAt) lastClienteAt = ts;
  }
  if (!lastClienteAt) return false;
  return Date.now() - lastClienteAt < WHATSAPP_SESSION_MS;
}

export function resolveWhatsAppDestinationPhone(
  chamado: IChamadoN1,
  hint?: string,
): string | null {
  const chatId = resolveWaChatIdFromChamado(chamado, hint);
  const fromChatId = toWhatsAppDestinationE164(chatId);
  if (fromChatId) return fromChatId;

  for (let i = (chamado.registro?.length ?? 0) - 1; i >= 0; i -= 1) {
    const meta = registroMetadados(chamado.registro![i]);
    const fromWa = toWhatsAppDestinationE164(meta.waFrom);
    if (fromWa) return fromWa;
  }

  return null;
}

export function updateWhatsAppMensagemDeliveryBySid(
  chamado: IChamadoN1,
  messageSid: string,
  input: {
    status: WhatsAppDeliveryStatus;
    errorCode?: string;
    errorMessage?: string;
  },
): { updated: boolean; deliveryStatus?: WhatsAppDeliveryStatus; reason?: string } {
  const sid = String(messageSid ?? '').trim();
  if (!sid) return { updated: false, reason: 'MessageSid ausente' };

  const registros = chamado.registro ?? [];
  for (let index = registros.length - 1; index >= 0; index -= 1) {
    const reg = registros[index];
    const meta = registroMetadados(reg);
    if (String(meta.source ?? '') !== WHATSAPP_THREAD_SOURCE) continue;

    const list = readWhatsAppMensagens(reg);
    const msgIndex = list.findIndex((item) => item.twilioMessageSid === sid);
    if (msgIndex < 0) continue;

    const current = list[msgIndex];
    const nextStatus = normalizeWhatsAppDeliveryStatus(input.status);
    if (!shouldApplyDeliveryStatus(current.deliveryStatus, nextStatus)) {
      return {
        updated: false,
        deliveryStatus: current.deliveryStatus,
        reason: 'Status ignorado (regressão)',
      };
    }

    const now = new Date().toISOString();
    list[msgIndex] = {
      ...current,
      deliveryStatus: nextStatus,
      deliveryStatusAt: now,
      deliveryErrorCode: input.errorCode || current.deliveryErrorCode,
      deliveryErrorMessage: input.errorMessage || current.deliveryErrorMessage,
    };
    writeWhatsAppMensagensToRegistro(reg, list);
    reg.data = new Date(now);
    // metadados é Mixed — sem markModified o save() descarta a mutação silenciosamente
    chamado.markModified(`registro.${index}.metadados`);
    return { updated: true, deliveryStatus: nextStatus };
  }

  return { updated: false, reason: 'Mensagem não encontrada na thread' };
}
