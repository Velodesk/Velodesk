/**
 * auditoriaAgent.service v1.2.0 — palavra-chave crítica vira gatilho de triagem por IA
 * (avaliarAmeacaCritica), não escalonamento automático — evita falso positivo tipo "processo"
 * usado em sentido administrativo forçando criticidade máxima sem ameaça real.
 * VERSION: v1.2.0 | DATE: 2026-09-02
 */
import { env } from '../../config/env';
import type {
  AuditDecisao,
  AuditoriaInput,
  AuditoriaResult,
  NivelCriticidade,
  TicketAiTabulationResult,
} from './agentTypes';
import { getAuditoriaPersona } from './personas/auditoriaPersona';
import {
  AUDITORIA_JSON_SCHEMA,
  buildAuditoriaUserBlock,
  buildTabulationCatalog,
  buildTabulationDisplay,
  loadTabulationConfig,
  loadTabulationScope,
  withProdutoFixo,
  validateTabulationResult,
} from './agentTabulation.util';
import {
  createOpenAiClient,
  extractOutputText,
  getAuditoriaVectorStoreIds,
  isAgentsConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
  trimStr,
} from './openaiAgent.util';
import { detectCriticalKeywords } from './criticalKeywords.service';
import { avaliarAmeacaCritica } from './criticidadeTriagem.service';
import { logAiUsage } from '../aiUsage.service';

interface AuditoriaParsed {
  aprovado?: boolean;
  score?: number;
  decisao?: AuditDecisao;
  nivelCriticidade?: NivelCriticidade;
  impactoGravidade?: 'alto' | 'medio' | 'baixo';
  categoriaAtendimento?: string;
  palavrasCriticasDetectadas?: string[];
  requerRevisaoAgente1?: boolean;
  notificarAgente3?: boolean;
  violacoes?: string[];
  recomendacoes?: string[];
  criteriosAvaliados?: {
    aderenciaReal?: boolean;
    procedimento?: boolean;
    veracidade?: boolean;
    produtos?: boolean;
    tomNaturalidade?: boolean;
    estruturaNucleo?: boolean;
    vazamento?: boolean;
    escalonamento?: boolean;
    riscoCritico?: boolean;
    tabulacao?: boolean;
  };
  tabulacaoSugerida?: { tipo?: string; produto?: string; motivo?: string; detalhe?: string };
}

function resolveTabulacaoSugerida(
  raw: AuditoriaParsed['tabulacaoSugerida'],
  config: Awaited<ReturnType<typeof loadTabulationConfig>>,
): TicketAiTabulationResult | undefined {
  if (!raw) return undefined;
  const validated = validateTabulationResult(raw, config);
  if (!validated.tipo && !validated.produto && !validated.motivo) return undefined;
  return validated;
}

function applyPostAuditRules(
  parsed: AuditoriaParsed,
  params: AuditoriaInput,
  precheckKeywords: string[],
  tabulacaoSugerida: TicketAiTabulationResult | undefined,
  ameacaConfirmada: boolean,
): AuditoriaResult {
  const modo = params.modo;
  const threshold = params.minScore ?? (modo === 'auto_envio'
    ? env.agentAuditThresholdAuto
    : env.agentAuditThresholdDesk);

  let score = typeof parsed.score === 'number' ? Math.round(parsed.score) : 0;
  score = Math.max(0, Math.min(100, score));

  const llmKeywords = parsed.palavrasCriticasDetectadas || [];
  const allKeywords = [...new Set([...precheckKeywords, ...llmKeywords])];
  // ameacaConfirmada já encapsula "algo acionou a triagem E ela confirmou ameaça real" (ver
  // validateAuditoria) — palavra-chave OU autodeclaração livre do Auditor são só o gatilho pra
  // rodar a triagem; sem confirmação real, é coincidência e nada muda no ticket.
  const hasCritical = ameacaConfirmada;

  let decisao: AuditDecisao = parsed.decisao || 'encaminhar_humano';
  let nivelCriticidade: NivelCriticidade = parsed.nivelCriticidade || 'nenhuma';
  // NUNCA confiar direto em parsed.notificarAgente3 — o próprio Auditor pode se autodeclarar
  // "crítico" por critério livre (persona: "RISCO_CRITICO — contextos críticos") sem nenhuma
  // palavra-gatilho, o que bypassaria a triagem por completo. notificarAgente3 só pode nascer
  // true dentro do bloco hasCritical abaixo, já com ameacaConfirmada validado.
  let notificarAgente3 = false;
  let requerRevisaoAgente1 = Boolean(parsed.requerRevisaoAgente1);
  let aprovado = Boolean(parsed.aprovado);

  const tabTipo = tabulacaoSugerida?.tipo || params.tabulacao.tipo;

  if (hasCritical) {
    decisao = 'bloquear_critico';
    nivelCriticidade = nivelCriticidade === 'nenhuma' ? 'alta' : nivelCriticidade;
    if (allKeywords.some((k) => ['procon', 'processo', 'fraude', 'ameaça', 'bacen'].includes(k))) {
      nivelCriticidade = 'critica';
    }
    notificarAgente3 = true;
    requerRevisaoAgente1 = false;
    aprovado = false;
  } else if (score < threshold) {
    decisao = 'revisar_agente1';
    requerRevisaoAgente1 = true;
    aprovado = false;
  } else if (modo === 'auto_envio') {
    const categoria = trimStr(parsed.categoriaAtendimento || tabTipo, 64);
    const impacto = parsed.impactoGravidade || 'medio';
    if (!params.autonomo && (categoria === 'Reclamação' || impacto === 'alto')) {
      decisao = 'encaminhar_humano';
      aprovado = false;
    } else {
      decisao = 'aprovar_auto';
      aprovado = true;
    }
  } else if (modo === 'desk_sugestao') {
    decisao = 'exibir_sugestao';
    aprovado = score >= threshold;
  }

  return {
    success: true,
    aprovado,
    score,
    modo,
    decisao,
    nivelCriticidade,
    impactoGravidade: parsed.impactoGravidade || 'medio',
    categoriaAtendimento: parsed.categoriaAtendimento || tabTipo,
    palavrasCriticasDetectadas: allKeywords,
    requerRevisaoAgente1,
    notificarAgente3,
    violacoes: parsed.violacoes || [],
    recomendacoes: parsed.recomendacoes || [],
    criteriosAvaliados: parsed.criteriosAvaliados && {
      aderenciaReal: parsed.criteriosAvaliados.aderenciaReal ?? false,
      procedimento: parsed.criteriosAvaliados.procedimento ?? false,
      veracidade: parsed.criteriosAvaliados.veracidade ?? false,
      produtos: parsed.criteriosAvaliados.produtos ?? false,
      tomNaturalidade: parsed.criteriosAvaliados.tomNaturalidade ?? false,
      estruturaNucleo: parsed.criteriosAvaliados.estruturaNucleo ?? false,
      vazamento: parsed.criteriosAvaliados.vazamento ?? false,
      escalonamento: parsed.criteriosAvaliados.escalonamento ?? false,
      riscoCritico: parsed.criteriosAvaliados.riscoCritico ?? false,
      tabulacao: parsed.criteriosAvaliados.tabulacao ?? false,
    },
    tabulacaoSugerida,
    tabulacaoDisplay: tabulacaoSugerida ? buildTabulationDisplay(tabulacaoSugerida) : undefined,
  };
}

