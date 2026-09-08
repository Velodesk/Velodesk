/**
 * openaiTicketSuggest.service v1.5.0 — checa aiSuggestionCache (fingerprint) antes de chamar
 * o pipeline; se a thread não mudou desde a última geração em modo desk, serve do cache sem
 * nenhuma chamada de LLM
 * VERSION: v1.5.0 | DATE: 2026-09-02
 */
import OpenAI from 'openai';
import { env } from '../config/env';
import { ChamadoN1, type IChamadoN1 } from '../models/ChamadoN1';
import { getActiveTabulation, type TabulationActiveDto } from './tabulation.service';
import {
  buildTabulationCatalog,
  buildTabulationDisplay,
  validateTabulationResult,
} from './agents/agentTabulation.util';
import { getTicketSuggestPersona } from './ticketSuggestPersona';
import { runAgentPipeline } from './agents/agentOrchestrator.service';
import type { PipelineStage } from './agents/agentTypes';
import { computeCanonicalFingerprint, readAiSuggestionCache } from './agents/agentSuggestionCache.util';
import { isPersistedMongoTicketId } from '../utils/persistedTicketId';
import { getAgentsStatus, getAtendimentoVectorStoreIds, isAgentsConfigured } from './agents/openaiAgent.util';
import { logAiUsage } from './aiUsage.service';
import {
  buildTicketIaMessagesFromChamado,
  buildTicketIaInternalNotesFromChamado,
  isPlaceholderClientMessageText,
} from './ticketIaAdapter.service';

const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 8_000;
const MAX_INTERNAL_NOTE_CHARS = 12_000;
const MAX_TITULO_CHARS = 500;
const REQUEST_TIMEOUT_MS = 120_000;

function createOpenAiClient() {
  return new OpenAI({
    apiKey: env.openaiApiKey,
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 2,
    // node-fetch bundled pelo SDK falha com ERR_STREAM_PREMATURE_CLOSE no Windows;
    // em produção (Linux/Cloud Run) o fetch nativo conflita com o content-length
    // que o SDK seta manualmente ("invalid content-length header"), então só
    // trocamos o transporte no Windows.
    ...(process.platform === 'win32' ? { fetch: globalThis.fetch } : {}),
  });
}

export type TicketAiContextSource = 'public' | 'internal';

export interface TicketAiMessageInput {
  role: 'cliente' | 'agente';
  text: string;
}

export interface TicketAiSuggestInput {
  ticketId?: string;
  protocolo?: string;
  titulo?: string;
  canal?: string;
  clientName?: string;
  nomeOperador?: string;
  contextSource: TicketAiContextSource;
  messages?: TicketAiMessageInput[];
  internalNote?: string;
  produtoHint?: string;
  /** Callback opcional (não serializado) para reportar progresso ao chamador — usado pelo endpoint SSE. */
  onStage?: (stage: PipelineStage) => void;
}

export interface TicketAiTabulationResult {
  tipo: string;
  produto: string;
  motivo: string;
  detalhe: string;
  incompleta?: boolean;
}

export interface TicketAiSuggestResult {
  success: boolean;
  respostaSugerida?: string;
  tabulacao?: TicketAiTabulationResult;
  tabulacaoDisplay?: string;
  model?: string;
  error?: string;
  auditScore?: number;
  auditAprovado?: boolean;
  auditDecisao?: string;
  confidence?: string;
  revisoesRealizadas?: number;
  auditComplete?: boolean;
  tabulacaoFonte?: 'auditoria' | 'atendimento';
}

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    respostaSugerida: { type: 'string' },
    tabulacao: {
      type: 'object',
      additionalProperties: false,
      properties: {
        tipo: { type: 'string' },
        produto: { type: 'string' },
        motivo: { type: 'string' },
        detalhe: { type: 'string' },
      },
      required: ['tipo', 'produto', 'motivo', 'detalhe'],
    },
  },
  required: ['respostaSugerida', 'tabulacao'],
} as const;

