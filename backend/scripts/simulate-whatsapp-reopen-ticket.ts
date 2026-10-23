/**
 * simulate-whatsapp-reopen-ticket — cria um ticket de SIMULAÇÃO no banco de DEV com uma conversa
 * de WhatsApp que foi reaberta depois da janela de 24h: um bloco de mensagens de 3 dias atrás e um
 * bloco novo hoje (template de reabertura + resposta do cliente). Serve pra testar na tela o
 * divisor de data entre os blocos e a data/hora no hover das mensagens.
 *
 * Cliente e telefone são fictícios e nada passa pelo Twilio — nenhuma mensagem sai de verdade.
 * Não grava nada no cadastro de clientes. Só roda contra o cluster de dev (trava abaixo).
 *
 * Uso: npx tsx scripts/simulate-whatsapp-reopen-ticket.ts <email-do-responsavel> ["Nome do responsável"] [--tipo=desk|consumidor-gov|reclame-aqui]
 *
 * Em consumidor-gov / reclame-aqui também cria o documento da reclamação (base chamados_reclamacoes),
 * que é de onde as listas dos casos especiais leem — mesmo passo do POST /reclamacoes/:orgao, mas sem
 * rodar a triagem (que reatribui responsável e pode ativar workflow). Prazo = hoje, então o ticket cai
 * na aba "Vencendo hoje".
 */

const FAKE_WA_CHAT_ID = '5511900000000';
const FAKE_CLIENT_NAME = 'Cliente Simulação WhatsApp';

