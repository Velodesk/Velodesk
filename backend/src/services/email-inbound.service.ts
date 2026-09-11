/** email-inbound.service v1.20.0 — plain truncado cede ao HTML completo no inbound */
import { addBrCivilDaysIso } from './dates/brDateTime.util';
import { decodeBasicHtmlEntities } from './emailHtml.util';
import { ChamadoN1 } from '../models/ChamadoN1';
import { ChamadoIaAnalise } from '../models/ChamadoIaAnalise';
import { isFusaoAbsorvidoChamado } from './ticketFusao.helpers';
import { applyAssignmentIfNeeded } from './assignmentRouter.service';
import {
  appendMessage,
  appendStatusTransition,
  createChamadoFromBody,
  currentStatus,
  normalizeStatusValue,
  prependInboundDerivedTicketNote,
  resolveInboundClientReplyStatus,
  shouldSpawnNewTicketOnInbound,
} from './chamado.mapper';
import { publishTicketEvent } from './presence/ticketEventsBroadcast.service';
import { normalizeEmail, resolveClienteRefFromEmail } from './cliente.service';
import { notifyTicketOpenedAsync } from './emailNotification.service';
import { runInboundPostCreateHooks } from './agents/inboundAgentPipeline.service';
import { runCasosEspeciaisTriagem } from './agents/casosEspeciaisTrigger.service';
import { matchMailRule } from './mailRules.service';
import { isEmailBounce } from './emailBounceDetection.util';
import {
  claimInboundMessage,
  markInboundMessageDone,
  markInboundMessageFailed,
} from './inboundDedupe.service';
import { extractEmailReplyContent } from './emailReplyContent.util';
import {
  attachmentMatchesKnownFingerprints,
  collectChamadoAttachmentFingerprints,
  isBrandInlineAttachmentFilename,
} from './attachmentFilter.util';
import type { InboundEmailPayload, InboundEmailProcessResult } from './inbound-email/types';
import type { IChamadoN1 } from '../models/ChamadoN1';
import {
  classifyInboundEspeciaisChannel,
  type InboundEspeciaisChannel,
} from './inbound-email/inboundChannelClassifier.service';
import {
  isCgovPrioritySubject,
  isCgovStructuredInboundEmail,
  parseConsumidorGovInboundEmail,
  type ParsedCgovInboundEmail,
} from './inbound-email/parseConsumidorGovEmail.service';
import {
  isBacenRdrPrioritySubject,
  isBacenRdrStructuredInboundEmail,
  parseBacenRdrInboundEmail,
  type ParsedBacenRdrInboundEmail,
} from './inbound-email/parseBacenRdrEmail.service';
import { buildFastPathTriagem } from './agents/casosEspeciaisAgent.service';
import { upsertFromChamado } from './reclamacoes/reclamacao.service';

export const LEGACY_PROTOCOL_PATTERN = /VD-\d{8}-\d{4}/i;
export const NUMERIC_PROTOCOL_PATTERN = /\[(\d{8,10})\]/;

export function normalizeMessageId(value: unknown): string {
  return String(value ?? '').trim().replace(/^<|>$/g, '');
}

export function stripHtml(html: string): string {
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return decodeBasicHtmlEntities(stripped);
}

function plainLooksLikeImagePlaceholders(text: string): boolean {
  return /\[image:\s*[^\]]+\]/i.test(text)
    || /\[cid:[^\]]+\]/i.test(text)
    || (!text.trim() && false);
}

/**
 * Gmail/clients costumam mandar text/plain truncado com htmlBody completo (multipart/alternative).
 * Ex.: plain "Número t" + html "Número tem acento".
 */
export function plainTextLooksTruncatedVsHtml(plain: string, html: string): boolean {
  const plainTrim = String(plain ?? '').trim();
  const htmlRaw = String(html ?? '').trim();
  if (!plainTrim || !htmlRaw) return false;

  const htmlText = stripHtml(htmlRaw).trim();
  if (!htmlText || htmlText.length <= plainTrim.length) return false;

  if (htmlText.startsWith(plainTrim) && htmlText.length - plainTrim.length >= 3) {
    return true;
  }

  const minExtra = 8;
  if (plainTrim.length < htmlText.length * 0.75 && htmlText.length - plainTrim.length >= minExtra) {
    return true;
  }

  return false;
}

