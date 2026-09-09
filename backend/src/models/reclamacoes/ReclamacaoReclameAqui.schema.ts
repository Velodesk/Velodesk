/**
 * ReclamacaoReclameAqui.schema v1.0.0 — schema próprio do Reclame Aqui (chamados_reclamacoes.
 * reclamacoes_reclameAqui), separado do ReclamacaoBaseSchema genérico usado por Procon/Bacen/
 * Consumidor.gov — não altera nada desses 3 órgãos.
 *
 * Campos vindos da planilha HugMe são de primeira classe (não empurrados pra dentro de um
 * `meta: Mixed` genérico); `dadosPlanilha` guarda a captura literal de TODAS as colunas da
 * planilha (nome da coluna = chave), inclusive as que ainda não têm exibição própria no ticket,
 * pra permitir desenvolvimentos futuros sem perder dado. Único id externo é `idOrigem` — "Id
 * HugMe" foi descartado por decisão de negócio (não é usado como identificador de nada).
 */
import { Schema, Document, Types } from 'mongoose';
import type { CasoEspecialOrgao } from '../../services/agents/casosEspeciais.types';
import type { FusaoHierarquia } from '../ChamadoN1';

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

/**
 * Fusão entre este ticket RA e um chamado padrão (chamados_n1) — mesmo mecanismo/formato do
 * IChamadoFusao (ChamadoN1.ts), cross-collection: parentId/childId podem apontar pra documentos
 * em coleções diferentes (RA aqui é tipicamente o parent/ativo; o childId referencia o
 * chamados_n1 que originou o atendimento e fica fechado). Ligação por protocolo (string) é o
 * jeito seguro de referenciar entre coleções — parentId/childId (ObjectId) só são resolvíveis
 * de fato dentro da MESMA coleção do ticket que os lê.
 */
export interface IReclamacaoFusao {
  fundido: boolean;
  dataFundido: Date | null;
  hierarquia: FusaoHierarquia | '';
  parentId: Types.ObjectId | null;
  childId: Types.ObjectId | null;
  parentProtocolo?: string;
  childProtocolo?: string;
  childProtocolos?: string[];
  childIds?: Types.ObjectId[];
  /** Coleção onde childId/parentId realmente vivem (ex.: 'chamados_n1') — necessário porque a
   * fusão aqui é cross-collection, diferente da fusão N1↔N1 que fica implícita na própria coleção. */
  childCollection?: string;
  parentCollection?: string;
}

export interface IReclamacaoReclameAqui extends Document {
  orgao: CasoEspecialOrgao;
  chamadoId?: Types.ObjectId | null;
  chamadoProtocolo?: string;
  origemEntrada: string;
  inboxDedicada: boolean;
  emailThreadRootId?: string;
  triagem?: IReclamacaoTriagem;
  analiseRelacionados?: IReclamacaoAnaliseRelacionados;

  // Identidade — único id externo é idOrigem (Id HugMe descartado)
  idOrigem: string;
  idDemandaExterna?: string;
  protocoloExterno?: string;

  // Canal — coluna A (Origem) da planilha HugMe
  canal?: string;

  // Consumidor / contato
  consumidor: string;
  nomeSocial?: string;
  cpf?: string;
  email?: string[];
  telefoneWhatsapp?: string;
  cidade?: string;
  uf?: string;

  // Conteúdo da reclamação
  assunto: string;
  descricao: string;
  dataReclamacao?: Date;
  dataResposta?: Date;
  respostaPublica?: string;

  // Classificação CRM (Desk) — distinta da taxonomia bruta da plataforma RA abaixo
  produto?: string;
  tipo?: string;
  motivo?: string;

  // Taxonomia bruta da plataforma RA/HugMe (referência — não é a classificação do CRM)
  motivoRa?: string;
  categoriaRa?: string;
  problemaRa?: string;
  produtoRa?: string;
  sentimentoRa?: string;
  nota?: string;

  // Status / moderação
  statusRa: string;
  statusRaLabel?: string;
  statusHugme?: string;
  statusCanal: string;

  // Captura literal de TODAS as colunas da planilha (nome da coluna = chave) — inclui as sem
  // exibição própria no ticket ainda (moderação, avaliações, réplicas etc.), pra uso futuro.
  dadosPlanilha?: Record<string, string>;

  // Operacional CRM
  prazoLegal?: Date;
  slaPct?: number;
  orgaoInstituicao?: string;
  atendente?: string;
  responsavel?: string;
  workflowId?: Types.ObjectId;
  workflowSlug?: string;
  workflowAtivo: boolean;
  workflow?: IReclamacaoWorkflow;
  fusao?: IReclamacaoFusao;
  aberta: boolean;
  /** Só o que é genuinamente ad hoc da UI do CRM (ex.: passivelNota, tentativaContato) — não é
   * mais o destino de campos da planilha (esses viraram campos de primeira classe acima). */
  meta: Record<string, unknown>;

