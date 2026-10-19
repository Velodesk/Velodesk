/**
 * agentOrchestrator.service v2.0.0 — pipeline Agente 1 → Auditor. Modo desk: sugestão ao atendente (com cache de
 * sugestão pré-gerada). Modo autônomo: ticket já na fila do agente; resposta com nota ≥ mínimo vai à aprovação humana.
 * VERSION: v2.0.0 | DATE: 2026-10-19
 */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { env } from '../../config/env';
import { currentStatus } from '../chamado.mapper';
import { enqueueForApproval, recordDirectSend } from './aiAutomation.service';
import { retryTecnico } from './retryTecnico.util';
import { sendAutonomousReply, validateTabulacaoForAutonomy } from './autonomousSend.service';
import { evaluateStrictGate } from './autonomyGate.util';
import { wrapComposerOpening } from '../clientMessageEnvelope.service';
import { AGENTE_AUTONOMO_ENVELOPE_NOME } from '../../config/agenteAutonomo';
import type {
  AtendimentoInput,
  AtendimentoResult,
  AuditModo,
  AuditoriaResult,
  PipelineInput,
  PipelineResult,
  RevisaoOrigem,
  TabulacaoFonte,
  TicketAiTabulationResult,
} from './agentTypes';
import { buildTabulationDisplay, tabulationCompletenessScore } from './agentTabulation.util';
import { classifyAtendimento, composeAtendimento, reviseAtendimento } from './atendimentoAgent.service';
import { validateAuditoria } from './auditoriaAgent.service';
import { saveAgentFeedback } from './agentFeedback.service';
import { getAgentesConfig, isHidratacaoEnabled } from './autonomyRules.service';
import {
  hydrateForRevision,
  hydrateProductForTicket,
  slugFromTabulacaoProduto,
  type HidratacaoResult,
} from '../consultaHidratacao.service';
import { executeGestaoHandoff } from './gestaoChamadosHandoff.service';
import { hasCasosEspeciaisTriagem } from './casosEspeciais.util';
import { getAgentNomeOficial } from './agentRegistry';
import { isPersistedMongoTicketId } from '../../utils/persistedTicketId';
import { computeCanonicalFingerprint, writeAiSuggestionCache } from './agentSuggestionCache.util';

function resolveDeskTabulacao(
  audit: AuditoriaResult,
  fallbackTab: TicketAiTabulationResult,
  fallbackDisplay?: string,
): { tabulacao: TicketAiTabulationResult; tabulacaoDisplay: string; tabulacaoFonte: TabulacaoFonte } {
  const auditTab = audit.tabulacaoSugerida;
  if (auditTab) {
    const auditScore = tabulationCompletenessScore(auditTab);
    const fallbackScore = tabulationCompletenessScore(fallbackTab);
    if (auditScore >= fallbackScore) {
      return {
        tabulacao: auditTab,
        tabulacaoDisplay: audit.tabulacaoDisplay || buildTabulationDisplay(auditTab),
        tabulacaoFonte: 'auditoria',
      };
    }
  }
  return {
    tabulacao: fallbackTab,
    tabulacaoDisplay: fallbackDisplay || buildTabulationDisplay(fallbackTab),
    tabulacaoFonte: 'atendimento',
  };
}

function auditModoFromPipeline(modo: PipelineInput['pipelineModo']): AuditModo {
  return modo === 'desk' ? 'desk_sugestao' : 'auto_envio';
}

function buildClientContext(input: PipelineInput): string {
  const publicPart = (input.messages || []).map((m) => m.text).join('\n');
  const internalPart = String(input.internalNote || '').trim();
  return [publicPart, internalPart].filter(Boolean).join('\n\n---\n\n');
}

function countThreadMessages(chamado?: IChamadoN1 | null): number {
  if (!chamado?.registro?.length) return 1;
  return chamado.registro.filter((r) => String(r.mensagemPublica || '').trim()).length || 1;
}

