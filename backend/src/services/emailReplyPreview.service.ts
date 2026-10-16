/**
 * emailReplyPreview.service v1.0.0 — prévia do e-mail que o cliente recebe para uma resposta do
 * agente: mesmo caminho do envio real (sendAgentReplyEmail → assembleClientEmail, modo 'agent'),
 * com logo/assinatura trocadas de cid: para data: para renderizar no navegador. Não envia nada.
 */
import type { IChamadoN1 } from '../models/ChamadoN1';
import { env } from '../config/env';
import { composeHtmlToEmailHtml } from './emailHtml.util';
import { assembleClientEmail } from './emailSkeleton.service';
import { buildThreadSubject } from './emailThread.service';
import { resolveClienteEmailFromChamado } from './emailNotification.service';

export interface EmailReplyPreview {
  html: string;
  subject: string;
  to: string;
  from: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function buildAgentReplyEmailPreview(
  chamado: IChamadoN1,
  messageText: string,
  hasAttachments = false,
): Promise<EmailReplyPreview> {
  const publicText = String(messageText ?? '').trim();
  // Imagens coladas no texto ficam como data: — no envio real viram cid:, mas o resultado visual é o mesmo.
  const messageHtml = publicText
    ? composeHtmlToEmailHtml(publicText)
    : (hasAttachments ? '<p>Segue(m) anexo(s) referente(s) ao seu chamado.</p>' : '');

  const assembled = await assembleClientEmail({
    mode: 'agent',
    chamado,
    corpo: messageHtml,
    corpoAlreadyHtml: true,
  });

  let html = assembled.html;
  for (const img of assembled.inlineImages || []) {
    if (!img?.cid || !img.buffer) continue;
    const dataUrl = `data:${img.contentType};base64,${img.buffer.toString('base64')}`;
    html = html.replace(new RegExp(`cid:${escapeRegExp(img.cid)}`, 'g'), dataUrl);
  }

  return {
    html,
    subject: buildThreadSubject(chamado.chamadoProtocolo),
    to: (await resolveClienteEmailFromChamado(chamado)) || '',
    from: env.emailFrom || '',
  };
}
