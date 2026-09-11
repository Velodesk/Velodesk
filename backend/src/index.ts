/** index v1.17.0 — e-mails de saída configuráveis */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env, getMongoHubCentralUri } from './config/env';
import {
  connectDatabase,
  disconnectDatabase,
  getAtlasConnectionInfo,
  getMongoStorageLabel,
  isAllMongoReady,
  isCadastrosConnected,
  isDeskConfigConnected,
  isDeskPreferencesConnected,
  isFuncionariosConnected,
  isConsoleConfigConnected,
  isMongoConnected,
  tryConnectFuncionarios,
  tryConnectConsoleConfig,
  waitForMongoReady,
} from './config/database';
import authRoutes from './routes/auth.routes';
import ticketsRoutes from './routes/tickets.routes';
import boxesRoutes from './routes/boxes.routes';
import agentQueueBoxesRoutes from './routes/agentQueueBoxes.routes';
import usersRoutes from './routes/users.routes';
import statsRoutes from './routes/stats.routes';
import uploadsRoutes from './routes/uploads.routes';
import clientsRoutes from './routes/clients.routes';
import tabulationRoutes from './routes/tabulation.routes';
import workflowsRoutes from './routes/workflows.routes';
import spellcheckRoutes from './routes/spellcheck.routes';
import composeRoutes from './routes/compose.routes';
import ticketAiRoutes from './routes/ticketAi.routes';
import agentsRoutes from './routes/agents.routes';
import inboundRoutes from './routes/inbound.routes';
import workspace360Routes from './routes/workspace360.routes';
import gestaoInsightsRoutes from './routes/gestaoInsights.routes';
import dashboardOperacionalRoutes from './routes/dashboardOperacional.routes';
import aiUsageRoutes from './routes/aiUsage.routes';
import whatsappCostSyncRoutes from './routes/whatsappCostSync.routes';
import colaboradoresRoutes from './routes/colaboradores.routes';
import workflowNotificacoesRoutes from './routes/workflowNotificacoes.routes';
import permissionsRoutes from './routes/permissions.routes';
import funcoesPermissoesRoutes from './routes/funcoesPermissoes.routes';
import agentesDeskRoutes from './routes/agentesDesk.routes';
import mailRulesRoutes from './routes/mailRules.routes';
import emailBouncesRoutes from './routes/emailBounces.routes';
import emailOutboundRoutes from './routes/emailOutbound.routes';
import macrosRoutes from './routes/macros.routes';
import ticketIaAnalysisRoutes from './routes/ticketIaAnalysis.routes';
import telephonyRoutes from './routes/telephony.routes';
import consultasRoutes from './routes/consultas.routes';
import ticketSearchRoutes from './routes/ticketSearch.routes';
import ticketFusaoRoutes from './routes/ticketFusao.routes';
import reclamacoesRoutes from './routes/reclamacoes.routes';
import internalAttachmentScanRoutes from './routes/internalAttachmentScan.routes';
import reclameAquiHugmeRoutes from './routes/reclameAquiHugme.routes';
import processosRoutes from './routes/processos.routes';
import csatPageRoutes from './routes/csatPage.routes';
import csatRoutes from './routes/csat.routes';
import moduleStatusRoutes from './routes/moduleStatus.routes';
import { logPopCatalogStartup } from './services/processos/popCatalog.service';
import { blockNoticiarioRoutes } from './middleware/blockNoticiarioRoutes';
import { shouldSkipApiRateLimit } from './middleware/rateLimitPolicy';
import { isLanguageToolConfigured, logLanguageToolStartupStatus } from './services/languagetool.service';
import {
  getOpenAiTicketSuggestStatus,
  isOpenAiTicketSuggestConfigured,
} from './services/openaiTicketSuggest.service';
import { seedDevelopmentData, purgeAllMockTickets, runDeskConfigMigrations } from './services/seed.service';
import { getAgentsStatus } from './services/agents/openaiAgent.util';
import { startGestaoChamadosJob } from './jobs/gestaoChamados.job';
import { startCloseResolvedTicketsJob } from './jobs/closeResolvedTickets.job';
import { startCsatRepescagemJob } from './jobs/csatRepescagem.job';
import { startCsatInicialJob } from './jobs/csatInicial.job';
import { startWhatsappCostSyncJob } from './jobs/whatsappCostSync.job';
import { startEmailSlaTriggerJob } from './jobs/emailSlaTrigger.job';
import { startResolvePendenteTicketsJob } from './jobs/resolvePendenteTickets.job';
import { startChamadoIaAnaliseJob } from './jobs/chamadoIaAnalise.job';
import { bootstrapEmailServices } from './services/emailBootstrap.service';
import { startChamadoProtocoloWatcher } from './services/chamadoProtocoloWatcher.service';
import { startWhatsAppAudioTranscriptionWorker } from './services/twilio/whatsappAudioTranscription.service';

