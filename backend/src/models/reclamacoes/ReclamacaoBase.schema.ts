/**
 * ReclamacaoBase.schema v1.5.0 — ganha registro[]/tabulacao[] (mesmo schema compartilhado do
 * ChamadoN1) pra Fase 3 da separação de persistência: a coleção do órgão passa a poder guardar
 * o histórico de conversa completo, não só a projeção de triagem. Aditivo — nenhum código ainda
 * escreve nesses campos; será ligado por módulo (Reclame Aqui primeiro) em mudança separada.
 */
import { Schema, Document, Types } from 'mongoose';
import type { CasoEspecialOrgao } from '../../services/agents/casosEspeciais.types';
import { RegistroSchema, TabulacaoSchema, type IRegistro, type ITabulacao } from '../shared/registro.schema';

export interface IReclamacaoClienteRef {
  clienteCpf: string;
  clienteId: Types.ObjectId | null;
}

const ReclamacaoClienteRefSchema = new Schema<IReclamacaoClienteRef>(
  {
    clienteCpf: { type: String, default: '' },
    clienteId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

export interface IReclamacaoTriagem {
  classificacao: string;
  orgao: string;
  confianca: string;
  evidencia: string;
  justificativa: string;
  signals: string[];
  at: Date;
  agenteVersao: string;
}

export interface IReclamacaoTicketRelacionado {
  chamadoId: string;
  chamadoProtocolo: string;
  scoreSimilaridade: number;
  criterios: string[];
  motivo: string;
}

export type ReclamacaoAnaliseRelacionadosStatus =
  | 'pendente'
  | 'concluida'
  | 'sem_candidatos'
  | 'erro'
  | 'desativado';

export interface IReclamacaoAnaliseRelacionados {
  status: ReclamacaoAnaliseRelacionadosStatus;
  tickets: IReclamacaoTicketRelacionado[];
  resumoExecutivo: string;
  geradoEm: Date;
  agenteVersao: string;
  notaInternaCriada: boolean;
}

export interface IReclamacaoWorkflowRequisicao {
  preenchidaEm?: Date;
  preenchidaPor?: string;
  valores?: Record<string, unknown>;
  comunicacaoWorkflow?: Array<{ mensagem: string; data: Date; autor: string }>;
}

/**
 * Espelha IChamadoWorkflow (ChamadoN1.ts) — o ticket permanece elegível a qualquer workflow
 * real (não um "*-tratativa" dedicado ao órgão); este bloco é o snapshot denormalizado do
 * workflow ativo no ticket, para consulta/ação direto do dash do órgão sem join em chamados_n1.
 */
export interface IReclamacaoWorkflow {
  active: boolean;
  workflowStatus?: 'active' | 'finished' | 'cancel' | null;
  workflowId: Types.ObjectId | null;
  step: number;
  passoId: Types.ObjectId | null;
  startedAt: Date | null;
  completedAt: Date | null;
  pendingDecision?: 'approve' | 'reject' | null;
  requisicao?: IReclamacaoWorkflowRequisicao;
}

export interface IReclamacao extends Document {
  orgao: CasoEspecialOrgao;
  /** Legado: só populado quando o ticket nasceu em chamados_n1 e foi fundido/migrado pra cá
   * (Procon/Bacen/Consumidor.gov via triagem de IA). Reclame Aqui nasce direto nesta coleção
   * e não tem chamadoId — é criado pelo próprio módulo (manual ou import HugMe), nunca por N1. */
  chamadoId?: Types.ObjectId;
  chamadoProtocolo: string;
  /** Histórico completo do atendimento — mesmo shape do ChamadoN1.registro. Só populado nos
   * tickets que já usam esta coleção como fonte de verdade (ver módulo por módulo). */
  registro?: IRegistro[];
  tabulacao?: ITabulacao[];
  cliente?: IReclamacaoClienteRef[];
  origemEntrada: string;
  inboxDedicada: boolean;
  emailThreadRootId?: string;
  triagem?: IReclamacaoTriagem;
  analiseRelacionados?: IReclamacaoAnaliseRelacionados;
  consumidor: string;
  cpf?: string;
  email?: string[];
  telefoneWhatsapp?: string;
  assunto: string;
  descricao: string;
  produto?: string;
  tipo?: string;
  motivo?: string;
  /** Motivo 2/3 — tabulações adicionais só usadas hoje por Bacen e Consumidor.gov. */
  motivo2?: string;
  motivo3?: string;
  statusCanal: string;
  // Denormalizado do ChamadoN1 vinculado — a listagem/patch desta coleção não faz join com
  // chamados_n1, então sem isto o front não sabe se o ticket está terminal (resolvido/fechado)
  // depois de recarregar a lista, e "Finalizar" parece reverter ao reabrir o módulo.
  ticketStatus?: string;
  dataReclamacao?: Date;
  prazoLegal?: Date;
  slaPct?: number;
  orgaoInstituicao?: string;
  cidade?: string;
  uf?: string;
  protocoloExterno?: string;
  idDemandaExterna?: string;
  atendente?: string;
  responsavel?: string;
  workflowId?: Types.ObjectId;
  workflowSlug?: string;
  workflowAtivo: boolean;
  workflow?: IReclamacaoWorkflow;
  aberta: boolean;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const ReclamacaoTriagemSchema = new Schema<IReclamacaoTriagem>(
  {
    classificacao: { type: String, required: true },
    orgao: { type: String, required: true },
    confianca: { type: String, required: true },
    evidencia: { type: String, default: '' },
    justificativa: { type: String, default: '' },
    signals: { type: [String], default: [] },
    at: { type: Date, required: true },
    agenteVersao: { type: String, default: 'casosEspeciaisAgent v1.0.0' },
  },
  { _id: false },
);

const ReclamacaoTicketRelacionadoSchema = new Schema<IReclamacaoTicketRelacionado>(
  {
    chamadoId: { type: String, required: true },
    chamadoProtocolo: { type: String, default: '' },
    scoreSimilaridade: { type: Number, default: 0 },
    criterios: { type: [String], default: [] },
    motivo: { type: String, default: '' },
  },
  { _id: false },
);

const ReclamacaoAnaliseRelacionadosSchema = new Schema<IReclamacaoAnaliseRelacionados>(
  {
    status: { type: String, required: true },
    tickets: { type: [ReclamacaoTicketRelacionadoSchema], default: [] },
    resumoExecutivo: { type: String, default: '' },
    geradoEm: { type: Date, default: Date.now },
    agenteVersao: { type: String, default: 'casosEspeciaisRelacionadosAgent v1.0.0' },
    notaInternaCriada: { type: Boolean, default: false },
  },
  { _id: false },
);

const ReclamacaoWorkflowComunicacaoSchema = new Schema(
  {
    mensagem: { type: String, default: '' },
    data: { type: Date, default: Date.now },
    autor: { type: String, default: '' },
  },
  { _id: false },
);

const ReclamacaoWorkflowRequisicaoSchema = new Schema<IReclamacaoWorkflowRequisicao>(
  {
    preenchidaEm: { type: Date, default: null },
    preenchidaPor: { type: String, default: '' },
    valores: { type: Schema.Types.Mixed, default: {} },
    comunicacaoWorkflow: { type: [ReclamacaoWorkflowComunicacaoSchema], default: [] },
  },
  { _id: false },
);

const ReclamacaoWorkflowSchema = new Schema<IReclamacaoWorkflow>(
  {
    active: { type: Boolean, default: false },
    workflowStatus: { type: String, enum: ['active', 'finished', 'cancel'], default: null },
    workflowId: { type: Schema.Types.ObjectId, default: null },
    step: { type: Number, default: 0 },
    passoId: { type: Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    pendingDecision: { type: String, enum: ['approve', 'reject', null], default: null },
    requisicao: { type: ReclamacaoWorkflowRequisicaoSchema, default: undefined },
  },
  { _id: false },
);

export const ReclamacaoBaseSchema = new Schema<IReclamacao>(
  {
    orgao: { type: String, required: true },
    // Opcional: Reclame Aqui nasce direto nesta coleção (manual ou import HugMe), sem
    // chamadoId. Procon/Bacen/Consumidor.gov via triagem de IA continuam preenchendo (ticket
    // nasceu em chamados_n1 e foi fundido/migrado pra cá).
    chamadoId: { type: Schema.Types.ObjectId, ref: 'ChamadoN1', default: undefined },
    chamadoProtocolo: { type: String, default: '' },
    registro: { type: [RegistroSchema], default: undefined },
    tabulacao: { type: [TabulacaoSchema], default: undefined },
    cliente: { type: [ReclamacaoClienteRefSchema], default: undefined },
    origemEntrada: { type: String, default: '' },
    inboxDedicada: { type: Boolean, default: false },
    emailThreadRootId: { type: String, default: '' },
    triagem: { type: ReclamacaoTriagemSchema, default: undefined },
    analiseRelacionados: { type: ReclamacaoAnaliseRelacionadosSchema, default: undefined },
    consumidor: { type: String, default: '' },
    cpf: { type: String, default: '' },
    email: { type: [String], default: [] },
    telefoneWhatsapp: { type: String, default: '' },
    assunto: { type: String, default: '' },
    descricao: { type: String, default: '' },
    produto: { type: String, default: '' },
    tipo: { type: String, default: '' },
    motivo: { type: String, default: '' },
    motivo2: { type: String, default: '' },
    motivo3: { type: String, default: '' },
    statusCanal: { type: String, default: 'nao-respondida' },
    ticketStatus: { type: String, default: '' },
    dataReclamacao: { type: Date, default: undefined },
    prazoLegal: { type: Date, default: undefined },
    slaPct: { type: Number, default: undefined },
    orgaoInstituicao: { type: String, default: '' },
    cidade: { type: String, default: '' },
    uf: { type: String, default: '' },
    protocoloExterno: { type: String, default: '' },
    idDemandaExterna: { type: String, default: undefined },
    atendente: { type: String, default: '' },
    responsavel: { type: String, default: '' },
    workflowId: { type: Schema.Types.ObjectId, default: undefined },
    workflowSlug: { type: String, default: '' },
    workflowAtivo: { type: Boolean, default: false },
    workflow: { type: ReclamacaoWorkflowSchema, default: undefined },
    aberta: { type: Boolean, default: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
  },
);

// Sparse porque chamadoId agora é opcional (Reclame Aqui nasce sem ele) — nome novo em vez de
// alterar o índice 'chamadoId_1' já criado em produção (mudar opções de um índice existente
// com o mesmo nome dá IndexOptionsConflict no Mongo; o antigo fica órfão/inofensivo até uma
// limpeza futura dedicada).
ReclamacaoBaseSchema.index({ chamadoId: 1 }, { unique: true, sparse: true, name: 'chamadoId_1_sparse' });
ReclamacaoBaseSchema.index({ chamadoProtocolo: 1 }, { name: 'chamadoProtocolo_1' });
ReclamacaoBaseSchema.index({ statusCanal: 1, prazoLegal: 1 }, { name: 'statusCanal_prazoLegal_1' });
ReclamacaoBaseSchema.index({ cpf: 1 }, { name: 'cpf_1', sparse: true });
ReclamacaoBaseSchema.index({ aberta: 1, createdAt: -1 }, { name: 'aberta_createdAt_1' });
ReclamacaoBaseSchema.index(
  { idDemandaExterna: 1 },
  {
    unique: true,
    name: 'idDemandaExterna_unique',
    partialFilterExpression: { idDemandaExterna: { $exists: true, $type: 'string', $gt: '' } },
  },
);
