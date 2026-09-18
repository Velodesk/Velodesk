/**
 * run v1.0.0 — orquestrador da rodada de QA do Velodesk
 *
 * Ordem: saúde → tickets novos → mensagens → finalização → mesclas → CSAT →
 * e-mails → erros → telas → limpeza → planilha.
 *
 * Uso:
 *   npm run qa            rodada completa
 *   npm run qa:leitura    só leitura (não cria nada, não envia e-mail)
 */
import fs from 'fs';
import path from 'path';
import { cfg, validarConfig, TravaDeSegurancaError } from './config';
import { ApiVelodesk } from './api';
import { Coletor } from './resultado';
import { CATALOGO } from './catalogo';
import type { Contexto } from './contexto';
import { conectar, desconectar, garantirClienteQa } from './db';
import { checarSaude } from './checks/saude';
import { checarTicketsNovos, checarMensagens, descobrirTabulacao, prepararTicketsAuxiliares } from './checks/tickets';
import { checarFinalizacao } from './checks/finalizacao';
import { checarMesclas } from './checks/mescla';
import { checarCsat } from './checks/csat';
import { checarEmails } from './checks/emails';
import { checarMensageria } from './checks/mensageria';
import { checarErros } from './checks/erros';
import { checarTelas } from './checks/ui';
import { limparTicketsDaRodada } from './limpeza';
import { gerarDevolutivas } from './ia';
import { alimentarPlanilha, nomeRodada, resumoTexto } from './relatorio';
import { montarEstadoAtual, gravarEstadoSentinela, gravarEstadoSentinelaMongo } from './estadoSentinela';
import { enviarRelatorioTelegram, montarMensagemResumo } from './telegram';

const RAIZ = path.join(__dirname, '..');
const PLANILHA = process.env.QA_PLANILHA
  ? path.resolve(process.env.QA_PLANILHA)
  : path.join(RAIZ, 'relatorios', 'Consolidado_QA_Velodesk.xlsx');

