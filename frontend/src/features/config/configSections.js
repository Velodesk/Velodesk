/**
 * Seções da Central de Configurações
 * VERSION: v1.5.0 | DATE: 2026-08-20
 */
export const CONFIG_SECTIONS = [
  {
    id: 'forms',
    label: 'Formulários',
    menuDesc: 'Campos e árvores de tabulação',
    cardDesc: 'Monte campos personalizados para os tickets',
    icon: 'ti-forms',
  },
  {
    id: 'workflows',
    label: 'Workflows',
    menuDesc: 'Regras e fluxos automáticos',
    cardDesc: 'Automatize etapas do atendimento',
    icon: 'ti-hierarchy-2',
  },
  {
    id: 'funcoes-permissoes',
    label: 'Funções e Permissões',
    menuDesc: 'RBAC, funções Desk e agentes VeloHub',
    cardDesc: 'Overrides por função e lista de agentes',
    icon: 'ti-shield-lock',
  },
  {
    id: 'macros',
    label: 'Macros',
    menuDesc: 'Respostas rápidas do compose',
    cardDesc: 'Crie e edite as macros do botão Macros no ticket',
    icon: 'ti-message-2-bolt',
  },
  {
    id: 'email',
    label: 'E-mail',
    menuDesc: 'Remetentes, e-mails de saída e assinatura',
    cardDesc: 'Controle de inbound, textos de saída e assinatura',
    icon: 'ti-mail',
  },
  {
    id: 'agentes-ia',
    label: 'Agentes de IA',
    menuDesc: 'Agente autônomo e escopo de resposta',
    cardDesc: 'Defina onde a IA responde sozinha',
    icon: 'ti-robot',
  },
  {
    id: 'automations',
    label: 'Automações',
    menuDesc: 'Rotinas e ações automáticas',
    cardDesc: 'Regras que executam sozinhas',
    icon: 'ti-bolt',
  },
  {
    id: 'triggers',
    label: 'Gatilhos',
    menuDesc: 'Condições que disparam ações',
    cardDesc: 'Configure eventos e condições de disparo',
    icon: 'ti-target',
  },
  {
    id: 'api',
    label: 'API Externa',
    cardTitle: 'API',
    menuDesc: 'Chaves e endpoints',
    cardDesc: 'Conecte sistemas externos',
    icon: 'ti-plug',
  },
  {
    id: 'backup',
    label: 'Backup / Restore',
    cardTitle: 'Backup',
    menuDesc: 'Exportar e restaurar dados',
    cardDesc: 'Proteja e restaure seus dados',
    icon: 'ti-database',
  },
];

export function getConfigSection(id) {
  return CONFIG_SECTIONS.find((s) => s.id === id) || null;
}
