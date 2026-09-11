/**
 * ChamadoN1 v1.16.0 — IChamadoWorkflow.path (bifurcação real em árvore) substitui step/passoId
 * como fonte de verdade; ambos mantidos como espelho depreciado.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';
import type { IChamadoWorkflowRequisicao } from '../config/workflowRequisicaoDefaults';
import {
  CHAMADO_STATUS_VALUES,
  RegistroSchema,
  TabulacaoSchema,
  type ChamadoStatus,
  type IRegistro,
  type ITabulacao,
} from './shared/registro.schema';

export { CHAMADO_STATUS_VALUES, type ChamadoStatus, type IRegistro, type ITabulacao };

export type FusaoHierarquia = 'superior' | 'inferior' | 'redundante';

/** Vínculo de fusão (espelha Fusao do VeloHub Ouvidoria). */
export interface IChamadoFusao {
  fundido: boolean;
  dataFundido: Date | null;
  hierarquia: FusaoHierarquia | '';
  parentId: Types.ObjectId | null;
  childId: Types.ObjectId | null;
  parentProtocolo?: string;
  childProtocolo?: string;
  childProtocolos?: string[];
  childIds?: Types.ObjectId[];
}

export const WORKFLOW_STATUS_VALUES = ['active', 'finished', 'cancel'] as const;
export type WorkflowRuntimeStatus = (typeof WORKFLOW_STATUS_VALUES)[number];

/**
 * Um segmento do caminho percorrido na árvore de etapas do workflow.
 * `viaVariavel` guarda qual rota (approve/reject) foi escolhida na etapa-pai
 * (de aprovação) pra descer até este segmento — ausente só no primeiro
 * segmento (raiz do workflow, `definicao.passos`).
 */
export interface IWorkflowPathSegment {
  passoEnvelopeId: Types.ObjectId;
  viaVariavel?: string | null;
}

export interface IChamadoWorkflow {
  active: boolean;
  workflowStatus?: WorkflowRuntimeStatus | null;
  workflowId: Types.ObjectId | null;
  /** Fonte de verdade da posição no workflow (substitui step/passoId). */
  path: IWorkflowPathSegment[];
  /** @deprecated espelho de path.length-1, mantido só por compatibilidade/observabilidade. */
  step?: number;
  /** @deprecated espelho do último segmento de path, mantido só por compatibilidade/observabilidade. */
  passoId?: Types.ObjectId | null;
  startedAt: Date | null;
  completedAt: Date | null;
  pendingDecision?: 'approve' | 'reject' | null;
  requisicao?: IChamadoWorkflowRequisicao;
}

/**
 * Cache de sugestão da IA pré-gerada (Agente 1+2, modo desk_sugestao) — nunca é mensagem
 * enviada nem parte do histórico oficial (`registro[]`); é só um rascunho pronto pra exibir
 * quando o agente abre o ticket. `fingerprint` identifica o estado da thread que gerou essa
 * sugestão — se a thread mudar, o fingerprint não bate mais e o cache é ignorado (recalculado
 * na hora). É apagado no envio real da resposta (ver clearAiSuggestionCache).
 */
export interface IAiSuggestionCache {
  fingerprint: string;
  respostaSugerida: string;
  tabulacao: { tipo: string; produto: string; motivo: string; detalhe: string; incompleta?: boolean };
  tabulacaoDisplay: string;
  tabulacaoFonte?: string;
  auditScore?: number;
  auditAprovado?: boolean;
  auditDecisao?: string;
  confidence?: string;
  model?: string;
  generatedAt: Date;
}

export interface IChamadoCsat {
  enviado: boolean;
  enviadoEm: Date | null;
  nota: number | null;
  comentario: string;
  respondido: boolean;
  respondidoEm: Date | null;
  repescagemEnviada: boolean;
  repescagemEnviadaEm: Date | null;
}

export interface IClienteRef {
  clienteCpf: string;
  clienteId: Types.ObjectId | null;
}

export interface IChamadoN1 extends Document {
  chamadoProtocolo: string;
  chamadoTitulo: string;
  cliente: IClienteRef[];
  tabulacao: ITabulacao[];
  registro: IRegistro[];
  workflow?: IChamadoWorkflow;
  fusao?: IChamadoFusao;
  csat?: IChamadoCsat;
  aiSuggestionCache?: IAiSuggestionCache;
  createdAt: Date;
  updatedAt: Date;
}

const ClienteRefSchema = new Schema<IClienteRef>(
  {
    clienteCpf: { type: String, default: '' },
    clienteId: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false }
);

const ComunicacaoWorkflowSchema = new Schema(
  {
    mensagem: { type: String, default: '' },
    data: { type: Date, default: Date.now },
    autor: { type: String, default: '' },
    autorEmail: { type: String, default: '' },
  },
  { _id: false },
);

const ComunicacaoResumoSchema = new Schema(
  {
    ultimaOrigem: { type: String, default: null },
    ultimaData: { type: Date, default: null },
    temRespostaAgente: { type: Boolean, default: false },
    // E-mail de quem mandou a última mensagem do lado "workflow" — usado pra notificar de
    // volta essa mesma pessoa quando o agente responde (não sobrescrito por respostas do agente).
    ultimoWorkflowAutorEmail: { type: String, default: '' },
    // Última vez que o lado workflow abriu o ticket depois da resposta do agente — esconde o
    // badge "Aguardando resposta" na fila de aprovação sem exigir uma nova mensagem enviada.
    vistoResponsavelEm: { type: Date, default: null },
  },
  { _id: false },
);