async function persistAgentSuggestion(
  chamado: IChamadoN1,
  result: PipelineResult,
): Promise<void> {
  if (!chamado._id) return;
  const fresh = await ChamadoN1.findById(chamado._id);
  if (!fresh?.registro?.length) return;
  const lastIdx = fresh.registro.length - 1;
  await ChamadoN1.updateOne(
    { _id: fresh._id },
    {
      $set: {
        [`registro.${lastIdx}.metadados.agentSuggestion`]: {
          respostaSugerida: result.respostaSugerida,
          tabulacao: result.tabulacao,
          auditScore: result.auditScore,
          auditDecisao: result.auditDecisao,
          ...(result.autonomiaMotivo ? { autonomiaMotivo: result.autonomiaMotivo } : {}),
          at: new Date().toISOString(),
        },
      },
    },
  );
}

export async function runAgentPipeline(input: PipelineInput): Promise<PipelineResult> {
  const autonomo = input.pipelineModo === 'autonomo';
  const auditModo = auditModoFromPipeline(input.pipelineModo);
  const maxRevisions = env.agentRevisionMaxAttempts;
  let revisoesRealizadas = 0;
  // Ticket do agente autônomo: falha técnica de uma etapa da IA é repetida antes de desistir.
  const tentar = <T extends { success: boolean }>(fn: () => Promise<T>) => (autonomo ? retryTecnico(fn) : fn());
  const cfg = autonomo ? await getAgentesConfig() : null;
  const auditExtra = autonomo ? { autonomo: true, minScore: cfg!.minAuditScoreEstrito } : {};

  let chamado: IChamadoN1 | null = null;
  if (isPersistedMongoTicketId(input.ticketId)) {
    chamado = await ChamadoN1.findById(input.ticketId);
  }

  input.onStage?.('gerando');

  // Hidratação: o produto vem da origem do ticket (produtoFixo); só sem ele o agente classifica. Consulta SÓ esse
  // produto na conta do cliente e a redação já recebe os dados reais.
  const hidEnabled = Boolean(chamado) && await isHidratacaoEnabled();
  let hid: HidratacaoResult | null = null;
  if (hidEnabled) {
    let slug = slugFromTabulacaoProduto(input.produtoFixo);
    let motivoClassificado: string | undefined;
    if (!slug && !input.produtoFixo) {
      const classe = await classifyAtendimento(input);
      slug = classe.success ? slugFromTabulacaoProduto(classe.tabulacao?.produto) : null;
      motivoClassificado = classe.tabulacao?.motivo;
    }
    if (slug) {
      const contextText = [input.titulo, ...(input.messages || []).map((m) => m.text), input.internalNote]
        .filter(Boolean).join(' ');
      const consultar = () => hydrateProductForTicket({
        ticketId: input.ticketId,
        protocolo: input.protocolo,
        slug: slug!,
        motivo: motivoClassificado,
        contextText,
      });
      hid = await consultar();
      for (let i = 0; autonomo && i < 2 && hid.status === 'indisponivel'; i += 1) hid = await consultar();
      if (hid.bloco) input = { ...input, dadosConta: hid.bloco };
    }
  }

  let atendimento: AtendimentoResult = await tentar(() => composeAtendimento(input));
  if (!atendimento.success || !atendimento.respostaSugerida || !atendimento.tabulacao) {
    return {
      success: false,
      error: atendimento.error || `Falha no ${getAgentNomeOficial(1)}`,
      source: 'agent_pipeline',
    };
  }

  // O agente só termina o serviço com a tabulação completa. Se a redação veio sem motivo (classificação dentro do
  // produto da origem não bateu com a árvore), refaz a classificação, que usa só a árvore do produto.
  if (!atendimento.tabulacao.motivo && autonomo) {
    const reclass = await classifyAtendimento(input);
    if (reclass.success && reclass.tabulacao?.motivo) {
      atendimento = {
        ...atendimento,
        tabulacao: { ...reclass.tabulacao, tipo: reclass.tabulacao.tipo || atendimento.tabulacao.tipo },
        tabulacaoDisplay: buildTabulationDisplay(reclass.tabulacao),
      };
    }
  }
  let respostaAtual = atendimento.respostaSugerida!;
  let tabulacaoAtual = atendimento.tabulacao!;

  input.onStage?.('auditando');
  let audit = await tentar(() => validateAuditoria({
    modo: auditModo,
    ...auditExtra,
    protocolo: input.protocolo,
    canal: input.canal,
    status: input.status || (chamado ? currentStatus(chamado) : 'novo'),
    contextSource: input.contextSource,
    messages: input.messages,
    internalNote: input.internalNote,
    respostaSugerida: respostaAtual,
    tabulacao: tabulacaoAtual,
    userId: input.userId,
    dadosConta: input.dadosConta,
    produtoFixo: input.produtoFixo,
  }));

  if (!audit.success) {
    return { success: false, error: audit.error, source: 'agent_pipeline' };
  }

  while (audit.requerRevisaoAgente1 && revisoesRealizadas < maxRevisions) {
    revisoesRealizadas += 1;
    const origem: RevisaoOrigem = 'automatica_baixo_compliance';

    input.onStage?.('revisando');
    const revised = await tentar(() => reviseAtendimento({
      ...input,
      respostaAnterior: respostaAtual,
      tabulacaoAnterior: tabulacaoAtual,
      violacoes: audit.violacoes,
      recomendacoes: audit.recomendacoes,
      origemRevisao: origem,
      auditScore: audit.score,
    }));

    await saveAgentFeedback({
      ticketId: input.ticketId,
      protocolo: input.protocolo,
      agentOrigem: 'atendimento',
      tipoEvento: 'revisao_automatica',
      scoreAntes: audit.score,
      violacoes: audit.violacoes,
      respostaAntes: respostaAtual,
      respostaDepois: revised.respostaSugerida,
      tabulacao: revised.tabulacao || tabulacaoAtual,
    });

    if (!revised.success || !revised.respostaSugerida || !revised.tabulacao) {
      break;
    }

    atendimento = revised;
    respostaAtual = revised.respostaSugerida;
    tabulacaoAtual = revised.tabulacao;
    input.onStage?.('auditando');
    audit = await tentar(() => validateAuditoria({
      modo: auditModo,
      ...auditExtra,
      protocolo: input.protocolo,
      canal: input.canal,
      status: input.status,
      contextSource: input.contextSource,
      messages: input.messages,
      internalNote: input.internalNote,
      respostaSugerida: respostaAtual,
      tabulacao: tabulacaoAtual,
      userId: input.userId,
      dadosConta: input.dadosConta,
      produtoFixo: input.produtoFixo,
    }));

    if (!audit.success) break;
  }

  if (audit.notificarAgente3 && input.ticketId && input.protocolo) {
    const skipHandoff = chamado ? hasCasosEspeciaisTriagem(chamado) : false;
    if (!skipHandoff) {
      const tabHandoff = resolveDeskTabulacao(audit, tabulacaoAtual, atendimento.tabulacaoDisplay);
      await executeGestaoHandoff({
        ticketId: input.ticketId,
        protocolo: input.protocolo,
        nivelCriticidade: audit.nivelCriticidade || 'alta',
        palavrasCriticas: audit.palavrasCriticasDetectadas,
        categoriaAtendimento: audit.categoriaAtendimento,
        origem: 'agente_auditoria',
        auditScore: audit.score,
        produto: tabHandoff.tabulacao.produto,
        motivo: tabHandoff.tabulacao.motivo,
      });
    }
  }

  const deskTab = !autonomo
    ? {
      tabulacao: tabulacaoAtual,
      tabulacaoDisplay: atendimento.tabulacaoDisplay || buildTabulationDisplay(tabulacaoAtual),
      tabulacaoFonte: 'atendimento' as TabulacaoFonte,
    }
    : resolveDeskTabulacao(audit, tabulacaoAtual, atendimento.tabulacaoDisplay);

  const pipelineResult: PipelineResult = {
    success: true,
    respostaSugerida: respostaAtual,
    tabulacao: deskTab.tabulacao,
    tabulacaoDisplay: deskTab.tabulacaoDisplay,
    tabulacaoFonte: deskTab.tabulacaoFonte,
    confidence: atendimento.confidence,
    auditScore: audit.score,
    auditAprovado: audit.aprovado,
    auditDecisao: audit.decisao,
    auditComplete: true,
    nivelCriticidade: audit.nivelCriticidade,
    revisoesRealizadas,
    model: atendimento.model,
    source: 'agent_pipeline',
    ...(hid ? { hidratacao: { slug: hid.slug, status: hid.status } } : {}),
  };

  /**
   * Só em modo desk (nunca no autônomo): grava a sugestão como rascunho pronto pra exibir na próxima vez que o
   * ticket for aberto com a MESMA thread (fingerprint) — nunca em registro[], nunca enviada.
   * Cobre tanto a pré-geração automática na criação do ticket/1ª nota interna
   * (runInboundAgentPipeline) quanto a geração normal quando o operador abre o ticket.
   */
  if (chamado && !autonomo) {
    const ticketId = chamado._id.toString();
    void ChamadoN1.findById(ticketId).then((fresh) => {
      if (!fresh) return undefined;
      const fingerprint = computeCanonicalFingerprint(fresh, input.contextSource);
      return writeAiSuggestionCache(ticketId, fingerprint, pipelineResult);
    }).catch((err) => {
      console.warn('[agent-pipeline] falha ao gravar aiSuggestionCache (fail-soft):', (err as Error)?.message);
    });
  }

  if (autonomo && chamado) {
    // Critério único: nota do auditor ≥ mínimo (abaixo disso a resposta já foi refeita no laço acima). Com
    // hidratação ligada, produto com consulta disponível exige os dados reais daquele produto. A tabulação precisa
    // existir na árvore e estar completa, como a de um atendente.
    const minScore = cfg!.minAuditScoreEstrito;
    const slugFinal = slugFromTabulacaoProduto(tabulacaoAtual.produto);
    const envioDireto = cfg!.modoEnvio === 'envio_direto';
    let motivo: string | undefined;
    if ((audit.score ?? 0) < minScore) {
      motivo = `Nota do auditor ${audit.score ?? 0} abaixo de ${minScore}`;
    } else if (hidEnabled && slugFinal !== null && !(hid?.status === 'ok' && hid.slug === slugFinal)) {
      motivo = 'Dados da conta do cliente indisponíveis para este produto';
    } else if (envioDireto) {
      motivo = evaluateStrictGate({ audit, confidence: atendimento.confidence, tabulacao: tabulacaoAtual, minAuditScore: minScore }).reason;
    }
    if (!motivo) motivo = (await validateTabulacaoForAutonomy(chamado, tabulacaoAtual)).reason;

    if (!motivo) {
      const attempt = {
        resposta: respostaAtual,
        tabulacao: tabulacaoAtual,
        audit,
        confidence: atendimento.confidence,
        model: atendimento.model,
        ruleId: chamado.aiAutomation?.ruleId,
      };

      if (!envioDireto) {
        await enqueueForApproval(input.ticketId!, attempt);
        pipelineResult.aguardandoAprovacao = true;
        return pipelineResult;
      }

      // Envio direto: congelado nesta fase (a UI aceita a opção, mas o fluxo em produção é a fila de aprovação).
      const composerText = wrapComposerOpening({
        nucleo: respostaAtual,
        clientName: input.clientName,
        messages: input.messages,
        agentName: AGENTE_AUTONOMO_ENVELOPE_NOME,
      });
      await sendAutonomousReply(chamado, composerText, tabulacaoAtual);
      await recordDirectSend(input.ticketId!, attempt);
      await saveAgentFeedback({
        ticketId: input.ticketId,
        protocolo: input.protocolo,
        agentOrigem: 'auditoria',
        tipoEvento: 'envio_autonomo',
        scoreAntes: audit.score,
        respostaDepois: respostaAtual,
        tabulacao: tabulacaoAtual,
      });
      pipelineResult.envioAutonomo = true;
      return pipelineResult;
    }

    // Fica registrado POR QUE não foi encaminhado (nota, dados da conta ou tabulação).
    pipelineResult.autonomiaMotivo = motivo;
    console.info('[agent-autonomo] não encaminhado à fila de aprovação — segue com o humano', {
      protocolo: input.protocolo,
      motivo,
    });
  }

  if (chamado && autonomo) {
    await persistAgentSuggestion(chamado, pipelineResult);
  }

  return pipelineResult;
}

