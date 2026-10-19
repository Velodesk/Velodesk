/**
 * test-gratitude-reply-gate — testa resolveInboundClientReplyStatusSmart isoladamente.
 * Cria 1 ticket de teste, marca como Resolvido, e simula respostas de cliente com textos
 * variados (agradecimento puro, agradecimento+pedido novo, pergunta nova, mensagem crítica),
 * mostrando se cada uma reabriria o ticket ou manteria Resolvido — sem nenhum envio real
 * (WhatsApp/e-mail), sem fila de aprovação, sem tocar em ticket real.
 *
 * Pré-requisito: GRATITUDE_REPLY_GATE_ENABLED=true no .env (independente de AGENTS_ENABLED).
 * Uso: npx tsx scripts/test-gratitude-reply-gate.ts            (roda os 5 casos padrão)
 *      KEEP=1 npx tsx scripts/test-gratitude-reply-gate.ts     (deixa salvo pra ver no Desk)
 *      npx tsx scripts/test-gratitude-reply-gate.ts "texto"    (testa só esse texto, KEEP=1 implícito)
 */

async function main() {
  const { env } = await import('../src/config/env');
  const { connectDatabase } = await import('../src/config/database');
  const { ChamadoN1 } = await import('../src/models/ChamadoN1');
  const { createChamadoFromBody, appendStatusTransition, appendMessage, currentStatus, normalizeStatusValue } = await import('../src/services/chamado.mapper');
  const { resolveInboundClientReplyStatusSmart } = await import('../src/services/agents/gratitudeReplyGate.service');

  console.log(`gratitudeReplyGateEnabled=${env.gratitudeReplyGateEnabled} | agentsEnabled=${env.agentsEnabled}`);
  if (!env.gratitudeReplyGateEnabled) {
    throw new Error('ABORTADO: GRATITUDE_REPLY_GATE_ENABLED=false — ligue no .env antes de rodar.');
  }

  await connectDatabase();

  const customText = process.argv[2];
  const keep = process.env.KEEP === '1' || Boolean(customText);

  const cases: Array<{ label: string; texto: string }> = customText
    ? [{ label: 'Texto customizado', texto: customText }]
    : [
      { label: 'Agradecimento óbvio (deve bater na base de exemplos, sem LLM)', texto: 'Obrigada!' },
      { label: 'Agradecimento mais elaborado (deve precisar do Agente 1 + Agente 2)', texto: 'Muito obrigada pela atenção de vocês, foi super rápido!' },
      { label: 'Agradecimento + pedido novo (NÃO deve fechar)', texto: 'Obrigada! Mas uma dúvida: isso já valeu pra esse mês também?' },
      { label: 'Pergunta nova, sem agradecimento (NÃO deve fechar)', texto: 'Vocês já enviaram o boleto atualizado?' },
      { label: 'Reclamação com palavra crítica (NÃO deve fechar, trava determinística)', texto: 'Obrigada, mas vou processar vocês se isso não for resolvido.' },
    ];

  const created: string[] = [];

  try {
    for (const c of cases) {
      const partial = await createChamadoFromBody(
        {
          chamadoTitulo: `[TESTE gratitude-gate] ${c.label}`,
          title: `[TESTE gratitude-gate] ${c.label}`,
          text: 'Mensagem original de teste — ticket criado só pra validar o gratitudeReplyGate.',
          status: 'novo',
          clientName: 'Cliente Teste Gratitude Gate',
          author: 'sistema-teste',
          lateralForm: { classificacaoTipo: 'Solicitação', tipoChamado: 'Solicitação', canal: 'E-mail', clienteNome: 'Cliente Teste Gratitude Gate' },
        },
        'novo',
      );
      const chamado = await ChamadoN1.create(partial);
      created.push(chamado._id.toString());

      appendStatusTransition(chamado, 'resolvido', { autor: 'teste-script', origin: 'agente' });
      chamado.markModified('registro');
      await chamado.save();

      console.log(`\n--- ${c.label} ---`);
      console.log(`ticket: ${chamado._id} | protocolo: ${chamado.chamadoProtocolo} | status antes: ${currentStatus(chamado)}`);
      console.log(`resposta do cliente simulada: "${c.texto}"`);

      // Mesma ordem da produção: a mensagem do cliente entra na conversa ANTES do gate decidir
      // o status — sem isso, o ticket fica com uma nota interna "do nada", sem o texto que a
      // motivou visível na conversa.
      appendMessage(chamado, c.texto, false, 'them', [], { source: 'teste-script' });

      const result = await resolveInboundClientReplyStatusSmart(chamado, c.texto);

      if (result === undefined) {
        console.log('RESULTADO: manteve Resolvido (gate decidiu que é agradecimento puro)');
      } else if (result !== normalizeStatusValue(currentStatus(chamado))) {
        appendStatusTransition(chamado, result, { origin: 'cliente', autor: 'Cliente Teste Gratitude Gate' });
        console.log(`RESULTADO: reabriu para status "${result}" (comportamento normal, sem fechar sozinho)`);
      }

      // Persiste a nota interna (caso fechado) ou a reabertura (caso normal) — sem isso, nada
      // fica salvo pra ver no Desk depois.
      chamado.markModified('registro');
      await chamado.save();
    }

    if (keep) {
      console.log('\nTickets de teste mantidos no banco (fila Resolvidos/Em andamento):');
      created.forEach((id, i) => console.log(`  ${cases[i].label} → ticket ${id}`));
      console.log('Busque pelo título "[TESTE gratitude-gate]" na lista de tickets.');
      return;
    }
  } finally {
    if (created.length && !keep) {
      await ChamadoN1.deleteMany({ _id: { $in: created } });
      console.log(`\nLimpeza: ${created.length} ticket(s) de teste removido(s).`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('ERRO:', err);
    process.exit(1);
  });
