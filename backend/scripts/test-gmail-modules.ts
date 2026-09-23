/** test-gmail-modules.ts v1.1.0 — smoke test Gmail + HTML e-mail */
import { buildProtocolSubject } from '../src/services/email-outbound.service';
import { buildRawRfc822 } from '../src/services/gmail/gmailApiSend';
import { buildNodemailerMessage } from '../src/services/gmail/smtpRelaySend';
import { decodePubSubMessage } from '../src/services/gmail/gmailInbound.service';
import { gmailMessageToInboundPayload, shouldSkipGmailMessage } from '../src/services/gmail/gmailMessageParser';
import { composeHtmlToEmailHtml } from '../src/services/emailHtml.util';
import { buildThreadSubject } from '../src/services/emailThread.service';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testBuildProtocolSubject() {
  const s = buildProtocolSubject('0100177678', 'Duvida');
  assert(s === '[0100177678] Atendimento Velotax Numero 0100177678', `subject: ${s}`);
}

function testBuildRawRfc822() {
  const raw = buildRawRfc822({
    from: 'chamados@test.com',
    to: 'cliente@test.com',
    subject: 'Teste',
    html: '<p>oi</p>',
    messageId: '<desk.test@velotax.com.br>',
    inReplyTo: '<desk.root@velotax.com.br>',
    references: ['<desk.root@velotax.com.br>'],
  });
  assert(raw.length > 10, 'raw vazio');
  const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert(decoded.includes('Message-ID:'), 'Message-ID ausente');
  assert(decoded.includes('In-Reply-To:'), 'In-Reply-To ausente');
  assert(decoded.includes('References:'), 'References ausente');
}

function testSmtpMessageMapping() {
  const message = buildNodemailerMessage({
    from: 'chamados@test.com',
    to: 'cliente@test.com',
    subject: 'Teste',
    html: '<p>oi <img src="cid:logo@velodesk"></p>',
    messageId: '<desk.test@velotax.com.br>',
    inReplyTo: '<desk.root@velotax.com.br>',
    references: ['<desk.root@velotax.com.br>'],
    inlineImages: [
      { cid: 'logo@velodesk', filename: 'logo.png', contentType: 'image/png', buffer: Buffer.from('fake-png') },
    ],
    attachments: [
      { filename: 'anexo.pdf', contentType: 'application/pdf', buffer: Buffer.from('fake-pdf') },
    ],
  });

  assert(message.messageId === '<desk.test@velotax.com.br>', 'messageId ausente/errado');
  assert(message.inReplyTo === '<desk.root@velotax.com.br>', 'inReplyTo ausente/errado');
  assert(Array.isArray(message.references) && message.references.length === 1, 'references ausente/errado');

  const attachments = message.attachments as Array<{ cid?: string; filename?: string }>;
  assert(Array.isArray(attachments) && attachments.length === 2, 'attachments deveria ter 2 itens (inline + arquivo)');
  assert(attachments[0].cid === 'logo@velodesk', 'cid da imagem inline ausente/errado');
  assert(attachments[1].filename === 'anexo.pdf', 'filename do anexo ausente/errado');
}

function testComposeHtmlToEmailHtml() {
  const html = composeHtmlToEmailHtml('Olá <strong>negrito</strong> e <em>itálico</em>');
  assert(html.includes('<strong>negrito</strong>'), 'negrito perdido');
  assert(html.includes('<em>itálico</em>'), 'itálico perdido');
}

function testBuildThreadSubject() {
  const first = buildThreadSubject('0100177678', 'Dúvida', false);
  const reply = buildThreadSubject('0100177678', 'Dúvida', true);
  assert(first === '[0100177678] Atendimento Velotax Numero 0100177678', `first: ${first}`);
  assert(reply === 'Re: [0100177678] Atendimento Velotax Numero 0100177678', `reply: ${reply}`);
}

function testDecodePubSub() {
  const payload = { emailAddress: 'a@b.com', historyId: '12345' };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const decoded = decodePubSubMessage({ message: { data } });
  assert(decoded?.historyId === '12345', 'decode falhou');
}

function testGmailMessageParser() {
  const skip = shouldSkipGmailMessage(
    { labelIds: ['SENT'], payload: { headers: [] } },
    'chamados@test.com'
  );
  assert(skip === true, 'deveria pular SENT');

  const payload = gmailMessageToInboundPayload({
    id: 'msg1',
    internalDate: String(Date.now()),
    payload: {
      headers: [
        { name: 'From', value: 'Cliente <cliente@test.com>' },
        { name: 'To', value: 'chamados@test.com' },
        { name: 'Subject', value: 'Ajuda' },
        { name: 'Message-Id', value: '<abc@test.com>' },
      ],
      mimeType: 'text/plain',
      body: { data: Buffer.from('Preciso de ajuda').toString('base64') },
    },
  });
  assert(payload?.from.email === 'cliente@test.com', 'from parse');
  assert(payload?.textBody.includes('ajuda'), 'body parse');
}

function main() {
  testBuildProtocolSubject();
  testBuildRawRfc822();
  testSmtpMessageMapping();
  testComposeHtmlToEmailHtml();
  testBuildThreadSubject();
  testDecodePubSub();
  testGmailMessageParser();
  console.log('OK — smoke tests Gmail modules');
}

main();