const app = express();

app.set('trust proxy', 1);
app.set('etag', false);

app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(blockNoticiarioRoutes);

app.use(csatPageRoutes);
app.use('/api/inbound', inboundRoutes);
app.use('/api/spellcheck', spellcheckRoutes);
app.use('/api/compose', composeRoutes);
app.use('/api/ticket-ai', ticketAiRoutes);
app.use('/api/agents', agentsRoutes);

app.use('/api', authRoutes);

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipApiRateLimit,
});

app.use('/api/', apiRateLimiter);

app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});

app.get('/api/health', (_req, res) => {
  const allReady = isAllMongoReady();
  res.json({
    status: allReady ? 'ok' : 'degraded',
    mongo: isMongoConnected(),
    mongoUriConfigured: Boolean(env.mongoUri?.trim()),
    googleClientIdConfigured: Boolean(env.googleClientId),
    mongoStorage: getMongoStorageLabel(),
    atlas: getAtlasConnectionInfo(),
    mongoDbName: env.mongoDbName,
    cadastrosDbName: env.mongoCadastrosDbName,
    cadastrosConnected: isCadastrosConnected(),
    deskConfigDbName: env.mongoDeskConfigDbName,
    deskConfigConnected: isDeskConfigConnected(),
    deskPreferencesDbName: env.mongoDeskPreferencesDbName,
    deskPreferencesConnected: isDeskPreferencesConnected(),
    funcionariosDbName: env.mongoFuncionariosDbName,
    mongoEnvConfigured: Boolean(getMongoHubCentralUri()),
    funcionariosConnected: isFuncionariosConnected(),
    languageTool: {
      configured: isLanguageToolConfigured(),
      url: isLanguageToolConfigured() ? env.languageToolUrl : null,
    },
  });
});

app.get('/health', (_req, res) => {
  const allReady = isAllMongoReady();
  res.json({
    status: allReady ? 'ok' : 'degraded',
    mongo: isMongoConnected(),
    mongoUriConfigured: Boolean(env.mongoUri?.trim()),
    googleClientIdConfigured: Boolean(env.googleClientId),
    mongoStorage: getMongoStorageLabel(),
    atlas: getAtlasConnectionInfo(),
    mongoDbName: env.mongoDbName,
    cadastrosDbName: env.mongoCadastrosDbName,
    cadastrosConnected: isCadastrosConnected(),
    deskConfigDbName: env.mongoDeskConfigDbName,
    deskConfigConnected: isDeskConfigConnected(),
    deskPreferencesDbName: env.mongoDeskPreferencesDbName,
    deskPreferencesConnected: isDeskPreferencesConnected(),
    funcionariosDbName: env.mongoFuncionariosDbName,
    mongoEnvConfigured: Boolean(getMongoHubCentralUri()),
    funcionariosConnected: isFuncionariosConnected(),
    languageTool: {
      configured: isLanguageToolConfigured(),
    },
  });
});

// Instância nova (cold start) ou reconexão após blip: app.listen() já aceita
// tráfego antes do connectDatabase() terminar. Sem isso, as rotas abaixo falham
// na hora com "Conexão X indisponível" durante essa janela — aguarda pronto (ou
// timeout curto) em vez de derrubar o request. Não afeta /api/health acima, que
// precisa responder na hora pro readiness probe do Cloud Run.
app.use(async (_req, _res, next) => {
  if (!isAllMongoReady()) await waitForMongoReady();
  next();
});

