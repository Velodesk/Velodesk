/**
 * clientMessageEnvelope.service v1.2.0 — stripComposerOpening (refinar / normalização núcleo)
 * VERSION: v1.2.0 | DATE: 2026-08-20
 */
import type { IChamadoN1 } from '../models/ChamadoN1';
import type { TicketAiMessageInput } from './agents/agentTypes';
import { isPrimeiroContatoAgente } from './agents/agentTabulation.util';
import { resolveClientFirstName, trimStr } from './agents/openaiAgent.util';

export type EnvelopeModo = 'primeiro_contato' | 'continuacao';

export interface WrapComposerOpeningParams {
  nucleo: string;
  clientName?: string;
  messages?: TicketAiMessageInput[];
  modo?: EnvelopeModo;
}

export function detectEnvelopeModo(messages?: TicketAiMessageInput[]): EnvelopeModo {
  return isPrimeiroContatoAgente(messages) ? 'primeiro_contato' : 'continuacao';
}

/**
 * Nota interna NÃO conta como mensagem pública pro envelope de saudação — só "já houve
 * contato público" se existir mensagemPublica de origem agente. Fonte de verdade direto no
 * chamado.registro, sem depender de um array de contexto que possa misturar nota interna.
 */
export function hasPriorPublicAgentMessage(chamado: IChamadoN1): boolean {
  return (chamado.registro || []).some(
    (reg) => reg.origin !== 'cliente' && String(reg.mensagemPublica || '').trim().length > 0,
  );
}

export function detectEnvelopeModoFromChamado(chamado: IChamadoN1): EnvelopeModo {
  return hasPriorPublicAgentMessage(chamado) ? 'continuacao' : 'primeiro_contato';
}

/** Primeiro nome do cliente para saudação (template WhatsApp, envelope composer, etc.). */
export function resolveClientGreetingName(clientName?: string, fallback = 'cliente'): string {
  const first = resolveClientFirstName(trimStr(clientName, 200));
  return first || fallback;
}

/**
 * Abertura mecânica aplicada no composer — só a saudação ("Olá, X, tudo bem?" no 1º
 * contato, "Oi, X, tudo bem?" nas seguintes), sem se apresentar. Curta e cordial.
 */
const MECHANICAL_OPENING_RE = /^(?:Olá|Oi),(?:\s*.+?,)?\s*tudo bem\?\s*\r?\n\s*\r?\n/s;

/** Remove abertura mecânica do composer para obter só o núcleo (refinar, IA). */
export function stripComposerOpening(text: string): string {
  const raw = trimStr(text, 32_000);
  if (!raw) return '';
  const stripped = raw.replace(MECHANICAL_OPENING_RE, '').trim();
  return stripped || raw;
}

/** Monta texto do composer: abertura mecânica + núcleo (sem fechamento visual). */
export function wrapComposerOpening(params: WrapComposerOpeningParams): string {
  const nucleo = trimStr(params.nucleo, 32_000);
  if (!nucleo) return '';

  const modo = params.modo ?? detectEnvelopeModo(params.messages);
  // Sem nome real resolvido, a saudação fica sem nome ("Oi, tudo bem?") em vez de usar a
  // palavra genérica "cliente" — mesma lógica de resolveTicketSaudacao em placeholders.util.ts.
  const clientGreeting = resolveClientGreetingName(params.clientName, '');
  const saudacaoCurta = clientGreeting ? `Oi, ${clientGreeting}, tudo bem?` : 'Oi, tudo bem?';
  const saudacaoLonga = clientGreeting ? `Olá, ${clientGreeting}, tudo bem?` : 'Olá, tudo bem?';

  if (modo === 'continuacao') {
    return [saudacaoCurta, '', nucleo].join('\n');
  }

  return [saudacaoLonga, '', nucleo].join('\n');
}