export function getOpenAiTicketSuggestStatus(): { configured: boolean; missing: string[] } {
  if (env.agentsEnabled) {
    const agents = getAgentsStatus();
    return { configured: agents.configured, missing: agents.missing };
  }
  const missing: string[] = [];
  if (!env.openaiApiKey?.trim()) missing.push('OPENAI_API_KEY');
  if (!env.openaiVectorStoreId?.trim()) missing.push('OPENAI_VECTOR_STORE_ID');
  return { configured: missing.length === 0, missing };
}

export function isOpenAiTicketSuggestConfigured(): boolean {
  if (env.agentsEnabled) return isAgentsConfigured();
  return getOpenAiTicketSuggestStatus().configured;
}

function trimStr(value: unknown, maxLen: number): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeMessages(raw: unknown): TicketAiMessageInput[] {
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((m) => ({
      role: m?.role === 'agente' ? 'agente' as const : 'cliente' as const,
      text: trimStr(m?.text, MAX_MESSAGE_CHARS),
    }))
    .filter((m) => m.text.length > 0);
  return mapped
    .filter((m) => m.role === 'agente' || !isPlaceholderClientMessageText(m.text))
    .slice(-MAX_MESSAGES);
}

async function resolveMessagesForSuggest(
  params: TicketAiSuggestInput,
): Promise<TicketAiMessageInput[]> {
  const fromClient = normalizeMessages(params.messages);
  if (!isPersistedMongoTicketId(params.ticketId)) return fromClient;

  try {
    const chamado = await ChamadoN1.findById(params.ticketId).lean();
    if (!chamado) return fromClient;
    const fromDb = buildTicketIaMessagesFromChamado(chamado as unknown as IChamadoN1)
      .map((item) => ({
        role: item.role,
        text: trimStr(item.text, MAX_MESSAGE_CHARS),
      }))
      .filter((item) => item.text.length > 0)
      .filter((item) => item.role === 'agente' || !isPlaceholderClientMessageText(item.text))
      .slice(-MAX_MESSAGES);
    if (fromDb.length) return fromDb;
  } catch (err) {
    console.warn('[ticket-ai-suggest] falha ao montar histórico do ticket — usando payload do cliente:', (err as Error).message);
  }
  return fromClient;
}

async function resolveInternalNoteForSuggest(
  params: TicketAiSuggestInput,
): Promise<string | undefined> {
  const fromClient = trimStr(params.internalNote, MAX_INTERNAL_NOTE_CHARS);
  if (!isPersistedMongoTicketId(params.ticketId)) return fromClient || undefined;

  try {
    const chamado = await ChamadoN1.findById(params.ticketId).lean();
    if (!chamado) return fromClient || undefined;
    const fromDb = trimStr(
      buildTicketIaInternalNotesFromChamado(chamado as unknown as IChamadoN1),
      MAX_INTERNAL_NOTE_CHARS,
    );
    if (!fromDb) return fromClient || undefined;
    if (!fromClient) return fromDb;
    // Une DB + rascunho do cliente sem duplicar o mesmo bloco.
    if (fromDb.includes(fromClient) || fromClient.includes(fromDb)) {
      return fromDb.length >= fromClient.length ? fromDb : fromClient;
    }
    return trimStr(`${fromDb}\n\n${fromClient}`, MAX_INTERNAL_NOTE_CHARS);
  } catch (err) {
    console.warn('[ticket-ai-suggest] falha ao montar notas internas — usando payload:', (err as Error).message);
    return fromClient || undefined;
  }
}