function shouldPreferHtmlBody(text: string, htmlRaw: string): boolean {
  if (!htmlRaw.trim()) return false;
  if (!text.trim()) return true;
  if (plainLooksLikeImagePlaceholders(text)) return true;
  return plainTextLooksTruncatedVsHtml(text, htmlRaw);
}

/** Mantém tags básicas + img com src http(s) ou /api — para corpo inbound com fotos inline. */
export function sanitizeInboundHtmlKeepingImages(html: string): string {
  let result = String(html ?? '');
  result = result.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
  result = result.replace(/<\s*br\s*\/?>/gi, '<br>');
  // Preserve img tags with safe src; rewrite others away after collecting.
  const imgs: string[] = [];
  result = result.replace(/<\s*img\b[^>]*>/gi, (full) => {
    const srcMatch = full.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = String(srcMatch?.[1] ?? '').trim();
    if (!src) return '';
    if (/^cid:/i.test(src)) return ''; // unresolved CID — drop
    if (!/^(https?:\/\/|\/api\/)/i.test(src)) return '';
    const altMatch = full.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = String(altMatch?.[1] ?? 'imagem').replace(/"/g, '');
    const token = `__IMG_${imgs.length}__`;
    imgs.push(`<img src="${src}" alt="${alt}" style="max-width:100%;height:auto" />`);
    return token;
  });
  result = result.replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b[^>]*>/gi, (_full, slash, name) => {
    const tag = String(name).toLowerCase();
    const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li']);
    if (!allowed.has(tag)) return '';
    if (tag === 'br' && slash) return '';
    return `<${slash ? '/' : ''}${tag}>`;
  });
  imgs.forEach((img, i) => {
    result = result.replace(`__IMG_${i}__`, img);
  });
  return result.replace(/(<br>){3,}/gi, '<br><br>').trim();
}

export function resolveEmailBody(payload: InboundEmailPayload): string {
  const text = payload.textBody.trim();
  const htmlRaw = String(payload.htmlBody ?? '').trim();

  if (shouldPreferHtmlBody(text, htmlRaw)) {
    const sanitized = sanitizeInboundHtmlKeepingImages(htmlRaw);
    if (sanitized) {
      return extractEmailReplyContent(sanitized);
    }
  }

  const raw = text || (htmlRaw ? stripHtml(htmlRaw) : '');
  return extractEmailReplyContent(raw);
}

/** Corpo a persistir: extração da resposta, senão o texto cru — nunca descarta o e-mail. */
export function resolveEmailBodyForPersist(payload: InboundEmailPayload): string {
  const extracted = resolveEmailBody(payload).trim();
  if (extracted) return extracted;
  const rawText = String(payload.textBody ?? '').trim();
  if (rawText) return rawText;
  const rawHtml = String(payload.htmlBody ?? '').trim();
  if (rawHtml) return stripHtml(rawHtml);
  return '';
}

function persistInboundEmailOnChamado(
  chamado: IChamadoN1,
  payload: InboundEmailPayload,
  bodyText: string,
  attachments: string[],
  emailMeta: Record<string, unknown>,
  statusOverride?: string,
): void {
  const autor = payload.from.name || payload.from.email;
  const textToStore = bodyText.trim() || (attachments.length ? '' : '[E-mail recebido]');
  const lenBefore = chamado.registro?.length ?? 0;
  appendMessage(chamado, textToStore, false, 'them', attachments, emailMeta, statusOverride);
  if ((chamado.registro?.length ?? 0) > lenBefore) return;

  if (!chamado.registro) chamado.registro = [];
  const status = String(statusOverride || currentStatus(chamado) || 'em-aberto').trim();
  chamado.registro.push({
    data: new Date(),
    origin: 'cliente',
    autor,
    mensagemPublica: textToStore || '[E-mail recebido]',
    anexosMensagemPublica: attachments,
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: statusOverride ? [{ status }] : [],
    metadados: emailMeta,
    status,
  });
}