app.use('/api/tickets', ticketsRoutes);
app.use('/api/boxes', boxesRoutes);
app.use('/api/agent-queue-boxes', agentQueueBoxesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/colaboradores', colaboradoresRoutes);
app.use('/api', statsRoutes);
app.use('/api/uploads', uploadsRoutes);
app.use('/api/internal', internalAttachmentScanRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/tabulation', tabulationRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/workflow-notificacoes', workflowNotificacoesRoutes);
app.use('/api/workspace360', workspace360Routes);
app.use('/api/gestao-insights', gestaoInsightsRoutes);
app.use('/api/dashboard', dashboardOperacionalRoutes);
app.use('/api/ai-usage', aiUsageRoutes);
app.use('/api/whatsapp-cost', whatsappCostSyncRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/funcoes-permissoes', funcoesPermissoesRoutes);
app.use('/api/agentes-desk', agentesDeskRoutes);
app.use('/api/mail-rules', mailRulesRoutes);
app.use('/api/email-bounces', emailBouncesRoutes);
app.use('/api/email-outbound', emailOutboundRoutes);
app.use('/api/macros', macrosRoutes);
app.use('/api/ticket-ia-analysis', ticketIaAnalysisRoutes);
app.use('/api/telephony', telephonyRoutes);
app.use('/api/consultas', consultasRoutes);
app.use('/api/ticket-search', ticketSearchRoutes);
app.use('/api/ticket-fusao', ticketFusaoRoutes);
app.use('/api/reclamacoes', reclamacoesRoutes);
app.use('/api/reclame-aqui/hugme', reclameAquiHugmeRoutes);
app.use('/api/processos', processosRoutes);
app.use('/api/csat', csatRoutes);
app.use('/api/module-status', moduleStatusRoutes);


app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[express] erro não tratado:', err);
  if (!res.headersSent) {
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

let mongoRetryTimer: ReturnType<typeof setInterval> | null = null;
let devMemoryServer: { getUri: (dbName?: string) => string } | null = null;
let activeMongoUri = env.mongoUri;
let mongoConnectInFlight: Promise<boolean> | null = null;

/**
 * scheduleMongoRetry() roda a cada 15s e chama esta função sempre que !isAllMongoReady().
 * Sem esse guard, uma tentativa lenta (SRV timeout de até 12s) ainda em andamento faz o
 * próximo tick do timer disparar uma SEGUNDA chamada a mongoose.connect() em paralelo —
 * com uma URI SRV possivelmente re-resolvida em ordem diferente — e o mongoose rejeita com
 * "Can't call openUri() on an active connection with different connection strings",
 * transformando um blip de rede curto numa cadeia de falhas de ~15min (saves e e-mails
 * falhando o tempo todo) até as tentativas pararem de colidir por acaso.
 */
async function tryConnectDatabase(uri?: string): Promise<boolean> {
  if (isAllMongoReady()) return true;
  if (mongoConnectInFlight) return mongoConnectInFlight;

  const targetUri = (uri || activeMongoUri || '').trim();
  if (!targetUri) return false;

  mongoConnectInFlight = doConnectDatabase(targetUri);
  try {
    return await mongoConnectInFlight;
  } finally {
    mongoConnectInFlight = null;
  }
}

async function doConnectDatabase(targetUri: string): Promise<boolean> {
  try {
    await connectDatabase(targetUri);
    activeMongoUri = targetUri;
    await purgeAllMockTickets();
    await seedDevelopmentData();
    if (env.nodeEnv !== 'development') {
      await runDeskConfigMigrations();
    }
    await startChamadoProtocoloWatcher();
    console.log('[startup] MongoDB conectado (chamados + cadastros + desk_config + desk_preferences).');
    logPopCatalogStartup();
    return true;
  } catch (err) {
    const msg = (err as Error).message;
    console.error('Falha ao conectar ao MongoDB:', msg);
    if (/whitelist|IP address/i.test(msg)) {
      console.error('Atlas → Network Access → libere 0.0.0.0/0 ou use VPC connector para Cloud Run.');
    } else if (/querySrv|ECONNREFUSED|ECONNREFUSED.*mongodb/i.test(msg)) {
      console.error('MongoDB indisponível. Em dev local, o backend tentará memória embarcada ou reconectar.');
    }
    return false;
  }
}

async function tryDevMemoryMongo(): Promise<string | null> {
  if (env.nodeEnv === 'production') return null;

  try {
    if (!devMemoryServer) {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      devMemoryServer = await MongoMemoryServer.create();
    }
    const uri = devMemoryServer.getUri('velodesk');
    console.log('[startup] MongoDB em memória (dev) — dados não persistem entre reinícios.');
    return uri;
  } catch (err) {
    console.error('[startup] Falha ao iniciar MongoDB em memória:', err);
    return null;
  }
}

function scheduleMongoRetry() {
  if (mongoRetryTimer) return;
  console.log('[startup] Monitoramento MongoDB a cada 15s (reconecta se cair).');
  mongoRetryTimer = setInterval(() => {
    if (!activeMongoUri?.trim()) return;
    if (!isAllMongoReady()) {
      void tryConnectDatabase(activeMongoUri).then((ok) => {
        if (ok) void bootstrapEmailServices();
      });
      return;
    }
    if (!isFuncionariosConnected() && getMongoHubCentralUri()) {
      void tryConnectFuncionarios();
    }
    if (!isConsoleConfigConnected() && getMongoHubCentralUri()) {
      void tryConnectConsoleConfig();
    }
  }, 15000);
}

async function bootstrapDatabase() {
  if (!env.mongoUri) {
    console.error('[startup] MONGODB_URI ausente — configure no Cloud Run (Variables & Secrets).');
    return;
  }

  let connected = await tryConnectDatabase(env.mongoUri);
  if (!connected && env.nodeEnv !== 'production') {
    const memoryUri = await tryDevMemoryMongo();
    if (memoryUri) {
      connected = await tryConnectDatabase(memoryUri);
    }
  }

  if (!connected) {
    scheduleMongoRetry();
    if (env.nodeEnv !== 'production') {
      console.warn('[startup] API ativa sem MongoDB — aguardando reconexão ou login dev após subir o banco.');
    }
  }
}

async function start() {
  const hubUri = getMongoHubCentralUri();
  console.log(
    `[env] Desk cluster (MONGO_URI/MONGODB_URI): ${env.mongoUri ? 'configurado' : 'AUSENTE'}`,
  );
  console.log(
    `[env] VeloHubCentral colaboradores (MONGO_ENV): ${hubUri ? 'configurado' : 'AUSENTE — /api/colaboradores retorna 503'}`,
  );

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`API Velodesk v1.2.0 — http://0.0.0.0:${env.port} (${env.nodeEnv})`);
    void bootstrapDatabase().then(async () => {
      await bootstrapEmailServices();
      await logLanguageToolStartupStatus();
      if (isOpenAiTicketSuggestConfigured()) {
        console.log('[ticket-ai] OpenAI configurado (sugestão resposta + tabulação).');
      } else {
        const aiStatus = getOpenAiTicketSuggestStatus();
        console.warn(
          '[ticket-ai] OpenAI NÃO configurado — sugestão IA retornará 503. Faltam:',
          aiStatus.missing.join(', ') || '(desconhecido)',
        );
      }
      if (env.agentsEnabled) {
        const agentsStatus = getAgentsStatus();
        console.log('[agents] Programa de agentes paralelos ativo.', {
          configured: agentsStatus.configured,
          autonomy: env.agentsAutonomyEnabled,
        });
        startGestaoChamadosJob();
      }
      // Independente do programa de agentes autônomos — controlado só por CHAMADO_IA_ANALISE_ENABLED.
      startChamadoIaAnaliseJob();
      startCloseResolvedTicketsJob();
      startCsatRepescagemJob();
      startCsatInicialJob();
      startWhatsappCostSyncJob();
      startEmailSlaTriggerJob();
      startResolvePendenteTicketsJob();
      startWhatsAppAudioTranscriptionWorker();
    });
  });
}

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException (processo continua):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection (processo continua):', reason);
});

process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});

start();