/** Instante `daysAgo` dias atrás, às HH:MM no horário de Brasília. */
function brAt(daysAgo: number, hh: number, mm: number): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const base = new Date(`${today}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`);
  return new Date(base.getTime() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

type Tipo = 'desk' | 'consumidor-gov' | 'reclame-aqui';

function buildBody(tipo: Tipo, simId: string): Record<string, unknown> {
  const base = {
    title: '[SIMULAÇÃO] WhatsApp reaberto após 24h',
    clientName: FAKE_CLIENT_NAME,
    text: 'Ticket de simulação para testar o divisor de data na reabertura do WhatsApp.',
  };
  if (tipo === 'desk') return base;

  const hoje = brAt(0, 23, 0);
  const tresDiasAtras = brAt(3, 9, 0);
  const comum = {
    assunto: '[SIMULAÇÃO] Restituição não recebida',
    descricao: base.text,
    consumidor: FAKE_CLIENT_NAME,
    produto: 'Restituição',
    tipo: 'Reclamação',
    motivo: 'Restituição não recebida',
  };
  const lateralBase = {
    classificacaoTipo: 'Reclamação',
    tipoChamado: 'Reclamação',
    produto: comum.produto,
    motivo: comum.motivo,
    clienteNome: FAKE_CLIENT_NAME,
    clienteTelefone: [],
    clienteEmail: [],
  };

  if (tipo === 'consumidor-gov') {
    return {
      ...base,
      chamadoTitulo: 'Demanda Consumidor.Gov',
      lateralForm: {
        ...lateralBase,
        detalhe: 'Demanda Consumidor.Gov',
        canal: 'Consumidor.Gov',
        consumidorGov: {
          ...comum,
          protocoloGov: simId,
          idDemanda: simId,
          statusGov: 'nao-respondida',
          prazoLegal: hoje,
          dataDemanda: tresDiasAtras,
          dataReclamacao: tresDiasAtras,
        },
      },
    };
  }

  return {
    ...base,
    chamadoTitulo: 'Reclamação Reclame Aqui',
    lateralForm: {
      ...lateralBase,
      detalhe: 'Reclamação Reclame Aqui',
      canal: 'Reclame Aqui',
      reclameAqui: {
        ...comum,
        protocoloRa: simId,
        idReclamacaoRa: simId,
        statusRa: 'nao-respondida',
        prazoRa: hoje,
        dataReclamacao: tresDiasAtras,
        passivelNota: false,
        urlRa: '',
      },
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const tipoArg = args.find((a) => a.startsWith('--tipo='));
  const positional = args.filter((a) => !a.startsWith('--'));
  const email = String(positional[0] || '').trim();
  const name = String(positional[1] || '').trim() || undefined;
  const tipo = (tipoArg ? tipoArg.slice('--tipo='.length) : 'desk') as Tipo;
  if (!email || !['desk', 'consumidor-gov', 'reclame-aqui'].includes(tipo)) {
    throw new Error(
      'Uso: npx tsx scripts/simulate-whatsapp-reopen-ticket.ts <email> ["Nome"] [--tipo=desk|consumidor-gov|reclame-aqui]',
    );
  }

  const { env } = await import('../src/config/env');
  const uri = String(process.env.MONGODB_URI || process.env.MONGO_URI || '');
  if (!/velodesk-dev/i.test(uri)) {
    throw new Error('Abortado: MONGODB_URI não aponta pro cluster de dev (velodesk-dev). Simulação só roda em dev.');
  }

  const { connectDatabase } = await import('../src/config/database');
  const { ChamadoN1 } = await import('../src/models/ChamadoN1');
  const { createChamadoFromBody } = await import('../src/services/chamado.mapper');
  const { applySessionResponsavelIfNeeded } = await import('../src/services/assignmentRouter.service');
  const {
    appendWhatsAppMensagemToChamado,
    findWhatsAppThreadRegistro,
    WHATSAPP_MENSAGENS_KEY,
  } = await import('../src/services/twilio/whatsappThread.service');

  await connectDatabase();
  console.log(`Banco: ${env.mongoDbName} (cluster de dev)`);

  const authUser = { userId: 'simulacao', email, role: 'agent', name };
  const simId = `SIM-${Date.now()}`;
  const partial = await createChamadoFromBody(buildBody(tipo, simId), 'novo', authUser);
  applySessionResponsavelIfNeeded(partial, authUser);
  const chamado = await ChamadoN1.create(partial);

  const script: Array<{ at: string; origin: 'agente' | 'cliente'; texto: string }> = [
    // Bloco 1 — 3 dias atrás
    { at: brAt(3, 10, 2), origin: 'agente', texto: `Olá, ${FAKE_CLIENT_NAME}! Aqui é a Velotax, sobre o seu chamado ${chamado.chamadoProtocolo}.` },
    { at: brAt(3, 10, 15), origin: 'cliente', texto: 'Oi! Queria saber da minha restituição.' },
    { at: brAt(3, 10, 20), origin: 'agente', texto: 'Claro! Vou verificar e te retorno por aqui.' },
    { at: brAt(3, 10, 31), origin: 'cliente', texto: 'Obrigada, fico no aguardo.' },
    // Bloco 2 — hoje, reabertura depois da janela de 24h
    { at: brAt(0, 9, 0), origin: 'agente', texto: `Olá, ${FAKE_CLIENT_NAME}! Retomando o seu chamado ${chamado.chamadoProtocolo}.` },
    { at: brAt(0, 9, 12), origin: 'cliente', texto: 'Oi, pode falar!' },
    { at: brAt(0, 9, 15), origin: 'agente', texto: 'Sua restituição já foi liberada e cai na conta em até 2 dias úteis.' },
  ];

  for (const item of script) {
    appendWhatsAppMensagemToChamado(chamado, {
      origin: item.origin,
      autor: item.origin === 'cliente' ? FAKE_CLIENT_NAME : (name || email),
      texto: item.texto,
      waChatId: FAKE_WA_CHAT_ID,
      deliveryStatus: item.origin === 'agente' ? 'read' : undefined,
    });
  }

  // appendWhatsAppMensagemToChamado carimba "agora" — reescreve as datas pra montar a linha do tempo.
  const thread = findWhatsAppThreadRegistro(chamado, FAKE_WA_CHAT_ID);
  if (!thread) throw new Error('Thread de WhatsApp não foi criada.');
  const meta = thread.registro.metadados as Record<string, unknown>;
  const list = meta[WHATSAPP_MENSAGENS_KEY] as Array<Record<string, unknown>>;
  list.forEach((row, i) => {
    row.data = script[i].at;
    row.id = `wa-sim-${new Date(script[i].at).getTime()}-${i}`;
    if (row.deliveryStatusAt) row.deliveryStatusAt = script[i].at;
  });
  thread.registro.data = new Date(script[script.length - 1].at);
  chamado.markModified(`registro.${thread.index}.metadados`);
  await chamado.save();

  if (tipo !== 'desk') {
    const orgao = tipo === 'consumidor-gov' ? 'consumidor_gov' : 'reclame_aqui';
    const { upsertFromChamado } = await import('../src/services/reclamacoes/reclamacao.service');
    const { buildFastPathTriagem } = await import('../src/services/agents/casosEspeciaisAgent.service');
    const doc = await upsertFromChamado(
      chamado,
      {
        ...buildFastPathTriagem(orgao, ['simulacao-script']),
        signals: ['simulacao-script'],
        at: new Date().toISOString(),
      },
      { origemEntrada: 'reclamacoes-manual' },
    );
    if (!doc) throw new Error(`Ticket criado, mas a reclamação (${orgao}) não foi gravada.`);
    console.log(`Reclamação ${orgao} criada: ${simId}`);
  }

  console.log(`Criado: ticket ${chamado.chamadoProtocolo} (${chamado._id}) — tipo ${tipo}`);
  console.log(`Responsável: ${email}`);
  console.log('Abra o ticket no Desk e clique em "Abrir conversa do WhatsApp".');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
