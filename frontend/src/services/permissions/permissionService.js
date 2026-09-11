/**
 * permissionService v1.11.1 — buildResponsavelCandidatesFromSession inclui aliasColaborador
 * VERSION: v1.11.1 | DATE: 2026-08-24
 */
import api from '../../api/client';
import { normalizeProfileId } from '../../config/profiles';
import { isWorkflowTeamQueueId } from '../workflow/workflowTeamQueues';
import { sanitizeResponsavel, isRealResponsavel } from '../tabulationConfig';
import { normalizeFuncao } from '../desk/atuacaoVision';

const STORAGE_KEY = 'velodesk_permissions';

export const CANAL_ORIGEM_BY_FUNCAO = {
  'reclame-aqui': ['reclame aqui', 'reclame-aqui'],
  bacen: ['bacen', 'banco central'],
  procon: ['procon'],
  'consumidor-gov': ['consumidor.gov', 'consumidor .gov', 'consumidor-gov', 'consumidor gov'],
};

let cachedPermissions = null;

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function readCachedPermissions() {
  if (cachedPermissions) return cachedPermissions;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cachedPermissions = raw ? JSON.parse(raw) : null;
  } catch {
    cachedPermissions = null;
  }
  return cachedPermissions;
}

export function writeCachedPermissions(payload) {
  cachedPermissions = payload;
  if (payload) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  try {
    window.dispatchEvent(new CustomEvent('velodesk:permissions'));
  } catch {
    /* SSR / test */
  }
}

export function clearCachedPermissions() {
  cachedPermissions = null;
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchMyPermissions() {
  const { data } = await api.get('/permissions/me');
  writeCachedPermissions(data);
  return data;
}

export function hasPermission(permissoes, modulo, key) {
  return permissoes?.[modulo]?.[key] === true;
}

export function can(modulo, key, permissoes = readCachedPermissions()?.permissoes) {
  return hasPermission(permissoes, modulo, key);
}

const ALL_PROFILE_PORTALS = ['agent', 'gestao', 'workflow', 'especiais'];

/** Portal Workflow sem Agente/Gestão — definido pelos overrides `portal.*`. */
export function isWorkflowOnlyPermissions(perm = readCachedPermissions()) {
  if (!perm) return false;
  const portal = perm.permissoes?.portal || {};
  return portal.workflow === true && portal.agente !== true && portal.gestao !== true;
}

/** Capacidade de atuar no Workflow (portal ou decisões explícitas). */
export function hasWorkflowActingCapability(perm = readCachedPermissions()) {
  const p = perm?.permissoes;
  return (
    hasPermission(p, 'portal', 'workflow')
    || hasPermission(p, 'workflow', 'aprovar')
    || hasPermission(p, 'workflow', 'avancar')
    || hasPermission(p, 'workflow', 'rejeitar')
  );
}

/** Portais exibidos no seletor de perfil — mescla API, cache, flags portal.* e função gestão. */
export function getAllowedProfilePortals(perm = readCachedPermissions()) {
  if (isWorkflowOnlyPermissions(perm)) {
    return ['workflow'];
  }

  const cached = readCachedPermissions();
  const sources = [perm, cached].filter(Boolean);

  const merged = [
    ...new Set(
      sources.flatMap((source) => [
        ...resolvePortalVisivel(source),
        ...(Array.isArray(source?.portalVisivel) ? source.portalVisivel : []),
      ]),
    ),
  ].filter((id) => ALL_PROFILE_PORTALS.includes(id));

  const hasGestaoPortal = merged.includes('gestao');

  const hasFullPortalFlags = sources.some((source) => {
    const portal = source?.permissoes?.portal || {};
    return portal.gestao === true && portal.workflow === true && portal.especiais === true;
  });

  if (hasGestaoPortal || hasFullPortalFlags) {
    return [...ALL_PROFILE_PORTALS];
  }

  if (merged.length) return merged;
  if (perm?.portalVisivel?.includes('workflow') || perm?.permissoes?.portal?.workflow === true) {
    return ['workflow'];
  }
  return ['agent'];
}

/** Portal padrão quando o usuário não escolheu perfil manualmente. */
export function resolvePreferredProfilePortal(allowed = []) {
  const list = allowed.filter((id) => ALL_PROFILE_PORTALS.includes(id));
  if (list.includes('gestao')) return 'gestao';
  if (list.includes('especiais')) return 'especiais';
  if (list.includes('workflow')) return 'workflow';
  return 'agent';
}

/** Ajusta profileId quando o portal salvo não é permitido pelas permissões atuais. */
export function resolveProfilePortalForPermissions(perm, currentProfileId = 'agent') {
  if (!perm) return normalizeProfileId(currentProfileId);
  const allowed = getAllowedProfilePortals(perm);
  const preferred = resolvePreferredProfilePortal(allowed);
  const current = normalizeProfileId(currentProfileId);

  if (isWorkflowOnlyPermissions(perm) && allowed.includes('workflow')) {
    return 'workflow';
  }
  if (!allowed.includes(current)) return preferred;
  if (current === 'agent' && !allowed.includes('agent')) return preferred;
  if (current === 'agent' && allowed.includes('workflow') && !allowed.includes('agent')) {
    return 'workflow';
  }
  return current;
}

export function getPortalVisivel(perm = readCachedPermissions()) {
  return getAllowedProfilePortals(perm);
}

const PORTAL_KEY_TO_PROFILE = {
  agente: 'agent',
  gestao: 'gestao',
  workflow: 'workflow',
  especiais: 'especiais',
};

/** Deriva portalVisivel[] a partir de permissoes.portal.* (editor de funções). */
export function derivePortalVisivelFromPermissoes(permissoes, fallback = ['agent']) {
  const portalPerms = permissoes?.portal;
  if (!portalPerms || typeof portalPerms !== 'object') return fallback;

  const hasExplicitPortal = Object.keys(PORTAL_KEY_TO_PROFILE).some(
    (key) => typeof portalPerms[key] === 'boolean',
  );
  if (!hasExplicitPortal) return fallback;

  const derived = Object.entries(PORTAL_KEY_TO_PROFILE)
    .filter(([key]) => portalPerms[key] === true)
    .map(([, id]) => id);

  return derived.length ? derived : fallback;
}

/** Unifica portalVisivel[] com flags permissoes.portal.* */
export function resolvePortalVisivel(perm = readCachedPermissions()) {
  const fromList = Array.isArray(perm?.portalVisivel) ? perm.portalVisivel : [];
  const fromFlags = Object.entries(perm?.permissoes?.portal || {})
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => PORTAL_KEY_TO_PROFILE[key] || key)
    .filter(Boolean);
  const merged = [...new Set([...fromList, ...fromFlags])];
  return merged.length ? merged : ['agent'];
}

