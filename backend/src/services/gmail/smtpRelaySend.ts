/** smtpRelaySend v1.0.0 — envio via Google Workspace SMTP Relay (smtp-relay.gmail.com) com XOAUTH2 */
import { google } from 'googleapis';
import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type { GmailAuthParams, GmailSendParams } from './gmailApiSend';

const SMTP_RELAY_HOST = process.env.SMTP_RELAY_HOST || 'smtp-relay.gmail.com';
const SMTP_RELAY_PORT = Number(process.env.SMTP_RELAY_PORT || 587);
const SMTP_RELAY_SCOPE = 'https://mail.google.com/';

async function mintSmtpRelayAccessToken(authParams: GmailAuthParams): Promise<string> {
  const { serviceAccountJson, delegatedUserEmail } = authParams;
  const auth = new google.auth.JWT({
    email: serviceAccountJson.client_email,
    key: serviceAccountJson.private_key,
    scopes: [SMTP_RELAY_SCOPE],
    subject: delegatedUserEmail,
  });
  const { token } = await auth.getAccessToken();
  if (!token) {
    throw new Error('Falha ao obter access token OAuth2 para SMTP Relay');
  }
  return token;
}

async function buildSmtpTransport(authParams: GmailAuthParams): Promise<Transporter> {
  const accessToken = await mintSmtpRelayAccessToken(authParams);
  return nodemailer.createTransport({
    host: SMTP_RELAY_HOST,
    port: SMTP_RELAY_PORT,
    secure: false,
    requireTLS: true,
    auth: {
      type: 'OAuth2',
      user: authParams.delegatedUserEmail,
      accessToken,
    },
  });
}

/** Mapeamento puro (sem rede) — usado no envio real e em teste de smoke sem credenciais. */
export function buildNodemailerMessage(mail: GmailSendParams): Mail.Options {
  const inlineImages = (mail.inlineImages || []).filter((item) => item.buffer?.length);
  const attachments = (mail.attachments || []).filter((item) => item.buffer?.length);

  const mappedAttachments: Mail.Attachment[] = [
    ...inlineImages.map((image) => ({
      cid: image.cid,
      filename: image.filename,
      contentType: image.contentType,
      content: image.buffer,
    })),
    ...attachments.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      content: attachment.buffer,
    })),
  ];

  return {
    from: String(mail.from || '').trim(),
    to: String(mail.to || '').trim(),
    subject: String(mail.subject || '').trim(),
    html: mail.html || '',
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    attachments: mappedAttachments.length ? mappedAttachments : undefined,
  };
}

export async function sendViaSmtpRelay(
  authParams: GmailAuthParams,
  mail: GmailSendParams
): Promise<{ success: true }> {
  const { serviceAccountJson } = authParams;
  if (!serviceAccountJson?.client_email || !serviceAccountJson?.private_key) {
    throw new Error('serviceAccountJson inválido (client_email / private_key ausentes)');
  }

  const transport = await buildSmtpTransport(authParams);
  try {
    await transport.sendMail(buildNodemailerMessage(mail));
  } finally {
    transport.close();
  }

  return { success: true };
}
