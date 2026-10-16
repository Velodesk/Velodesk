/**
 * responsavelSegmentation v1.7.1 — buildResponsavelCandidates inclui aliasColaborador
 * VERSION: v1.7.1 | DATE: 2026-08-24
 */
import { getDeskDisplayName } from '../../utils/userDisplayName';
import { normalizeProfileId } from '../../config/profiles';
import { sanitizeResponsavel } from '../tabulationConfig';
import { getServerResponsavelCandidates } from './serverResponsavelCandidates';
import {
  readCachedPermissions,
  shouldUseMeusChamadosFila as permShouldUseMeusChamados,
  hasPermission,
  canActOnTicket,
  filterTicketForUser,
} from '../permissions/permissionService';

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function emailLocalPart(email) {
  const normalized = normalize(email);
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0] ?? '';
}

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('velodesk_user') || '{}');
  } catch {
    return {};
  }
}

function readStoredColaborador() {
  try {
    return JSON.parse(localStorage.getItem('velodesk_colaborador') || 'null');
  } catch {
    return null;
  }
}

export function readDeskProfileId() {
  try {
    return normalizeProfileId(localStorage.getItem('velodeskProfile') || 'agent');
  } catch {
    return 'agent';
  }
}

/** Papel operacional da sessão (JWT / login) — prevalece sobre perfil UI desatualizado */
export function readAuthDeskRole() {
  const user = readStoredUser();
  const role = String(user?.deskProfile || user?.role || '').trim().toLowerCase();
  if (role === 'agent' || role === 'supervisor') return role;
  return null;
}

export function isGestaoDeskProfile(profileId = readDeskProfileId()) {
  return normalizeProfileId(profileId) === 'gestao';
}

/** ver_todos: todas as categorias na sidebar (somente visualização — atuação exige override de atuar_*). */
export function shouldViewAllDeskTickets(profileId = readDeskProfileId()) {
  const perm = readCachedPermissions();
  return Boolean(perm && hasPermission(perm.permissoes, 'tickets', 'ver_todos'));
}

export function shouldUseMeusChamadosFila(profileId = readDeskProfileId()) {
  if (shouldViewAllDeskTickets(profileId)) return false;

  const normalized = normalizeProfileId(profileId);
  if (['gestao', 'workflow'].includes(normalized)) return false;

  const perm = readCachedPermissions();
  if (perm) return permShouldUseMeusChamados(perm);

  const authRole = readAuthDeskRole();
  if (authRole === 'agent') return true;
  if (authRole === 'supervisor') return false;
  return true;
}

export function buildResponsavelCandidates() {
  const user = readStoredUser();
  const colaborador = readStoredColaborador();
  const values = [];
  const push = (raw) => {
    const value = normalize(raw);
    if (value) values.push(value);
  };

  push(user.name);
  push(user.email);
  push(emailLocalPart(user.email));
  push(user.id);
  push(colaborador?.nome);
  push(colaborador?.colaboradorNome);
  push(colaborador?.email);
  push(colaborador?.aliasColaborador);
  push(getDeskDisplayName(user, colaborador));
  // Mesmos candidatos que o backend usa na contagem (alias do cadastro de colaboradores etc.).
  getServerResponsavelCandidates().forEach(push);

  return [...new Set(values.filter(Boolean))];
}

export function readTicketResponsavel(ticket) {
  return sanitizeResponsavel(ticket?.lateralForm?.responsavel || ticket?.responsibleAgent);
}

function normalizeAtribuidoColaborador(value) {
  const raw = String(value ?? '').trim().replace(/\s*\(eu\)\s*$/i, '');
  if (!raw || raw.startsWith('funcao:') || raw.startsWith('grupo:')) return '';
  return normalize(raw);
}

/** Atribuído individual (colaborador) igual ao agente logado — não funcao:/grupo:. */
export function ticketAtribuidoToCurrentAgent(ticket) {
  const atribuido = normalizeAtribuidoColaborador(ticket?.lateralForm?.atribuido);
  if (!atribuido) return false;
  const candidates = buildResponsavelCandidates();
  return candidates.includes(atribuido);
}

/**
 * Fila Novos (sidebar) — agentes veem só tickets novos atribuídos a si ou sem responsável real.
 * Gestão / ver_todos: todos os novos.
 */
export function ticketBelongsInAgentNovosQueue(ticket, profileId = readDeskProfileId()) {
  if (shouldViewAllDeskTickets(profileId)) return true;

  const perm = readCachedPermissions();
  if (perm && hasPermission(perm.permissoes, 'tickets', 'ver_todos')) return true;
  if (perm && !permShouldUseMeusChamados(perm)) return true;

  if (!shouldUseMeusChamadosFila(profileId)) {
    return ticketMatchesAgentResponsavel(ticket, profileId);
  }

  const status = normalize(ticket?.status || '');
  if (status && status !== 'novo') return false;

  const responsavel = normalize(readTicketResponsavel(ticket));
  if (!responsavel) return true;

  return buildResponsavelCandidates().includes(responsavel);
}

export function ticketMatchesAgentResponsavel(ticket, profileId = readDeskProfileId()) {
  if (shouldViewAllDeskTickets(profileId)) return true;

  const perm = readCachedPermissions();
  if (perm && hasPermission(perm.permissoes, 'tickets', 'ver_todos')) return true;
  if (perm && !permShouldUseMeusChamados(perm)) return true;

  if (!shouldUseMeusChamadosFila(profileId)) return true;

  if (ticketAssignedToCurrentAgent(ticket)) return true;
  if (ticketAtribuidoToCurrentAgent(ticket)) return true;

  const status = normalize(ticket?.status || '');
  if (!readTicketResponsavel(ticket) && status === 'novo') return true;
  return false;
}

/** Apenas tickets com responsável explícito igual ao agente logado. */
export function ticketAssignedToCurrentAgent(ticket) {
  const responsavel = normalize(readTicketResponsavel(ticket));
  if (!responsavel) return false;
  const candidates = buildResponsavelCandidates();
  return candidates.includes(responsavel);
}

/**
 * Fila virtual Meus Tickets — SOMENTE tickets do usuário logado.
 * Responsável explícito OU atribuído colaborador individual (nunca funcao:/grupo:).
 * Não herda ver_todos/gestão: perfil de gestão vê totais nas outras filas, não aqui.
 */
export function ticketBelongsInMeusTicketsList(ticket) {
  return ticketAssignedToCurrentAgent(ticket) || ticketAtribuidoToCurrentAgent(ticket);
}

/** Responsável explícito diferente do agente logado (transferência para outro agente). */
export function isResponsavelAssignedToOtherAgent(responsavel) {
  const normalized = normalize(responsavel);
  if (!normalized) return false;
  return !buildResponsavelCandidates().includes(normalized);
}

export { canActOnTicket, filterTicketForUser };