export async function validateAuditoria(params: AuditoriaInput): Promise<AuditoriaResult> {
  if (!isAgentsConfigured()) {
    return { success: false, error: 'Agentes não configurados' };
  }

  const contextText = [
    ...(params.messages || []).map((m) => m.text),
    params.internalNote,
    params.respostaSugerida,
    params.ultimaMensagemCliente,
    params.mensagemOperador,
  ].filter(Boolean).join('\n');

  // Ticket do agente autônomo não passa pela varredura de palavras críticas: quem decide é o auditor humano.
  const precheckKeywords = params.autonomo
    ? []
    : detectCriticalKeywords(contextText, ...(params.palavrasCriticasPrecheck || []));

  try {
    const { config, produtoFixo } = await loadTabulationScope(params.produtoFixo);
    const tabulationCatalog = buildTabulationCatalog(config);
    const userBlock = buildAuditoriaUserBlock(
      { ...params, produtoFixo, palavrasCriticasPrecheck: precheckKeywords },
      tabulationCatalog,
    );

    const openai = createOpenAiClient();
    const vectorIds = getAuditoriaVectorStoreIds();
    const tools = vectorIds.length
      ? [{ type: 'file_search' as const, vector_store_ids: vectorIds, max_num_results: 6 }]
      : undefined;

    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: getAuditoriaPersona(params.modo) },
        { role: 'user', content: userBlock },
      ],
      ...(tools ? { tools } : {}),
      text: {
        format: {
          type: 'json_schema',
          name: 'agent_auditoria',
          schema: AUDITORIA_JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const model = response.model || env.openaiModel;
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model,
        feature: 'auditoria',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        protocolo: params.protocolo,
        userId: params.userId,
      });
    }

    const rawText = extractOutputText(response);
    const parsed = parseAiJson<AuditoriaParsed>(rawText);

    if (!parsed || typeof parsed.score !== 'number') {
      return { success: false, error: 'Resposta de auditoria inválida' };
    }

    const tabulacaoSugerida = resolveTabulacaoSugerida(
      produtoFixo ? withProdutoFixo(parsed.tabulacaoSugerida, produtoFixo) : parsed.tabulacaoSugerida,
      config,
    );

    const llmKeywords = parsed.palavrasCriticasDetectadas || [];
    const candidateKeywords = [...new Set([...precheckKeywords, ...llmKeywords])];
    // Gatilho pra avaliar: palavra-chave (regex ou o próprio Auditor listou em
    // palavrasCriticasDetectadas) OU o Auditor se autodeclarou notificarAgente3=true por
    // critério livre (RISCO_CRITICO), sem nenhuma palavra específica. De qualquer forma, é só
    // o gatilho — a decisão de escalonar de fato fica com avaliarAmeacaCritica, que lê a
    // conversa inteira (ver criticidadeTriagem.service). Sem isso, um "notificarAgente3=true"
    // autodeclarado pelo Auditor bypassaria a triagem inteira.
    const triagemAcionada = !params.autonomo && (candidateKeywords.length > 0 || Boolean(parsed.notificarAgente3));
    const triagemKeywords = candidateKeywords.length > 0
      ? candidateKeywords
      : ['contexto crítico sinalizado pelo Auditor (sem palavra específica)'];
    const ameacaConfirmada = triagemAcionada
      ? (await avaliarAmeacaCritica(contextText, triagemKeywords, {
        protocolo: params.protocolo,
        userId: params.userId,
      })).ameacaReal
      : false;

    const result = applyPostAuditRules(parsed, params, precheckKeywords, tabulacaoSugerida, ameacaConfirmada);
    return { ...result, model };
  } catch (err) {
    console.error('[agent-auditoria]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}
