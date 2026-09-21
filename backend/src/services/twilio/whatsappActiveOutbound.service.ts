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
import { getTwilioClient, isTwilioConfigured } from './twilioClient.util';

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

/**
 * Nome pro slot {{1}} do template Twilio aprovado — nunca o chamadoTitulo (mesmo motivo do
 * cadastro em placeholders.util.ts: o título do ticket já causou nome errado tipo "Central" ou
 * "Atendimento" grudando como se fosse nome de cliente). "Cliente" só entra aqui porque o
 * template WhatsApp é um texto fixo pré-aprovado pela Meta com variável obrigatória — não dá
 * pra omitir o nome como se faz no e-mail/composer; é o único lugar do sistema onde esse
 * fallback genérico ainda é necessário.
 */
function resolveTemplateClientName(chamado: IChamadoN1, dados: IClienteDados | null): string {
  const full = String(dados?.clienteNome ?? '').trim();
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

/**
 * Template UTILITY separado pra saudação padrão do atendimento comum (sem texto livre do
 * agente) — content_sid próprio porque um template aprovado pelo WhatsApp não pode ter o
 * corpo editado depois; e como o corpo daqui não tem slot de texto livre (diferente do
 * DESK_ACTIVE_WHATSAPP_TEMPLATE_TWILIO_BODY, usado pelos módulos de casos especiais), reusar
 * o mesmo content_sid quebraria a saudação customizada por órgão.
 */
export const DESK_STANDARD_WHATSAPP_TEMPLATE_TWILIO_BODY = [
  'Olá {{1}}, aqui é o Velotax.',
  'Eu sou {{2}} e irei realizar o atendimento referente ao seu chamado {{3}}!',
  'Responda esta mensagem para continuarmos o atendimento.',
].join('\n');

export function buildDeskStandardTemplateBody(variables: Record<string, string>): string {
  const name = String(variables['1'] ?? 'Cliente').trim() || 'Cliente';
  const agent = String(variables['2'] ?? 'Atendimento Velotax').trim() || 'Atendimento Velotax';
  const protocol = String(variables['3'] ?? '—').trim() || '—';
  return [
    `Olá ${name}, aqui é o Velotax.`,
    `Eu sou ${agent} e irei realizar o atendimento referente ao seu chamado ${protocol}!`,
    'Responda esta mensagem para continuarmos o atendimento.',
  ].join('\n');
}

export function buildDeskStandardTemplateVariables(
  chamado: IChamadoN1,
  dados: IClienteDados | null,
  agentName?: string,
): Record<string, string> {
  return {
    1: resolveTemplateClientName(chamado, dados),
    2: String(agentName ?? '').trim() || 'Atendimento Velotax',
    3: resolveProtocol(chamado),
  };
}

export function resolveWhatsAppDeskStandardContentSid(explicit?: string): string {
  return String(explicit ?? env.twilioWhatsappDeskStandardContentSid ?? '').trim();
}

/**
 * O template padrão novo (desk_atendimento_padrao_v1) foi submetido pra aprovação do WhatsApp
 * e pode ainda não ter sido aprovado pela Meta — nesse caso o Twilio rejeita o envio. Em vez de
 * travar a comunicação, checamos o status aprovado antes de usar (cache curto pra não bater na
 * API do Twilio a cada mensagem) e caímos de volta pro template já aprovado (casos especiais,
 * com o resumo padrão) enquanto a aprovação não sai.
 */
let standardTemplateApprovalCache: { approved: boolean; checkedAt: number } | null = null;
const STANDARD_TEMPLATE_APPROVAL_CACHE_MS = 5 * 60 * 1000;

export async function isDeskStandardTemplateApproved(): Promise<boolean> {
  const sid = resolveWhatsAppDeskStandardContentSid();
  if (!sid || !isTwilioConfigured()) return false;

  const now = Date.now();
  if (standardTemplateApprovalCache && now - standardTemplateApprovalCache.checkedAt < STANDARD_TEMPLATE_APPROVAL_CACHE_MS) {
    return standardTemplateApprovalCache.approved;
  }

  try {
    const client = getTwilioClient();
    const res = await client.request({
      method: 'get',
      uri: `https://content.twilio.com/v1/Content/${sid}/ApprovalRequests`,
    });
    const approved = res.body?.whatsapp?.status === 'approved';
    standardTemplateApprovalCache = { approved, checkedAt: now };
    return approved;
  } catch (err) {
    console.warn('[whatsapp-active-outbound] falha ao checar aprovação do template padrão — usando fallback', (err as Error).message);
    standardTemplateApprovalCache = { approved: false, checkedAt: now };
    return false;
  }
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
  const hasCustomText = Boolean(rawText);
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

  // Sem texto livre custom (agente não digitou nada) — mensagem padrão do atendimento comum,
  // com template próprio (nome do responsável + protocolo), não o de casos especiais. Só usa
  // o template novo se ele já estiver aprovado pelo WhatsApp; senão cai no antigo (já aprovado)
  // pra não travar o envio enquanto a aprovação não sai.
  const useStandardTemplate = !hasCustomText
    && !options.contentSid
    && !options.contentVariables
    && await isDeskStandardTemplateApproved();

  const contentSid = useStandardTemplate
    ? resolveWhatsAppDeskStandardContentSid()
    : resolveWhatsAppDeskActiveContentSid(options.contentSid);
  if (!contentSid) {
    return {
      sent: false,
      reason: useStandardTemplate
        ? 'TWILIO_WHATSAPP_DESK_STANDARD_CONTENT_SID ausente — necessário para mensagem padrão de atendimento'
        : 'TWILIO_WHATSAPP_DESK_ACTIVE_CONTENT_SID ausente — necessário para mensagem ativa',
      mode: 'template',
      sessionOpen: false,
    };
  }

  const contentVariables = options.contentVariables
    ?? (useStandardTemplate
      ? buildDeskStandardTemplateVariables(chamado, dados, options.agentName)
      : buildDeskActiveTemplateVariables(chamado, dados, rawText));

  const result = await sendWhatsAppTemplateMessage({
    to: destination,
    contentSid,
    contentVariables,
  });

  const renderedBody = useStandardTemplate
    ? buildDeskStandardTemplateBody(contentVariables)
    : buildDeskActiveTemplateBody(contentVariables);

  return {
    ...result,
    mode: 'template',
    sessionOpen: false,
    body: renderedBody,
  };
}