export function extractProtocolFromSubject(subject: string): string | null {
  const legacy = subject.match(LEGACY_PROTOCOL_PATTERN);
  if (legacy) return legacy[0].toUpperCase();

  const bracket = subject.match(NUMERIC_PROTOCOL_PATTERN);
  if (bracket?.[1]) return bracket[1];

  return null;
}

export function buildEmailMetadados(payload: InboundEmailPayload): Record<string, unknown> {
  return {
    source: 'email-inbound',
    emailMessageId: normalizeMessageId(payload.messageId),
    emailFrom: payload.from.email,
    emailSubject: payload.subject,
    emailInReplyTo: payload.inReplyTo ? normalizeMessageId(payload.inReplyTo) : undefined,
    emailReferences: payload.references?.map((item) => normalizeMessageId(item)),
  };
}

/** @deprecated use buildEmailMetadados */
export const buildEmailAlteracoes = buildEmailMetadados;

export async function findChamadoByCgovProtocolo(protocolo: string) {
  const normalized = String(protocolo ?? '').trim();
  if (!normalized) return null;
  return ChamadoN1.findOne({
    $or: [
      { 'registro.metadados.consumidorGov.protocoloGov': normalized },
      { 'registro.metadados.consumidorGov.idDemanda': normalized },
    ],
  });
}

export async function findChamadoByBacenIdDemanda(idDemanda: string) {
  const normalized = String(idDemanda ?? '').trim();
  if (!normalized) return null;
  return ChamadoN1.findOne({
    $or: [
      { 'registro.metadados.bacen.idDemanda': normalized },
      { 'registro.metadados.bacen.protocoloBacen': normalized },
    ],
  });
}

function addDaysIso(iso: string, days: number): string {
  return addBrCivilDaysIso(iso, days, { hour: 18, minute: 0 });
}

export async function findChamadoByEmailMessageId(messageId: string) {
  const normalized = normalizeMessageId(messageId);
  if (!normalized) return null;
  return ChamadoN1.findOne({
    $or: [
      { 'registro.metadados.emailMessageId': normalized },
      { 'registro.metadados.emailOutboundMessageId': normalized },
      { 'registro.metadados.emailThreadRootId': normalized },
      { 'registro.alteracoes.emailMessageId': normalized },
    ],
  });
}

export async function findChamadoForEmailReply(payload: InboundEmailPayload) {
  const protocol = extractProtocolFromSubject(payload.subject);
  if (protocol) {
    const byProtocol = await ChamadoN1.findOne({ chamadoProtocolo: protocol });
    if (byProtocol) return byProtocol;
  }

  const candidates = [payload.inReplyTo, ...(payload.references ?? [])]
    .map((item) => normalizeMessageId(item))
    .filter(Boolean);

  for (const candidate of candidates) {
    const found = await findChamadoByEmailMessageId(candidate);
    if (found) return found;
  }

  return null;
}

/**
 * Melhor palpite pro e-mail do cliente que não recebeu a mensagem: procura no histórico do
 * ticket a última mensagem de origem 'cliente' com metadados.emailFrom (endereço usado pelo
 * cliente pra falar com o Desk é o mesmo endereço pro qual o Desk responde).
 */
function resolveClienteEmailFromChamado(chamado: IChamadoN1): string {
  const registro = chamado.registro ?? [];
  for (let i = registro.length - 1; i >= 0; i -= 1) {
    const item = registro[i];
    if (item?.origin !== 'cliente') continue;
    const emailFrom = (item.metadados as Record<string, unknown> | undefined)?.emailFrom;
    if (typeof emailFrom === 'string' && emailFrom.trim()) return emailFrom.trim();
  }
  return '';
}

/**
 * Bounce de um e-mail que o Desk mandou pro cliente: correlaciona ao ticket original (via
 * protocolo no assunto ou cadeia In-Reply-To/References) e grava a falha permanentemente em
 * chamado.emailDeliveryFailures. Sem ticket correspondente, descarta silenciosamente — não há
 * mais log genérico separado (ver emailBounceDetection.util.ts para a detecção pura).
 */