export function validateTicketAiInput(body: unknown):
  | { ok: true; data: TicketAiSuggestInput }
  | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Corpo da requisição inválido' };
  }

  const b = body as Record<string, unknown>;
  // contextSource é aceito por compatibilidade com clientes antigos, mas descontinuado: o
  // contexto agora é sempre a mescla de mensagens públicas + anotações internas, nunca uma
  // escolha exclusiva entre as duas — ver generateTicketAiSuggest.
  const contextSource = b.contextSource === 'internal' ? 'internal' : 'public';

  const messages = normalizeMessages(b.messages);
  const internalNote = trimStr(b.internalNote, MAX_INTERNAL_NOTE_CHARS);

  return {
    ok: true,
    data: {
      ticketId: trimStr(b.ticketId, 64) || undefined,
      protocolo: trimStr(b.protocolo, 64) || undefined,
      titulo: trimStr(b.titulo, MAX_TITULO_CHARS) || undefined,
      canal: trimStr(b.canal, 64) || undefined,
      clientName: trimStr(b.clientName, 200) || undefined,
      nomeOperador: trimStr(b.nomeOperador, 120) || undefined,
      contextSource,
      messages: messages.length ? messages : undefined,
      internalNote: internalNote || undefined,
      produtoHint: trimStr(b.produtoHint, 200) || undefined,
    },
  };
}

function formatMessagesBlock(messages: TicketAiMessageInput[]): string {
  return messages
    .map((m, i) => `${i + 1}. [${m.role === 'cliente' ? 'Cliente' : 'Agente'}]: ${m.text}`)
    .join('\n');
}

function resolveClientFirstName(fullName: string): string {
  const name = trimStr(fullName, 200);
  if (!name) return '';
  return name.split(/\s+/)[0] || name;
}

function buildUserBlock(params: TicketAiSuggestInput, tabulationCatalog: string): string {
  const clientFullName = trimStr(params.clientName, 200);
  const clientFirstName = resolveClientFirstName(clientFullName);
  const parts: string[] = [
    '## Dados do atendimento',
    '',
    `- **Protocolo:** ${params.protocolo || 'não informado'}`,
    `- **Canal:** ${params.canal || 'não informado'}`,
    `- **Cliente:** ${clientFullName || 'não informado'}`,
    `- **Nome do agente:** ${params.nomeOperador || 'não informado'}`,
    `- **Título:** ${params.titulo || 'não informado'}`,
    `- **Fonte de contexto:** ${[params.messages?.length ? 'mensagens públicas' : '', params.internalNote?.trim() ? 'anotações internas' : ''].filter(Boolean).join(' + ') || 'nenhuma'}`,
  ];

  if (clientFirstName) {
    parts.push(
      '',
      '## Nome do cliente',
      '',
      `- **Nome completo:** ${clientFullName}`,
      `- **Primeiro nome:** ${clientFirstName} (saudação breve apenas no primeiro contato; não repita a pergunta do cliente)`,
    );
  }

  if (params.produtoHint) {
    parts.push(`- **Produto já identificado pelo agente (priorizar POP):** ${params.produtoHint}`);
  }

  parts.push('', '## Lista fechada de tabulação (usar SOMENTE estes valores)', '', tabulationCatalog);
  parts.push('', '## Tipos permitidos', '', 'Reclamação, Solicitação, Dúvida, Informação');

  if (params.messages?.length) {
    parts.push('', '## Mensagens públicas do atendimento', '', formatMessagesBlock(params.messages));
    const firstClient = params.messages.find((m) => m.role === 'cliente');
    if (firstClient) {
      parts.push('', '## Descrição principal do chamado (1ª mensagem do cliente)', '', firstClient.text);
    }
  }

  if (params.internalNote?.trim()) {
    parts.push(
      '',
      '## Anotações internas do agente (contexto operacional — NÃO repetir literalmente na resposta ao cliente)',
      '',
      params.internalNote.trim(),
    );
  }

  parts.push(
    '',
    '## Tarefa',
    '',
    'Consulte os POPs na base de conhecimento. Retorne JSON com respostaSugerida (direta ao ponto, sem eco nem clichê de abertura) e tabulacao (tipo, produto, motivo, detalhe) usando apenas valores da lista fechada.',
  );

  return parts.join('\n');
}