export function isPortalAllowed(portalId, perm = readCachedPermissions()) {
  const allowed = getAllowedProfilePortals(perm);
  const legacyMap = { agent: 'agent', gestao: 'gestao', workflow: 'workflow', especiais: 'especiais' };
  const normalized = legacyMap[portalId] || portalId;
  return allowed.includes(normalized);
}

export function hasWorkflowPortalAccess(perm = readCachedPermissions()) {
  // Módulos de Acesso (permissoes.acesso.*) é a fonte de verdade de quem entra em cada
  // módulo — é o mesmo override que decide se o ícone aparece na barra lateral. Se o
  // módulo está liberado ali, o usuário tem que conseguir abrir a tela, não só ver o ícone.
  if (can('acesso', 'workflow-inbox', perm?.permissoes) || can('acesso', 'workflow-finalizados', perm?.permissoes)) {
    return true;
  }
  return isPortalAllowed('workflow', perm) || can('portal', 'workflow', perm?.permissoes);
}

export function shouldUseMeusChamadosFila(perm = readCachedPermissions()) {
  if (!perm) return true;
  if (hasPermission(perm.permissoes, 'tickets', 'ver_todos')) return false;
  if (
    hasPermission(perm.permissoes, 'tickets', 'atuar_atribuido')
    && hasPermission(perm.permissoes, 'portal', 'workflow')
  ) {
    return false;
  }
  return hasPermission(perm.permissoes, 'tickets', 'ver_meus');
}

function normalizeAtribuido(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('grupo:')) {
    const map = { n1: 'atendimento', n2: 'n2', financeiro: 'financeiro', produtos: 'produtos', suporte: 'suporte' };
    const slug = raw.slice(6).toLowerCase();
    return `funcao:${map[slug] || slug}`;
  }
  return raw;
}

function buildResponsavelCandidatesFromSession() {
  try {
    const user = JSON.parse(localStorage.getItem('velodesk_user') || '{}');
    const colaborador = JSON.parse(localStorage.getItem('velodesk_colaborador') || 'null');
    const values = [];
    const push = (v) => {
      const n = normalizeText(v);
      if (n) values.push(n);
    };
    push(user.name);
    push(user.email);
    push(colaborador?.colaboradorNome);
    push(colaborador?.nome);
    push(colaborador?.email);
    push(colaborador?.aliasColaborador);
    return [...new Set(values)];
  } catch {
    return [];
  }
}

