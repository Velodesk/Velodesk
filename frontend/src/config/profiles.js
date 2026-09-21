/**
 * Perfis operacionais — Agente / Gestão / Workflow / Especiais
 * VERSION: v1.9.3 | DATE: 2026-08-21
 * — Tickets antes do Console de aprovações na barra
 */
export const ESPECIAIS_NAV_IDS = [
  'especiais-reclame-aqui',
  'especiais-procon',
  'especiais-consumidor-gov',
  'especiais-bacen',
  'especiais-processos',
  'especiais-redes-sociais',
];

const ESPECIAIS_NAV_SET = new Set(ESPECIAIS_NAV_IDS);

export function isEspeciaisNavId(id) {
  return ESPECIAIS_NAV_SET.has(id);
}

export const PROFILES = {
  agent: {
    id: 'agent',
    label: 'Agente',
    icon: 'fa-headset',
    color: '#1634FF',
    desc: 'Tickets, fila operacional e registro rápido',
    nav: ['workspace', 'tickets', 'busca-tickets', 'preferencias', 'atendimento-ia-telefonico', ...ESPECIAIS_NAV_IDS],
    defaultPage: 'workspace',
  },
  gestao: {
    id: 'gestao',
    label: 'Gestão',
    icon: 'fa-user-tie',
    color: '#000058',
    desc: 'SLA, performance da equipe e escalonamentos',
    nav: ['workspace', 'tickets', 'busca-tickets', 'preferencias', 'atendimento-ia-telefonico', 'config', ...ESPECIAIS_NAV_IDS],
    defaultPage: 'workspace',
  },
  workflow: {
    id: 'workflow',
    label: 'Workflow',
    icon: 'fa-diagram-project',
    color: '#1694FF',
    desc: 'Fluxos operacionais entre times e acompanhamento de etapas',
    nav: ['workspace', 'workflow-inbox', 'busca-tickets', 'workflow-finalizados'],
    defaultPage: 'workflow-inbox',
  },
  especiais: {
    id: 'especiais',
    label: 'Especiais',
    icon: 'fa-star',
    color: '#7C3AED',
    desc: 'Canais especiais — Reclame Aqui, Procon, Consumidor.Gov, Bacen e Processos',
    nav: [
      'workspace',
      'busca-tickets',
      ...ESPECIAIS_NAV_IDS,
    ],
    defaultPage: 'workspace',
  },
};

export const NAV_ITEMS = [
  { id: 'workspace', path: '/workspace', label: 'Painel 360°', icon: 'ti-layout-grid', tooltip: 'Painel 360°' },
  { id: 'reports', path: '/reports', label: 'Relatórios', icon: 'ti-chart-bar', tooltip: 'Relatórios' },
  { id: 'tickets', path: '/tickets', label: 'Tickets', icon: 'ti-ticket', tooltip: 'Tickets' },
  {
    id: 'busca-tickets',
    path: '/busca-tickets',
    label: 'Busca de Tickets',
    icon: 'ti-search',
    tooltip: 'Busca avançada de tickets',
  },
  { id: 'workflow-inbox', path: '/workflow', label: 'Aprovações', icon: 'ti-checkbox', tooltip: 'Console de aprovações' },
  {
    id: 'atendimento-ia-telefonico',
    path: '/atendimento-ia-telefonico',
    label: 'IA Telefônica',
    icon: 'ti-phone-call',
    tooltip: 'Atendimento IA Telefônico',
  },
  {
    id: 'workflow-finalizados',
    path: '/workflow?view=finalizados',
    label: 'Finalizados',
    icon: 'ti-checks',
    tooltip: 'Solicitações concluídas do workflow',
  },
  {
    id: 'especiais-reclame-aqui',
    path: '/especiais/reclame-aqui',
    label: 'Reclame Aqui',
    icon: 'ti-messages',
    tooltip: 'Reclame Aqui',
  },
  {
    id: 'especiais-procon',
    path: '/especiais/procon',
    label: 'Procon',
    icon: 'ti-building-community',
    tooltip: 'Procon',
  },
  {
    id: 'especiais-consumidor-gov',
    path: '/especiais/consumidor-gov',
    label: 'Consumidor.Gov',
    icon: 'ti-world',
    tooltip: 'Consumidor.Gov',
  },
  {
    id: 'especiais-bacen',
    path: '/especiais/bacen',
    label: 'Bacen',
    icon: 'ti-building-bank',
    tooltip: 'Bacen',
  },
  {
    id: 'especiais-processos',
    path: '/especiais/processos',
    label: 'Processos',
    icon: 'ti-briefcase',
    tooltip: 'Processos',
  },
  {
    id: 'especiais-redes-sociais',
    path: '/especiais/redes-sociais',
    label: 'Redes Sociais',
    icon: 'ti-device-desktop',
    tooltip: 'Redes Sociais',
  },
  {
    id: 'legado-octa',
    path: '/legado-octa',
    label: 'Legado Octa',
    icon: 'ti-archive',
    tooltip: 'Histórico Octadesk (somente consulta)',
  },
  {
    id: 'preferencias',
    path: '/preferencias',
    label: 'Preferências',
    icon: 'ti-adjustments',
    tooltip: 'Preferências do agente',
  },
  {
    id: 'tickets-resolvidos',
    path: '/tickets?desk=v2&queue=resolvidos',
    label: 'Finalizados',
    icon: 'ti-checks',
    tooltip: 'Fila de tickets finalizados (Resolvidos)',
  },
  { id: 'config', path: '/config', label: 'Configurações', icon: 'ti-settings', tooltip: 'Configurações' },
];

const LEGACY_PROFILE_MAP = {
  supervisor: 'gestao',
  management: 'gestao',
};

export function normalizeProfileId(id) {
  const raw = String(id || 'agent').trim();
  if (PROFILES[raw]) return raw;
  if (LEGACY_PROFILE_MAP[raw]) return LEGACY_PROFILE_MAP[raw];
  return 'agent';
}

export function getProfileMeta(id) {
  return PROFILES[normalizeProfileId(id)];
}

export function getProfileDefaultPath(profileId = 'agent') {
  const profile = getProfileMeta(profileId);
  const pageId = profile.defaultPage || 'workspace';
  if (pageId === 'tickets') return '/tickets?desk=v2';
  if (pageId === 'workflow-inbox') return '/workflow';
  if (pageId === 'alteracoes-cadastrais') return '/alteracoes-cadastrais';
  if (pageId === 'analytics-ia') return '/analytics-ia';
  return `/${pageId}`;
}
