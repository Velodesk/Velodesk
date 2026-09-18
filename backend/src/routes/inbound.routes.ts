/** inbound.routes v1.9.0 — GET outbound-media para Twilio buscar anexo do agente */
import { Router, Request, Response } from 'express';
import path from 'path';
import multer from 'multer';
import { env } from '../config/env';
import { inboundAppAuthMiddleware, inboundB2cTelephonyAuthMiddleware, inboundEmailAuthMiddleware, inboundTelephonyAuthMiddleware } from '../middleware/inboundAuth';
import { inboundTicketAuthMiddleware } from '../middleware/inboundTicketAuth';
import { twilioWebhookAuthMiddleware } from '../middleware/twilioWebhookAuth';
import {
  buildInboundTwimlReply,
  getWhatsAppInboundHealth,
  parseTwilioWhatsAppWebhook,
  processInboundWhatsAppMessage,
  WHATSAPP_NO_TICKET_REPLY_TEXT,
} from '../services/twilio/whatsappInbound.service';
import {
  parseTwilioMessageStatusWebhook,
  processWhatsAppMessageStatusCallback,
} from '../services/twilio/whatsappStatusCallback.service';
import { processAppNotify } from '../services/app-inbound.service';
import { isAllowedRecipient, processInboundEmail } from '../services/email-inbound.service';
import { parseInboundEmailPayload } from '../services/inbound-email/adapters';
import { handleGmailPubSubPush } from '../services/gmail/gmailInbound.service';
import { getGmailWatchHealth } from '../services/gmail/gmailWatch.service';
import { isEmailTransportReady } from '../services/emailTransport.service';
import {
  getInboundTelephonyRecados,
  processInboundTelephonyCall,
} from '../services/telephony-inbound/telephonyInbound.service';
import { parseTelecom55B2cPayload } from '../services/telephony-inbound/adapters/telecom55B2c.adapter';
import { getQaSentinelaEstadoModel } from '../models/QaSentinelaEstado';
import { getQaSentinelaRunModel } from '../models/QaSentinelaRun';
import {
  createTicketFromTelecom55B2cCall,
  shouldCreateTicketFromTelecom55B2cEvent,
} from '../services/telecom55B2cTicket.service';
import { countActiveRecados, getRecadosEnvelopeUpdatedAt, migrateLegacyRecadosIfNeeded } from '../services/telephonyRecado.service';
import {
  getTelecom55WebhookHealth,
  isTelecom55WebhookAuthorized,
  processTelecom55Webhook,
} from '../services/realtime/telecom55/webhook.service';
import { isRealtimeSupabaseConfigured } from '../config/supabaseRealtime';
import { processInboundTicket } from '../services/inbound-ticket/inboundTicket.service';
import { getClientTicketHistory, listClientTicketsForApp } from '../services/inbound-ticket/inboundTicketRead.service';
import { listProdutos } from '../services/tabulation.service';
import { ORIGIN_CANAL_CONFIG } from '../services/inbound-ticket/types';
import {
  buildWhatsAppOutboundMediaPublicUrlFromApiUrl,
  TOKEN_TTL_MS as SIGNED_ATTACHMENT_TOKEN_TTL_MS,
  verifyWhatsAppOutboundMediaToken,
} from '../services/twilio/whatsappOutboundMedia.util';
import { openSentAttachment } from '../services/sentAttachmentStorage.service';
const router = Router();
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },
});

router.get('/email/health', (_req, res: Response) => {
  res.json({
    status: 'ok',
    enabled: env.inboundEmailEnabled,
    provider: env.inboundEmailProvider,
    emailTransportReady: isEmailTransportReady(),
  });
});

