/** WhatsappTemplate v1.0.0 — desk_config.whatsapp_templates */
import { Schema, Document, Model, Types } from 'mongoose';
import { getDeskConfigConnection } from '../config/database';

export const WHATSAPP_TEMPLATE_CATEGORIAS = ['marketing', 'utilitario', 'autenticacao'] as const;
export type WhatsappTemplateCategoria = (typeof WHATSAPP_TEMPLATE_CATEGORIAS)[number];

export const WHATSAPP_TEMPLATE_CABECALHO_TIPOS = ['nenhum', 'texto'] as const;
export type WhatsappTemplateCabecalhoTipo = (typeof WHATSAPP_TEMPLATE_CABECALHO_TIPOS)[number];

export const WHATSAPP_TEMPLATE_IDIOMAS = ['pt_BR', 'en_US'] as const;
export type WhatsappTemplateIdioma = (typeof WHATSAPP_TEMPLATE_IDIOMAS)[number];

/**
 * Status de aprovação na Meta — "pendente" é tudo que ainda não foi aprovado nem reprovado
 * (inclusive o que nem chegou a ser submetido ainda). O envio de mensagem business-initiated de
 * verdade só é possível com status "aprovado" e contentSid preenchido (ver
 * whatsappOutbound.service.ts) — essa submissão em si é feita fora do Velodesk (Console da
 * Twilio), o campo aqui só registra o resultado.
 */
export const WHATSAPP_TEMPLATE_STATUS = ['pendente', 'aprovado', 'reprovado', 'arquivado'] as const;
export type WhatsappTemplateStatus = (typeof WHATSAPP_TEMPLATE_STATUS)[number];

/**
 * Tipos de botão do modelo, espelhando as opções do próprio construtor da Meta:
 * "Resposta rápida" (personalizado / cancelar marketing) e "Chamada para ação"
 * (ligar / acessar o site / copiar código da oferta) — cada um com seus campos extras.
 */
export const WHATSAPP_TEMPLATE_BOTAO_TIPOS = [
  'personalizado',
  'cancelar_marketing',
  'ligar',
  'acessar_site',
  'copiar_codigo',
] as const;
export type WhatsappTemplateBotaoTipo = (typeof WHATSAPP_TEMPLATE_BOTAO_TIPOS)[number];

export const WHATSAPP_TEMPLATE_BOTAO_TIPO_URL = ['estatico', 'dinamico'] as const;
export type WhatsappTemplateBotaoTipoUrl = (typeof WHATSAPP_TEMPLATE_BOTAO_TIPO_URL)[number];

export interface IWhatsappTemplateBotao {
  tipo: WhatsappTemplateBotaoTipo;
  texto: string;
  telefone?: string;
  tipoUrl?: WhatsappTemplateBotaoTipoUrl;
  url?: string;
  codigoOferta?: string;
  /** Só pro botão "cancelar_marketing": texto de rodapé mostrado junto do botão e a
   * confirmação de ciência exigida pela Meta de que a Velotax para de enviar mensagens de
   * marketing pra quem recusar através dele. */
  textoRodape?: string;
  confirmacaoResponsabilidade?: boolean;
}

export interface IWhatsappTemplate extends Document {
  nome: string;
  categoria: WhatsappTemplateCategoria;
  idioma: WhatsappTemplateIdioma;
  disponibilidade: string[];
  cabecalhoTipo: WhatsappTemplateCabecalhoTipo;
  cabecalhoTexto: string;
  corpo: string;
  rodape: string;
  botoes: IWhatsappTemplateBotao[];
  /**
   * Campos exclusivos da categoria "autenticacao" — nela o corpo e o botão não são livres
   * (a Meta exige um modelo fixo de entrega de código), só essas opções são configuráveis.
   * O corpo/botão final gravado acima (corpo, botoes) é derivado desses campos no service.
   */
  autenticacaoBotaoTexto: string;
  autenticacaoRecomendacaoSeguranca: boolean;
  autenticacaoExpiracaoAtiva: boolean;
  autenticacaoExpiracaoMinutos: number;
  /** ID do Content Template na Twilio, preenchido só depois de aprovado pela Meta. */
  contentSid: string;
  status: WhatsappTemplateStatus;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const BotaoSchema = new Schema<IWhatsappTemplateBotao>(
  {
    tipo: { type: String, enum: WHATSAPP_TEMPLATE_BOTAO_TIPOS, default: 'personalizado' },
    texto: { type: String, required: true, trim: true, maxlength: 25 },
    telefone: { type: String, default: '', trim: true, maxlength: 20 },
    tipoUrl: { type: String, enum: WHATSAPP_TEMPLATE_BOTAO_TIPO_URL, default: 'estatico' },
    url: { type: String, default: '', trim: true, maxlength: 2000 },
    codigoOferta: { type: String, default: '', trim: true, maxlength: 15 },
    textoRodape: { type: String, default: '', trim: true, maxlength: 60 },
    confirmacaoResponsabilidade: { type: Boolean, default: false },
  },
  { _id: false },
);

const WhatsappTemplateSchema = new Schema<IWhatsappTemplate>(
  {
    nome: { type: String, required: true, trim: true, maxlength: 512 },
    categoria: { type: String, enum: WHATSAPP_TEMPLATE_CATEGORIAS, default: 'marketing' },
    idioma: { type: String, enum: WHATSAPP_TEMPLATE_IDIOMAS, default: 'pt_BR' },
    disponibilidade: { type: [String], default: ['Todos os usuários'] },
    cabecalhoTipo: { type: String, enum: WHATSAPP_TEMPLATE_CABECALHO_TIPOS, default: 'nenhum' },
    cabecalhoTexto: { type: String, default: '', maxlength: 60 },
    corpo: { type: String, required: true, maxlength: 1024 },
    // 120 pra caber recomendação de segurança + aviso de expiração combinados nos modelos de
    // autenticação (ver buildAutenticacaoRodape) — o rodapé digitado à mão (outras categorias)
    // continua limitado a 60 pelo campo do formulário (RODAPE_MAX no frontend).
    rodape: { type: String, default: '', maxlength: 120 },
    botoes: { type: [BotaoSchema], default: [] },
    autenticacaoBotaoTexto: { type: String, default: 'Copiar código', trim: true, maxlength: 25 },
    autenticacaoRecomendacaoSeguranca: { type: Boolean, default: false },
    autenticacaoExpiracaoAtiva: { type: Boolean, default: true },
    autenticacaoExpiracaoMinutos: { type: Number, default: 10, min: 1, max: 1440 },
    contentSid: { type: String, default: '', trim: true },
    status: { type: String, enum: WHATSAPP_TEMPLATE_STATUS, default: 'pendente' },
    updatedBy: { type: String, default: '' },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'whatsapp_templates',
  },
);

export function getWhatsappTemplateModel(): Model<IWhatsappTemplate> {
  const conn = getDeskConfigConnection();
  if (conn.models.WhatsappTemplate) {
    return conn.models.WhatsappTemplate as Model<IWhatsappTemplate>;
  }
  return conn.model<IWhatsappTemplate>('WhatsappTemplate', WhatsappTemplateSchema);
}

export function isValidWhatsappTemplateId(id: string): boolean {
  return Types.ObjectId.isValid(id);
}
