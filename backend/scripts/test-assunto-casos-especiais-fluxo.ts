/**
 * test-assunto-casos-especiais-fluxo — teste ponta a ponta com OUTBOUND BLOQUEADO.
 *
 * Cenários reais: o gatilho de caso especial é SÓ o assunto do e-mail (Config > Assuntos
 * Prioritários); corpo com menção a órgão não escala. Para cada cenário:
 *   1. cria o ticket como se fosse e-mail inbound (marcado QA, sem cliente vinculado);
 *   2. roda runCasosEspeciaisTriagem (precheck por assunto → fast-path → roteamento → Agente 5);
 *   3. simula os agentes autônomos em modo 'desk' (sugestão, NUNCA envio) com dados reais do
 *      contrato vindos da Customer Data API;
 *   4. apaga tudo que criou.
 *
 * Bloqueio de e-mail em 3 camadas: EMAIL_ENABLED=false (sendOutboundEmail vira no-op), ticket
 * marcado QA com QA_EMAIL_ALLOWLIST vazia, e hook em net.Socket.connect que ABORTA qualquer
 * conexão para SMTP/Gmail (portas 25/465/587/2525 ou host smtp/gmail/mail).
 *
 * Uso: VELODESK_DOTENV_PATH=<arquivo com EMAIL_ENABLED=false> npx tsx scripts/test-assunto-casos-especiais-fluxo.ts
 * (o loader de env carrega .env com override — só VELODESK_DOTENV_PATH, carregado por último, ganha dele)
 */
process.env.EMAIL_ENABLED = 'false';
process.env.QA_EMAIL_ALLOWLIST = '';
delete process.env.VELODESK_WEBHOOK_URL;

import net from 'net';

const hostsContacted = new Set<string>();
const blockedAttempts: string[] = [];
const origConnect = net.Socket.prototype.connect;
(net.Socket.prototype as any).connect = function patchedConnect(this: net.Socket, ...args: any[]) {
  const o = typeof args[0] === 'object' && args[0] ? args[0] : { port: args[0], host: args[1] };
  const host = String(o.host ?? o.hostname ?? 'localhost');
  const port = Number(o.port);
  hostsContacted.add(`${host}:${port}`);
  if ([25, 465, 587, 2525].includes(port) || /smtp|gmail|mail\.|mailgun|sendgrid|amazonses/i.test(host)) {
    blockedAttempts.push(`${host}:${port}`);
    throw new Error(`OUTBOUND DE E-MAIL BLOQUEADO PELO TESTE (${host}:${port})`);
  }
  return (origConnect as any).apply(this, args);
};

const RUN = Date.now().toString(36);

interface Scenario {
  id: string;
  cpf: string;
  contratoEsperado: string;
  subject: string;
  corpo: string;
  esperaEscalar: boolean;
  orgaoEsperado?: string;
}