  // Proveniência da importação HugMe (substitui a antiga coleção paralela reclame_aqui_hugme_registros)
  ultimoImportBatchId?: string;
  primeiroImportEm?: Date;
  ultimoImportEm?: Date;

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

const ReclamacaoFusaoSchema = new Schema<IReclamacaoFusao>(
  {
    fundido: { type: Boolean, default: false },
    dataFundido: { type: Date, default: null },
    hierarquia: { type: String, enum: ['superior', 'inferior', 'redundante', ''], default: '' },
    parentId: { type: Schema.Types.ObjectId, default: null },
    childId: { type: Schema.Types.ObjectId, default: null },
    parentProtocolo: { type: String, default: '' },
    childProtocolo: { type: String, default: '' },
    childProtocolos: { type: [String], default: [] },
    childIds: { type: [Schema.Types.ObjectId], default: [] },
    childCollection: { type: String, default: '' },
    parentCollection: { type: String, default: '' },
  },
  { _id: false },
);

export const ReclamacaoReclameAquiSchema = new Schema<IReclamacaoReclameAqui>(
  {
    orgao: { type: String, required: true, default: 'reclame_aqui' },
    chamadoId: { type: Schema.Types.ObjectId, ref: 'ChamadoN1', default: null },
    chamadoProtocolo: { type: String, default: '' },
    origemEntrada: { type: String, default: '' },
    inboxDedicada: { type: Boolean, default: false },
    emailThreadRootId: { type: String, default: '' },
    triagem: { type: ReclamacaoTriagemSchema, default: undefined },
    analiseRelacionados: { type: ReclamacaoAnaliseRelacionadosSchema, default: undefined },

    idOrigem: { type: String, required: true },
    idDemandaExterna: { type: String, default: undefined },
    protocoloExterno: { type: String, default: '' },

    canal: { type: String, default: '' },

    consumidor: { type: String, default: '' },
    nomeSocial: { type: String, default: '' },
    cpf: { type: String, default: '' },
    email: { type: [String], default: [] },
    telefoneWhatsapp: { type: String, default: '' },
    cidade: { type: String, default: '' },
    uf: { type: String, default: '' },

    assunto: { type: String, default: '' },
    descricao: { type: String, default: '' },
    dataReclamacao: { type: Date, default: undefined },
    dataResposta: { type: Date, default: undefined },
    respostaPublica: { type: String, default: '' },

    produto: { type: String, default: '' },
    tipo: { type: String, default: '' },
    motivo: { type: String, default: '' },

    motivoRa: { type: String, default: '' },
    categoriaRa: { type: String, default: '' },
    problemaRa: { type: String, default: '' },
    produtoRa: { type: String, default: '' },
    sentimentoRa: { type: String, default: '' },
    nota: { type: String, default: '' },

    statusRa: { type: String, default: 'nao-respondida' },
    statusRaLabel: { type: String, default: '' },
    statusHugme: { type: String, default: '' },
    statusCanal: { type: String, default: 'nao-respondida' },

    dadosPlanilha: { type: Schema.Types.Mixed, default: {} },

    prazoLegal: { type: Date, default: undefined },
    slaPct: { type: Number, default: undefined },
    orgaoInstituicao: { type: String, default: '' },
    atendente: { type: String, default: '' },
    responsavel: { type: String, default: '' },
    workflowId: { type: Schema.Types.ObjectId, default: undefined },
    workflowSlug: { type: String, default: '' },
    workflowAtivo: { type: Boolean, default: false },
    workflow: { type: ReclamacaoWorkflowSchema, default: undefined },
    fusao: { type: ReclamacaoFusaoSchema, default: undefined },
    aberta: { type: Boolean, default: true },
    meta: { type: Schema.Types.Mixed, default: {} },

    ultimoImportBatchId: { type: String, default: '' },
    primeiroImportEm: { type: Date, default: undefined },
    ultimoImportEm: { type: Date, default: undefined },
  },
  {
    timestamps: true,
  },
);

ReclamacaoReclameAquiSchema.index({ chamadoId: 1 }, { name: 'chamadoId_1', sparse: true });
ReclamacaoReclameAquiSchema.index({ chamadoProtocolo: 1 }, { name: 'chamadoProtocolo_1' });
ReclamacaoReclameAquiSchema.index({ statusCanal: 1, prazoLegal: 1 }, { name: 'statusCanal_prazoLegal_1' });
ReclamacaoReclameAquiSchema.index({ cpf: 1 }, { name: 'cpf_1', sparse: true });
ReclamacaoReclameAquiSchema.index({ aberta: 1, createdAt: -1 }, { name: 'aberta_createdAt_1' });
ReclamacaoReclameAquiSchema.index(
  { idOrigem: 1 },
  { unique: true, name: 'idOrigem_unique' },
);
ReclamacaoReclameAquiSchema.index(
  { idDemandaExterna: 1 },
  {
    unique: true,
    name: 'idDemandaExterna_unique',
    partialFilterExpression: { idDemandaExterna: { $exists: true, $type: 'string', $gt: '' } },
  },
);