function mapOpenAiErrorMessage(err: unknown): string {
  const message = (err as Error)?.message || String(err);
  if (/401|invalid_api_key|Incorrect API key/i.test(message)) {
    return 'Chave OpenAI inválida. Verifique OPENAI_API_KEY.';
  }
  if (/429|rate limit|quota/i.test(message)) {
    return 'Limite de uso da API OpenAI atingido. Tente novamente em alguns minutos.';
  }
  if (/402|billing|insufficient/i.test(message)) {
    return 'Conta OpenAI sem crédito ou cobrança pendente.';
  }
  if (/404|not found|vector_store/i.test(message)) {
    return `Vector store ou modelo indisponível. Verifique OPENAI_VECTOR_STORE_ID e OPENAI_MODEL.`;
  }
  if (/timeout|ETIMEDOUT|abort|Premature close|ERR_STREAM_PREMATURE_CLOSE/i.test(message)) {
    return 'Tempo esgotado ou conexão interrompida ao consultar a IA. Tente novamente.';
  }
  return message || 'Não foi possível gerar sugestão';
}

function extractOutputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  for (const item of response.output || []) {
    if (item.type === 'message' && 'content' in item) {
      for (const part of item.content || []) {
        if (part.type === 'output_text' && part.text?.trim()) {
          return part.text.trim();
        }
      }
    }
  }
  return '';
}