function fmtCpf(d: string): string {
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function buildScenarios(): Scenario[] {
  const ATRASADO = '02013500505'; // contrato de empréstimo pessoal ATRASADO (API)
  const ATIVO = '39323097829'; // contrato de empréstimo pessoal ATIVO / em vigência (API)
  const n = (k: number) => `${RUN}${k}`.replace(/[^0-9]/g, '').padEnd(8, '1').slice(0, 8);

  const cgovBody = (cpf: string, proto: string, relato: string) => `
Prezados,

Foi registrada reclamação na plataforma Consumidor.gov.br contra a empresa, para análise e resposta no prazo informado.

Consumidor: Consumidor Teste QA
CPF: ${fmtCpf(cpf)}
Telefone: (11) 90000-0000
Cidade/UF: São Paulo/SP
Número do protocolo: ${proto}
Produto/Serviço: Empréstimo pessoal

Relato do consumidor: ${relato}

Prazo de resposta: 20/10/2026
Data de abertura: 08/10/2026
`.trim();

  const bacenBody = (cpf: string, rdr: string, relato: string) => `
Prezados,

O Banco Central do Brasil encaminha a demanda registrada no Registro de Demandas do Cidadão (RDR) abaixo, para esclarecimentos no prazo indicado.

Reclamante: Consumidor Teste QA
CPF: ${fmtCpf(cpf)}
Número da demanda RDR: ${rdr}
Produto/Serviço: Empréstimo pessoal

Relato: ${relato}

Prazo de resposta: 25/10/2026
Data de abertura: 08/10/2026
`.trim();

  return [
    {
      id: 'A', cpf: ATRASADO, contratoEsperado: 'OVERDUE', esperaEscalar: true, orgaoEsperado: 'consumidor_gov',
      subject: `Solicitação de negociação de contrato - CGOV - 2026.10/${n(1)}0001 - Prazo: 20/10`,
      corpo: cgovBody(ATRASADO, `2026.10/${n(1)}0001`, 'Estou com parcelas do meu empréstimo pessoal em atraso e quero negociar o contrato para quitar a dívida em condições possíveis.'),
    },
    {
      id: 'B', cpf: ATIVO, contratoEsperado: 'ACTIVE', esperaEscalar: true, orgaoEsperado: 'bacen',
      subject: `Solicitação de redução de juros - BACEN/ RDR - 2026${n(2)} - Prazo: 25/10/2026`,
      corpo: bacenBody(ATIVO, `2026${n(2)}`, 'Meu empréstimo pessoal está com juros muito acima do que me foi apresentado na contratação e solicito a redução da taxa.'),
    },
    {
      id: 'C', cpf: ATRASADO, contratoEsperado: 'OVERDUE', esperaEscalar: true, orgaoEsperado: 'bacen',
      subject: `Solicitação de redução de juros - BACEN/ RDR - 2026${n(3)} - Prazo: 25/10/2026`,
      corpo: bacenBody(ATRASADO, `2026${n(3)}`, 'Meu empréstimo pessoal está atrasado e os juros de mora estão abusivos. Peço a redução dos juros para conseguir regularizar.'),
    },
    {
      id: 'D', cpf: ATIVO, contratoEsperado: 'ACTIVE', esperaEscalar: true, orgaoEsperado: 'consumidor_gov',
      subject: `Solicitação de negociação de contrato - CGOV - 2026.10/${n(4)}0001 - Prazo: 20/10`,
      corpo: cgovBody(ATIVO, `2026.10/${n(4)}0001`, 'Quero renegociar o prazo e o valor das parcelas restantes do meu empréstimo pessoal, que está em dia.'),
    },
    {
      // Controle negativo: corpo cheio de menção a órgão, mas assunto comum → NÃO pode escalar.
      id: 'E (negativo)', cpf: ATRASADO, contratoEsperado: 'OVERDUE', esperaEscalar: false,
      subject: 'Dúvida sobre pagamento da minha parcela',
      corpo: 'Olá, minha parcela do empréstimo pessoal está atrasada. Se vocês não me derem uma solução eu vou no Procon e no Banco Central registrar reclamação. Meu CPF é ' + fmtCpf(ATRASADO) + '. Como faço para regularizar?',
    },
  ];
}

async function main() {
  const { env } = await import('../src/config/env');
  if (env.emailEnabled) throw new Error('ABORTADO: env.emailEnabled deveria ser false neste teste.');
  if (env.velodeskWebhookUrl) throw new Error('ABORTADO: webhook outbound do App está configurado.');

  const { connectDatabase } = await import('../src/config/database');
  const { ChamadoN1 } = await import('../src/models/ChamadoN1');
  const { createChamadoFromBody } = await import('../src/services/chamado.mapper');
  const { loadMailPrioritySubjectRules, detectPrioritySubjectMatch } = await import('../src/services/mailPrioritySubjectRules.service');
  const { detectCasoEspecialSignal } = await import('../src/services/agents/casosEspeciaisPrecheck');
  const { runCasosEspeciaisTriagem } = await import('../src/services/agents/casosEspeciaisTrigger.service');
  const { resolveReclamacaoModel } = await import('../src/services/reclamacoes/reclamacao.service');
  const { runAgentPipeline } = await import('../src/services/agents/agentOrchestrator.service');
  const { findClienteByCpf } = await import('../src/services/cliente.service');
  const { hydrateProductForTicket } = await import('../src/services/consultaHidratacao.service');
  const { isHidratacaoEnabled } = await import('../src/services/agents/autonomyRules.service');
  const { getWorkflowNotificacaoModel } = await import('../src/models/WorkflowNotificacao');
  const { AiUsageLog } = await import('../src/models/AiUsageLog');

  await connectDatabase();
  await loadMailPrioritySubjectRules();
  const probe = detectPrioritySubjectMatch('Solicitação X - CGOV - 1', '');
  console.log(`[setup] regras de assunto carregadas; sonda CGOV → ${probe.matched ? `${probe.rule?.value}→${probe.rule?.orgao}` : 'SEM MATCH'}`);
  console.log(`[setup] EMAIL_ENABLED=${env.emailEnabled} | agente4=${env.agentCasosEspeciaisEnabled} | agente5=${env.agentCasosEspeciaisExtracaoEnabled}`);

  const scenarios = buildScenarios();
  const preExisting = new Map<string, boolean>();
  for (const s of scenarios) if (!preExisting.has(s.cpf)) preExisting.set(s.cpf, Boolean(await findClienteByCpf(s.cpf)));

  const createdIds: string[] = [];
  const summary: Array<Record<string, unknown>> = [];

  try {
    for (const s of scenarios) {
      console.log(`\n================ CENÁRIO ${s.id} — CPF ***${s.cpf.slice(-4)} (contrato ${s.contratoEsperado}) ================`);
      console.log(`assunto: ${s.subject}`);

      const payload = {
        chamadoTitulo: s.subject,
        title: s.subject,
        text: s.corpo,
        description: s.corpo,
        status: 'novo',
        clientName: 'Consumidor Teste QA',
        author: 'sistema-teste',
        lateralForm: { classificacaoTipo: 'Reclamação', tipoChamado: 'Reclamação', canal: 'E-mail', clienteNome: 'Consumidor Teste QA' },
      };
      const partial = await createChamadoFromBody(payload, 'novo');
      if (partial.registro?.[0]) {
        partial.registro[0].origin = 'cliente';
        partial.registro[0].autor = 'Consumidor Teste QA';
        partial.registro[0].metadados = {
          ...(partial.registro[0].metadados ?? {}),
          source: 'email-inbound',
          emailFrom: 'caixa-teste@teste.invalid',
          origemQa: 'qa-velodesk',
          inboundTicketExternalId: `qa-velodesk-assunto-${RUN}-${s.id[0]}`,
        };
      }
      const chamado = await ChamadoN1.create(partial);
      createdIds.push(String(chamado._id));
      console.log(`ticket ${chamado.chamadoProtocolo} criado (marcado QA, sem cliente vinculado)`);

      const sig = detectCasoEspecialSignal(chamado);
      console.log(`precheck: triggered=${sig.triggered} fastPath=${sig.fastPathReal} origem=${sig.origemProvavel} sinais=${JSON.stringify(sig.signals)}`);

      const trig = await runCasosEspeciaisTriagem(chamado, { source: 'teste-assunto-fluxo' });
      console.log(`triagem: ${JSON.stringify(trig)}`);

      const fresh = (await ChamadoN1.findById(chamado._id))!;
      const tab = fresh.tabulacao?.[fresh.tabulacao.length - 1];
      const cli = fresh.cliente?.[0];
      const escalou = ['routed'].includes(String(trig.action));
      console.log(`estado: canal="${tab?.canal ?? ''}" produto="${tab?.produto ?? ''}" motivo="${tab?.motivo ?? ''}" responsavel="${tab?.responsavel ?? ''}"`);
      console.log(`cliente associado: ${cli?.clienteCpf ? `***${String(cli.clienteCpf).slice(-4)}` : '(nenhum)'} | workflow: ${fresh.workflow ? 'ATIVOU' : 'não'}`);

      // Simulação dos agentes autônomos — modo 'desk': gera sugestão + auditoria, NUNCA envia.
      const msgs = [{ role: 'cliente' as const, text: s.corpo }];

      // A hidratação automática do pipeline está desligada na config do dev (hidratacaoConsulta);
      // aqui usamos a MESMA função que ele usaria (consulta oficial do contrato na Customer Data
      // API pelo CPF do ticket) e entregamos o resultado ao agente como dadosConta.
      // Com hidratacaoConsulta LIGADA o pipeline faz isso sozinho (classifica → consulta a API →
      // redige com os dados); só cai no caminho manual se a flag estiver desligada.
      const pipelineHidrata = await isHidratacaoEnabled();
      const hid = pipelineHidrata
        ? { status: 'pipeline' as const, bloco: '', motivo: undefined as string | undefined }
        : await hydrateProductForTicket({
          ticketId: String(chamado._id),
          protocolo: chamado.chamadoProtocolo,
          slug: 'emprestimo-pessoal',
          motivo: tab?.motivo,
          contextText: s.corpo,
        });
      console.log(pipelineHidrata
        ? 'contrato: hidratação do PRÓPRIO pipeline (hidratacaoConsulta=true)'
        : `contrato (API, caminho manual — flag desligada): status=${hid.status}${hid.motivo ? ` (${hid.motivo})` : ''}`);
      if (hid.bloco) console.log(hid.bloco.split('\n').slice(0, 18).map((l) => '    # ' + l).join('\n'));
      const pipe = await runAgentPipeline({
        ticketId: String(chamado._id),
        protocolo: chamado.chamadoProtocolo,
        titulo: s.subject,
        canal: 'E-mail',
        status: 'novo',
        clientName: 'Consumidor Teste QA',
        nomeOperador: 'Atendimento Velotax',
        contextSource: 'public',
        messages: msgs,
        produtoHint: 'Empréstimo Pessoal',
        dadosConta: hid.bloco || undefined,
        pipelineModo: 'desk',
      });
      console.log(`agentes (simulação, sem envio): sucesso=${pipe.success} hidratação(pipeline)=${JSON.stringify(pipe.hidratacao ?? null)} envioAutonomo=${pipe.envioAutonomo ?? false} aguardandoAprovacao=${pipe.aguardandoAprovacao ?? false}`);
      if (pipe.success) {
        console.log(`  tabulação sugerida: ${pipe.tabulacaoDisplay ?? JSON.stringify(pipe.tabulacao)}`);
        console.log(`  auditoria: score=${pipe.auditScore} decisão=${pipe.auditDecisao} criticidade=${pipe.nivelCriticidade}`);
        console.log(`  resposta sugerida:\n${String(pipe.respostaSugerida).split('\n').map((l) => '    | ' + l).join('\n')}`);
      } else {
        console.log(`  erro: ${pipe.error}`);
      }

      summary.push({
        cenario: s.id, escalou, esperado: s.esperaEscalar, orgao: tab?.canal, orgaoEsperado: s.orgaoEsperado,
        ok: escalou === s.esperaEscalar,
        clienteAssociado: Boolean(cli?.clienteCpf), produto: tab?.produto, motivo: tab?.motivo,
        workflow: Boolean(fresh.workflow), hidratacao: pipe.hidratacao?.status ?? hid.status, audit: pipe.auditDecisao ?? null,
      });
    }
  } finally {
    console.log('\n[limpeza] removendo tudo que o teste criou…');
    const NotifModel = getWorkflowNotificacaoModel();
    let notifs = 0; let usage = 0; let recl = 0;
    const destinatarios = new Set<string>();
    for (const id of createdIds) {
      for (const n of await NotifModel.find({ ticketId: id }).lean()) destinatarios.add(String(n.destinatarioEmail));
      for (const org of ['procon', 'bacen', 'consumidor_gov'] as const) {
        const M = resolveReclamacaoModel(org);
        if (M) recl += (await M.deleteMany({ chamadoId: id })).deletedCount ?? 0;
      }
      notifs += (await NotifModel.deleteMany({ ticketId: id })).deletedCount ?? 0;
      usage += (await AiUsageLog.deleteMany({ ticketId: id })).deletedCount ?? 0;
      await ChamadoN1.deleteOne({ _id: id });
    }
    for (const [cpf, existed] of preExisting) {
      if (existed) continue;
      const c = await findClienteByCpf(cpf);
      if (c) await c.deleteOne();
    }
    console.log(`[limpeza] destinatários dos avisos internos (sininho): ${[...destinatarios].join(', ') || '(nenhum)'}`);
    console.log(`[limpeza] chamados=${createdIds.length} reclamações=${recl} notificações=${notifs} usageLogs=${usage}; clientes criados pelo teste removidos.`);
  }

  console.log('\n================ RESUMO ================');
  console.table(summary);
  console.log(`tentativas de conexão SMTP/Gmail bloqueadas: ${blockedAttempts.length}${blockedAttempts.length ? ' → ' + blockedAttempts.join(', ') : ''}`);
  console.log(`hosts contatados (${hostsContacted.size}): ${[...hostsContacted].map((h) => h.replace(/^[^.]*\.([^.]+\.mongodb\.net)/, '*.$1')).join(' | ')}`);
  process.exit(summary.every((r) => r.ok) && blockedAttempts.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[test] ERRO FATAL:', err);
  process.exit(1);
});