router.get('/gmail/health', async (_req, res: Response) => {
  try {
    const watch = await getGmailWatchHealth();
    res.json({ status: 'ok', ...watch });
  } catch (err) {
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

router.post(
  '/email',
  upload.any(),
  inboundEmailAuthMiddleware,
  async (req, res: Response) => {
    try {
      const payload = parseInboundEmailPayload(req.body as Record<string, unknown>);

      if (!payload.from.email) {
        return res.status(400).json({ message: 'Remetente inválido' });
      }

      if (!isAllowedRecipient(payload, env.inboundEmailAllowedRecipients)) {
        return res.status(403).json({ message: 'Destinatário não autorizado' });
      }

      const result = await processInboundEmail(payload);
      const statusCode = result.action === 'created' ? 201 : 200;
      return res.status(statusCode).json(result);
    } catch (err) {
      console.error('[inbound/email]', err);
      return res.status(500).json({ message: 'Falha ao processar e-mail inbound' });
    }
  }
);

router.post('/gmail/pubsub', async (req: Request, res: Response) => {
  if (!env.gmailInboundEnabled) {
    return res.status(503).json({ message: 'Gmail inbound desabilitado' });
  }

  const token = String(req.query.token ?? '').trim();
  if (env.gmailPubsubVerifyToken && token !== env.gmailPubsubVerifyToken) {
    return res.status(401).json({ message: 'Token Pub/Sub inválido' });
  }

  try {
    const { processed, results, hasMore } = await handleGmailPubSubPush(req.body);

    if (hasMore) {
      console.info('[inbound/gmail/pubsub] backlog parcial — aguardando retry Pub/Sub', { processed });
      return res.status(503).json({
        ok: false,
        partial: true,
        processed,
        message: 'Backlog parcial — Pub/Sub reentregará para continuar',
      });
    }

    return res.status(200).json({ ok: true, processed, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[inbound/gmail/pubsub]', err);

    // Instância ainda subindo: 503 faz o Pub/Sub reentregar em vez de descartar a notificação
    if (/desk_config|MongoDB|indispon/i.test(message)) {
      return res.status(503).json({ ok: false, retry: true, message });
    }

    return res.status(500).json({ message: 'Falha ao processar notificação Gmail' });
  }
});

/** Telefonia IA — health check para parceira (sem autenticação) */
router.get('/telephony/health', async (_req, res: Response) => {
  const activeRecados = await countActiveRecados();
  const lastRecadoUpdate = await getRecadosEnvelopeUpdatedAt();
  res.json({
    status: 'ok',
    enabled: env.inboundTelephonyEnabled,
    apiVersion: '1.0.0',
    recadosSchemaVersion: '2.0',
    activeRecados,
    lastRecadoUpdate,
  });
});

router.post('/telephony/calls', inboundTelephonyAuthMiddleware, async (req, res: Response) => {
  try {
    const result = await processInboundTelephonyCall(req.body as Record<string, unknown>);
    const statusCode = result.action === 'created' ? 201 : 200;
    return res.status(statusCode).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/obrigatório|Informe/i.test(message)) {
      return res.status(400).json({ message });
    }
    console.error('[inbound/telephony/calls]', err);
    return res.status(500).json({ message: 'Falha ao processar ligação inbound' });
  }
});

router.get('/telephony/recados', inboundTelephonyAuthMiddleware, async (_req, res: Response) => {
  try {
    await migrateLegacyRecadosIfNeeded();
    const result = await getInboundTelephonyRecados();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json(result);
  } catch (err) {
    console.error('[inbound/telephony/recados]', err);
    return res.status(500).json({ message: 'Falha ao carregar recados ativos' });
  }
});

/**
 * Webhook 55PBX (call center humano) — abertura de ticket quando a ligação entra no
 * ramal de um atendente. Distinto de /telephony/calls (Contact Tel) e de /telecom55
 * (painel ao vivo via Supabase, não mexer). Contrato de resposta pedido pela 55: 200
 * sempre que o evento é aceito/processado ou filtrado (nunca gera ticket sozinho e não
 * deve reentrar em retry), 400 só pra body ausente/inválido, 500 pra falha interna.
 */
router.post('/telephony/inbound_b2c', inboundB2cTelephonyAuthMiddleware, async (req, res: Response) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ message: 'Body inválido' });
  }

  try {
    const event = parseTelecom55B2cPayload(body as Record<string, unknown>);
    if (!shouldCreateTicketFromTelecom55B2cEvent(event)) {
      return res.status(200).json({ status: 'Success' });
    }

    const result = await createTicketFromTelecom55B2cCall(event);
    console.info('[inbound/telephony/inbound_b2c] ticket criado', result);
    return res.status(200).json({ status: 'Success' });
  } catch (err) {
    console.error('[inbound/telephony/inbound_b2c]', err);
    return res.status(500).json({ message: 'Falha ao processar evento da 55' });
  }
});

/** WhatsApp Twilio — health (sem autenticação) */
router.get('/whatsapp/health', (req: Request, res: Response) => {
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol);
  const host = String(req.headers['x-forwarded-host'] ?? req.get('host') ?? 'localhost:8001');
  const baseUrl = `${proto}://${host}`;
  res.json(getWhatsAppInboundHealth(baseUrl));
});

