/**
 * atendimentoAgent.service v1.3.0 — remove gate de coerência como chamada de LLM separada;
 * volta a ser 1 única consulta, com a trava determinística (enforceLiteralClientQuote) como
 * única camada de proteção contra pedido implícito/incoerente
 * VERSION: v1.3.0 | DATE: 2026-09-02
 */
import { env } from '../../config/env';
import type { AtendimentoInput, AtendimentoResult, RevisaoInput, ConfidenceLevel } from './agentTypes';
import { getAtendimentoPersona } from './personas/atendimentoPersona';
import { getAtendimentoRevisaoPersona } from './personas/atendimentoRevisaoPersona';
import {
  ATENDIMENTO_JSON_SCHEMA,
  buildAtendimentoUserBlock,
  buildTabulationDisplay,
  loadTabulationScope,
  withProdutoFixo,
  buildTabulationCatalog,
  validateTabulationResult,
  isPrimeiroContatoAgente,
  isLiteralClientQuote,
  buildClassificacaoUserBlock,
  CLASSIFICACAO_JSON_SCHEMA,
  CLASSIFICACAO_SYSTEM_PROMPT,
} from './agentTabulation.util';
import {
  createOpenAiClient,
  extractOutputText,
  getAtendimentoVectorStoreIds,
  isAgentsConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
  resolveClientFirstName,
  trimStr,
} from './openaiAgent.util';
import { getFeedbackExamplesForPrompt } from './agentFeedback.service';
import { logAiUsage } from '../aiUsage.service';

interface AtendimentoParsed {
  pedidoClienteCitado?: string;
  respostaSugerida?: string;
  tabulacao?: { tipo?: string; produto?: string; motivo?: string; detalhe?: string };
  confidence?: ConfidenceLevel;
  fontesConsultadas?: string[];
}

/**
 * Trava determinística: se o modelo não citou um trecho que realmente existe na mensagem
 * do cliente, força o resultado para "sem solicitação identificada" — não confia no
 * julgamento do próprio modelo sobre se o pedido é real (ver isLiteralClientQuote).
 * Única camada de proteção contra pedido implícito/incoerente: a checagem de coerência
 * virou instrução do próprio Agente 1 (ver getAtendimentoPersona), sem chamada de LLM
 * separada — reduz o custo do pipeline de volta a 1 consulta por composição.
 */
function enforceLiteralClientQuote(
  parsed: AtendimentoParsed,
  clientText: string,
): AtendimentoParsed {
  if (!clientText.trim()) return parsed;
  const quote = String(parsed.pedidoClienteCitado || '');
  if (isLiteralClientQuote(quote, clientText)) return parsed;

  return {
    ...parsed,
    respostaSugerida: 'Não foi possível identificar uma solicitação clara nesse contato. '
      + 'Por favor, confirme com o cliente qual é a dúvida ou pedido antes de prosseguir.',
    tabulacao: { tipo: parsed.tabulacao?.tipo || '', produto: '', motivo: '', detalhe: '' },
    confidence: 'baixa',
  };
}

function buildClientTextForQuoteCheck(messages?: AtendimentoInput['messages']): string {
  return (messages || [])
    .filter((m) => m.role === 'cliente')
    .map((m) => m.text)
    .join('\n');
}

