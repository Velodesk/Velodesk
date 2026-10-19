/**
 * gratitudeReplyGate.service v1.1.0 — Agente 1 + Agente 2 decidindo, juntos, se a resposta do
 * cliente a um ticket Resolvido é só agradecimento (sem pedido novo) — se for, o ticket
 * permanece Resolvido em vez de reabrir sozinho pra fila de atendimento humano.
 *
 * Cenário: cliente agradece um ticket já resolvido → hoje isso reabre pra "Em andamento" (ver
 * resolveInboundClientReplyStatus em chamado.mapper.ts), empilhando ticket que ninguém precisa
 * tratar de novo. Esse gate intercepta exatamente esse caso, ANTES da reabertura:
 *   1. Guarda-corpos determinísticos (flag GRATITUDE_REPLY_GATE_ENABLED desligada — independente
 *      de AGENTS_ENABLED, pra dar pra testar/ligar isso sozinho sem acender o resto do pipeline
 *      de IA —, ticket bloqueado pra IA, canal de caso especial, palavra crítica na mensagem)
 *      — qualquer um deles mantém o comportamento de hoje (reabre normalmente), sem gastar IA.
 *   2. Checagem rápida contra GRATITUDE_ONLY_EXAMPLES (a base fixa, cadastrada aqui no código) e
 *      contra a base APRENDIDA (GratitudeLearnedExample, banco) — mensagem curta e praticamente
 *      igual a um exemplo de qualquer uma das duas fecha na hora, sem LLM.
 *   3. Caso não seja um casamento óbvio: Agente 1 (classifyGratitudeOnly) dá o primeiro parecer;
 *      só se vier com confiança alta, o Agente 2 (auditGratitudeClosure) audita com ceticismo.
 *      Só mantém resolvido se os DOIS concordarem — e nesse caso a frase é registrada como mais
 *      uma ocorrência confirmada (recordConfirmedGratitudeExample); só vira exemplo "promovido"
 *      (sem custo de IA) depois de se repetir em GRATITUDE_LEARNING_PROMOTION_THRESHOLD tickets
 *      diferentes, pra um acerto isolado da IA não virar regra permanente sem segunda checada.
 * Em qualquer dúvida/erro/falha de IA, o padrão é NÃO mexer — mantém o comportamento atual
 * (reabre pra um humano tratar). Nunca manda mensagem ao cliente; só decide se o status muda ou
 * não. Toda decisão de manter resolvido vira nota interna no ticket (sem fila de aprovação
 * humana pra essa ação, a nota é o registro de auditoria).
 */
import { env } from '../../config/env';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import {
  appendMessage,
  currentStatus,
  isEspeciaisChamado,
  normalizeStatusValue,
  resolveInboundClientReplyStatus,
} from '../chamado.mapper';
import { shouldSkipAgentPipeline } from './casosEspeciais.util';
import { hasCriticalKeywords } from './criticalKeywords.service';
import {
  createOpenAiClient,
  extractOutputText,
  isOpenAiApiKeyConfigured,
  mapOpenAiErrorMessage,
  parseAiJson,
} from './openaiAgent.util';
import { logAiUsage } from '../aiUsage.service';
import { getGratitudeLearnedExampleModel } from '../../models/GratitudeLearnedExample';

/**
 * Base de exemplos de agradecimento "puro" (sem pedido novo) — referência pros Agentes 1 e 2
 * classificarem por semelhança, e ponto único pra expandir conforme casos reais aparecerem.
 * Adicione frases novas aqui conforme forem observadas; NUNCA inclua uma que tenha pedido/
 * dúvida/reclamação junto, mesmo que comece com agradecimento.
 */
export const GRATITUDE_ONLY_EXAMPLES: string[] = [
  'Obrigado!',
  'Obrigada!',
  'Muito obrigado, era isso mesmo.',
  'Muito obrigada pela ajuda!',
  'Valeu, obrigado!',
  'Ok, obrigado.',
  'Perfeito, muito obrigada!',
  'Show, valeu pela ajuda.',
  'Agradeço o retorno.',
  'Agradeço, resolvido!',
  'Ótimo, obrigada pela atenção.',
  'Tudo certo, obrigado!',
  'Obrigado, bom dia.',
  'Entendi, obrigada!',
];

