/**
 * test-n1-ia-autonoma — IA autônoma atendendo ticket N1 (NÃO caso especial), outbound desligado.
 *
 * NENHUM parâmetro de teste é embutido aqui: cada rodada vem do arquivo JSON passado em argv[2]:
 *   [{ "id": "R1", "cpf": "00000000000", "assunto": "<literal>", "corpo": "<literal>" }, ...]
 *
 * Caminho exercitado = o de produção para ticket novo: runInboundPostCreateHooks
 *   → triagem casos especiais (precisa NÃO disparar; se disparar, a rodada é ABORTADA)
 *   → runInboundAgentPipeline → runAgentPipeline (modo 'inbound' se autonomia ligada)
 *   → hidratação (Customer Data API) → Agente 1 → Agente 2 → regras de autonomia → fila/envio.
 *
 * Bloqueio de e-mail: rode com VELODESK_DOTENV_PATH apontando p/ arquivo com EMAIL_ENABLED=false
 * (o loader de env carrega .env com override). O script ABORTA se EMAIL_ENABLED=true, se o
 * webhook do App estiver configurado ou se hidratacaoConsulta estiver desligada; e além disso
 * derruba qualquer conexão a SMTP/Gmail.
 *
 * Uso: VELODESK_DOTENV_PATH=<arq> npx tsx scripts/test-n1-ia-autonoma.ts <rodadas.json>
 */
import fs from 'fs';
import net from 'net';

process.env.EMAIL_ENABLED = 'false';
delete process.env.VELODESK_WEBHOOK_URL;

// ---------- instrumentação ----------
const t0 = Date.now();
const ms = () => `+${String(Date.now() - t0).padStart(6)}ms`;

const blockedSmtp: string[] = [];
const hosts = new Set<string>();
const origConnect = net.Socket.prototype.connect;
(net.Socket.prototype as any).connect = function patched(this: net.Socket, ...args: any[]) {
  const o = typeof args[0] === 'object' && args[0] ? args[0] : { port: args[0], host: args[1] };
  const host = String(o.host ?? o.hostname ?? 'localhost');
  const port = Number(o.port);
  hosts.add(host.replace(/^[^.]+\.([^.]+\.mongodb\.net)$/, '*.$1') + ':' + port);
  if ([25, 465, 587, 2525].includes(port) || /smtp|gmail|mail\.|mailgun|sendgrid|amazonses/i.test(host)) {
    blockedSmtp.push(`${host}:${port}`);
    throw new Error(`OUTBOUND DE E-MAIL BLOQUEADO PELO TESTE (${host}:${port})`);
  }
  return (origConnect as any).apply(this, args);
};

interface HttpCall { at: string; method: string; host: string; path: string; status: number | string; ms: number }
let httpCalls: HttpCall[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  const started = Date.now();
  const rec: HttpCall = { at: ms(), method: String(init?.method ?? 'GET'), host: url.host, path: url.pathname, status: '…', ms: 0 };
  httpCalls.push(rec);
  try {
    const res = await origFetch(input, init);
    rec.status = res.status;
    return res;
  } catch (e) {
    rec.status = `ERRO ${(e as Error).message.slice(0, 60)}`;
    throw e;
  } finally {
    rec.ms = Date.now() - started;
  }
}) as typeof fetch;

const TAGS = /^\[(customerDataApi|hidratacao|inbound-agent-pipeline|agent-autonomo|agent-gestao-handoff|agent-pipeline|agent-atendimento|casos-especiais[a-z-]*|autonom[a-z-]*|cliente|emailNotification|csatEmail|emailTrigger)\]/;
let logLines: string[] = [];
for (const level of ['log', 'info', 'warn'] as const) {
  const orig = console[level].bind(console);
  (console as any)[level] = (...a: unknown[]) => {
    const first = typeof a[0] === 'string' ? a[0] : '';
    if (TAGS.test(first)) logLines.push(`${ms()} ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ').replace(/\s+/g, ' ').slice(0, 260)}`);
  };
  void orig;
}
const out = (s = '') => process.stdout.write(s + '\n');