/** URL pública temporária — Twilio baixa mídia outbound enviada pelo agente no Desk. */
router.get('/whatsapp/outbound-media/:token', async (req: Request, res: Response) => {
  const verified = verifyWhatsAppOutboundMediaToken(String(req.params.token ?? ''));
  if (!verified) {
    return res.status(404).json({ message: 'Mídia indisponível ou expirada' });
  }
  try {
    const storageKey = verified.storageKey.replace(/\//g, '__');
    const opened = await openSentAttachment(storageKey);
    if (!opened) {
      return res.status(404).json({ message: 'Anexo não encontrado' });
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (opened.contentType) res.setHeader('Content-Type', opened.contentType);
    if (opened.source === 'disk' && opened.filePath) {
      return res.sendFile(path.resolve(opened.filePath));
    }
    if (opened.stream) {
      opened.stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ message: 'Falha ao ler anexo' });
      });
      return opened.stream.pipe(res);
    }
    return res.status(404).json({ message: 'Anexo não encontrado' });
  } catch {
    return res.status(404).json({ message: 'Anexo não encontrado' });
  }
});

/**
 * WhatsApp Twilio — webhook inbound. Anexa ao ticket reabrível existente (auto-reply só se
 * TWILIO_WHATSAPP_AUTO_REPLY definido); sem ticket reabrível, não cria ticket — responde com
 * a orientação padrão (WHATSAPP_NO_TICKET_REPLY_TEXT) pra abrir contato por telefone ou app.
 */
router.post('/whatsapp/messages', twilioWebhookAuthMiddleware, async (req, res: Response) => {
  try {
    const payload = parseTwilioWhatsAppWebhook(req.body as Record<string, unknown>);
    if (!payload.messageSid) {
      return res.status(400).type('text/plain').send('MessageSid ausente');
    }

    const outcome = await processInboundWhatsAppMessage(payload);

    return res
      .status(200)
      .type('text/xml')
      .send(buildInboundTwimlReply(outcome === 'rejected_no_ticket' ? WHATSAPP_NO_TICKET_REPLY_TEXT : undefined));
  } catch (err) {
    console.error('[inbound/whatsapp/messages]', err);
    return res.status(500).type('text/plain').send('Falha ao processar mensagem WhatsApp');
  }
});

/** 55PBX — webhook de eventos em tempo real (telecom_webhook_events + telecom_live_calls) */
router.post('/telecom55', async (req: Request, res: Response) => {
  if (!env.realtimeEnabled) {
    return res.status(503).json({ message: 'Módulo Realtime desabilitado' });
  }
  if (!isRealtimeSupabaseConfigured()) {
    return res.status(503).json({ message: 'Supabase Realtime não configurado' });
  }

  const payload = (req.body ?? {}) as Record<string, unknown>;
  if (!isTelecom55WebhookAuthorized(req, payload)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await processTelecom55Webhook(payload);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[inbound/telecom55]', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/telecom55', async (req: Request, res: Response) => {
  if (!env.realtimeEnabled) {
    return res.status(503).json({ message: 'Módulo Realtime desabilitado' });
  }
  if (!isRealtimeSupabaseConfigured()) {
    return res.status(503).json({ message: 'Supabase Realtime não configurado' });
  }
  if (!isTelecom55WebhookAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const health = await getTelecom55WebhookHealth();
    return res.json(health);
  } catch (err) {
    console.error('[inbound/telecom55] GET health falhou:', err);
    return res.status(500).json({ error: (err as Error).message });
  }
});

/** WhatsApp Twilio — status callback (sent / delivered / read / failed) */
router.post('/whatsapp/message-status', twilioWebhookAuthMiddleware, async (req, res: Response) => {
  try {
    const payload = parseTwilioMessageStatusWebhook(req.body as Record<string, unknown>);
    if (!payload.messageSid) {
      return res.status(400).type('text/plain').send('MessageSid ausente');
    }

    await processWhatsAppMessageStatusCallback(payload);
    return res.status(200).type('text/plain').send('');
  } catch (err) {
    console.error('[inbound/whatsapp/message-status]', err);
    return res.status(500).type('text/plain').send('Falha ao processar status WhatsApp');
  }
});

router.post('/app-notify', inboundAppAuthMiddleware, async (req, res: Response) => {
  try {
    const result = await processAppNotify({
      chamadoId: req.body?.chamadoId,
      chamadoProtocolo: req.body?.chamadoProtocolo,
    });
    const statusCode = result.action === 'processed' ? 200 : 200;
    return res.status(statusCode).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Chamado não encontrado') {
      return res.status(404).json({ message });
    }
    if (message.includes('inválido') || message.includes('Informe')) {
      return res.status(400).json({ message });
    }
    console.error('[inbound/app-notify]', err);
    return res.status(500).json({ message: 'Falha ao processar notificação do app' });
  }
});

/** Abertura de ticket — health (sem autenticação) */
router.get('/tickets/health', (_req, res: Response) => {
  res.json({
    status: 'ok',
    enabled: env.inboundTicketsEnabled,
    apiVersion: '1.0.0',
    origins: Object.keys(ORIGIN_CANAL_CONFIG),
    secretFormat: '[a-z0-9]{35}',
  });
});

router.post('/tickets', inboundTicketAuthMiddleware, async (req, res: Response) => {
  try {
    const origin = req.inboundTicketOrigin;
    if (!origin) {
      return res.status(401).json({ message: 'Origem inbound ticket não identificada' });
    }
    const result = await processInboundTicket(origin, req.body as Record<string, unknown>);
    const statusCode = result.action === 'created' ? 201 : 200;
    return res.status(statusCode).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/obrigatório|Informe|inválid/i.test(message)) {
      return res.status(400).json({ message });
    }
    console.error('[inbound/tickets]', err);
    return res.status(500).json({ message: 'Falha ao criar ticket inbound' });
  }
});

