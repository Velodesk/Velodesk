/**
 * macroPlaceholders v1.0.0 — placeholders inseridos no texto da macro e resolvidos com
 * os dados do ticket/agente no momento em que a macro é aplicada no compose.
 * Mesmo catálogo de tokens de backend/src/services/placeholders.util.ts (nomeCliente,
 * nomeAgente, numeroTicket, produtoTicket) — mantém a sintaxe {token} consistente entre
 * e-mails automáticos e macros do compose.
 */
import { getTicketProtocolLabel } from './utils';

export const MACRO_PLACEHOLDER_CATALOG = [
  { key: 'nomeCliente', token: '{nomeCliente}', label: 'Nome do cliente' },
  { key: 'nomeAgente', token: '{nomeAgente}', label: 'Nome do agente' },
  { key: 'numeroTicket', token: '{numeroTicket}', label: 'Número do ticket' },
  { key: 'produtoTicket', token: '{produtoTicket}', label: 'Produto do ticket' },
];

function resolveClientName(ticket) {
  return String(
    ticket?.clientName
    || ticket?.client?.name
    || ticket?.lateralForm?.clienteNome
    || '',
  ).trim();
}

/** Resolve os valores reais dos placeholders a partir do ticket aberto e do agente logado. */
export function buildMacroPlaceholderValues(ticket, agentName) {
  return {
    // Sem nome real, vira string vazia — nunca o artifício "Cliente" (mesma regra do backend
    // em placeholders.util.ts).
    nomeCliente: resolveClientName(ticket),
    nomeAgente: String(agentName || '').trim() || 'Atendimento Velotax',
    numeroTicket: getTicketProtocolLabel(ticket) || '',
    produtoTicket: String(ticket?.lateralForm?.produto || '').trim(),
  };
}

/** Troca os tokens {chave} pelos valores reais do ticket/agente no HTML da macro. */
export function applyMacroPlaceholders(html, ticket, agentName) {
  const raw = String(html || '');
  if (!raw) return raw;
  const values = buildMacroPlaceholderValues(ticket, agentName);
  return MACRO_PLACEHOLDER_CATALOG.reduce(
    (acc, item) => acc.replace(new RegExp(`\\{${item.key}\\}`, 'gi'), values[item.key]),
    raw,
  );
}