/** Frases que parecem agradecimento mas têm pedido/dúvida junto — NÃO deve fechar sozinho. */
export const GRATITUDE_WITH_NEW_REQUEST_EXAMPLES: string[] = [
  'Obrigada! Mas ainda não recebi o valor na minha conta.',
  'Valeu, só uma dúvida: isso já está valendo pra esse mês também?',
  'Obrigado, mas o problema voltou a acontecer.',
  'Agradeço, porém preciso de mais uma informação.',
];

function normalizeForQuickMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUICK_MATCH_SET = new Set(GRATITUDE_ONLY_EXAMPLES.map(normalizeForQuickMatch));

/** Teto de tamanho pra um exemplo valer a pena memorizar — casamento é exato, frase longa não
 * tem chance real de se repetir idêntica, só infla a base/o prompt à toa. */
const MAX_EXAMPLE_LENGTH = 60;

function matchesNormalizedSet(replyText: string, set: Set<string>): boolean {
  const normalized = normalizeForQuickMatch(replyText);
  if (!normalized || normalized.length > MAX_EXAMPLE_LENGTH) return false;
  return set.has(normalized);
}

/** Casamento determinístico — só mensagens curtas e praticamente idênticas a um exemplo da base. */
function isObviousGratitudeOnly(replyText: string): boolean {
  return matchesNormalizedSet(replyText, QUICK_MATCH_SET);
}

// --- Aprendizado: frases confirmadas pelos 2 agentes que se repetem viram exemplo "promovido",
// entrando na checagem rápida (sem custo de IA) — ver GratitudeLearnedExample.ts pro porquê de
// exigir repetição antes de promover. Cache em memória pra não bater no banco a cada mensagem. ---
const LEARNED_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_LEARNED_EXAMPLES_TOTAL = 500;

let learnedCache: { keys: Set<string>; loadedAt: number } | null = null;

async function loadPromotedLearnedKeys(): Promise<Set<string>> {
  const now = Date.now();
  if (learnedCache && now - learnedCache.loadedAt < LEARNED_CACHE_TTL_MS) {
    return learnedCache.keys;
  }
  try {
    const Model = getGratitudeLearnedExampleModel();
    const docs = await Model.find({ promoted: true }).select('normalizedKey').lean();
    const keys = new Set(docs.map((d) => d.normalizedKey));
    learnedCache = { keys, loadedAt: now };
    return keys;
  } catch (err) {
    console.warn('[gratitude-gate] falha ao carregar exemplos aprendidos (fail-soft):', (err as Error).message);
    return learnedCache?.keys ?? new Set();
  }
}

/**
 * Registra mais uma ocorrência confirmada da frase (Agente 1 + Agente 2 concordaram). Só promove
 * (vira exemplo "sem custo") depois de GRATITUDE_LEARNING_PROMOTION_THRESHOLD tickets diferentes
 * com a mesma frase normalizada — um acerto isolado da IA não vira regra permanente sozinho.
 */
async function recordConfirmedGratitudeExample(text: string, protocolo: string): Promise<void> {
  const normalizedKey = normalizeForQuickMatch(text);
  if (!normalizedKey || normalizedKey.length > MAX_EXAMPLE_LENGTH) return;

  try {
    const Model = getGratitudeLearnedExampleModel();
    const existing = await Model.findOne({ normalizedKey });

    if (!existing) {
      const totalCount = await Model.estimatedDocumentCount();
      if (totalCount >= MAX_LEARNED_EXAMPLES_TOTAL) return;
      await Model.create({
        normalizedKey,
        exampleText: text.slice(0, 200),
        occurrences: 1,
        promoted: false,
        ticketProtocols: protocolo ? [protocolo] : [],
      });
      return;
    }

    existing.occurrences += 1;
    existing.lastSeenAt = new Date();
    if (protocolo && !existing.ticketProtocols.includes(protocolo) && existing.ticketProtocols.length < 20) {
      existing.ticketProtocols.push(protocolo);
    }
    if (!existing.promoted && existing.occurrences >= env.gratitudeLearningPromotionThreshold) {
      existing.promoted = true;
      learnedCache = null;
      console.info('[gratitude-gate] exemplo promovido à checagem rápida (sem custo de IA a partir de agora)', {
        normalizedKey,
        occurrences: existing.occurrences,
      });
    }
    await existing.save();
  } catch (err) {
    console.warn('[gratitude-gate] falha ao registrar exemplo aprendido (fail-soft):', (err as Error).message);
  }
}

interface GratitudeClassification {
  agradecimentoPuro: boolean;
  confidence: 'alta' | 'media' | 'baixa';
  justificativa: string;
}

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    agradecimentoPuro: { type: 'boolean' },
    confidence: { type: 'string', enum: ['alta', 'media', 'baixa'] },
    justificativa: { type: 'string' },
  },
  required: ['agradecimentoPuro', 'confidence', 'justificativa'],
} as const;

