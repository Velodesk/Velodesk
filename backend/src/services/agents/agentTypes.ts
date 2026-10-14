/**
 * agentTypes v1.1.2 — AuditoriaInput não carrega mais confidence do Agente de Atendimento
 * VERSION: v1.1.2 | DATE: 2026-08-31
 */

export type TicketAiContextSource = 'public' | 'internal';

export type AuditModo = 'auto_envio' | 'desk_sugestao' | 'pos_humano';

export type AuditDecisao =
  | 'revisar_agente1'
  | 'aprovar_auto'
  | 'bloquear_critico'
  | 'encaminhar_humano'
  | 'exibir_sugestao';

export type NivelCriticidade = 'critica' | 'alta' | 'media' | 'baixa' | 'nenhuma';

export type ConfidenceLevel = 'alta' | 'media' | 'baixa';

export type PipelineModo = 'desk' | 'auto_envio' | 'inbound';

export type RevisaoOrigem = 'automatica_baixo_compliance' | 'solicitada_operador' | 'reprovada_humano';

export interface TicketAiMessageInput {
  role: 'cliente' | 'agente';
  text: string;
}

export interface TicketAiTabulationResult {
  tipo: string;
  produto: string;
  motivo: string;
  detalhe: string;
  incompleta?: boolean;
}

export interface AtendimentoInput {
  ticketId?: string;
  protocolo?: string;
  titulo?: string;
  canal?: string;
  status?: string;
  clientName?: string;
  nomeOperador?: string;
  contextSource: TicketAiContextSource;
  messages?: TicketAiMessageInput[];
  internalNote?: string;
  produtoHint?: string;
  /** Dados reais da conta do cliente (já filtrados) para personalizar a resposta. */
  dadosConta?: string;
  /** Id do colaborador (req.user.userId) que acionou o agente — usado no relatório de custo de IA por colaborador. */
  userId?: string;
}

export interface AtendimentoResult {
  success: boolean;
  respostaSugerida?: string;
  tabulacao?: TicketAiTabulationResult;
  tabulacaoDisplay?: string;
  confidence?: ConfidenceLevel;
  fontesConsultadas?: string[];
  model?: string;
  error?: string;
}

export interface RevisaoInput extends AtendimentoInput {
  respostaAnterior: string;
  tabulacaoAnterior: TicketAiTabulationResult;
  violacoes?: string[];
  recomendacoes?: string[];
  origemRevisao: RevisaoOrigem;
  inputOperador?: string;
  auditScore?: number;
}

/** Um booleano fixo por critério — sem texto livre, pra não gastar tokens de geração à toa. */
export interface CriteriosAvaliados {
  aderenciaReal: boolean;
  procedimento: boolean;
  veracidade: boolean;
  produtos: boolean;
  tomNaturalidade: boolean;
  estruturaNucleo: boolean;
  vazamento: boolean;
  escalonamento: boolean;
  riscoCritico: boolean;
  tabulacao: boolean;
}

export interface AuditoriaInput {
  modo: AuditModo;
  protocolo?: string;
  canal?: string;
  status?: string;
  nomeOperador?: string;
  dataEnvio?: string;
  contextSource?: TicketAiContextSource;
  messages?: TicketAiMessageInput[];
  internalNote?: string;
  respostaSugerida: string;
  tabulacao: TicketAiTabulationResult;
  mensagemOperador?: string;
  ultimaMensagemCliente?: string;
  palavrasCriticasPrecheck?: string[];
  /** Mesmos dados da conta que o Agente de Resposta recebeu, para conferir a resposta contra a realidade. */
  dadosConta?: string;
  /** Id do colaborador (req.user.userId) que acionou o agente — usado no relatório de custo de IA por colaborador. */
  userId?: string;
}

export type TabulacaoFonte = 'auditoria' | 'atendimento';

export interface AuditoriaResult {
  success: boolean;
  aprovado?: boolean;
  score?: number;
  modo?: AuditModo;
  decisao?: AuditDecisao;
  nivelCriticidade?: NivelCriticidade;
  impactoGravidade?: 'alto' | 'medio' | 'baixo';
  categoriaAtendimento?: string;
  palavrasCriticasDetectadas?: string[];
  requerRevisaoAgente1?: boolean;
  notificarAgente3?: boolean;
  violacoes?: string[];
  recomendacoes?: string[];
  criteriosAvaliados?: CriteriosAvaliados;
  tabulacaoSugerida?: TicketAiTabulationResult;
  tabulacaoDisplay?: string;
  model?: string;
  error?: string;
}

export type PipelineStage = 'gerando' | 'auditando' | 'revisando';

export interface PipelineInput extends AtendimentoInput {
  pipelineModo: PipelineModo;
  /** Callback opcional (não serializado) para reportar progresso ao chamador — usado pelo endpoint SSE. */
  onStage?: (stage: PipelineStage) => void;
}

export interface PipelineResult {
  success: boolean;
  respostaSugerida?: string;
  tabulacao?: TicketAiTabulationResult;
  tabulacaoDisplay?: string;
  tabulacaoFonte?: TabulacaoFonte;
  confidence?: ConfidenceLevel;
  auditScore?: number;
  auditAprovado?: boolean;
  auditDecisao?: AuditDecisao;
  auditComplete?: boolean;
  nivelCriticidade?: NivelCriticidade;
  envioAutonomo?: boolean;
  /** Resultado da consulta de dados da conta usada na resposta (quando habilitada). */
  hidratacao?: { slug: string; status: 'ok' | 'sem_dados' | 'indisponivel' };
  /** Resposta gravada na fila de aprovação humana (não enviada ao cliente). */
  aguardandoAprovacao?: boolean;
  revisoesRealizadas?: number;
  model?: string;
  error?: string;
  source?: string;
}

export interface GestaoHandoffInput {
  ticketId: string;
  protocolo: string;
  nivelCriticidade: NivelCriticidade;
  palavrasCriticas?: string[];
  categoriaAtendimento?: string;
  origem?: string;
  auditScore?: number;
  produto?: string;
  motivo?: string;
}

export interface GestaoHandoffResult {
  success: boolean;
  responsavelAtribuido?: string;
  statusAtualizado?: string;
  notificacoesEnviadas?: string[];
  alertId?: string;
  error?: string;
}