function ticketCanalMatches(ticket, funcaoSlug) {
  const lf = ticket?.lateralForm || {};
  const text = [
    lf.tipoChamado,
    lf.classificacaoTipo,
    lf.canal,
    lf.produto,
    lf.motivo,
    ticket?.channel,
    ticket?.source,
  ].map(normalizeText).join(' ');
  const patterns = CANAL_ORIGEM_BY_FUNCAO[funcaoSlug] || [funcaoSlug];
  return patterns.some((p) => text.includes(normalizeText(p)));
}

function userFuncaoSlugs(perm) {
  return [
    ...new Set(
      [perm?.funcaoSlug, ...(perm?.funcoes || [])]
        .map((s) => normalizeFuncao(String(s || '').trim()))
        .filter(Boolean),
    ),
  ];
}

function matchesAtribuidoAnyUserFuncao(ticket, perm) {
  const atribuido = normalizeAtribuido(ticket?.lateralForm?.atribuido);
  if (!atribuido.startsWith('funcao:')) return false;
  const slug = normalizeFuncao(atribuido.slice(7));
  return userFuncaoSlugs(perm).includes(slug);
}

function matchesWorkflowDefinitionTeam(ticket, perm) {
  const lf = ticket?.lateralForm || {};
  const wf = lf.workflow || {};
  const slug = String(wf.definicaoSlug || wf.templateId || '')
    .trim()
    .toLowerCase();
  if (!slug) return false;
  const team = slug.startsWith('escalonar-') ? slug.slice('escalonar-'.length) : slug;
  return userFuncaoSlugs(perm).includes(team);
}

function matchesAtribuidoColaborador(ticket, perm) {
  const raw = normalizeAtribuido(ticket?.lateralForm?.atribuido);
  if (!raw || raw.startsWith('funcao:') || raw.startsWith('grupo:')) return false;
  const candidates = buildResponsavelCandidatesFromSession();
  return candidates.includes(raw);
}

function ticketSemResponsavelReal(ticket) {
  const responsavel = sanitizeResponsavel(ticket?.lateralForm?.responsavel || ticket?.responsibleAgent);
  return !isRealResponsavel(responsavel);
}

function matchesMeusTicketsView(ticket, perm) {
  const candidates = buildResponsavelCandidatesFromSession();
  const responsavel = sanitizeResponsavel(ticket?.lateralForm?.responsavel || ticket?.responsibleAgent);
  if (responsavel && candidates.includes(normalizeText(responsavel))) return true;
  if (matchesAtribuidoColaborador(ticket, perm)) return true;
  if (matchesAtribuidoAnyUserFuncao(ticket, perm)) return true;
  return false;
}

function matchesWorkflowScope(ticket, perm) {
  return matchesAtribuidoAnyUserFuncao(ticket, perm)
    || matchesAtribuidoColaborador(ticket, perm)
    || matchesWorkflowDefinitionTeam(ticket, perm);
}

export function canActOnTicket(ticket, perm = readCachedPermissions()) {
  if (!perm) return false;
  const { permissoes, funcoes = [] } = perm;

  if (hasPermission(permissoes, 'tickets', 'atuar_sempre')) {
    return true;
  }

  for (const cf of funcoes) {
    if (CANAL_ORIGEM_BY_FUNCAO[cf] && hasPermission(permissoes, 'tickets', 'atuar_canal_especial')) {
      if (ticketCanalMatches(ticket, cf)) return true;
    }
  }

  const candidates = buildResponsavelCandidatesFromSession();
  const responsavel = sanitizeResponsavel(ticket?.lateralForm?.responsavel || ticket?.responsibleAgent);

  if (hasPermission(permissoes, 'tickets', 'atuar_responsavel')) {
    if (responsavel && candidates.some((c) => c === normalizeText(responsavel))) return true;
    if (ticketSemResponsavelReal(ticket) && normalizeText(ticket?.status || '') === 'novo') {
      return true;
    }
  }

  if (
    hasPermission(permissoes, 'tickets', 'atuar_atribuido')
    && matchesWorkflowScope(ticket, perm)
  ) {
    return true;
  }

  return false;
}

/** Mensagem pública, status e tabulação — override Tickets > Atuar como responsável. */
export function canSendPublicMessageOnTicket(ticket, perm = readCachedPermissions()) {
  return canActOnTicket(ticket, perm);
}

/** Comentário interno — responsável/atribuído ou quem enxerga o ticket. */
export function canSendInternalNoteOnTicket(ticket, perm = readCachedPermissions()) {
  if (canSendPublicMessageOnTicket(ticket, perm)) return true;
  return filterTicketForUser(ticket, perm);
}

