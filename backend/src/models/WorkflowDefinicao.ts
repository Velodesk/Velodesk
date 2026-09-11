/** WorkflowDefinicao v2.0.0 — bifurcação real: rotas ganham passos[] aninhados (sub-árvore), proximoPassoId removido */
import { Schema, Document, Model, Types } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';
import type {
  IWorkflowRequisicaoCampo,
  IWorkflowRequisicaoConfig,
} from '../config/workflowRequisicaoDefaults';

export interface IWorkflowCriterio {
  _id?: Types.ObjectId;
  fonte: 'tabulacao' | 'integracao';
  campo: string;
  operador: 'equals' | 'contains' | 'not_empty' | 'in';
  valor: string;
}

export interface IWorkflowAutomaticaConfig {
  modo: 'acao_sistema' | 'resposta_cliente' | 'call_to_action';
  webhookTipo?: 'interno' | 'externo';
  webhookUrl?: string;
  webhookHookId?: string;
  webhookMetodo?: 'POST' | 'GET';
  webhookHeaders?: Record<string, string>;
  promptContexto?: string;
  /** Resposta ao cliente: IA (promptContexto + contexto do chamado) ou e-mail padrão fixo. */
  conteudoModo?: 'ia' | 'email_padrao';
  emailConteudoId?: string;
  ctaTitulo?: string;
  ctaMensagem?: string;
  ctaAlvo?: 'responsavel' | 'atribuido' | 'grupo';
  ctaGrupoSlug?: string;
}

/** @deprecated legado — preferir acao.automatica */
export type IWorkflowSistemaConfig = IWorkflowAutomaticaConfig;

export interface IWorkflowAtribuicao {
  tipo: 'funcao' | 'grupo' | 'colaborador' | 'responsavel_ticket' | 'sistema';
  funcaoSlug: string;
  grupoSlug: string;
  colaborador: string;
  sistema?: IWorkflowSistemaConfig;
}

export interface IWorkflowRota {
  _id?: Types.ObjectId;
  variavel: string;
  rotulo: string;
  statusTicket: string | null;
  /**
   * Sub-sequência de etapas própria deste ramo (bifurcação real): quando o
   * ticket segue por esta rota, avança para a primeira etapa daqui, e as
   * etapas seguintes (inclusive automáticas) só andam dentro deste array —
   * nunca vazam para o array de outro ramo. Vazio = "sem etapas" (rota
   * 'reject' sem etapas volta ao responsável; 'approve' sem etapas encerra
   * o workflow).
   */
  passos: IWorkflowPassoEnvelope[];
}

export interface IWorkflowPassoConfig {
  nome: string;
  descricao: string;
  slaHoras: number | null;
  atribuicao: IWorkflowAtribuicao;
  acao: {
    tipo: 'manual' | 'aprovacao' | 'automatica';
    rotas: IWorkflowRota[];
    automatica?: IWorkflowAutomaticaConfig;
  };
}

export interface IWorkflowPassoEnvelope {
  _id?: Types.ObjectId;
  ordem: number;
  passo: IWorkflowPassoConfig;
}

export interface IWorkflowGatilho {
  tipo: string;
  criterios: IWorkflowCriterio[];
}

export type { IWorkflowRequisicaoCampo, IWorkflowRequisicaoConfig };