async function recordEmailDeliveryFailure(payload: InboundEmailPayload, messageId: string): Promise<void> {
  const chamado = await findChamadoForEmailReply(payload);
  if (!chamado) {
    console.info('[email-inbound] bounce descartado (sem ticket correspondente)', {
      from: payload.from.email,
      messageId,
      subject: payload.subject,
    });
    return;
  }

  if (!chamado.emailDeliveryFailures) chamado.emailDeliveryFailures = [];
  chamado.emailDeliveryFailures.push({
    em: payload.receivedAt || new Date(),
    destinatario: resolveClienteEmailFromChamado(chamado),
    assunto: payload.subject || '',
    messageId,
  });
  await chamado.save();

  console.info('[email-inbound] falha de entrega registrada no ticket', {
    protocolo: chamado.chamadoProtocolo,
    messageId,
    subject: payload.subject,
  });
}

function attachmentUrls(payload: InboundEmailPayload): string[] {
  return (payload.attachments ?? [])
    .map((item) => item.url)
    .filter((url): url is string => Boolean(url));
}

/** Remove anexos já presentes em mensagens anteriores do mesmo ticket. */
function retainOnlyNewAttachments(
  payload: InboundEmailPayload,
  chamado: IChamadoN1 | null | undefined,
): void {
  const attachments = payload.attachments ?? [];
  if (!attachments.length || !chamado) return;

  const known = collectChamadoAttachmentFingerprints(chamado);
  const kept = attachments.filter((item) => !attachmentMatchesKnownFingerprints(item, known));
  if (kept.length !== attachments.length) {
    console.info('[email-inbound] anexos da thread anterior removidos da mensagem atual', {
      antes: attachments.length,
      depois: kept.length,
      protocolo: chamado.chamadoProtocolo,
    });
  }
  payload.attachments = kept;
}

function dropBrandInlineAttachments(payload: InboundEmailPayload): void {
  const attachments = payload.attachments ?? [];
  if (!attachments.length) return;
  payload.attachments = attachments.filter((item) => {
    const filename = String(item.filename || '').trim();
    const url = String(item.url || '').trim();
    return !isBrandInlineAttachmentFilename(filename)
      && !isBrandInlineAttachmentFilename(url);
  });
}

function buildAttachmentMetadados(payload: InboundEmailPayload): Record<string, unknown> {
  const items = (payload.attachments ?? [])
    .filter((item) => item.url || item.gcsUri)
    .map((item) => ({
      filename: item.filename,
      url: item.url,
      gcsUri: item.gcsUri,
      storageKey: item.storageKey,
      contentHash: item.contentHash,
      bytes: item.bytes,
      scanStatus: item.scanStatus,
    }));
  return items.length ? { emailAttachments: items } : {};
}

function appendAttachmentReferencesToBody(bodyText: string, payload: InboundEmailPayload): string {
  const lines = (payload.attachments ?? [])
    .filter((item) => item.filename || item.url)
    .map((item) => {
      const label = String(item.filename || 'anexo').trim() || 'anexo';
      return `[Anexo: ${label}]`;
    });
  if (!lines.length) return bodyText;
  const block = lines.join('\n');
  const base = String(bodyText || '').trim();
  return base ? `${base}\n\n${block}` : block;
}

export async function processInboundEmail(payload: InboundEmailPayload): Promise<InboundEmailProcessResult> {
  const messageId = normalizeMessageId(payload.messageId);
  if (!messageId) {
    throw new Error('Message-Id ausente no e-mail inbound');
  }

  if (isEmailBounce(payload)) {
    await recordEmailDeliveryFailure(payload, messageId);
    return {
      action: 'skipped',
      reason: 'bounce',
      messageId,
    };
  }

  const rule = matchMailRule(payload);
  if (rule === 'spam' || rule === 'ignored') {
    console.info('[email-inbound] skipped', {
      rule,
      from: payload.from.email,
      messageId,
      subject: payload.subject,
    });
    return {
      action: 'skipped',
      reason: rule,
      messageId,
    };
  }

  const claim = await claimInboundMessage(messageId);
  if (!claim.granted) {
    console.info('[email-inbound] claim negado', {
      messageId,
      reason: claim.reason,
      protocolo: claim.previous?.chamadoProtocolo || null,
    });
    return {
      action: 'duplicate',
      chamadoProtocolo: claim.previous?.chamadoProtocolo || undefined,
      ticketId: claim.previous?.ticketId || undefined,
      messageId,
    };
  }

  try {
    const priorityFromSubject = isCgovPrioritySubject(payload.subject)
      || isBacenRdrPrioritySubject(payload.subject);
    const result = await runInboundEmailFlow(
      payload,
      messageId,
      rule === 'priority' || priorityFromSubject,
    );
    await markInboundMessageDone(messageId, {
      action: result.action,
      chamadoProtocolo: result.chamadoProtocolo,
      ticketId: result.ticketId,
    });
    return result;
  } catch (err) {
    await markInboundMessageFailed(messageId, (err as Error).message);
    throw err;
  }
}