/** Leitura server-to-server dos tickets do cliente — origens app e chat têm motivo de chamar isso em nome de alguém. */
router.get('/tickets/client', inboundTicketAuthMiddleware, async (req, res: Response) => {
  try {
    if (req.inboundTicketOrigin !== 'app' && req.inboundTicketOrigin !== 'chat') {
      return res.status(403).json({ message: 'Leitura de tickets do cliente é exclusiva das origens app e chat' });
    }

    const clientCPF = String(req.query.clientCPF ?? '').trim();
    const clientPhone = String(req.query.clientPhone ?? '').trim();
    const clientEmail = String(req.query.clientEmail ?? '').trim();
    if (!clientCPF && !clientPhone && !clientEmail) {
      return res.status(400).json({ message: 'Informe clientCPF, clientPhone ou clientEmail' });
    }

    const limitRaw = req.query.limit;
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;

    const tickets = await listClientTicketsForApp(
      { clientCPF, clientPhone, clientEmail },
      limit,
    );
    return res.json({ tickets });
  } catch (err) {
    console.error('[inbound/tickets/client]', err);
    return res.status(500).json({ message: 'Falha ao listar tickets do cliente' });
  }
});

/** Lista de produtos (tabulação Desk) — qualquer origem inbound autenticada, mesmo vocabulário pra todo mundo. */
router.get('/produtos', inboundTicketAuthMiddleware, async (req, res: Response) => {
  try {
    const produtos = await listProdutos(false);
    return res.json({
      produtos: produtos.map(({ produto, ordem }) => ({ produto, ordem })),
    });
  } catch (err) {
    console.error('[inbound/produtos]', err);
    return res.status(500).json({ message: 'Falha ao listar produtos' });
  }
});

/**
 * Gera uma URL assinada temporária (15min) para um anexo ENVIADO pelo agente ao cliente
 * (`/api/uploads/sent/:storageKey`) — origem app, pra baixar o arquivo sem precisar da
 * sessão/token do Desk. Mesmo mecanismo de token HMAC já usado pro outbound-media do
 * WhatsApp (whatsappOutboundMedia.util.ts) — não é um signed URL nativo do GCS, mas dá o
 * mesmo resultado prático: link temporário que qualquer um pode baixar, sem autenticação
 * própria do Desk.
 */
router.get('/attachments/signed-url', inboundTicketAuthMiddleware, async (req, res: Response) => {
  try {
    if (req.inboundTicketOrigin !== 'app') {
      return res.status(403).json({ message: 'Geração de URL assinada é exclusiva da origem app' });
    }

    const attachmentPath = String(req.query.path ?? req.query.url ?? '').trim();
    if (!attachmentPath) {
      return res.status(400).json({ message: 'Informe path (ou url) do anexo' });
    }

    const url = buildWhatsAppOutboundMediaPublicUrlFromApiUrl(attachmentPath);
    if (!url) {
      return res.status(400).json({ message: 'Path de anexo inválido — esperado /api/uploads/sent/:storageKey' });
    }

    return res.json({
      url,
      expiresAt: new Date(Date.now() + SIGNED_ATTACHMENT_TOKEN_TTL_MS).toISOString(),
    });
  } catch (err) {
    console.error('[inbound/attachments/signed-url]', err);
    return res.status(500).json({ message: 'Falha ao gerar URL assinada' });
  }
});