export interface IWorkflowDefinicao extends Document {
  _id: Types.ObjectId;
  slug: string;
  titulo: string;
  descricao: string;
  ordem: number;
  ativo: boolean;
  gatilho: IWorkflowGatilho;
  requisicao?: IWorkflowRequisicaoConfig;
  passos: IWorkflowPassoEnvelope[];
  passoInicialId: Types.ObjectId | null;
  /**
   * Funções com capacidade de decisão (aprovar/reprovar/avançar) em QUALQUER etapa deste
   * workflow, além de quem já está atribuído em cada etapa (atribuicao.funcaoSlug) — não
   * substitui o responsável da etapa, só soma. Usado por workflowDefinitionMatchesFuncao.
   */
  funcoesAdicionais: string[];
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const CriterioSchema = new Schema<IWorkflowCriterio>(
  {
    fonte: { type: String, required: true, enum: ['tabulacao', 'integracao'] },
    campo: { type: String, required: true },
    operador: { type: String, required: true, enum: ['equals', 'contains', 'not_empty', 'in'] },
    valor: { type: String, default: '' },
  },
  { _id: true },
);

const AutomaticaConfigSchema = new Schema<IWorkflowAutomaticaConfig>(
  {
    modo: { type: String, enum: ['acao_sistema', 'resposta_cliente', 'call_to_action'], required: true },
    webhookTipo: { type: String, enum: ['interno', 'externo'], default: 'externo' },
    webhookUrl: { type: String, default: '' },
    webhookHookId: { type: String, default: '' },
    webhookMetodo: { type: String, enum: ['POST', 'GET'], default: 'POST' },
    webhookHeaders: { type: Schema.Types.Mixed, default: {} },
    promptContexto: { type: String, default: '' },
    conteudoModo: { type: String, enum: ['ia', 'email_padrao'], default: 'ia' },
    emailConteudoId: { type: String, default: '' },
    ctaTitulo: { type: String, default: '' },
    ctaMensagem: { type: String, default: '' },
    ctaAlvo: { type: String, enum: ['responsavel', 'atribuido', 'grupo'], default: 'responsavel' },
    ctaGrupoSlug: { type: String, default: '' },
  },
  { _id: false },
);

const AtribuicaoSchema = new Schema<IWorkflowAtribuicao>(
  {
    tipo: { type: String, required: true, enum: ['funcao', 'grupo', 'colaborador', 'responsavel_ticket', 'sistema'] },
    funcaoSlug: { type: String, default: '' },
    grupoSlug: { type: String, default: '' },
    colaborador: { type: String, default: '' },
    sistema: { type: AutomaticaConfigSchema, default: undefined },
  },
  { _id: false },
);

/**
 * Estrutura recursiva (Passo → Rota → Passo → ...): PassoEnvelopeSchema é
 * declarado primeiro sem o campo `passo` (que fecharia o ciclo), RotaSchema e
 * PassoConfigSchema o referenciam normalmente, e só no final `.add()` fecha o
 * ciclo — é o padrão do Mongoose para schemas auto-referentes/recursivos.
 */
const PassoEnvelopeSchema = new Schema<IWorkflowPassoEnvelope>(
  {
    ordem: { type: Number, default: 0 },
  },
  { _id: true },
);

const RotaSchema = new Schema<IWorkflowRota>(
  {
    variavel: { type: String, required: true },
    rotulo: { type: String, required: true },
    statusTicket: { type: String, default: null },
    passos: { type: [PassoEnvelopeSchema], default: [] },
  },
  { _id: true },
);

const PassoConfigSchema = new Schema<IWorkflowPassoConfig>(
  {
    nome: { type: String, required: true },
    descricao: { type: String, default: '' },
    slaHoras: { type: Number, default: null },
    atribuicao: { type: AtribuicaoSchema, default: () => ({ tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' }) },
    acao: {
      tipo: { type: String, enum: ['manual', 'aprovacao', 'automatica'], default: 'manual' },
      rotas: { type: [RotaSchema], default: [] },
      automatica: { type: AutomaticaConfigSchema, default: undefined },
    },
  },
  { _id: false },
);

PassoEnvelopeSchema.add({ passo: { type: PassoConfigSchema, required: true } });

const RequisicaoCampoOpcaoSchema = new Schema(
  {
    valor: { type: String, default: '' },
    label: { type: String, default: '' },
  },
  { _id: false },
);

const RequisicaoCampoSchema = new Schema<IWorkflowRequisicaoCampo>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    tipo: {
      type: String,
      enum: ['text', 'textarea', 'number', 'date', 'select', 'boolean', 'currency'],
      default: 'text',
    },
    obrigatorio: { type: Boolean, default: false },
    ordem: { type: Number, default: 0 },
    opcoes: { type: [RequisicaoCampoOpcaoSchema], default: undefined },
    placeholder: { type: String, default: '' },
    ajuda: { type: String, default: '' },
  },
  { _id: false },
);

const WorkflowDefinicaoSchema = new Schema<IWorkflowDefinicao>(
  {
    slug: { type: String, required: true },
    titulo: { type: String, required: true },
    descricao: { type: String, default: '' },
    ordem: { type: Number, default: 0 },
    ativo: { type: Boolean, default: true },
    gatilho: {
      tipo: { type: String, default: 'tabulacao' },
      criterios: { type: [CriterioSchema], default: [] },
    },
    requisicao: {
      campos: { type: [RequisicaoCampoSchema], default: [] },
    },
    passos: { type: [PassoEnvelopeSchema], default: [] },
    passoInicialId: { type: Schema.Types.ObjectId, default: null },
    funcoesAdicionais: { type: [String], default: [] },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'workflow_definicoes',
  },
);

WorkflowDefinicaoSchema.index({ slug: 1 }, { unique: true });
WorkflowDefinicaoSchema.index({ ativo: 1, ordem: 1 });

export function getWorkflowDefinicaoModel(): Model<IWorkflowDefinicao> {
  const conn = getDeskConfigConnection();
  if (conn.models.WorkflowDefinicao) {
    return conn.models.WorkflowDefinicao as Model<IWorkflowDefinicao>;
  }
  return conn.model<IWorkflowDefinicao>('WorkflowDefinicao', WorkflowDefinicaoSchema);
}
