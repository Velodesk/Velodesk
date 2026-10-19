/**
 * agenteAutonomo v1.0.0 — identidade fixa do agente autônomo de IA (sem conta de usuário)
 * VERSION: v1.0.0 | DATE: 2026-10-14
 */

/** Responsável gravado em tabulacao[].responsavel dos chamados tratados pelo agente autônomo. */
export const AGENTE_AUTONOMO_RESPONSAVEL = 'Agente Autônomo';

/** Nome com que o agente autônomo se apresenta ao cliente no envelope da mensagem. */
export const AGENTE_AUTONOMO_ENVELOPE_NOME = 'CláudIA';

/** Origens de POST /api/inbound/tickets que podem ser atendidas pelo agente autônomo (cada uma tem um switch na config). */
export const CANAIS_AUTONOMOS = ['app', 'chat', 'agente-ia'] as const;
export type CanalAutonomo = (typeof CANAIS_AUTONOMOS)[number];
