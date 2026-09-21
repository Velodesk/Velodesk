/**
 * funcaoPermissaoDefaults v1.4.0 — catálogo RBAC only; sem seeds de permissão
 * VERSION: v1.4.0 | DATE: 2026-08-21
 *
 * Permissões efetivas vêm SOMENTE dos overrides por função persistidos no Mongo
 * (Config → Funções). Este arquivo define apenas o catálogo de chaves e utilitários.
 */

export type PermissoesMap = Record<string, Record<string, boolean>>;

export interface FuncaoPermissaoSeed {
  slug: string;
  nome: string;
  nivel: number;
  herdaDe: string[];
  portalVisivel: string[];
  permissoes: PermissoesMap;
  canalOrigem?: string;
}

/** Módulos de Acesso — ids de NAV_ITEMS (frontend/src/config/profiles.js). */
export const ACESSO_MODULO_IDS: string[] = [
  'workspace',
  'tickets',
  'busca-tickets',
  'atendimento-ia-telefonico',
  'realtime',
  'workflow-inbox',
  'config',
  'especiais-reclame-aqui',
  'especiais-procon',
  'especiais-consumidor-gov',
  'especiais-bacen',
  'especiais-processos',
  'especiais-redes-sociais',
  'reports',
  'tickets-resolvidos',
  'legado-octa',
];

export const PERMISSION_CATALOG: Record<string, string[]> = {
  portal: ['agente', 'gestao', 'workflow', 'especiais'],
  tickets: [
    'ver_todos',
    'ver_meus',
    'atuar_responsavel',
    'atuar_atribuido',
    'atuar_sempre',
    'atuar_canal_especial',
  ],
  workspace: ['painel_360_proprio', 'painel_360_equipe'],
  workflow: ['avancar', 'aprovar', 'rejeitar', 'interromper'],
  preferencias: ['visualizar'],
  config: [
    'visualizar',
    'formularios_criar',
    'formularios_editar',
    'formularios_excluir',
    'automacoes_criar',
    'automacoes_editar',
    'automacoes_excluir',
    'workflows_editar',
  ],
  especiais: [
    'reclame_aqui_gerenciar',
    'bacen_gerenciar',
    'procon_gerenciar',
    'consumidor_gov_gerenciar',
  ],
  acesso: ACESSO_MODULO_IDS,
};

export const CANAL_ORIGEM_BY_FUNCAO: Record<string, string[]> = {
  'reclame-aqui': ['reclame aqui', 'reclame-aqui'],
  bacen: ['bacen', 'banco central'],
  procon: ['procon'],
  'consumidor-gov': ['consumidor.gov', 'consumidor .gov', 'consumidor-gov', 'consumidor gov'],
};

/** Chaves permissoes.portal → id do perfil operacional */
export const PORTAL_PERM_TO_PORTAL_ID: Record<string, string> = {
  agente: 'agent',
  gestao: 'gestao',
  workflow: 'workflow',
  especiais: 'especiais',
};

/** Deriva portalVisivel a partir das permissões efetivas de portal */
export function derivePortalVisivelFromPermissoes(
  permissoes: PermissoesMap,
  fallback: string[] = ['agent'],
): string[] {
  const portalPerms = permissoes?.portal;
  if (!portalPerms || typeof portalPerms !== 'object') return fallback;

  const hasExplicitPortal = Object.keys(PORTAL_PERM_TO_PORTAL_ID).some(
    (key) => typeof portalPerms[key] === 'boolean',
  );
  if (!hasExplicitPortal) return fallback;

  const derived = Object.entries(PORTAL_PERM_TO_PORTAL_ID)
    .filter(([key]) => portalPerms[key] === true)
    .map(([, id]) => id);

  return derived.length ? derived : fallback;
}

/** Mapeia slug de grupo legado → slug de função */
export const GRUPO_TO_FUNCAO_MAP: Record<string, string> = {
  n1: 'atendimento',
  n2: 'n2',
  financeiro: 'financeiro',
  produtos: 'produtos',
  suporte: 'suporte',
};
