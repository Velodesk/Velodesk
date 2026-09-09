/**
 * casosEspeciaisRelacionados.types v1.0.0 — Agente 5, correlação de tickets relacionados
 * VERSION: v1.0.0 | DATE: 2026-09-09
 */
/**
 * Duplicado (não importado) de propósito: RA usa ReclamacaoReclameAqui.schema.ts e os demais
 * órgãos usam ReclamacaoBase.schema.ts — cada um declara sua própria cópia deste status, e este
 * arquivo (camada do agente, agnóstica de qual schema está por trás) não deve depender de nenhum
 * dos dois em específico.
 */
export type ReclamacaoAnaliseRelacionadosStatus =
  | 'pendente'
  | 'concluida'
  | 'sem_candidatos'
  | 'erro'
  | 'desativado';

export type CasoRelacionadoCriterio =
  | 'mesmo_motivo_categoria'
  | 'mesmo_contrato_operacao'
  | 'recorrencia_nao_resolvida'
  | 'similaridade_semantica';

/**
 * Ticket do histórico do CPF já normalizado no contrato do prompt, pronto para o LLM.
 * id_ticket é o chamadoProtocolo (não o ObjectId) — protocolos são curtos e o LLM os reproduz
 * de forma confiável em prosa; ObjectIds de 24 chars são citados errado com frequência.
 */
export interface CasoRelacionadoTicketBlock {
  id_ticket: string;
  origem: string;
  data_reclamacao: string;
  categoria_ra: string | null;
  problema_ra: string | null;
  produto_ra: string | null;
  titulo: string;
  texto_reclamacao: string;
  resposta_empresa: string | null;
  status: string;
}

/** Candidato do histórico após o pré-filtro mecânico — carrega o bloco do prompt + metadados internos. */
export interface CasoRelacionadoCandidato {
  block: CasoRelacionadoTicketBlock;
  chamadoId: string;
  chamadoProtocolo: string;
  mechScore: number;
  mechSignals: string[];
}

export interface CasoRelacionadoLlmItem {
  id_ticket: string;
  score_similaridade: number;
  criterios: CasoRelacionadoCriterio[];
  motivo: string;
}

export interface CasoRelacionadoLlmResult {
  id_ticket_atual: string;
  tickets_relacionados: CasoRelacionadoLlmItem[];
  resumo_executivo: string;
}

export interface AnaliseRelacionadosTicketPersisted {
  chamadoId: string;
  chamadoProtocolo: string;
  scoreSimilaridade: number;
  criterios: CasoRelacionadoCriterio[];
  motivo: string;
}

export interface AnaliseRelacionadosPersisted {
  status: ReclamacaoAnaliseRelacionadosStatus;
  tickets: AnaliseRelacionadosTicketPersisted[];
  resumoExecutivo: string;
  geradoEm: Date;
  agenteVersao: string;
  notaInternaCriada: boolean;
}