const CLASSIFY_SYSTEM_PROMPT = [
  'Você é o Agente de Resposta da Velotax (Agente 1). O ticket deste cliente já estava com status',
  '"Resolvido" e ele acabou de responder de novo. Sua única tarefa: decidir se essa resposta é',
  'PURAMENTE um agradecimento/confirmação de que está tudo certo, SEM nenhum pedido novo, dúvida,',
  'reclamação ou informação pendente — nesse caso o ticket deve CONTINUAR resolvido, sem reabrir',
  'pra fila de atendimento humano.',
  'Se houver QUALQUER sinal de pedido, dúvida, reclamação, problema não resolvido ou assunto novo',
  '(mesmo junto com um agradecimento), classifique como agradecimentoPuro=false — na dúvida, não é',
  'agradecimento puro. Responda só com o JSON pedido, sem redigir nada pro cliente.',
].join('\n');

function buildClassifyPrompt(replyText: string): string {
  return [
    '## Exemplos de agradecimento PURO (sem pedido novo) — mantenha resolvido nesses casos',
    ...GRATITUDE_ONLY_EXAMPLES.map((e) => `- "${e}"`),
    '',
    '## Exemplos que PARECEM agradecimento mas têm pedido/dúvida junto — NÃO mantenha resolvido',
    ...GRATITUDE_WITH_NEW_REQUEST_EXAMPLES.map((e) => `- "${e}"`),
    '',
    '## Mensagem do cliente a classificar',
    replyText,
  ].join('\n');
}

export async function classifyGratitudeOnly(
  replyText: string,
  ctx: { ticketId?: string; protocolo?: string },
): Promise<GratitudeClassification | null> {
  try {
    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
        { role: 'user', content: buildClassifyPrompt(replyText) },
      ],
      // Classificação binária, não geração de texto — temperatura baixa reduz a variação entre
      // chamadas pra mensagens no limite da ambiguidade (ação sem fila de aprovação humana).
      temperature: 0,
      text: {
        format: { type: 'json_schema', name: 'agente1_agradecimento', schema: CLASSIFY_SCHEMA, strict: true },
      },
    });
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model: response.model || env.openaiModel,
        feature: 'gratitude_gate_classificacao',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: ctx.ticketId,
        protocolo: ctx.protocolo,
      });
    }
    return parseAiJson<GratitudeClassification>(extractOutputText(response));
  } catch (err) {
    console.warn('[gratitude-gate] classificação (Agente 1) falhou (fail-soft):', mapOpenAiErrorMessage(err));
    return null;
  }
}

interface GratitudeAudit {
  confirmaFechamento: boolean;
  motivo: string;
}

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    confirmaFechamento: { type: 'boolean' },
    motivo: { type: 'string' },
  },
  required: ['confirmaFechamento', 'motivo'],
} as const;

const AUDIT_SYSTEM_PROMPT = [
  'Você é o Agente Auditor da Velotax (Agente 2). O Agente de Resposta (Agente 1) classificou a',
  'resposta de um cliente a um ticket "Resolvido" como agradecimento puro, sugerindo manter o',
  'ticket resolvido (sem reabrir pra atendimento humano).',
  'Audite essa decisão com ceticismo: só confirme confirmaFechamento=true se tiver certeza de que',
  'NÃO existe nenhum pedido, dúvida, reclamação ou problema pendente na mensagem do cliente. Na',
  'menor dúvida, confirmaFechamento=false (deixa reabrir, um humano decide).',
].join('\n');

function buildAuditPrompt(replyText: string, classification: GratitudeClassification): string {
  return [
    `Mensagem do cliente: "${replyText}"`,
    `Classificação do Agente 1: agradecimentoPuro=${classification.agradecimentoPuro}, `
      + `confidence=${classification.confidence}, justificativa="${classification.justificativa}"`,
  ].join('\n');
}