interface Round { id: string; cpf: string; assunto: string; corpo: string }

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('Informe o arquivo JSON de rodadas (argv[2]).');
  const rounds: Round[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(rounds) || !rounds.length) throw new Error('Arquivo de rodadas vazio.');
  for (const r of rounds) if (!r.id || !r.cpf || !r.assunto || !r.corpo) throw new Error(`Rodada incompleta: ${JSON.stringify(r).slice(0, 80)}`);

  const { env } = await import('../src/config/env');
  const { connectDatabase } = await import('../src/config/database');
  const { ChamadoN1 } = await import('../src/models/ChamadoN1');
  const { createChamadoFromBody } = await import('../src/services/chamado.mapper');
  const { resolveClienteRefFromBody, findClienteByCpf } = await import('../src/services/cliente.service');
  const { loadMailPrioritySubjectRules } = await import('../src/services/mailPrioritySubjectRules.service');
  const { detectCasoEspecialSignal } = await import('../src/services/agents/casosEspeciaisPrecheck');
  const { runInboundPostCreateHooks } = await import('../src/services/agents/inboundAgentPipeline.service');
  const { getAgentesConfig } = await import('../src/services/agents/autonomyRules.service');
  const { AiUsageLog } = await import('../src/models/AiUsageLog');
  const { getWorkflowNotificacaoModel } = await import('../src/models/WorkflowNotificacao');
  const { resolveReclamacaoModel } = await import('../src/services/reclamacoes/reclamacao.service');

  await connectDatabase();
  await loadMailPrioritySubjectRules();

  const cfg = await getAgentesConfig({ fresh: true });
  out('=== 0. PRÉ-CONDIÇÕES ===');
  out(`EMAIL_ENABLED=${env.emailEnabled} | webhook App=${env.velodeskWebhookUrl ? 'CONFIGURADO' : 'não'} | agentsEnabled=${env.agentsEnabled}`);
  out(`config agentes: hidratacaoConsulta=${cfg.hidratacaoConsulta} autonomiaHabilitada=${cfg.autonomiaHabilitada} modoEnvio=${cfg.modoEnvio} | agente4(IA)=${env.agentCasosEspeciaisEnabled}`);
  if (env.emailEnabled) throw new Error('ABORTADO: EMAIL_ENABLED=true.');
  if (env.velodeskWebhookUrl) throw new Error('ABORTADO: webhook outbound do App configurado.');
  if (!cfg.hidratacaoConsulta) throw new Error('ABORTADO: hidratacaoConsulta desligada.');
  if (!env.agentsEnabled) throw new Error('ABORTADO: agentsEnabled=false.');

  const cpfsPreExistentes = new Map<string, boolean>();
  for (const r of rounds) if (!cpfsPreExistentes.has(r.cpf)) cpfsPreExistentes.set(r.cpf, Boolean(await findClienteByCpf(r.cpf)));

  const created: string[] = [];
  const results: Array<Record<string, unknown>> = [];

  try {
    for (const r of rounds) {
      httpCalls = []; logLines = [];
      out(`\n\n################ RODADA ${r.id} — CPF ***${r.cpf.slice(-4)} ################`);

      out('--- 1. ENTRADA DO TICKET (parâmetros literais) ---');
      out(`assunto: ${r.assunto}`);
      out(`corpo  : ${r.corpo}`);

      const payload = {
        chamadoTitulo: r.assunto, title: r.assunto, text: r.corpo, description: r.corpo,
        status: 'novo', clientName: 'Cliente Teste', clientCPF: r.cpf, author: 'sistema-teste',
        lateralForm: { classificacaoTipo: 'Solicitação', tipoChamado: 'Solicitação', canal: 'E-mail', clienteNome: 'Cliente Teste' },
      };
      const partial = await createChamadoFromBody(payload, 'novo');
      const clienteRefs = await resolveClienteRefFromBody({ clientCPF: r.cpf });
      if (clienteRefs.length) partial.cliente = clienteRefs;
      if (partial.registro?.[0]) {
        partial.registro[0].origin = 'cliente';
        partial.registro[0].autor = 'Cliente Teste';
        partial.registro[0].metadados = {
          ...(partial.registro[0].metadados ?? {}),
          source: 'email-inbound',
          emailFrom: 'caixa-teste@teste.invalid',
          origemQa: 'qa-velodesk',
          inboundTicketExternalId: `qa-velodesk-n1-${t0.toString(36)}-${r.id}`,
        };
      }
      const chamado = await ChamadoN1.create(partial);
      created.push(String(chamado._id));
      out(`ticket criado: protocolo ${chamado.chamadoProtocolo} | cliente vinculado: ${clienteRefs[0]?.clienteCpf ? '***' + clienteRefs[0].clienteCpf.slice(-4) : 'NÃO'} | marcado QA`);
      out('chamadas HTTP desta etapa:');
      httpCalls.forEach((c) => out(`   ${c.at} ${c.method} ${c.host}${c.path} → ${c.status} (${c.ms}ms)`));
      logLines.forEach((l) => out(`   log ${l}`));
      httpCalls = []; logLines = [];

      out('\n--- 2. TRIAGEM CASOS ESPECIAIS (precisa NÃO disparar) ---');
      const sig = detectCasoEspecialSignal(chamado);
      out(`precheck: triggered=${sig.triggered} fastPath=${sig.fastPathReal} sinais=${JSON.stringify(sig.signals)}`);
      if (sig.triggered) {
        out('!!! ASSUNTO/TICKET DISPARARIA CASO ESPECIAL — rodada ABORTADA (parâmetro inválido para teste N1).');
        results.push({ rodada: r.id, abortada: true, motivo: 'precheck disparou caso especial' });
        continue;
      }

      out('\n--- 3. PIPELINE NA ENTRADA (runInboundPostCreateHooks) ---');
      const tPipe = Date.now();
      await runInboundPostCreateHooks(chamado, { source: 'teste-n1-ia-autonoma' });
      out(`duração total: ${Date.now() - tPipe}ms`);
      out('chamadas HTTP (ordem cronológica):');
      httpCalls.forEach((c) => out(`   ${c.at} ${c.method} ${c.host}${c.path} → ${c.status} (${c.ms}ms)`));
      out('logs dos serviços:');
      logLines.forEach((l) => out(`   ${l}`));

      out('\n--- 4. CHAMADAS DE IA (ai_usage_logs, por etapa) ---');
      const usage = await AiUsageLog.find({ ticketId: String(chamado._id) }).sort({ createdAt: 1 }).lean();
      usage.forEach((u: any) => out(`   ${new Date(u.createdAt).toISOString().slice(11, 23)} feature=${u.feature} modelo=${u.model} in=${u.inputTokens} out=${u.outputTokens}`));
      if (!usage.length) out('   (nenhuma chamada de IA registrada)');

      out('\n--- 5. ESTADO FINAL DO TICKET ---');
      const fresh = (await ChamadoN1.findById(chamado._id).lean())!;
      const tab = fresh.tabulacao?.[fresh.tabulacao.length - 1];
      out(`tabulação: tipo="${tab?.tipoChamado ?? ''}" produto="${tab?.produto ?? ''}" motivo="${tab?.motivo ?? ''}" detalhe="${tab?.detalhe ?? ''}" canal="${tab?.canal ?? ''}" responsavel="${tab?.responsavel ?? ''}"`);
      const novos = (fresh.registro ?? []).slice(1);
      out(`registros adicionados pelo pipeline: ${novos.length}`);
      novos.forEach((reg: any, i: number) => out(`   [${i + 1}] origin=${reg.origin} autor=${reg.autor} publica="${String(reg.mensagemPublica ?? '').slice(0, 160)}" interna="${String(reg.anotacaoInterna ?? '').slice(0, 100)}"`));
      const sug = (fresh.registro ?? []).map((x: any) => x.metadados?.agentSuggestion).find(Boolean) ?? (fresh as any).aiSuggestionCache?.value ?? (fresh as any).aiSuggestionCache;
      if (sug) out(`sugestão da IA gravada: ${JSON.stringify(sug).slice(0, 700)}`);
      out(`aiAutomation: ${JSON.stringify((fresh as any).aiAutomation ?? null).slice(0, 500)}`);

      results.push({
        rodada: r.id, protocolo: chamado.chamadoProtocolo, cliente: Boolean(clienteRefs.length),
        casoEspecial: sig.triggered, chamadasIA: usage.length, registrosNovos: novos.length,
        tabulacao: `${tab?.produto ?? ''} / ${tab?.motivo ?? ''}`, aiAutomation: Boolean((fresh as any).aiAutomation),
      });
    }
  } finally {
    out('\n\n=== LIMPEZA ===');
    const Notif = getWorkflowNotificacaoModel();
    let n = 0; let u = 0; let rc = 0;
    for (const id of created) {
      for (const org of ['procon', 'bacen', 'consumidor_gov'] as const) {
        const M = resolveReclamacaoModel(org);
        if (M) rc += (await M.deleteMany({ chamadoId: id })).deletedCount ?? 0;
      }
      n += (await Notif.deleteMany({ ticketId: id })).deletedCount ?? 0;
      u += (await AiUsageLog.deleteMany({ ticketId: id })).deletedCount ?? 0;
      await ChamadoN1.deleteOne({ _id: id });
    }
    for (const [cpf, existed] of cpfsPreExistentes) {
      if (existed) continue;
      const c = await findClienteByCpf(cpf);
      if (c) await c.deleteOne();
    }
    out(`chamados=${created.length} reclamações=${rc} notificações=${n} usageLogs=${u}; clientes criados pelo teste removidos`);
  }

  out('\n=== RESUMO ===');
  out(JSON.stringify(results, null, 1));
  out(`conexões SMTP/Gmail bloqueadas: ${blockedSmtp.length}${blockedSmtp.length ? ' → ' + blockedSmtp.join(', ') : ''}`);
  out(`hosts contatados: ${[...hosts].join(' | ')}`);
  process.exit(blockedSmtp.length === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(`[test] ERRO FATAL: ${err?.stack ?? err}\n`);
  process.exit(1);
});
