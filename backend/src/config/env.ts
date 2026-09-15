/** env v1.39.0 — bucket de recursos da assinatura de e-mail */
import fs from 'fs';
import path from 'path';

function resolveEnvLoader() {
  const candidates = [
    path.join(__dirname, 'loadFonteVelodeskEnv.cjs'),
    path.join(__dirname, '../../src/config/loadFonteVelodeskEnv.cjs'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('loadFonteVelodeskEnv.cjs não encontrado');
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const envFileResult = require(resolveEnvLoader()).loadFrom(path.join(__dirname, '..', '..'));

function requireMongoUri(): string {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
  const trimmed = uri.trim().replace(/^["']|["']$/g, '').replace(/\r?\n/g, '').trim();
  if (trimmed) return trimmed;

  if (process.env.NODE_ENV === 'production') {
    console.error(
      '[env] MONGODB_URI ausente — defina no serviço Cloud Run (Variables & Secrets). API sobe degradada.'
    );
    return '';
  }

  console.warn(
    '[env] MONGODB_URI ausente em desenvolvimento — o backend tentará MongoDB em memória local.'
  );
  return '';
}

export const envFile = envFileResult as {
  envPath?: string | null;
  loaded?: boolean;
  source?: string;
};

/** @deprecated use envFile */
export const envBootstrap = envFile;

export function cleanMongoUri(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
    .replace(/(@[^/?]+)\/\?/, '$1?');
}

/** Cluster Desk (b2c_chamados, b2c_cadastros, desk_config, desk_preferences) — MONGO_URI / MONGODB_URI */
export function getMongoDeskUri(): string {
  return cleanMongoUri(process.env.MONGODB_URI || process.env.MONGO_URI || '');
}

/**
 * VeloHubCentral — console_funcionarios (colaboradores Desk).
 * Somente MONGO_ENV (secret Cloud Run). Nunca reutilizar MONGO_URI do Desk.
 */
export function getMongoHubCentralUri(): string {
  return cleanMongoUri(process.env.MONGO_ENV || '');
}

function resolveMongoFuncionariosUri(): string {
  return getMongoHubCentralUri();
}

function resolveApiRateLimitMax(): number {
  const raw = parseInt(process.env.API_RATE_LIMIT_MAX || '', 10);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return (process.env.NODE_ENV || 'development') === 'development' ? 2000 : 5000;
}

export const env = {
  port: parseInt(process.env.PORT || process.env.VELODESK_BACKEND || '8001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  apiRateLimitMax: resolveApiRateLimitMax(),
  mongoUri: requireMongoUri(),
  mongoDbName: process.env.MONGODB_DB_NAME || 'b2c_chamados',
  mongoCadastrosDbName: process.env.MONGODB_CADASTROS_DB_NAME || 'b2c_cadastros',
  mongoDeskConfigDbName: process.env.MONGODB_DESK_CONFIG_DB_NAME || 'desk_config',
  mongoDeskPreferencesDbName: process.env.MONGODB_DESK_PREFERENCES_DB_NAME || 'desk_preferences',
  mongoReclamacoesDbName: process.env.MONGODB_RECLAMACOES_DB_NAME || 'chamados_reclamacoes',
  /** VeloHubCentral — console_funcionarios.funcionarios_cadastroColaboradores (leitura via MONGO_ENV) */
  mongoFuncionariosUri: resolveMongoFuncionariosUri(),
  mongoFuncionariosDbName: process.env.MONGODB_FUNCIONARIOS_DB_NAME || 'console_funcionarios',
  mongoFuncionariosCollection:
    process.env.MONGODB_FUNCIONARIOS_COLLECTION || 'funcionarios_cadastroColaboradores',
  /** VeloHubCentral — console_config.module_status (mesmo status dos serviços do VeloHub, leitura via MONGO_ENV) */
  mongoConsoleConfigDbName: process.env.MONGODB_CONSOLE_CONFIG_DB_NAME || 'console_config',
  jwtSecret: process.env.JWT_SECRET || 'velodesk-dev-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  /** Diretório com os .docx dos POPs, um subdiretório por produto (quadro de Processos) */
  popsSourceDir: (
    process.env.POPS_SOURCE_DIR || path.resolve(__dirname, '..', '..', 'source file', 'POPs')
  ).trim(),
  /** Versão completa dos POPs (mesma árvore de pastas que popsSourceDir) */
  popsCompletoSourceDir: (
    process.env.POPS_COMPLETO_SOURCE_DIR
    || path.resolve(__dirname, '..', '..', 'source file', 'POP Completo')
  ).trim(),
  twilioAccountSid: (process.env.TWILIO_ACCOUNT_SID || '').trim(),
  twilioAuthToken: (process.env.TWILIO_AUTH_TOKEN || '').trim(),
  /** Subconta Velodesk — prioridade para WhatsApp / Senders API */
  twilioSubaccountSid: (process.env.TWILIO_SUBACCOUNT_SID || '').trim(),
  twilioSubaccountAuthToken: (process.env.TWILIO_SUBACCOUNT_AUTH_TOKEN || '').trim(),
  /** API Key (SK...) — alternativa ao Auth Token; exige TWILIO_SUBACCOUNT_SID */
  twilioApiKeySid: (process.env.TWILIO_API_KEY_SID || process.env.API_KEY_SID || '').trim(),
  twilioApiKeySecret: (process.env.TWILIO_API_KEY_SECRET || process.env.API_KEY_SECRET || '').trim(),
  /** Número WhatsApp Business (produção). Não usar +14155238886 (sandbox Twilio). */
  twilioWhatsappFrom: (process.env.TWILIO_WHATSAPP_FROM || '').trim(),
  /** Template Appointment Reminder (Sandbox quickstart) */
  twilioWhatsappContentSid: (
    process.env.TWILIO_WHATSAPP_CONTENT_SID || 'HXb5b62575e6e4ff6129ad7c8efe1f983e'
  ).trim(),
  /** Template UTILITY — 1º contato / fora da janela 24h (Desk ativo) */
  twilioWhatsappDeskActiveContentSid: (
    process.env.TWILIO_WHATSAPP_DESK_ACTIVE_CONTENT_SID || 'HXcbba12297392a996aeaf60af3e05ccc4'
  ).trim(),
  whatsappInboundEnabled: process.env.WHATSAPP_INBOUND_ENABLED !== 'false',
  /** Resposta automática TwiML ao inbound — vazio = só registra no ticket, sem mensagem ao cliente */
  twilioWhatsappAutoReply: (process.env.TWILIO_WHATSAPP_AUTO_REPLY || '').trim(),
  /** Status callback — confirmação de entrega (sent/delivered/read) */
  twilioWhatsappStatusCallbackUrl: (process.env.TWILIO_WHATSAPP_STATUS_CALLBACK_URL || '').trim(),
  /** Dev only — pular validação X-Twilio-Signature (ngrok/local) */
  twilioWebhookSkipValidation: process.env.TWILIO_WEBHOOK_SKIP_VALIDATION === 'true',
  /** Base pública usada na assinatura Twilio (deve bater com callback_url do sender) */
  twilioWebhookPublicBaseUrl: (
    process.env.TWILIO_WEBHOOK_PUBLIC_BASE_URL
    || 'https://velodesk-278491073220.us-east1.run.app'
  ).trim().replace(/\/+$/, ''),
  gcpStorageBucket: (process.env.GCP_STORAGE_BUCKET || 'velodesk_storage').trim(),
  /** Imagens da assinatura de e-mail — gs://velodesk_resources/mail_signature_img */
  gcpEmailResourcesBucket: (process.env.GCP_EMAIL_RESOURCES_BUCKET || 'velodesk_resources').trim(),
  gcpEmailSignaturePrefix: (
    process.env.GCP_EMAIL_SIGNATURE_PREFIX || 'mail_signature_img'
  ).trim().replace(/^\/+|\/+$/g, ''),
  /** E-mail recebido (inbound Gmail) */
  gcpStorageInboundAttachmentsPrefix: (
    process.env.GCP_STORAGE_INBOUND_ATTACHMENTS_PREFIX
    || process.env.GCP_STORAGE_ATTACHMENTS_PREFIX
    || 'desk_ticket_attachments'
  ).trim().replace(/^\/+|\/+$/g, ''),
  /** Anexo enviado pelo agente no atendimento */
  gcpStorageSentAttachmentsPrefix: (
    process.env.GCP_STORAGE_SENT_ATTACHMENTS_PREFIX || 'desk_ticket_sent_attachments'
  ).trim().replace(/^\/+|\/+$/g, ''),
  /** Anexos importados do Octadesk (dump legado) */
  gcpStorageOctadeskLegacyAttachmentsPrefix: (
    process.env.GCP_STORAGE_OCTADESK_LEGACY_PREFIX || 'octadesk_legacy_attachments'
  ).trim().replace(/^\/+|\/+$/g, ''),
  /** Inbound aguardando / reprovado no ClamAV */
  gcpStorageInboundQuarantinePrefix: (
    process.env.GCP_STORAGE_INBOUND_QUARANTINE_PREFIX || 'desk_ticket_attachments_quarantine'
  ).trim().replace(/^\/+|\/+$/g, ''),
  attachmentScanCallbackSecret: (process.env.ATTACHMENT_SCAN_CALLBACK_SECRET || '').trim(),
  /** Dump Octadesk → legado_tickets.importados_octadesk (scripts offline) */
  octadeskApiBase: (
    process.env.OCTADESK_API_BASE || 'https://o199103-bfa.api001.octadesk.services'
  ).trim().replace(/\/+$/, ''),
  octadeskApiKey: (process.env.OCTADESK_API_KEY || '').trim(),
  octadeskAgentEmail: (process.env.OCTADESK_AGENT_EMAIL || '').trim(),
  mongoLegadoTicketsDbName: (process.env.MONGODB_LEGADO_TICKETS_DB_NAME || 'legado_tickets').trim(),
  inboundAttachmentsDir: (process.env.INBOUND_ATTACHMENTS_DIR || '').trim(),
  sentAttachmentsDir: (process.env.SENT_ATTACHMENTS_DIR || '').trim(),
  inboundEmailEnabled: process.env.INBOUND_EMAIL_ENABLED === 'true',
  inboundEmailProvider: (process.env.INBOUND_EMAIL_PROVIDER || 'generic').toLowerCase(),
  inboundEmailWebhookSecret: process.env.INBOUND_EMAIL_WEBHOOK_SECRET || '',
  inboundEmailAllowedRecipients: (process.env.INBOUND_EMAIL_ALLOWED_RECIPIENTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundEmailProconRecipients: (process.env.INBOUND_EMAIL_PROCON_RECIPIENTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundEmailProconSenderPatterns: (process.env.INBOUND_EMAIL_PROCON_SENDER_PATTERNS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundEmailConsumidorGovRecipients: (process.env.INBOUND_EMAIL_CONSUMIDOR_GOV_RECIPIENTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundEmailConsumidorGovSenderPatterns: (process.env.INBOUND_EMAIL_CONSUMIDOR_GOV_SENDER_PATTERNS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundEmailBacenRecipients: (process.env.INBOUND_EMAIL_BACEN_RECIPIENTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundEmailBacenSenderPatterns: (process.env.INBOUND_EMAIL_BACEN_SENDER_PATTERNS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  emailEnabled: process.env.EMAIL_ENABLED === 'true',
  deskEmailTransportCollection: process.env.DESK_EMAIL_TRANSPORT_COLLECTION || 'email_transport',
  deskEmailTransportDocumentId: process.env.DESK_EMAIL_TRANSPORT_DOCUMENT_ID || 'desk_email_transport',
  gmailInboundEnabled: process.env.GMAIL_INBOUND_ENABLED === 'true',
  gcpProjectId: (process.env.GCP_PROJECT_ID || 'velohub-471220').trim(),
  gmailPubsubTopic: (process.env.GMAIL_PUBSUB_TOPIC || 'gmail-desk-inbound').trim(),
  gmailPubsubVerifyToken: (process.env.GMAIL_PUBSUB_VERIFY_TOKEN || '').trim(),
  gmailWatchStateCollection: process.env.GMAIL_WATCH_STATE_COLLECTION || 'gmail_watch_state',
  gmailWatchStateDocumentId: process.env.GMAIL_WATCH_STATE_DOCUMENT_ID || 'desk_gmail_watch',
  /** Máx. mensagens processadas por push Pub/Sub (evita timeout Cloud Run 60s) */
  gmailInboundMaxMessagesPerPush: parseInt(process.env.GMAIL_INBOUND_MAX_MESSAGES_PER_PUSH || '8', 10),
  /** Orçamento de tempo por push antes de devolver 503 (Pub/Sub reentrega) */
  gmailInboundBudgetMs: parseInt(process.env.GMAIL_INBOUND_BUDGET_MS || '50000', 10),
  /** @deprecated use desk_config.email_transport Gmail API */
  emailFrom: process.env.EMAIL_FROM || '',
  /** @deprecated use desk_config.email_transport Gmail API */
  emailApiKey: process.env.EMAIL_API_KEY || '',
  googleClientId: (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim(),
  languageToolEnabled: process.env.LANGUAGETOOL_ENABLED !== 'false',
  languageToolUrl: (process.env.LANGUAGETOOL_URL || 'http://localhost:8010').trim().replace(/\/+$/, ''),
  languageToolLanguage: (process.env.LANGUAGETOOL_LANGUAGE || 'pt-BR').trim(),
  languageToolTimeoutMs: parseInt(process.env.LANGUAGETOOL_TIMEOUT_MS || '8000', 10),
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim(),
  /** Revisor de Texto — flash-lite por padrão (menor latência). */
  geminiRefinarModel: (process.env.GEMINI_REFINAR_MODEL || 'gemini-2.5-flash-lite').trim(),
  openaiApiKey: (process.env.OPENAI_API_KEY || '').trim(),
  whatsappAudioTranscriptionEnabled:
    process.env.WHATSAPP_AUDIO_TRANSCRIPTION_ENABLED !== 'false',
  whatsappAudioTranscriptionModel: (
    process.env.WHATSAPP_AUDIO_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'
  ).trim(),
  openaiVectorStoreId: (
    process.env.OPENAI_VECTOR_STORE_ID
    || process.env.VECTOR_STORE_PATH
    || ''
  ).trim(),
  openaiPopVectorStoreId: (
    process.env.OPENAI_POP_VECTOR_STORE_ID
    || process.env.OPENAI_VECTOR_STORE_ID
    || process.env.VECTOR_STORE_PATH
    || ''
  ).trim(),
  openaiPublicVectorStoreId: (process.env.OPENAI_PUBLIC_VECTOR_STORE_ID || '').trim(),
  openaiAuditVectorStoreId: (process.env.OPENAI_AUDIT_VECTOR_STORE_ID || '').trim(),
  openaiModel: (process.env.OPENAI_MODEL || 'gpt-4.1-mini').trim(),
  agentsEnabled: process.env.AGENTS_ENABLED === 'true',
  agentsAutonomyEnabled: process.env.AGENTS_AUTONOMY_ENABLED === 'true',
  /** Agente 4 — triagem silenciosa de casos especiais na entrada do ticket (classificação só) */
  agentCasosEspeciaisEnabled: process.env.AGENT_CASOS_ESPECIAIS_ENABLED === 'true',
  /** Agente 5 — extração de campos (Procon/Bacen/Consumidor.gov) após a classificação do Agente 4 */
  agentCasosEspeciaisExtracaoEnabled: process.env.AGENT_CASOS_ESPECIAIS_EXTRACAO_ENABLED === 'true',
  /** Agente 6 — correlação de tickets relacionados no histórico do CPF (Reclame Aqui) */
  agentCasosEspeciaisRelacionadosEnabled: process.env.AGENT_CASOS_ESPECIAIS_RELACIONADOS_ENABLED === 'true',
  agentAuditThresholdAuto: parseInt(process.env.AGENT_AUDIT_THRESHOLD_AUTO || '85', 10),
  agentAuditThresholdDesk: parseInt(process.env.AGENT_AUDIT_THRESHOLD_DESK || '70', 10),
  agentRevisionMaxAttempts: parseInt(process.env.AGENT_REVISION_MAX_ATTEMPTS || '1', 10),
  gestaoSnapshotIntervalMs: parseInt(process.env.GESTAO_SNAPSHOT_INTERVAL_MS || '3600000', 10),
  gestaoChamadosIntervalMs: parseInt(process.env.GESTAO_CHAMADOS_INTERVAL_MS || '300000', 10),
  gestaoSpikeThreshold: parseInt(process.env.GESTAO_SPIKE_THRESHOLD || '10', 10),
  gestaoSpikeWindowMin: parseInt(process.env.GESTAO_SPIKE_WINDOW_MIN || '30', 10),
  gestaoStuckNovoMinutes: parseInt(process.env.GESTAO_STUCK_NOVO_MINUTES || '120', 10),
  gestaoStuckActiveHours: parseInt(process.env.GESTAO_STUCK_ACTIVE_HOURS || '4', 10),
  gestaoAlertEmails: (process.env.GESTAO_ALERT_EMAILS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  chamadoIaAnaliseEnabled: process.env.CHAMADO_IA_ANALISE_ENABLED !== 'false',
  /** Sync diário de custo Twilio WhatsApp → coleção `whatsapp_message_costs` (consumido pelo WFM). */
  whatsappCostSyncEnabled: process.env.WHATSAPP_COST_SYNC_ENABLED !== 'false',
  /** Batch periódico de re-varredura da IA de telefonia (sort pesado em telephony_calls).
   * Desativado por padrão: cada ligação já é classificada na chegada (telephonyInbound). */
  telephonyIaBatchEnabled: process.env.TELEPHONY_IA_BATCH_ENABLED === 'true',
  chamadoIaAnaliseModel: (process.env.CHAMADO_IA_ANALISE_MODEL || 'gpt-5-mini').trim(),
  chamadoIaAnaliseIntervalMs: parseInt(process.env.CHAMADO_IA_ANALISE_INTERVAL_MS || '900000', 10),
  chamadoIaAnaliseMaxPerCycle: parseInt(process.env.CHAMADO_IA_ANALISE_MAX_PER_CYCLE || '60', 10),
  ticketSequenceFloor: (process.env.TICKET_SEQUENCE_FLOOR || '100177678').trim(),
  /** Ativo por padrão; desligar com ASSIGNMENT_ROUTER_ENABLED=false */
  assignmentRouterEnabled: process.env.ASSIGNMENT_ROUTER_ENABLED !== 'false',
  assignmentRouterStrategy: (process.env.ASSIGNMENT_ROUTER_STRATEGY || 'cap_online').trim(),
  assignmentRouterMaxOpen: parseInt(process.env.ASSIGNMENT_ROUTER_MAX_OPEN || '10', 10),
  assignmentRouterPresenceTtlMs: parseInt(process.env.ASSIGNMENT_ROUTER_PRESENCE_TTL_MS || '300000', 10),
  assignmentRouterTerminalStatuses: (process.env.ASSIGNMENT_ROUTER_TERMINAL_STATUSES || 'resolvido,cancelado,fechado')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
  inboundAppWebhookSecret: (process.env.INBOUND_APP_WEBHOOK_SECRET || '').trim(),
  /** Abertura de ticket inbound — App / Telefone / Agente IA */
  inboundTicketsEnabled: process.env.INBOUND_TICKETS_ENABLED !== 'false',
  inboundTicketAppSecret: (process.env.INBOUND_TICKET_APP_SECRET || '').trim(),
  inboundTicketTelefoneSecret: (process.env.INBOUND_TICKET_TELEFONE_SECRET || '').trim(),
  inboundTicketAgenteIaSecret: (process.env.INBOUND_TICKET_AGENTE_IA_SECRET || '').trim(),
  inboundTicketChatSecret: (process.env.INBOUND_TICKET_CHAT_SECRET || '').trim(),
  inboundTicketQaTesteSecret: (process.env.INBOUND_TICKET_QA_TESTE_SECRET || '').trim(),
  /** Intervalo do job que fecha tickets resolvidos (default 1h) */
  resolvedCloseIntervalMs: parseInt(process.env.RESOLVED_CLOSE_INTERVAL_MS || '3600000', 10),
  /** Idade mínima em Resolvido antes de virar Fechado (default 48h) */
  resolvedCloseAfterMs: parseInt(process.env.RESOLVED_CLOSE_AFTER_MS || '172800000', 10),
  /** Idade mínima em Pendente antes de virar Resolvido (default 48h) */
  pendenteResolveAfterMs: parseInt(process.env.PENDENTE_RESOLVE_AFTER_MS || '172800000', 10),
  /** Intervalo do job que envia repescagem de CSAT (default 1h) */
  csatRepescagemIntervalMs: parseInt(process.env.CSAT_REPESCAGEM_INTERVAL_MS || '3600000', 10),
  /** Idade mínima após envio do CSAT para repescagem (default 48h) */
  csatRepescagemAfterMs: parseInt(process.env.CSAT_REPESCAGEM_AFTER_MS || '172800000', 10),
  inboundTelephonyEnabled: process.env.INBOUND_TELEPHONY_ENABLED !== 'false',
  inboundTelephonyWebhookSecret: (process.env.INBOUND_TELEPHONY_WEBHOOK_SECRET || '').trim(),
  telephonyAutoCreateTicket: process.env.TELEPHONY_AUTO_CREATE_TICKET === 'true',
  /** Webhook 55PBX (call center humano) — abertura de ticket em /api/inbound/telephony/inbound_b2c.
   * Secret isolado, não reaproveita INBOUND_TELEPHONY_WEBHOOK_SECRET (Contact Tel) nem
   * TELECOM55_WEBHOOK_SECRET (painel ao vivo). */
  inboundB2cTelephonySecret: (process.env.INBOUND_B2C_TELEPHONY_SECRET || '').trim(),
  /** Aba Consultas — Velotax Customer Data API (header x-api-key na fonte da verdade) */
  customerDataApiKey: (
    process.env['x-api-key']
    || process.env.CUSTOMER_DATA_API_KEY
    || process.env.VELOTAX_CUSTOMER_DATA_API_KEY
    || ''
  ).trim(),
  customerDataBaseUrl: (
    process.env.VELOTAX_CUSTOMER_DATA_BASE_URL
    || 'https://customer-data.velotax.com.br'
  ).trim().replace(/\/+$/, ''),
  customerDataTimeoutMs: parseInt(process.env.VELOTAX_CUSTOMER_DATA_TIMEOUT_MS || '30000', 10),
  /** Realtime / 55PBX — Supabase WFM (telefonia). Lazy; não bloqueia API core se ausente. */
  realtimeEnabled: process.env.REALTIME_ENABLED !== 'false',
  realtimeSupabaseUrl: (
    process.env.REALTIME_SUPABASE_URL
    || process.env.NEXT_PUBLIC_SUPABASE_URL
    || ''
  ).trim(),
  realtimeSupabaseServiceRoleKey: (
    process.env.REALTIME_SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || ''
  ).trim(),
  telecom55WebhookSecret: (
    process.env.TELECOM55_WEBHOOK_SECRET
    || process.env.WEBHOOK_SECRET
    || ''
  ).trim(),
  /** Presence de ticket (quem está olhando/tem aberto) — Supabase Realtime via JWT custom (HS256) */
  ticketPresenceJwtSecret: (process.env.PRESENCE_REALTIME_JWT_SECRET || '').trim(),
  ticketPresenceTokenTtlSec: parseInt(process.env.PRESENCE_REALTIME_TOKEN_TTL_SEC || '600', 10),
  /**
   * Eventos de ticket (nova mensagem/mudança) publicados em canal Supabase Realtime (broadcast
   * público, só o id do ticket — sem conteúdo). Reaproveita o projeto de presence. Se URL/anon key
   * ausentes, o publisher vira no-op e o polling (leve) segue como mecanismo confiável.
   */
  ticketEventsRealtimeUrl: (process.env.PRESENCE_REALTIME_URL || '').trim().replace(/\/+$/, ''),
  ticketEventsRealtimeApiKey: (process.env.PRESENCE_REALTIME_ANON_KEY || '').trim(),
};