export async function runRevisarSugestao(params: {
  input: AtendimentoInput;
  respostaAtual: string;
  tabulacaoAtual: AtendimentoResult['tabulacao'];
  auditScore?: number;
  origemRevisao: RevisaoOrigem;
  inputOperador?: string;
  violacoes?: string[];
  recomendacoes?: string[];
}): Promise<PipelineResult> {
  if (!params.tabulacaoAtual) {
    return { success: false, error: 'Tabulação atual obrigatória' };
  }

  const dadosConta = params.input.dadosConta ?? await hydrateForRevision({
    ticketId: params.input.ticketId,
    protocolo: params.input.protocolo,
    produto: params.tabulacaoAtual.produto,
    motivo: params.tabulacaoAtual.motivo,
  });

  const revised = await reviseAtendimento({
    ...params.input,
    dadosConta,
    respostaAnterior: params.respostaAtual,
    tabulacaoAnterior: params.tabulacaoAtual,
    origemRevisao: params.origemRevisao,
    inputOperador: params.inputOperador,
    violacoes: params.violacoes,
    recomendacoes: params.recomendacoes,
    auditScore: params.auditScore,
  });

  if (!revised.success || !revised.respostaSugerida || !revised.tabulacao) {
    return { success: false, error: revised.error || 'Falha na revisão' };
  }

  const audit = await validateAuditoria({
    modo: 'desk_sugestao',
    protocolo: params.input.protocolo,
    canal: params.input.canal,
    contextSource: params.input.contextSource,
    messages: params.input.messages,
    internalNote: params.input.internalNote,
    respostaSugerida: revised.respostaSugerida,
    tabulacao: revised.tabulacao,
    userId: params.input.userId,
    dadosConta,
  });

  await saveAgentFeedback({
    ticketId: params.input.ticketId,
    protocolo: params.input.protocolo,
    agentOrigem: 'atendimento',
    tipoEvento: params.origemRevisao === 'solicitada_operador' ? 'revisao_solicitada' : 'revisao_automatica',
    scoreAntes: params.auditScore,
    scoreDepois: audit.score,
    violacoes: params.violacoes,
    inputOperador: params.inputOperador,
    respostaAntes: params.respostaAtual,
    respostaDepois: revised.respostaSugerida,
    tabulacao: revised.tabulacao,
  });

  const deskTab = resolveDeskTabulacao(audit, revised.tabulacao, revised.tabulacaoDisplay);

  return {
    success: true,
    respostaSugerida: revised.respostaSugerida,
    tabulacao: deskTab.tabulacao,
    tabulacaoDisplay: deskTab.tabulacaoDisplay,
    tabulacaoFonte: deskTab.tabulacaoFonte,
    confidence: revised.confidence,
    auditScore: audit.score,
    auditAprovado: audit.aprovado,
    auditDecisao: audit.decisao,
    auditComplete: audit.success,
    model: revised.model,
    source: 'agent_revisar_sugestao',
  };
}
