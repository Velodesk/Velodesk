/**
 * agentRegistry v1.2.0 — Agente 5 (extração casos especiais) inserido; relacionados vira 6
 * VERSION: v1.2.0 | DATE: 2026-09-15
 */

export type AgentNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type AgentCodigo =
  | 'agente_atendimento'
  | 'agente_auditoria'
  | 'agente_gestao'
  | 'agente_casos_especiais'
  | 'agente_casos_especiais_extracao'
  | 'agente_casos_especiais_relacionados';

export interface AgentRegistryEntry {
  numero: AgentNumber;
  codigo: AgentCodigo;
  nomeOficial: string;
  serviceFile: string;
}

export const AGENT_REGISTRY: Record<AgentNumber, AgentRegistryEntry> = {
  1: {
    numero: 1,
    codigo: 'agente_atendimento',
    nomeOficial: 'Agente de Resposta',
    serviceFile: 'atendimentoAgent.service.ts',
  },
  2: {
    numero: 2,
    codigo: 'agente_auditoria',
    nomeOficial: 'Agente Auditor',
    serviceFile: 'auditoriaAgent.service.ts',
  },
  3: {
    numero: 3,
    codigo: 'agente_gestao',
    nomeOficial: 'Agente Gestor de Tickets',
    serviceFile: 'gestaoChamadosAgent.service.ts',
  },
  4: {
    numero: 4,
    codigo: 'agente_casos_especiais',
    nomeOficial: 'Agente de Casos especiais',
    serviceFile: 'casosEspeciaisAgent.service.ts',
  },
  5: {
    numero: 5,
    codigo: 'agente_casos_especiais_extracao',
    nomeOficial: 'Agente de Casos Especiais — Extração de Campos',
    serviceFile: 'casosEspeciaisExtracao.service.ts',
  },
  6: {
    numero: 6,
    codigo: 'agente_casos_especiais_relacionados',
    nomeOficial: 'Agente de Casos Especiais — Tickets Relacionados',
    serviceFile: 'casosEspeciaisRelacionadosAgent.service.ts',
  },
};

export function getAgentNomeOficial(numero: AgentNumber): string {
  return AGENT_REGISTRY[numero].nomeOficial;
}

export function getAgentLabel(numero: AgentNumber): string {
  const entry = AGENT_REGISTRY[numero];
  return `Agente ${entry.numero} — ${entry.nomeOficial}`;
}

export function getAgentShortLabel(numero: AgentNumber): string {
  return `Agente ${numero}`;
}