/** Leitura de um chamado + histórico de mensagens públicas — origem app, validado por CPF/telefone/e-mail do cliente. */
router.get('/tickets/client/:chamadoProtocolo/messages', inboundTicketAuthMiddleware, async (req, res: Response) => {
  try {
    if (req.inboundTicketOrigin !== 'app') {
      return res.status(403).json({ message: 'Leitura de histórico de mensagens é exclusiva da origem app' });
    }

    const clientCPF = String(req.query.clientCPF ?? '').trim();
    const clientPhone = String(req.query.clientPhone ?? '').trim();
    const clientEmail = String(req.query.clientEmail ?? '').trim();
    if (!clientCPF && !clientPhone && !clientEmail) {
      return res.status(400).json({ message: 'Informe clientCPF, clientPhone ou clientEmail' });
    }

    const ticket = await getClientTicketHistory(req.params.chamadoProtocolo, {
      clientCPF,
      clientPhone,
      clientEmail,
    });
    if (!ticket) {
      return res.status(404).json({ message: 'Chamado não encontrado para este cliente' });
    }
    const { mensagens, ...rest } = ticket;
    const messages = mensagens.map(({ attachments, ...msg }) => ({
      ...msg,
      attachments: attachments.map((url) => ({ url })),
    }));
    return res.json({ ...rest, messages });
  } catch (err) {
    console.error('[inbound/tickets/client/:chamadoProtocolo/messages]', err);
    return res.status(500).json({ message: 'Falha ao buscar histórico do chamado' });
  }
});

/** Leitura de um chamado + histórico de mensagens públicas — origem chat, validado por CPF/telefone/e-mail do cliente. */
router.get('/tickets/:chamadoProtocolo', inboundTicketAuthMiddleware, async (req, res: Response) => {
  try {
    if (req.inboundTicketOrigin !== 'chat') {
      return res.status(403).json({ message: 'Leitura de chamado por protocolo é exclusiva da origem chat' });
    }

    const clientCPF = String(req.query.clientCPF ?? '').trim();
    const clientPhone = String(req.query.clientPhone ?? '').trim();
    const clientEmail = String(req.query.clientEmail ?? '').trim();
    if (!clientCPF && !clientPhone && !clientEmail) {
      return res.status(400).json({ message: 'Informe clientCPF, clientPhone ou clientEmail' });
    }

    const ticket = await getClientTicketHistory(req.params.chamadoProtocolo, {
      clientCPF,
      clientPhone,
      clientEmail,
    });
    if (!ticket) {
      return res.status(404).json({ message: 'Chamado não encontrado para este cliente' });
    }
    return res.json({ ticket });
  } catch (err) {
    console.error('[inbound/tickets/:chamadoProtocolo]', err);
    return res.status(500).json({ message: 'Falha ao buscar chamado' });
  }
});

/**
 * Leitura do retrato do agente de QA (Claudio Q.A.) pro dashboard Sentinela Velodesk —
 * exclusiva da origem qa-teste, mesmo segredo que já cria os tickets de teste. Sem isso,
 * a única forma de alimentar o dashboard seria expor uma connection string do Mongo pra
 * fora do backend.
 */
router.get('/qa-sentinela/estado', inboundTicketAuthMiddleware, async (req, res: Response) => {
  if (req.inboundTicketOrigin !== 'qa-teste') {
    return res.status(403).json({ message: 'Leitura do Sentinela é exclusiva da origem qa-teste' });
  }
  try {
    const estado = await getQaSentinelaEstadoModel().findById('atual').lean();
    if (!estado) {
      return res.status(404).json({ message: 'Nenhuma rodada do Sentinela gravada ainda' });
    }
    return res.json({ estado });
  } catch (err) {
    console.error('[inbound/qa-sentinela/estado]', err);
    return res.status(500).json({ message: 'Falha ao ler estado do Sentinela' });
  }
});

router.get('/qa-sentinela/runs', inboundTicketAuthMiddleware, async (req, res: Response) => {
  if (req.inboundTicketOrigin !== 'qa-teste') {
    return res.status(403).json({ message: 'Leitura do Sentinela é exclusiva da origem qa-teste' });
  }
  try {
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 14;
    const runs = await getQaSentinelaRunModel().find({}).sort({ iniciadoEm: -1 }).limit(limit).lean();
    return res.json({ runs });
  } catch (err) {
    console.error('[inbound/qa-sentinela/runs]', err);
    return res.status(500).json({ message: 'Falha ao ler histórico do Sentinela' });
  }
});

export default router;
