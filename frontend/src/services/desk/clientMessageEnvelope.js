/**
 * clientMessageEnvelope v1.1.0 — stripComposerOpening (refinar / normalização núcleo)
 * VERSION: v1.1.0 | DATE: 2026-08-20
 */

function trimStr(value, maxLen = 200) {
  return String(value ?? '').trim().slice(0, maxLen);
}

function resolveClientFirstName(fullName) {
  const name = trimStr(fullName, 200);
  if (!name) return '';
  return name.split(/\s+/)[0] || name;
}

/** Sem nome real, retorna string vazia — nunca o artifício "cliente"/"Cliente" genérico. */
function resolveClientGreetingName(clientName) {
  return resolveClientFirstName(clientName);
}

function resolveAgentDisplayName(agentName) {
  const name = trimStr(agentName, 120);
  return name || 'Atendimento Velotax';
}

/**
 * Abertura mecânica aplicada no composer — envelope completo no 1º contato
 * ("Olá, X, tudo bem?\n\nEu sou Y...") ou só a saudação curta nas mensagens
 * seguintes ("Oi, X, tudo bem?"). Sem se apresentar de novo, mas sempre cordial.
 */
const MECHANICAL_OPENING_RE = /^(?:Olá,\s*.+?,\s*tudo bem\?\s*\r?\n\s*\r?\nEu sou .+?, do time de atendimento Velotax\.\s*\r?\n\s*\r?\n|Oi,\s*.+?,\s*tudo bem\?\s*\r?\n\s*\r?\n)/s;

/** Remove abertura mecânica do composer para obter só o núcleo. */
export function stripComposerOpening(text) {
  const raw = trimStr(text, 32000);
  if (!raw) return '';
  const stripped = raw.replace(MECHANICAL_OPENING_RE, '').trim();
  return stripped || raw;
}

/** @param {Array<{ role?: string }>} messages */
export function detectEnvelopeModoFromTicketMessages(messages = []) {
  if (!messages.length) return 'primeiro_contato';
  const hasAgent = messages.some((m) => {
    const role = String(m?.role ?? '').toLowerCase();
    return role === 'agente' || role === 'agent' || role === 'me';
  });
  return hasAgent ? 'continuacao' : 'primeiro_contato';
}

/**
 * @param {object} params
 * @param {string} params.nucleo
 * @param {string} [params.clientName]
 * @param {string} [params.agentName]
 * @param {'primeiro_contato'|'continuacao'} [params.modo]
 */
export function wrapComposerOpening(params) {
  const nucleo = trimStr(params?.nucleo, 32000);
  if (!nucleo) return '';

  const modo = params?.modo || 'primeiro_contato';
  const clientGreeting = resolveClientGreetingName(params?.clientName);

  if (modo === 'continuacao') {
    // Sem se apresentar de novo — mas continua cordial: só a saudação curta.
    const saudacaoCurta = clientGreeting ? `Oi, ${clientGreeting}, tudo bem?` : 'Oi, tudo bem?';
    return [saudacaoCurta, '', nucleo].join('\n');
  }

  const agentDisplay = resolveAgentDisplayName(params?.agentName);
  const saudacaoLonga = clientGreeting ? `Olá, ${clientGreeting}, tudo bem?` : 'Olá, tudo bem?';

  return [
    saudacaoLonga,
    '',
    `Eu sou ${agentDisplay}, do time de atendimento Velotax.`,
    '',
    nucleo,
  ].join('\n');
}

/**
 * Detecta modo a partir do ticket Desk (registro público do agente).
 * @param {object} ticket
 */
export function detectEnvelopeModoFromTicket(ticket) {
  const registro = ticket?.registro || ticket?.messages || [];
  const publicAgentMsgs = registro.filter((reg) => {
    const origin = String(reg?.origin ?? reg?.sender ?? '').toLowerCase();
    const isAgent = origin === 'agente' || origin === 'agent' || origin === 'me';
    const text = String(reg?.mensagemPublica ?? reg?.text ?? reg?.body ?? '').trim();
    return isAgent && text.length > 0;
  });
  return publicAgentMsgs.length === 0 ? 'primeiro_contato' : 'continuacao';
}

/**
 * @param {object} params
 * @param {string} params.nucleo
 * @param {object} params.ticket
 * @param {string} params.agentName
 */
export function wrapComposerOpeningForTicket({ nucleo, ticket, agentName }) {
  // Nunca ticket?.titulo — título do ticket já causou nome errado grudando como se fosse
  // nome de cliente (ex.: "Central" saindo de "Central de Atendimento (Tel ...)").
  const clientName = ticket?.clientName
    || ticket?.client?.name
    || ticket?.lateralForm?.clienteNome
    || '';
  const modo = detectEnvelopeModoFromTicket(ticket);
  return wrapComposerOpening({
    nucleo,
    clientName,
    agentName,
    modo,
  });
}

function escapeHtmlText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Mesma abertura mecânica de wrapComposerOpening, mas para um núcleo que já é HTML rico
 * (ex.: macro com links) — usada em vez de wrapComposerOpening quando o núcleo não pode
 * passar por normalização de texto puro (senão as quebras de linha da saudação virariam
 * espaço em vez de <br />, e o HTML do núcleo seria escapado por engano).
 * @param {object} params
 * @param {string} params.nucleoHtml
 * @param {string} [params.clientName]
 * @param {string} [params.agentName]
 * @param {'primeiro_contato'|'continuacao'} [params.modo]
 */
export function wrapComposerOpeningHtml(params) {
  const nucleoHtml = String(params?.nucleoHtml || '').trim();
  if (!nucleoHtml) return '';

  const modo = params?.modo || 'primeiro_contato';
  const clientGreeting = resolveClientGreetingName(params?.clientName);

  if (modo === 'continuacao') {
    const saudacaoCurta = clientGreeting ? `Oi, ${clientGreeting}, tudo bem?` : 'Oi, tudo bem?';
    return `${escapeHtmlText(saudacaoCurta)}<br /><br />${nucleoHtml}`;
  }

  const agentDisplay = resolveAgentDisplayName(params?.agentName);
  const saudacaoLonga = clientGreeting ? `Olá, ${clientGreeting}, tudo bem?` : 'Olá, tudo bem?';
  const greetingLines = [
    escapeHtmlText(saudacaoLonga),
    escapeHtmlText(`Eu sou ${agentDisplay}, do time de atendimento Velotax.`),
  ];
  return `${greetingLines.join('<br /><br />')}<br /><br />${nucleoHtml}`;
}

/**
 * @param {object} params
 * @param {string} params.nucleoHtml
 * @param {object} params.ticket
 * @param {string} params.agentName
 */
export function wrapComposerOpeningForTicketHtml({ nucleoHtml, ticket, agentName }) {
  const clientName = ticket?.clientName
    || ticket?.client?.name
    || ticket?.lateralForm?.clienteNome
    || '';
  const modo = detectEnvelopeModoFromTicket(ticket);
  return wrapComposerOpeningHtml({
    nucleoHtml,
    clientName,
    agentName,
    modo,
  });
}