export function buildCgovStructuredTicketBody(
  parsed: ParsedCgovInboundEmail,
  payload: InboundEmailPayload,
  attachments: string[],
  isPriority: boolean,
): Record<string, unknown> {
  const assunto = String(parsed.assunto || '').trim() || 'Demanda Consumidor.Gov';
  const descricao = String(parsed.descricao || '').trim();
  const telefone = parsed.telefone ? [parsed.telefone] : [];

  return {
    title: assunto,
    chamadoTitulo: assunto,
    description: descricao,
    text: descricao,
    status: 'novo',
    priority: isPriority ? 'alta' : 'media',
    clientName: parsed.nome,
    clientCPF: parsed.cpf,
    attachments,
    messageOrigin: 'cliente',
    sender: 'them',
    lateralForm: {
      canal: 'Consumidor.Gov',
      classificacaoTipo: 'Reclamação',
      tipoChamado: 'Reclamação',
      produto: parsed.area || 'Empréstimo',
      motivo: parsed.problema || assunto,
      detalhe: descricao.slice(0, 500),
      clienteCpf: parsed.cpf,
      cpf: parsed.cpf,
      clienteNome: parsed.nome,
      clienteEmail: parsed.email ? [parsed.email] : [],
      clienteTelefone: telefone,
      consumidorGov: {
        protocoloGov: parsed.protocolo,
        idDemanda: parsed.protocolo,
        assunto,
        descricao,
        consumidor: parsed.nome,
        cpf: parsed.cpf,
        motivo: parsed.problema,
        produto: parsed.area,
        orgaoGov: 'Consumidor.gov.br',
        cidade: parsed.cidade,
        uf: parsed.uf,
        prazoLegal: parsed.prazoIso,
        dataDemanda: parsed.dataAberturaIso,
        statusGov: 'nao-respondida',
      },
    },
    emailInboundMeta: {
      emailFrom: payload.from.email,
      emailSubject: payload.subject,
    },
  };
}

export function buildBacenStructuredTicketBody(
  parsed: ParsedBacenRdrInboundEmail,
  payload: InboundEmailPayload,
  attachments: string[],
  isPriority: boolean,
): Record<string, unknown> {
  const assunto = String(parsed.assunto || '').trim() || 'Demanda Bacen RDR';
  const descricao = String(parsed.descricao || '').trim();
  const telefone = parsed.telefone ? [parsed.telefone] : [];
  const dataDemanda = parsed.dataDemandaIso || new Date().toISOString();
  // Prazo real vem do assunto do e-mail (ex.: "Prazo: 06/08/2026"); só cai no cálculo de
  // +10 dias corridos quando o e-mail não trouxer essa informação.
  const prazoLegal = parsed.prazoIso || addDaysIso(dataDemanda, 10);

  return {
    title: assunto,
    chamadoTitulo: assunto,
    description: descricao,
    text: descricao,
    status: 'novo',
    priority: isPriority ? 'alta' : 'media',
    clientName: parsed.nome,
    clientCPF: parsed.cpf,
    attachments,
    messageOrigin: 'cliente',
    sender: 'them',
    lateralForm: {
      canal: 'Bacen',
      classificacaoTipo: parsed.tipo || 'Reclamação',
      tipoChamado: parsed.tipo || 'Reclamação',
      produto: 'Empréstimo',
      motivo: parsed.motivo || assunto,
      detalhe: descricao.slice(0, 500),
      clienteCpf: parsed.cpf,
      cpf: parsed.cpf,
      clienteNome: parsed.nome,
      clienteEmail: parsed.email ? [parsed.email] : [],
      clienteTelefone: telefone,
      bacen: {
        protocoloBacen: parsed.protocoloBacen,
        idDemanda: parsed.idDemanda,
        assunto,
        descricao,
        consumidor: parsed.nome,
        cpf: parsed.cpf,
        email: parsed.email,
        telefoneWhatsapp: parsed.telefone,
        motivo: parsed.motivo || assunto,
        produto: 'Empréstimo',
        tipo: parsed.tipo || 'Reclamação',
        orgaoBacen: 'Bacen — RDR',
        cidade: parsed.cidade,
        uf: parsed.uf,
        prazoLegal,
        dataDemanda,
        statusBc: 'nao-respondida',
        contrato: parsed.contrato || undefined,
        workflow: 'Tratativa Bacen',
        workflowAtivo: true,
      },
    },
    emailInboundMeta: {
      emailFrom: payload.from.email,
      emailSubject: payload.subject,
    },
  };
}