async function callAtendimentoOpenAi(
  systemPrompt: string,
  userBlock: string,
  vectorStoreIds: string[],
  usageContext: { ticketId?: string; protocolo?: string; userId?: string },
): Promise<{ parsed: AtendimentoParsed | null; model: string }> {
  const openai = createOpenAiClient();
  const tools = vectorStoreIds.length
    ? [{ type: 'file_search' as const, vector_store_ids: vectorStoreIds, max_num_results: 6 }]
    : undefined;

  const response = await openai.responses.create({
    model: env.openaiModel,
    input: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userBlock },
    ],
    ...(tools ? { tools } : {}),
    text: {
      format: {
        type: 'json_schema',
        name: 'agent_atendimento',
        schema: ATENDIMENTO_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  const model = response.model || env.openaiModel;
  if (response.usage) {
    void logAiUsage({
      provider: 'openai',
      model,
      feature: 'atendimento',
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
      reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
      ticketId: usageContext.ticketId,
      protocolo: usageContext.protocolo,
      userId: usageContext.userId,
    });
  }

  const rawText = extractOutputText(response);
  const parsed = parseAiJson<AtendimentoParsed>(rawText);
  return { parsed, model };
}

export async function composeAtendimento(params: AtendimentoInput): Promise<AtendimentoResult> {
  if (!isAgentsConfigured()) {
    return { success: false, error: 'Agentes não configurados' };
  }

  try {
    const { config, produtoFixo } = await loadTabulationScope(params.produtoFixo);
    const catalog = buildTabulationCatalog(config);
    const feedbackExamples = await getFeedbackExamplesForPrompt(params.produtoHint);

    const userBlock = buildAtendimentoUserBlock(
      { ...params, produtoFixo, feedbackExamples },
      catalog,
    );

    const vectorIds = getAtendimentoVectorStoreIds();
    const { parsed, model } = await callAtendimentoOpenAi(
      getAtendimentoPersona(),
      userBlock,
      vectorIds,
      { ticketId: params.ticketId, protocolo: params.protocolo, userId: params.userId },
    );

    if (!parsed?.respostaSugerida?.trim()) {
      return { success: false, error: 'Resposta da IA inválida ou vazia' };
    }

    const enforced = enforceLiteralClientQuote(parsed, buildClientTextForQuoteCheck(params.messages));
    const tabulacao = validateTabulationResult(withProdutoFixo(enforced.tabulacao, produtoFixo), config);

    return {
      success: true,
      respostaSugerida: enforced.respostaSugerida!.trim(),
      tabulacao,
      tabulacaoDisplay: buildTabulationDisplay(tabulacao),
      confidence: enforced.confidence || 'media',
      fontesConsultadas: enforced.fontesConsultadas || ['public', 'pop'],
      model,
    };
  } catch (err) {
    console.error('[agent-atendimento]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}

export async function reviseAtendimento(params: RevisaoInput): Promise<AtendimentoResult> {
  if (!isAgentsConfigured()) {
    return { success: false, error: 'Agentes não configurados' };
  }

  try {
    const { config, produtoFixo } = await loadTabulationScope(params.produtoFixo);
    const catalog = buildTabulationCatalog(config);
    const feedbackExamples = await getFeedbackExamplesForPrompt(
      params.tabulacaoAnterior.produto || params.produtoHint,
      params.tabulacaoAnterior.motivo,
    );

    const isPrimeiroContato = isPrimeiroContatoAgente(params.messages);
    const clientFirstName = resolveClientFirstName(trimStr(params.clientName, 200));

    const systemPrompt = getAtendimentoRevisaoPersona({
      origemRevisao: params.origemRevisao,
      inputOperador: params.inputOperador,
      violacoes: params.violacoes,
      recomendacoes: params.recomendacoes,
      respostaAnterior: params.respostaAnterior,
      isPrimeiroContato,
      canal: params.canal,
      clientFirstName: clientFirstName || undefined,
    });

    const userBlock = buildAtendimentoUserBlock(
      { ...params, produtoFixo, feedbackExamples },
      catalog,
      { modoRevisao: true },
    );

    const vectorIds = getAtendimentoVectorStoreIds();
    const { parsed, model } = await callAtendimentoOpenAi(
      systemPrompt,
      userBlock,
      vectorIds,
      { ticketId: params.ticketId, protocolo: params.protocolo, userId: params.userId },
    );

    if (!parsed?.respostaSugerida?.trim()) {
      return { success: false, error: 'Revisão da IA inválida ou vazia' };
    }

    const enforced = enforceLiteralClientQuote(parsed, buildClientTextForQuoteCheck(params.messages));
    const tabulacao = validateTabulationResult(withProdutoFixo(enforced.tabulacao, produtoFixo), config);

    return {
      success: true,
      respostaSugerida: enforced.respostaSugerida!.trim(),
      tabulacao,
      tabulacaoDisplay: buildTabulationDisplay(tabulacao),
      confidence: enforced.confidence || 'media',
      fontesConsultadas: enforced.fontesConsultadas || ['public', 'pop'],
      model,
    };
  } catch (err) {
    console.error('[agent-atendimento-revise]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}

/**
 * Etapa 1 da hidratação: chamada curta (sem POPs, sem redação) só para o agente decidir produto/motivo.
 * O resultado define qual consulta da conta será feita antes de redigir a resposta.
 */
export async function classifyAtendimento(
  params: AtendimentoInput,
): Promise<{ success: boolean; tabulacao?: AtendimentoResult['tabulacao']; error?: string }> {
  if (!isAgentsConfigured()) return { success: false, error: 'Agentes não configurados' };

  try {
    const { config, produtoFixo } = await loadTabulationScope(params.produtoFixo);
    const userBlock = buildClassificacaoUserBlock({ ...params, produtoFixo }, buildTabulationCatalog(config));
    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: CLASSIFICACAO_SYSTEM_PROMPT },
        { role: 'user', content: userBlock },
      ],
      text: {
        format: { type: 'json_schema', name: 'agent_classificacao', schema: CLASSIFICACAO_JSON_SCHEMA, strict: true },
      },
    });

    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model: response.model || env.openaiModel,
        feature: 'atendimento_classificacao',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: params.ticketId,
        protocolo: params.protocolo,
        userId: params.userId,
      });
    }

    const parsed = parseAiJson<{ tipo?: string; produto?: string; motivo?: string; detalhe?: string }>(
      extractOutputText(response),
    );
    if (!parsed) return { success: false, error: 'Classificação inválida' };
    return { success: true, tabulacao: validateTabulationResult(withProdutoFixo(parsed, produtoFixo), config) };
  } catch (err) {
    console.warn('[agent-atendimento] classificação falhou (fail-soft):', (err as Error)?.message);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}
