/** smtpRelaySend v1.0.0 — envio via Google Workspace SMTP Relay (smtp-relay.gmail.com) */
import { google } from 'googleapis';
import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type { GmailAuthParams, GmailSendParams } from './gmailApiSend';

export type { GmailAuthParams, GmailSendParams } from './gmailApiSend';

const SMTP_RELAY_HOST = process.env.SMTP_RELAY_HOST || 'smtp-relay.gmail.com';
const SMTP_RELAY_PORT = Number(process.env.SMTP_RELAY_PORT || 587);
// EHLO precisa de um FQDN válido — o relay do Google rejeita com 421-4.7.0
// "Try again later" se receber um hostname não qualificado (ex.: hostname
// interno do container/máquina).
const SMTP_EHLO_NAME = process.env.SMTP_RELAY_EHLO_NAME || 'velodesk.velotax.com.br';

// Escopo mais amplo que o `gmail.send` da API — necessário pro SMTP AUTH via XOAUTH2.
const SMTP_RELAY_SCOPE = 'https://mail.google.com/';

async function mintSmtpRelayAccessToken(authParams: GmailAuthParams): Promise<string> {
  const { serviceAccountJson, delegatedUserEmail } = authParams;
  const auth = new google.auth.JWT({
    email: serviceAccountJson.client_email,
    key: serviceAccountJson.private_key,
    scopes: [SMTP_RELAY_SCOPE],
    subject: delegatedUserEmail,
  });
  const { token } = await auth.authorize().then(() => auth.getAccessToken());
  if (!token) {
    throw new Error('Falha ao obter access token XOAUTH2 para SMTP relay');
  }
  return token;
}

function buildSmtpTransport(authParams: GmailAuthParams, accessToken: string): Transporter {
  return nodemailer.createTransport({
    host: SMTP_RELAY_HOST,
    port: SMTP_RELAY_PORT,
    secure: false,
    requireTLS: true,
    name: SMTP_EHLO_NAME,
    auth: {
      type: 'OAuth2',
      user: authParams.delegatedUserEmail,
      accessToken,
    },
  });
}

/** Mapeamento puro (sem rede) — GmailSendParams para as opções do nodemailer. */
export function buildNodemailerMessage(mail: GmailSendParams): Mail.Options {
  const attachments: Mail.Options['attachments'] = [];

  for (const image of mail.inlineImages || []) {
    if (!image.buffer?.length) continue;
    attachments.push({
      filename: image.filename,
      content: image.buffer,
      contentType: image.contentType,
      cid: image.cid,
    });
  }

  for (const file of mail.attachments || []) {
    if (!file.buffer?.length) continue;
    attachments.push({
      filename: file.filename,
      content: file.buffer,
      contentType: file.contentType,
    });
  }

  return {
    from: mail.from,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    attachments: attachments.length ? attachments : undefined,
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

  const accessToken = await mintSmtpRelayAccessToken(authParams);
  const transport = buildSmtpTransport(authParams, accessToken);

  try {
    await transport.sendMail(buildNodemailerMessage(mail));
  } finally {
    transport.close();
  }

  return { success: true };
}