async function ensureStructuredBacenReclamacao(
  chamado: IChamadoN1,
  emailThreadRootId: string,
): Promise<void> {
  try {
    const signals = ['inbox_dedicada:bacen', 'bacenStructuredInbound'];
    const triagemBase = buildFastPathTriagem('bacen', signals);
    await upsertFromChamado(chamado, {
      ...triagemBase,
      signals,
      at: new Date().toISOString(),
    }, {
      origemEntrada: 'email-inbound-bacen-structured',
      inboxDedicada: true,
      emailThreadRootId,
    });
  } catch (err) {
    console.warn('[email-inbound] upsert reclamacao bacen fail-soft:', (err as Error).message);
  }
}

function buildInboundEspeciaisTicketBody(
  payload: InboundEmailPayload,
  channel: InboundEspeciaisChannel,
  bodyText: string,
  displayName: string,
  subject: string,
  attachments: string[],
  isPriority: boolean,
): Record<string, unknown> {
  const lateralBase = {
    clienteEmail: [payload.from.email],
    clienteNome: displayName,
    classificacaoTipo: 'Reclamação',
    motivo: subject,
    detalhe: bodyText.slice(0, 500),
  };

  if (channel === 'procon') {
    return {
      title: subject,
      chamadoTitulo: subject,
      description: bodyText,
      text: bodyText,
      status: 'novo',
      priority: isPriority ? 'alta' : 'media',
      clientName: displayName,
      attachments,
      messageOrigin: 'cliente',
      sender: 'them',
      lateralForm: {
        ...lateralBase,
        canal: 'Procon',
        procon: {
          assunto: subject,
          descricao: bodyText,
          consumidor: displayName,
          statusPc: 'nao-respondida',
        },
      },
    };
  }

  if (channel === 'bacen') {
    return {
      title: subject,
      chamadoTitulo: subject,
      description: bodyText,
      text: bodyText,
      status: 'novo',
      priority: isPriority ? 'alta' : 'media',
      clientName: displayName,
      attachments,
      messageOrigin: 'cliente',
      sender: 'them',
      lateralForm: {
        ...lateralBase,
        canal: 'Bacen',
        bacen: {
          assunto: subject,
          descricao: bodyText,
          consumidor: displayName,
          statusBc: 'nao-respondida',
          orgaoBacen: 'Bacen — RDR',
        },
      },
    };
  }

  return {
    title: subject,
    chamadoTitulo: subject,
    description: bodyText,
    text: bodyText,
    status: 'novo',
    priority: isPriority ? 'alta' : 'media',
    clientName: displayName,
    attachments,
    messageOrigin: 'cliente',
    sender: 'them',
    lateralForm: {
      ...lateralBase,
      canal: 'Consumidor.Gov',
      consumidorGov: {
        assunto: subject,
        descricao: bodyText,
        consumidor: displayName,
        statusGov: 'nao-respondida',
      },
    },
  };
}

