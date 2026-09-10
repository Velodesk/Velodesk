/** emailNotification.service v2.3.0 — log estruturado de disparo outbound */
import type { IChamadoN1 } from '../models/ChamadoN1';
import { loadDadosForRef, normalizeEmail } from './cliente.service';
import { sendOutboundEmail } from './email-outbound.service';
import { blockQaOutboundEmail } from './qaEmailGuard.service';
import { composeHtmlToEmailHtml, htmlToPlainTextForEmail } from './emailHtml.util';
import { extractComposeInlineImages } from './composeInlineImages.util';
import { assembleClientEmail } from './emailSkeleton.service';
import { evaluateEmailTriggers } from './emailTrigger.service';
import {
  buildOutboundMessageId,
  buildOutboundThreadHeaders,
  buildThreadSubject,
  persistOutboundEmailMeta,
} from './emailThread.service';
import { loadSentAttachmentsForEmail } from './sentAttachmentStorage.service';
import type { GmailInlineImage } from './gmail/gmailApiSend';

export async function resolveClienteEmailFromChamado(chamado: IChamadoN1): Promise<string | null> {
  const ref = chamado.cliente?.[0];
  if (ref) {
    const dados = await loadDadosForRef(ref);
    const lista = dados?.clienteEmail?.lista ?? [];
    const resposta = normalizeEmail(dados?.clienteEmail?.resposta);
    if (resposta && lista.some((item) => normalizeEmail(item) === resposta)) {
      return resposta;
    }
    const email = lista[0];
    if (email?.includes('@')) return email.trim().toLowerCase();
  }

  for (const reg of chamado.registro ?? []) {
    const meta = (reg.metadados ?? {}) as Record<string, unknown>;
    const from = String(meta.emailFrom ?? '').trim().toLowerCase();
    if (from.includes('@')) return from;
  }

  return null;
}

export async function sendTicketOpenedEmail(
  chamado: IChamadoN1,
  _clienteEmail?: string,
  _registroIndex = 0,
): Promise<void> {
  await evaluateEmailTriggers(chamado, 'event');
}

export async function sendAgentReplyEmail(
  chamado: IChamadoN1,
  messageText: string,
  clienteEmail?: string,
  registroIndex?: number,
  attachmentUrls: string[] = [],
): Promise<void> {
  const to = clienteEmail ?? (await resolveClienteEmailFromChamado(chamado));
  const publicText = String(messageText ?? '').trim();
  const safeAttachmentUrls = (attachmentUrls || [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (!to || (!publicText && !safeAttachmentUrls.length)) return;

  const protocolo = chamado.chamadoProtocolo;
  const subject = buildThreadSubject(protocolo);
  const { html: htmlWithCids, inlineImages: composeInline } = extractComposeInlineImages(publicText);
  const messageHtml = publicText
    ? composeHtmlToEmailHtml(htmlWithCids)
    : '<p>Segue(m) anexo(s) referente(s) ao seu chamado.</p>';

  const assembled = await assembleClientEmail({
    mode: 'agent',
    chamado,
    corpo: messageHtml,
    corpoAlreadyHtml: true,
  });

  const seen = new Set((assembled.inlineImages || []).map((item) => item.cid));
  const inlineImages: GmailInlineImage[] = [
    ...(assembled.inlineImages || []),
    ...composeInline.filter((item) => {
      if (seen.has(item.cid)) return false;
      seen.add(item.cid);
      return true;
    }),
  ];

  const messageId = buildOutboundMessageId(protocolo);
  const headers = buildOutboundThreadHeaders(chamado, messageId);
  const emailAttachments = await loadSentAttachmentsForEmail(safeAttachmentUrls);

  const sentAt = new Date();
  // Trava de QA: ticket de teste nunca envia e-mail para fora da lista segura.
  const bloqueioQa = blockQaOutboundEmail(chamado, to);
  if (bloqueioQa) {
    console.warn('[emailNotification] envio bloqueado pela trava de QA:', bloqueioQa);
    return;
  }

  const result = await sendOutboundEmail({
    to,
    subject,
    text: publicText
      ? `${htmlToPlainTextForEmail(publicText)}\n\n${assembled.text}`
      : assembled.text,
    html: assembled.html,
    headers,
    attachments: emailAttachments,
    inlineImages,
  });

  if (!result.sent) {
    console.warn('[emailNotification] resposta agente não enviada:', {
      protocolo,
      to,
      messageId,
      reason: result.reason,
    });
    return;
  }

  console.info('[emailNotification] resposta agente enviada', {
    protocolo,
    to,
    messageId,
    sentAt: sentAt.toISOString(),
    attachmentCount: emailAttachments.length,
    registroIndex: registroIndex ?? null,
  });

  persistOutboundEmailMeta(chamado, messageId, registroIndex);
  await chamado.save();
}

function findFirstPublicAgentMessage(chamado: IChamadoN1): { text: string; registroIndex: number } | null {
  for (let i = 0; i < (chamado.registro ?? []).length; i += 1) {
    const reg = chamado.registro![i];
    if (String(reg.origin ?? '').trim().toLowerCase() !== 'agente') continue;
    const text = String(reg.mensagemPublica ?? '').trim();
    if (text) return { text, registroIndex: i };
  }
  return null;
}

/** Ticket criado só com nota interna do agente — não notificar solicitante. */
function chamadoCreatedHasPublicClientMessage(chamado: IChamadoN1): boolean {
  for (const reg of chamado.registro ?? []) {
    const pub = String(reg.mensagemPublica ?? '').trim();
    const pubAttachments = (reg.anexosMensagemPublica ?? []).length;
    if (pub || pubAttachments) return true;
  }
  return false;
}

/** Criação de ticket: envia a 1ª mensagem pública do agente ou dispara e-mails padrão. */
export async function notifyChamadoCreatedAsync(
  chamado: IChamadoN1,
  clienteEmail?: string,
): Promise<void> {
  try {
    if (!chamadoCreatedHasPublicClientMessage(chamado)) {
      return;
    }
    const firstAgentPublic = findFirstPublicAgentMessage(chamado);
    if (firstAgentPublic) {
      const reg = chamado.registro?.[firstAgentPublic.registroIndex];
      const attachmentUrls = (reg?.anexosMensagemPublica ?? [])
        .map((item) => String(item ?? '').trim())
        .filter(Boolean);
      await sendAgentReplyEmail(
        chamado,
        firstAgentPublic.text,
        clienteEmail,
        firstAgentPublic.registroIndex,
        attachmentUrls,
      );
    } else {
      await sendTicketOpenedEmail(chamado, clienteEmail, 0);
    }
    await chamado.save();
  } catch (err) {
    console.warn('[emailNotification] notifyChamadoCreated:', (err as Error).message);
  }
}

/** Fail-soft: não propaga erro */
export async function notifyTicketOpenedAsync(chamado: IChamadoN1, clienteEmail?: string): Promise<void> {
  try {
    await sendTicketOpenedEmail(chamado, clienteEmail);
    await chamado.save();
  } catch (err) {
    console.warn('[emailNotification] notifyTicketOpened:', (err as Error).message);
  }
}

export async function notifyAgentReplyAsync(
  chamado: IChamadoN1,
  messageText: string,
  clienteEmail?: string,
  registroIndex?: number,
  attachmentUrls: string[] = [],
): Promise<void> {
  try {
    await sendAgentReplyEmail(
      chamado,
      messageText,
      clienteEmail,
      registroIndex,
      attachmentUrls,
    );
  } catch (err) {
    console.warn('[emailNotification] notifyAgentReply:', (err as Error).message);
  }
}