function ticketWorkflowActive(ticket) {
  const wf = ticket?.workflow || ticket?.lateralForm?.workflow;
  if (wf?.workflowStatus === 'finished' || wf?.workflowStatus === 'cancel') return false;
  return Boolean(wf?.active);
}

export function canApproveWorkflow(perm = readCachedPermissions()) {
  return can('workflow', 'aprovar', perm?.permissoes);
}

const INTERRUPT_WORKFLOW_FUNCOES = ['suporte', 'gestao', 'suporte-supervisao', 'direcao'];

/** Interromper workflow — suporte, supervisão e gestão. */
export function canInterruptWorkflow(perm = readCachedPermissions()) {
  if (!perm) return false;
  if (can('workflow', 'interromper', perm.permissoes)) return true;
  if (hasPermission(perm.permissoes, 'portal', 'gestao')) return true;
  return userFuncaoSlugs(perm).some((slug) => INTERRUPT_WORKFLOW_FUNCOES.includes(slug));
}

export function agentCanDecideTicket(ticket, perm = readCachedPermissions()) {
  if (!can('workflow', 'avancar', perm?.permissoes)) return false;

  const atribuido = normalizeAtribuido(ticket?.lateralForm?.atribuido);
  if (!atribuido) {
    if (ticketWorkflowActive(ticket)) {
      return ticketMatchesAgentResponsavel(ticket, perm)
        && hasPermission(perm?.permissoes, 'tickets', 'atuar_responsavel');
    }
    return canActOnTicket(ticket, perm);
  }

  if (atribuido.startsWith('funcao:')) {
    const slug = normalizeFuncao(atribuido.slice(7));
    return userFuncaoSlugs(perm).includes(slug)
      && hasPermission(perm?.permissoes, 'tickets', 'atuar_atribuido');
  }

  if (atribuido.startsWith('grupo:')) {
    return false;
  }

  return ticketAtribuidoMatchesSession(ticket, perm);
}

export function canAdvanceWorkflowStep(ticket, perm = readCachedPermissions()) {
  return agentCanDecideTicket(ticket, perm);
}

function ticketAtribuidoMatchesSession(ticket, perm) {
  const raw = String(ticket?.lateralForm?.atribuido ?? '').trim();
  if (!raw || raw.startsWith('funcao:') || raw.startsWith('grupo:')) return false;
  const atribuido = normalizeText(raw);
  const candidates = buildResponsavelCandidatesFromSession();
  return candidates.includes(atribuido);
}

export function ticketMatchesAgentResponsavel(ticket, perm = readCachedPermissions()) {
  if (!shouldUseMeusChamadosFila(perm)) return true;

  if (ticketAtribuidoMatchesSession(ticket, perm)) return true;

  const responsavel = normalizeText(ticket?.lateralForm?.responsavel || ticket?.responsibleAgent);
  const status = normalizeText(ticket?.status || '');

  if (!responsavel && status === 'novo') return true;
  if (!responsavel) return false;

  const candidates = buildResponsavelCandidatesFromSession();
  return candidates.includes(responsavel);
}

export function filterTicketForUser(ticket, perm = readCachedPermissions()) {
  if (hasPermission(perm?.permissoes, 'tickets', 'ver_todos')) return true;
  if (
    hasPermission(perm?.permissoes, 'tickets', 'ver_meus')
    && matchesMeusTicketsView(ticket, perm)
  ) {
    return true;
  }
  return canActOnTicket(ticket, perm);
}

/**
 * Fila de time do usuário no Workflow = função efetiva com atuar_atribuido + portal.workflow.
 * Gestão (ver_todos + aprovar) usa console consolidado (retorna null).
 */
export function resolveWorkflowTeamQueueForUser(perm = readCachedPermissions()) {
  if (!perm) return null;
  if (
    hasPermission(perm.permissoes, 'tickets', 'atuar_sempre')
    && canApproveWorkflow(perm)
  ) {
    return null;
  }
  if (!hasPermission(perm.permissoes, 'portal', 'workflow')) return null;
  if (!hasPermission(perm.permissoes, 'tickets', 'atuar_atribuido')) return null;
  const slugs = userFuncaoSlugs(perm);
  return slugs.find((slug) => isWorkflowTeamQueueId(slug)) || null;
}

/** Console consolidado de aprovação — atuar_sempre + aprovar ou fila de time. */
export function canAccessWorkflowApprovalConsole(perm = readCachedPermissions()) {
  if (resolveWorkflowTeamQueueForUser(perm)) return true;
  return canApproveWorkflow(perm) && hasPermission(perm?.permissoes, 'tickets', 'atuar_sempre');
}
