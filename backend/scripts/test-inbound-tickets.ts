/** Teste local — POST /api/inbound/tickets (App / Telefone / Agente IA) */
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { ChamadoN1 } from '../src/models/ChamadoN1';
import { generateInboundTicketSecret } from './generate-inbound-ticket-secrets';
import {
  findExistingInboundTicket,
  parseInboundTicketPayload,
  processInboundTicket,
} from '../src/services/inbound-ticket/inboundTicket.service';
import { ORIGIN_CANAL_CONFIG } from '../src/services/inbound-ticket/types';

const TEST_PREFIX = 'test-inbound-ticket-';

async function cleanup(): Promise<void> {
  await ChamadoN1.deleteMany({
    registro: {
      $elemMatch: {
        'metadados.inboundTicketExternalId': { $regex: `^${TEST_PREFIX}` },
      },
    },
  });
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  await connectDatabase();
  await cleanup();

  const sampleKey = generateInboundTicketSecret();
  assert(/^[a-z0-9]{35}$/.test(sampleKey), 'gerador deve produzir chave [a-z0-9]{35}');

  try {
    parseInboundTicketPayload({});
  } catch (err) {
    assert((err as Error).message.includes('externalId'), 'validação externalId');
  }

  const appExternalId = `${TEST_PREFIX}app-001`;
  const appCreated = await processInboundTicket('app', {
    externalId: appExternalId,
    title: 'Teste App',
    text: 'Descrição teste app inbound ticket.',
    clientName: 'Cliente Teste App',
    clientCPF: '52998224725',
    canal: 'DeveSerIgnorado',
  });
  assert(appCreated.action === 'created', 'app created');
  assert(appCreated.canal === ORIGIN_CANAL_CONFIG.app.canal, 'canal App na resposta');

  const appDup = await processInboundTicket('app', {
    externalId: appExternalId,
    title: 'Teste App',
    text: 'Retry',
    clientName: 'Cliente Teste App',
    clientCPF: '52998224725',
  });
  assert(appDup.action === 'duplicate', 'app duplicate');
  assert(appDup.ticketId === appCreated.ticketId, 'app duplicate mesmo ticketId');

  const appSaved = await findExistingInboundTicket('app', appExternalId);
  assert(appSaved, 'app salvo');
  assert(
    appSaved!.registro?.[0]?.metadados?.inboundTicketOrigin === 'app',
    'metadados inboundTicketOrigin app',
  );

  const telExternalId = `${TEST_PREFIX}telefone-001`;
  const telCreated = await processInboundTicket('telefone', {
    externalId: telExternalId,
    title: 'Teste Telefone',
    text: 'Ligação humana teste.',
    clientName: 'Cliente Teste Tel',
    clientPhone: '5511999990001',
    responsavel: 'Operador Teste',
  });
  assert(telCreated.action === 'created', 'telefone created');
  assert(telCreated.canal === 'Telefone', 'canal Telefone');

  const iaExternalId = `${TEST_PREFIX}agente-ia-001`;
  const iaCreated = await processInboundTicket('agente-ia', {
    externalId: iaExternalId,
    title: 'Teste Agente IA',
    text: 'Resumo da ligação IA.',
    clientName: 'Cliente Teste IA',
    clientPhone: '5511888880002',
    metadata: { telephonyCallId: 'call-test-001' },
  });
  assert(iaCreated.action === 'created', 'agente-ia created');
  assert(iaCreated.canal === 'Agente IA', 'canal Agente IA');

  const iaSaved = await ChamadoN1.findById(iaCreated.ticketId).lean();
  assert(
    iaSaved?.registro?.[0]?.metadados?.inboundTicketMetadata?.telephonyCallId === 'call-test-001',
    'metadata telephonyCallId persistido',
  );
  assert(
    !String(iaSaved?.tabulacao?.[0]?.responsavel ?? '').trim(),
    'agente-ia sem responsavel explícito não deve ser atribuído pela roleta genérica',
  );

  console.log('OK test:inbound-tickets', {
    app: appCreated.chamadoProtocolo,
    telefone: telCreated.chamadoProtocolo,
    agenteIa: iaCreated.chamadoProtocolo,
    sampleKeyLength: sampleKey.length,
  });

  await cleanup();
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('FAIL test:inbound-tickets', err);
  try {
    await cleanup();
    await disconnectDatabase();
  } catch {
    // ignore
  }
  process.exit(1);
});