function idDaRodada(agora: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${agora.getUTCFullYear()}${p(agora.getUTCMonth() + 1)}${p(agora.getUTCDate())}-${p(
    agora.getUTCHours(),
  )}${p(agora.getUTCMinutes())}`;
}

async function main() {
  const inicio = new Date();
  const runId = idDaRodada(inicio);
  const observacoes: string[] = [];

  console.log(`\n=== Claudio Q.A. — ${nomeRodada(inicio)} — rodada ${runId} ===`);
  validarConfig();

  const coletor = new Coletor();
  const api = new ApiVelodesk();
  api.usarRegistrador(coletor);

  const ctx: Contexto = {
    api,
    coletor,
    runId,
    emailTeste: cfg.emailsSeguros[0],
    nomeAtendente: cfg.responsavel,
    criados: [],
    tabulacao: null,
    dirPrints: path.join(RAIZ, 'relatorios', 'prints', runId),
    podeEscrever: !cfg.somenteLeitura,
    temBanco: false,
    sessao: null,
  };

  console.log(`Ambiente: ${cfg.baseUrl}`);
  console.log(`E-mails seguros: ${cfg.emailsSeguros.join(', ')}`);
  console.log(`Modo: ${ctx.podeEscrever ? 'completo (cria tickets de teste)' : 'somente leitura'}\n`);

  // Banco (checagens por dados)
  if (cfg.mongo.uri) {
    try {
      await conectar();
      ctx.temBanco = true;
    } catch (err) {
      observacoes.push(
        `Sem acesso ao banco de dados: ${err instanceof Error ? err.message : String(err)}. ` +
          'As checagens por dados ficaram bloqueadas.',
      );
      console.warn('[qa] banco indisponível:', err instanceof Error ? err.message : err);
    }
  } else {
    observacoes.push('MONGODB_URI não informado — checagens por dados desativadas nesta rodada.');
  }

  try {
    await checarSaude(ctx);

    if (ctx.podeEscrever && ctx.temBanco) {
      await garantirClienteQa(cfg.cpfQa, ctx.emailTeste, 'Cliente de Teste QA');
    }

    if (api.temToken) {
      ctx.tabulacao = await descobrirTabulacao(ctx);
      if (!ctx.tabulacao) {
        observacoes.push('Não foi possível montar uma tabulação válida a partir da árvore de motivos ativa.');
      }
    }

    await checarTicketsNovos(ctx);
    await prepararTicketsAuxiliares(ctx);
    await checarMensagens(ctx);
    await checarFinalizacao(ctx);
    await checarMesclas(ctx);
    await checarCsat(ctx);
    await checarEmails(ctx);
    await checarMensageria(ctx);
    await checarErros(ctx);
    await checarTelas(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    observacoes.push(`Rodada interrompida: ${msg}`);
    console.error('\n[qa] rodada interrompida:', msg);
    if (err instanceof TravaDeSegurancaError) console.error('[qa] nenhuma operação de risco foi executada.');
  }

  // Limpeza dos tickets de teste
  try {
    const limpeza = await limparTicketsDaRodada(ctx);
    if (limpeza.fechados) console.log(`[qa] ${limpeza.fechados} ticket(s) de teste encerrado(s).`);
    if (limpeza.falhas.length) {
      observacoes.push(`Tickets de teste que não foram encerrados: ${limpeza.falhas.join(' | ')}`);
    }
  } catch (err) {
    observacoes.push(`Falha na limpeza dos tickets de teste: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Casos que não chegaram a rodar
  const executados = new Set(coletor.resultados.map((r) => r.caso.id));
  for (const c of CATALOGO) {
    if (!executados.has(c.id)) coletor.naoExecutado(c.id, 'Não chegou a ser executado nesta rodada.');
  }

  // Devolutiva: sugestão curta de correção para cada caso que não passou.
  const devolutivas = await gerarDevolutivas(coletor.resultados);
  if (devolutivas.aviso) {
    observacoes.push(devolutivas.aviso);
    console.warn(`[qa] devolutiva: ${devolutivas.aviso}`);
  } else {
    console.log(
      `[qa] devolutiva preenchida a partir ${devolutivas.fonte === 'ia' ? 'da sugestão da IA' : 'da orientação base do catálogo'}.`,
    );
  }

  const fim = new Date();
  await alimentarPlanilha(PLANILHA, {
    inicio,
    fim,
    coletor,
    observacaoGeral: observacoes.join(' • '),
    devolutivas: devolutivas.textos,
  });

  // Uma mensagem por rodada, sempre — com falha ou não (enviarRelatorioTelegram já é
  // fail-soft: nunca derruba a rodada se o Telegram estiver fora ou mal configurado).
  await enviarRelatorioTelegram(montarMensagemResumo(coletor.resultados));

  console.log(`\n${resumoTexto(coletor)}`);
  console.log(`\nPlanilha atualizada: ${PLANILHA}`);
  if (fs.existsSync(ctx.dirPrints)) console.log(`Prints da rodada: ${ctx.dirPrints}`);

  // Retrato da rodada pro dashboard Sentinela Velodesk — grava no Mongo
  // (fonte de verdade que a rotina agendada lê pra atualizar o site) e também
  // em qa/data/*.json local, só como registro/depuração de cada rodada.
  const estado = montarEstadoAtual({ runId, inicio, fim, coletor, somenteLeitura: cfg.somenteLeitura });
  try {
    gravarEstadoSentinela(estado);
    console.log('[qa] estado da rodada gravado em qa/data/ (local).');
  } catch (err) {
    console.warn('[qa] falha ao gravar qa/data/ local:', err instanceof Error ? err.message : err);
  }
  if (ctx.temBanco) {
    try {
      await gravarEstadoSentinelaMongo(estado);
      console.log('[qa] estado da rodada gravado no Mongo para o Sentinela.');
    } catch (err) {
      console.warn('[qa] falha ao gravar o estado no Mongo para o Sentinela:', err instanceof Error ? err.message : err);
    }
  } else {
    console.warn('[qa] sem banco nesta rodada — Sentinela não foi atualizado.');
  }

  await desconectar();

  const falharNaFalha = String(process.env.QA_FALHAR_NA_FALHA ?? 'true').toLowerCase() !== 'false';
  const r = coletor.resumo;
  if (falharNaFalha && (r.falhas > 0 || r.bloqueados > 0)) {
    console.error(`\nRodada com ${r.falhas} falha(s) nova(s) e ${r.bloqueados} bloqueio(s).`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error('[qa] erro fatal:', err instanceof Error ? err.stack : err);
  await desconectar();
  process.exitCode = 1;
});