export async function auditGratitudeClosure(
  replyText: string,
  classification: GratitudeClassification,
  ctx: { ticketId?: string; protocolo?: string },
): Promise<GratitudeAudit | null> {
  try {
    const openai = createOpenAiClient();
    const response = await openai.responses.create({
      model: env.openaiModel,
      input: [
        { role: 'system', content: AUDIT_SYSTEM_PROMPT },
        { role: 'user', content: buildAuditPrompt(replyText, classification) },
      ],
      temperature: 0,
      text: {
        format: { type: 'json_schema', name: 'agente2_agradecimento', schema: AUDIT_SCHEMA, strict: true },
      },
    });
    if (response.usage) {
      void logAiUsage({
        provider: 'openai',
        model: response.model || env.openaiModel,
        feature: 'gratitude_gate_auditoria',
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
        ticketId: ctx.ticketId,
        protocolo: ctx.protocolo,
      });
    }
    return parseAiJson<GratitudeAudit>(extractOutputText(response));
  } catch (err) {
    console.warn('[gratitude-gate] auditoria (Agente 2) falhou (fail-soft):', mapOpenAiErrorMessage(err));
    return null;
  }
}

function logGratitudeClosure(
  chamado: IChamadoN1,
  replyText: string,
  classification: GratitudeClassification,
  audit: GratitudeAudit,
  viaFastPath: boolean,
): void {
  const resumo = viaFastPath
    ? 'Resposta do cliente reconhecida como agradecimento (casamento direto com a base de '
      + 'exemplos) — ticket mantido como Resolvido, sem reabrir.'
    : `Resposta do cliente reconhecida como agradecimento pelo Agente de Resposta (confiança `
      + `${classification.confidence}) e confirmada pelo Agente Auditor — ticket mantido como `
      + `Resolvido, sem reabrir. Motivo do auditor: ${audit.motivo}`;

  appendMessage(chamado, resumo, true, 'me', [], {
    origemNota: 'gratitude-reply-gate',
    viaFastPath,
    ...(viaFastPath ? {} : { classificacaoAgente1: classification, auditoriaAgente2: audit }),
    respostaCliente: replyText.slice(0, 500),
  });
  console.info('[gratitude-gate] ticket mantido resolvido', {
    protocolo: chamado.chamadoProtocolo,
    viaFastPath,
  });
}

/**
 * Substitui resolveInboundClientReplyStatus nos pontos de entrada inbound (WhatsApp, e-mail,
 * inbound-ticket genérico) — mesma assinatura de retorno (string de status ou undefined), só que
 * capaz de, no caso específico "ticket estava Resolvido", reconhecer que a resposta do cliente é
 * só agradecimento e manter undefined (sem reabrir) em vez do "em-aberto" padrão.
 */
export async function resolveInboundClientReplyStatusSmart(
  chamado: IChamadoN1,
  replyText: string,
): Promise<string | undefined> {
  const naive = resolveInboundClientReplyStatus(chamado);
  if (!naive) return naive;

  const previousStatus = normalizeStatusValue(currentStatus(chamado));
  if (previousStatus !== 'resolvido') return naive;

  const text = String(replyText ?? '').trim();
  if (!text) return naive;
  if (!env.gratitudeReplyGateEnabled) return naive;
  if (chamado.aiAutomation?.bloqueadoIA) return naive;
  if (isEspeciaisChamado(chamado) || shouldSkipAgentPipeline(chamado)) return naive;
  if (hasCriticalKeywords(text)) return naive;

  if (isObviousGratitudeOnly(text)) {
    logGratitudeClosure(
      chamado,
      text,
      { agradecimentoPuro: true, confidence: 'alta', justificativa: 'casamento direto com a base de exemplos' },
      { confirmaFechamento: true, motivo: 'casamento direto com a base de exemplos' },
      true,
    );
    return undefined;
  }

  const learnedKeys = await loadPromotedLearnedKeys();
  if (matchesNormalizedSet(text, learnedKeys)) {
    logGratitudeClosure(
      chamado,
      text,
      { agradecimentoPuro: true, confidence: 'alta', justificativa: 'frase aprendida — já confirmada em tickets anteriores' },
      { confirmaFechamento: true, motivo: 'frase aprendida — já confirmada em tickets anteriores' },
      true,
    );
    return undefined;
  }

  if (!isOpenAiApiKeyConfigured()) return naive;

  const ctx = { ticketId: chamado._id?.toString(), protocolo: chamado.chamadoProtocolo };
  const classification = await classifyGratitudeOnly(text, ctx);
  if (!classification || !classification.agradecimentoPuro || classification.confidence !== 'alta') {
    return naive;
  }

  const audit = await auditGratitudeClosure(text, classification, ctx);
  if (!audit || !audit.confirmaFechamento) return naive;

  await recordConfirmedGratitudeExample(text, chamado.chamadoProtocolo ?? '');
  logGratitudeClosure(chamado, text, classification, audit, false);
  return undefined;
}