function parseAiJson(raw: string): { respostaSugerida?: string; tabulacao?: { tipo?: string; produto?: string; motivo?: string; detalhe?: string } } | null {
  try {
    return JSON.parse(raw) as { respostaSugerida?: string; tabulacao?: { tipo?: string; produto?: string; motivo?: string; detalhe?: string } };
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export async function generateTicketAiSuggest(
  params: TicketAiSuggestInput,
  userId?: string,
): Promise<TicketAiSuggestResult> {
  if (!isOpenAiTicketSuggestConfigured()) {
    return { success: false, error: 'Serviço OpenAI não configurado' };
  }

  const resolvedMessages = await resolveMessagesForSuggest(params);
  const resolvedInternalNote = await resolveInternalNoteForSuggest(params);
  const enrichedParams: TicketAiSuggestInput = {
    ...params,
    messages: resolvedMessages.length ? resolvedMessages : params.messages,
    internalNote: resolvedInternalNote || params.internalNote,
  };

  // Política: contexto sempre mesclado (mensagens públicas + anotações internas), nunca uma
  // escolha exclusiva — contextSource não filtra mais o que é enviado à IA, só falha se não
  // houver NENHUM contexto disponível (nem mensagem, nem nota).
  const hasAnyContext = (enrichedParams.messages || []).some(
    (m) => m.role === 'agente' || !isPlaceholderClientMessageText(m.text),
  ) || Boolean(trimStr(enrichedParams.internalNote, MAX_INTERNAL_NOTE_CHARS));
  if (!hasAnyContext) {
    return { success: false, error: 'Nenhum contexto disponível (mensagens públicas ou anotação interna) para gerar sugestão' };
  }

  if (env.agentsEnabled && isPersistedMongoTicketId(enrichedParams.ticketId)) {
    const freshChamado = await ChamadoN1.findById(enrichedParams.ticketId);
    const cached = freshChamado ? await readAiSuggestionCache(enrichedParams.ticketId!) : null;
    const fingerprint = freshChamado
      ? computeCanonicalFingerprint(freshChamado, enrichedParams.contextSource)
      : '';
    if (cached && cached.fingerprint === fingerprint) {
      console.log('[ticket-ai-suggest] cache hit — sugestão pré-gerada reaproveitada', {
        ticketId: enrichedParams.ticketId,
        generatedAt: cached.generatedAt,
      });
      return {
        success: true,
        respostaSugerida: cached.respostaSugerida,
        tabulacao: cached.tabulacao,
        tabulacaoDisplay: cached.tabulacaoDisplay,
        tabulacaoFonte: (cached.tabulacaoFonte as 'auditoria' | 'atendimento' | undefined) || 'atendimento',
        model: cached.model,
        auditScore: cached.auditScore,
        auditAprovado: cached.auditAprovado,
        auditDecisao: cached.auditDecisao,
        auditComplete: true,
        confidence: cached.confidence,
      };
    }
  }

  if (env.agentsEnabled) {
    console.log('[ticket-ai-suggest] delegando ao orquestrador (desk) para', userId || 'anonimo');
    const pipeline = await runAgentPipeline({
      ...enrichedParams,
      pipelineModo: 'desk',
      onStage: params.onStage,
    });
    if (!pipeline.success) {
      return { success: false, error: pipeline.error || 'Falha no pipeline de agentes' };
    }
    if (typeof pipeline.auditScore !== 'number' || !pipeline.auditComplete) {
      return { success: false, error: 'Auditoria não concluída — sugestão bloqueada' };
    }
    return {
      success: true,
      respostaSugerida: pipeline.respostaSugerida,
      tabulacao: pipeline.tabulacao,
      tabulacaoDisplay: pipeline.tabulacaoDisplay,
      tabulacaoFonte: pipeline.tabulacaoFonte,
      model: pipeline.model,
      auditScore: pipeline.auditScore,
      auditAprovado: pipeline.auditAprovado,
      auditDecisao: pipeline.auditDecisao,
      auditComplete: true,
      confidence: pipeline.confidence,
      revisoesRealizadas: pipeline.revisoesRealizadas,
    };
  }

  try {
    let config: TabulationActiveDto;
    try {
      config = await getActiveTabulation();
    } catch (tabErr) {
      console.warn('[ticket-ai-suggest] tabulação Mongo indisponível — continuando só com POPs:', (tabErr as Error)?.message);
      config = { produtos: [], opcoes: { tipoChamado: [], canalContato: [] } };
    }
    const tabulationCatalog = buildTabulationCatalog(config);
    const systemPrompt = getTicketSuggestPersona();
    const userBlock = buildUserBlock(enrichedParams, tabulationCatalog);

    const openai = createOpenAiClient();

    console.log('[ticket-ai-suggest] processando para', userId || 'anonimo', enrichedParams.contextSource, {
      messages: enrichedParams.messages?.length || 0,
    });

    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBlock },
      ],
      tools: [
        {
          type: 'file_search',
          vector_store_ids: getAtendimentoVectorStoreIds(),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'ticket_ai_suggest',
          schema: JSON_SCHEMA,
          strict: true,
        },
      },
    });

    const model = response.model || env.openaiModel;
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model,
        feature: 'ticket_suggest_legacy',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: enrichedParams.ticketId,
        protocolo: enrichedParams.protocolo,
        userId,
      });
    }

    const rawText = extractOutputText(response);
    const parsed = parseAiJson(rawText);

    if (!parsed?.respostaSugerida?.trim()) {
      return { success: false, error: 'Resposta da IA inválida ou vazia' };
    }

    const tabulacao = validateTabulationResult(parsed.tabulacao || {}, config);

    return {
      success: true,
      respostaSugerida: parsed.respostaSugerida.trim(),
      tabulacao,
      tabulacaoDisplay: buildTabulationDisplay(tabulacao),
      model,
    };
  } catch (err) {
    console.error('[ticket-ai-suggest]', err);
    return { success: false, error: mapOpenAiErrorMessage(err) };
  }
}

export function statusForOpenAiError(error?: string): number {
  if (!error) return 500;
  if (/não configurado|OPENAI_API_KEY|OPENAI_VECTOR_STORE/i.test(error)) return 503;
  if (/crédito|cobrança|billing|429|Limite de uso|indisponível|Vector store/i.test(error)) return 502;
  return 500;
}