const ChamadoWorkflowRequisicaoSchema = new Schema(
  {
    preenchidaEm: { type: Date, default: null },
    preenchidaPor: { type: String, default: '' },
    valores: { type: Schema.Types.Mixed, default: {} },
    comunicacaoWorkflow: { type: [ComunicacaoWorkflowSchema], default: [] },
    comunicacaoResumo: { type: ComunicacaoResumoSchema, default: undefined },
    solicitacaoProdutos: { type: Schema.Types.Mixed, default: undefined },
    solicitacaoFinanceiro: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const WorkflowPathSegmentSchema = new Schema<IWorkflowPathSegment>(
  {
    passoEnvelopeId: { type: Schema.Types.ObjectId, required: true },
    viaVariavel: { type: String, default: null },
  },
  { _id: false },
);

const ChamadoWorkflowSchema = new Schema<IChamadoWorkflow>(
  {
    active: { type: Boolean, default: false },
    workflowStatus: { type: String, enum: WORKFLOW_STATUS_VALUES, default: null },
    workflowId: { type: Schema.Types.ObjectId, default: null },
    path: { type: [WorkflowPathSegmentSchema], default: [] },
    step: { type: Number, default: 0 },
    passoId: { type: Schema.Types.ObjectId, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    pendingDecision: { type: String, enum: ['approve', 'reject'], default: null },
    requisicao: { type: ChamadoWorkflowRequisicaoSchema, default: undefined },
  },
  { _id: false },
);

const ChamadoFusaoSchema = new Schema<IChamadoFusao>(
  {
    fundido: { type: Boolean, default: false },
    dataFundido: { type: Date, default: null },
    hierarquia: {
      type: String,
      enum: ['superior', 'inferior', 'redundante', ''],
      default: '',
    },
    parentId: { type: Schema.Types.ObjectId, default: null },
    childId: { type: Schema.Types.ObjectId, default: null },
    parentProtocolo: { type: String, default: '' },
    childProtocolo: { type: String, default: '' },
    childProtocolos: { type: [String], default: [] },
    childIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);

const ChamadoCsatSchema = new Schema<IChamadoCsat>(
  {
    enviado: { type: Boolean, default: false },
    enviadoEm: { type: Date, default: null },
    nota: { type: Number, min: 1, max: 5, default: null },
    comentario: { type: String, default: '' },
    respondido: { type: Boolean, default: false },
    respondidoEm: { type: Date, default: null },
    repescagemEnviada: { type: Boolean, default: false },
    repescagemEnviadaEm: { type: Date, default: null },
  },
  { _id: false },
);

const AiSuggestionCacheSchema = new Schema<IAiSuggestionCache>(
  {
    fingerprint: { type: String, required: true },
    respostaSugerida: { type: String, default: '' },
    tabulacao: {
      type: {
        tipo: { type: String, default: '' },
        produto: { type: String, default: '' },
        motivo: { type: String, default: '' },
        detalhe: { type: String, default: '' },
        incompleta: { type: Boolean, default: false },
      },
      default: undefined,
    },
    tabulacaoDisplay: { type: String, default: '' },
    tabulacaoFonte: { type: String, default: undefined },
    auditScore: { type: Number, default: undefined },
    auditAprovado: { type: Boolean, default: undefined },
    auditDecisao: { type: String, default: undefined },
    confidence: { type: String, default: undefined },
    model: { type: String, default: undefined },
    generatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ChamadoN1Schema = new Schema<IChamadoN1>(
  {
    chamadoProtocolo: { type: String },
    chamadoTitulo: { type: String, default: '' },
    cliente: { type: [ClienteRefSchema], default: [] },
    tabulacao: { type: [TabulacaoSchema], default: [] },
    registro: { type: [RegistroSchema], default: [] },
    workflow: { type: ChamadoWorkflowSchema, default: undefined },
    fusao: { type: ChamadoFusaoSchema, default: undefined },
    csat: { type: ChamadoCsatSchema, default: undefined },
    aiSuggestionCache: { type: AiSuggestionCacheSchema, default: undefined },
  },
  {
    timestamps: true,
    collection: 'chamados_n1',
  }
);

ChamadoN1Schema.index({ chamadoProtocolo: 1 }, { unique: true, sparse: true, name: 'chamadoProtocolo_1' });
ChamadoN1Schema.index({ 'cliente.clienteCpf': 1 }, { name: 'cliente_clienteCpf_1' });
// Aceleram os cards de Gestão (volume/resumo/voz-cliente/casos-especiais), que filtram por
// data de criação e por datas de eventos do histórico. Sem estes índices, cada card fazia
// varredura completa de coleção (15-19s em produção).
ChamadoN1Schema.index({ createdAt: 1 }, { name: 'createdAt_1' });
ChamadoN1Schema.index({ 'registro.data': 1 }, { name: 'registro_data_1' });
// Acelera as agregações de CSAT (gestaoInsights/workspace360) que filtram por respostas
// dentro de um período.
ChamadoN1Schema.index({ 'csat.respondido': 1, 'csat.respondidoEm': 1 }, { name: 'csat_respondido_1' });

export const ChamadoN1 = mongoose.model<IChamadoN1>('ChamadoN1', ChamadoN1Schema);