async function runInboundEmailFlow(
  payload: InboundEmailPayload,
  messageId: string,
  isPriority: boolean,
): Promise<InboundEmailProcessResult> {
  const duplicate = await findChamadoByEmailMessageId(messageId);
  if (duplicate) {
    return {
      action: 'duplicate',
      chamadoProtocolo: duplicate.chamadoProtocolo,
      ticketId: duplicate._id.toString(),
    };
  }

  let existing = await findChamadoForEmailReply(payload);
  if (existing && isFusaoAbsorvidoChamado(existing) && existing.fusao?.parentId) {
    // Ticket encontrado já foi mesclado (fusão) — toda correspondência futura sobre esse
    // protocolo vai para o ticket ativo (pai). Sem isso, o reply reabre o absorvido, que
    // fica escondido pra sempre em todas as filas/buscas (excludeFusaoAbsorvidosFilter).
    const parent = await ChamadoN1.findById(existing.fusao.parentId);
    if (parent) existing = parent;
  }
  retainOnlyNewAttachments(payload, existing);
  dropBrandInlineAttachments(payload);

  const bodyText = appendAttachmentReferencesToBody(resolveEmailBodyForPersist(payload), payload);

  const bacenParsed = isBacenRdrStructuredInboundEmail(payload, bodyText)
    ? parseBacenRdrInboundEmail(bodyText, payload.subject)
    : null;
  const bacenStructured = Boolean(bacenParsed?.isValid());

  const cgovParsed = !bacenStructured && isCgovStructuredInboundEmail(payload, bodyText)
    ? parseConsumidorGovInboundEmail(bodyText, payload.subject)
    : null;
  const cgovStructured = Boolean(cgovParsed?.isValid());

  if (bacenStructured && bacenParsed?.idDemanda) {
    const duplicateByBacen = await findChamadoByBacenIdDemanda(bacenParsed.idDemanda);
    if (duplicateByBacen) {
      return {
        action: 'duplicate',
        chamadoProtocolo: duplicateByBacen.chamadoProtocolo,
        ticketId: duplicateByBacen._id.toString(),
      };
    }
  }

  if (cgovStructured && cgovParsed?.protocolo) {
    const duplicateByProtocol = await findChamadoByCgovProtocolo(cgovParsed.protocolo);
    if (duplicateByProtocol) {
      return {
        action: 'duplicate',
        chamadoProtocolo: duplicateByProtocol.chamadoProtocolo,
        ticketId: duplicateByProtocol._id.toString(),
      };
    }
  }

  const emailMeta = {
    ...buildEmailMetadados(payload),
    ...buildAttachmentMetadados(payload),
  };
  const attachments = attachmentUrls(payload);

  if (existing && !shouldSpawnNewTicketOnInbound(existing)) {
    const statusOverride = resolveInboundClientReplyStatus(existing);
    persistInboundEmailOnChamado(existing, payload, bodyText, attachments, emailMeta, statusOverride);
    const current = normalizeStatusValue(currentStatus(existing));
    if (statusOverride && statusOverride !== current) {
      appendStatusTransition(existing, statusOverride, {
        origin: 'cliente',
        autor: payload.from.name || payload.from.email,
        metadados: { trigger: 'email-inbound-reply' },
      });
    }
    existing.markModified('registro');
    await existing.save();
    void publishTicketEvent(existing._id.toString(), 'message');
    await ChamadoIaAnalise.updateOne(
      { chamadoId: existing._id, origem: { $ne: 'manual' } },
      { $set: { needsReanalysis: true } },
    );
    void runCasosEspeciaisTriagem(existing, { source: 'email-inbound-reply' }).catch((err: Error) => {
      console.warn('[email-inbound] triagem casos especiais fail-soft:', err.message);
    });
    return {
      action: 'replied',
      chamadoProtocolo: existing.chamadoProtocolo,
      ticketId: existing._id.toString(),
    };
  }

  const clienteRef = (cgovStructured || bacenStructured)
    ? null
    : await resolveClienteRefFromEmail(payload.from.email, payload.from.name);
  const subject = payload.subject.trim() || 'Atendimento por e-mail';
  const displayName = payload.from.name || payload.from.email.split('@')[0];
  const inboundRootId = normalizeMessageId(payload.messageId);
  let canalProvavel = classifyInboundEspeciaisChannel(payload);
  if (bacenStructured) {
    canalProvavel = 'bacen';
  } else if (cgovStructured) {
    canalProvavel = 'consumidor-gov';
  }

  const ticketBody: Record<string, unknown> = bacenStructured && bacenParsed
    ? buildBacenStructuredTicketBody(bacenParsed, payload, attachments, isPriority)
    : cgovStructured && cgovParsed
      ? buildCgovStructuredTicketBody(cgovParsed, payload, attachments, isPriority)
      : canalProvavel
      ? buildInboundEspeciaisTicketBody(
        payload,
        canalProvavel,
        bodyText,
        displayName,
        subject,
        attachments,
        isPriority,
      )
      : {
        title: subject,
        chamadoTitulo: subject,
        description: bodyText,
        text: bodyText,
        status: 'novo',
        priority: isPriority ? 'alta' : 'media',
        clientName: displayName,
        attachments,
        lateralForm: {
          clienteEmail: [payload.from.email],
          clienteEmailResposta: payload.from.email,
          clienteNome: displayName,
          canal: 'E-mail',
          classificacaoTipo: 'Solicitação',
          motivo: subject,
          detalhe: bodyText.slice(0, 500),
        },
      };

  if (!cgovStructured && !bacenStructured) {
    if (clienteRef?.clienteId) ticketBody.clienteId = clienteRef.clienteId.toString();
    if (clienteRef?.clienteCpf) ticketBody.clientCPF = clienteRef.clienteCpf;
  }

  const partial = await createChamadoFromBody(ticketBody, 'novo');
  if (partial.registro?.[0]) {
    partial.registro[0].origin = 'cliente';
    if (bacenStructured && bacenParsed) {
      partial.registro[0].autor = bacenParsed.nome;
      if (bacenParsed.dataDemandaIso) {
        partial.registro[0].data = new Date(bacenParsed.dataDemandaIso);
      }
    } else if (cgovStructured && cgovParsed) {
      partial.registro[0].autor = cgovParsed.nome;
      if (cgovParsed.dataAberturaIso) {
        partial.registro[0].data = new Date(cgovParsed.dataAberturaIso);
      }
    } else {
      partial.registro[0].autor = displayName;
    }
    partial.registro[0].metadados = {
      ...(partial.registro[0].metadados ?? {}),
      ...emailMeta,
      source: 'email-inbound',
      emailInbound: true,
      emailThreadRootId: inboundRootId,
      ...(canalProvavel ? { canalProvavel, inboxDedicada: true } : {}),
      ...(bacenStructured ? { bacenStructuredInbound: true } : {}),
      ...(cgovStructured ? { cgovStructuredInbound: true } : {}),
      ...(isPriority ? { mailPriority: 'alta' } : {}),
    };
    partial.registro[0].alteracoes = partial.registro[0].alteracoes ?? [];
  }

  if (existing) {
    prependInboundDerivedTicketNote(partial, existing.chamadoProtocolo, 'novo');
    if (existing.cliente?.length && (!partial.cliente || partial.cliente.length === 0)) {
      partial.cliente = existing.cliente;
    }
  }

  if (!cgovStructured && !bacenStructured && clienteRef && (!partial.cliente || partial.cliente.length === 0)) {
    partial.cliente = [clienteRef];
  }

  await applyAssignmentIfNeeded(partial, {
    source: 'email-inbound',
    canal: canalProvavel === 'procon'
      ? 'Procon'
      : canalProvavel === 'consumidor-gov'
        ? 'Consumidor.Gov'
        : canalProvavel === 'bacen'
          ? 'Bacen'
          : 'E-mail',
  });

  const chamado = await ChamadoN1.create(partial);
  await notifyTicketOpenedAsync(chamado, payload.from.email);

  if (bacenStructured) {
    await ensureStructuredBacenReclamacao(chamado, inboundRootId);
  }

  void runInboundPostCreateHooks(chamado, { source: 'email-inbound' }).catch((err: Error) => {
    console.warn('[email-inbound] hooks inbound fail-soft:', err.message);
  });

  return {
    action: 'created',
    chamadoProtocolo: chamado.chamadoProtocolo,
    ticketId: chamado._id.toString(),
  };
}

export function isAllowedRecipient(payload: InboundEmailPayload, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const allowedSet = new Set(allowed.map((item) => normalizeEmail(item)));
  return payload.to.some((item) => allowedSet.has(normalizeEmail(item)));
}
