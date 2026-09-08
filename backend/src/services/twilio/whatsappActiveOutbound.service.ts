/** whatsappActiveOutbound.service v1.5.0 — anexos outbound via mediaUrl Twilio */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import type { IClienteDados } from '../../models/Cliente';
import { env } from '../../config/env';
import { resolveClientGreetingName } from '../clientMessageEnvelope.service';
import { loadDadosForRef } from '../cliente.service';
import { normalizePhoneE164 } from '../telephonyRecado.validation';
import { applyWhatsAppSendMask } from '../clientMessageSendMask.util';
import {
  isWhatsAppCustomerSessionOpen,
  resolveWhatsAppDestinationPhone,
} from './whatsappThread.service';
import {
  sendWhatsAppTemplateMessage,
  sendWhatsAppSessionMessageBatch,
  type WhatsAppOutboundResult,
} from './whatsappOutbound.service';
import { buildWhatsAppOutboundMediaPublicUrlFromApiUrl } from './whatsappOutboundMedia.util';

export const DEFAULT_DESK_INITIAL_TEMPLATE_TEXT = 'Estamos entrando em contato sobre sua solicitação.';

/** Corpo do template UTILITY Desk — placeholders Twilio {{1}} {{2}} {{3}}. */
export const DESK_ACTIVE_WHATSAPP_TEMPLATE_TWILIO_BODY = [
  'Olá {{1}}, aqui é o Velotax.',
  'Referente ao seu chamado {{2}}: {{3}}',
  'Responda esta mensagem para continuarmos o atendimento.',
].join('\n');

export function buildDeskActiveTemplateBody(
  variables: Record<string, string>,
): string {
  const name = String(variables['1'] ?? 'Cliente').trim() || 'Cliente';
  const protocol = String(variables['2'] ?? '—').trim() || '—';
  const summary = String(variables['3'] ?? DEFAULT_DESK_INITIAL_TEMPLATE_TEXT).trim()
    || DEFAULT_DESK_INITIAL_TEMPLATE_TEXT;
  return [
    `Olá ${name}, aqui é o Velotax.`,
    `Referente ao seu chamado ${protocol}: ${summary}`,
    'Responda esta mensagem para continuarmos o atendimento.',
  ].join('\n');
}

export type WhatsAppOutboundMode = 'session' | 'template';

export interface WhatsAppChamadoOutboundResult extends WhatsAppOutboundResult {
  mode?: WhatsAppOutboundMode;
  sessionOpen?: boolean;
}

export interface SendWhatsAppForChamadoOptions {
  text?: string;
  waChatId?: string;
  forceTemplate?: boolean;
  forceSession?: boolean;
  initialTemplate?: boolean;
  contentSid?: string;
  contentVariables?: Record<string, string>;
  attachments?: string[];
  agentName?: string;
  isFirstOutboundMessage?: boolean;
}

function resolveAttachmentsForTwilio(apiUrls: string[] = []): string[] {
  const resolved: string[] = [];
  apiUrls.forEach((apiUrl) => {
    const publicUrl = buildWhatsAppOutboundMediaPublicUrlFromApiUrl(String(apiUrl ?? '').trim());
    if (publicUrl) resolved.push(publicUrl);
  });
  return resolved;
}

function truncate(value: string, max: number): string {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

function resolveTemplateClientName(chamado: IChamadoN1, dados: IClienteDados | null): string {
  const full = String(dados?.clienteNome ?? '').trim()
    || String(chamado.chamadoTitulo ?? '').trim();
  return resolveClientGreetingName(full, 'Cliente');
}

function resolveProtocol(chamado: IChamadoN1): string {
  return String(chamado.chamadoProtocolo ?? '').trim() || '—';
}

export function buildDeskActiveTemplateVariables(
  chamado: IChamadoN1,
  dados: IClienteDados | null,
  agentText: string,
): Record<string, string> {
  const summary = truncate(
    String(agentText ?? '').replace(/\s+/g, ' ').trim()
      || 'Estamos entrando em contato sobre sua solicitação.',
    320,
  );
  return {
    1: resolveTemplateClientName(chamado, dados),
    2: resolveProtocol(chamado),
    3: summary,
  };
}

export function resolveWhatsAppDeskActiveContentSid(explicit?: string): string {
  const sid = String(
    explicit
    ?? env.twilioWhatsappDeskActiveContentSid
    ?? '',
  ).trim();
  return sid;
}

export async function sendWhatsAppForChamado(
  chamado: IChamadoN1,
  options: SendWhatsAppForChamadoOptions,
): Promise<WhatsAppChamadoOutboundResult> {
  const waChatId = String(options.waChatId ?? '').trim() || undefined;
  const dados = await loadDadosForRef(chamado.cliente?.[0] ?? null);
  let destination = resolveWhatsAppDestinationPhone(chamado, waChatId);
  if (!destination) {
    const cadastroWa = dados?.clienteTelefone?.whatsapp
      ?? dados?.clienteTelefone?.lista?.find((item) => normalizePhoneE164(item));
    destination = normalizePhoneE164(cadastroWa ?? '') ?? null;
  }
  if (!destination) {
    return {
      sent: false,
      reason: 'Destino WhatsApp não encontrado no ticket',
      sessionOpen: false,
    };
  }

  const sessionOpen = isWhatsAppCustomerSessionOpen(chamado, waChatId);
  const useTemplate = options.initialTemplate
    || options.forceTemplate
    || (!options.forceSession && !sessionOpen);

  let rawText = String(options.text ?? '').trim();
  const attachmentUrls = resolveAttachmentsForTwilio(options.attachments);
  if (!rawText && !attachmentUrls.length && useTemplate) {
    rawText = DEFAULT_DESK_INITIAL_TEMPLATE_TEXT;
  }
  if (!rawText && !attachmentUrls.length) {
    return { sent: false, reason: 'Texto ou anexo é obrigatório', sessionOpen };
  }
  if (attachmentUrls.length && useTemplate) {
    return {
      sent: false,
      reason: 'Anexos só podem ser enviados após resposta do cliente (janela 24h)',
      mode: 'template',
      sessionOpen: false,
    };
  }

  if (!useTemplate) {
    const maskedText = rawText
      ? applyWhatsAppSendMask(rawText, chamado, {
        agentName: options.agentName,
        isFirstOutboundMessage: options.isFirstOutboundMessage,
      })
      : '';
    const result = await sendWhatsAppSessionMessageBatch({
      to: destination,
      body: maskedText || undefined,
      mediaUrls: attachmentUrls,
    });
    return { ...result, mode: 'session', sessionOpen: true };
  }

  if (!rawText) {
    return { sent: false, reason: 'Texto da mensagem é obrigatório', sessionOpen };
  }

  const contentSid = resolveWhatsAppDeskActiveContentSid(options.contentSid);
  if (!contentSid) {
    return {
      sent: false,
      reason: 'TWILIO_WHATSAPP_DESK_ACTIVE_CONTENT_SID ausente — necessário para mensagem ativa',
      mode: 'template',
      sessionOpen: false,
    };
  }

  const contentVariables = options.contentVariables
    ?? buildDeskActiveTemplateVariables(chamado, dados, rawText);

  const result = await sendWhatsAppTemplateMessage({
    to: destination,
    contentSid,
    contentVariables,
  });

  const renderedBody = buildDeskActiveTemplateBody(contentVariables);

  return {
    ...result,
    mode: 'template',
    sessionOpen: false,
    body: renderedBody,
  };
}
