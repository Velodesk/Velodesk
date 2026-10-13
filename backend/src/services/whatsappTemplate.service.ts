/** whatsappTemplate.service v1.0.0 — CRUD desk_config.whatsapp_templates */
import { Types } from 'mongoose';
import {
  WHATSAPP_TEMPLATE_CATEGORIAS,
  WHATSAPP_TEMPLATE_CABECALHO_TIPOS,
  WHATSAPP_TEMPLATE_IDIOMAS,
  WHATSAPP_TEMPLATE_STATUS,
  WHATSAPP_TEMPLATE_BOTAO_TIPOS,
  WHATSAPP_TEMPLATE_BOTAO_TIPO_URL,
  getWhatsappTemplateModel,
  type IWhatsappTemplateBotao,
  type WhatsappTemplateCategoria,
  type WhatsappTemplateCabecalhoTipo,
  type WhatsappTemplateIdioma,
  type WhatsappTemplateStatus,
  type WhatsappTemplateBotaoTipo,
  type WhatsappTemplateBotaoTipoUrl,
} from '../models/WhatsappTemplate';

const MAX_BOTOES = 10;

/** Limite por tipo de botão, igual ao construtor de modelo da Meta. Tipos fora daqui
 * (ex.: "personalizado") só respeitam o limite geral de MAX_BOTOES. */
const BOTAO_TIPO_MAX: Partial<Record<WhatsappTemplateBotaoTipo, number>> = {
  cancelar_marketing: 1,
  ligar: 1,
  acessar_site: 2,
  copiar_codigo: 1,
};

const AUTENTICACAO_BOTAO_TEXTO_PADRAO = 'Copiar código';
const AUTENTICACAO_EXPIRACAO_MINUTOS_PADRAO = 10;
const AUTENTICACAO_EXPIRACAO_MIN = 1;
const AUTENTICACAO_EXPIRACAO_MAX = 1440;

export function serializeWhatsappTemplate(doc: {
  _id: Types.ObjectId;
  nome: string;
  categoria: WhatsappTemplateCategoria;
  idioma: WhatsappTemplateIdioma;
  disponibilidade: string[];
  cabecalhoTipo: WhatsappTemplateCabecalhoTipo;
  cabecalhoTexto: string;
  corpo: string;
  rodape: string;
  botoes: IWhatsappTemplateBotao[];
  autenticacaoBotaoTexto?: string;
  autenticacaoRecomendacaoSeguranca?: boolean;
  autenticacaoExpiracaoAtiva?: boolean;
  autenticacaoExpiracaoMinutos?: number;
  contentSid: string;
  status: WhatsappTemplateStatus;
  updatedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: String(doc._id),
    nome: doc.nome,
    categoria: doc.categoria,
    idioma: doc.idioma,
    disponibilidade: Array.isArray(doc.disponibilidade) ? doc.disponibilidade : [],
    cabecalhoTipo: doc.cabecalhoTipo,
    cabecalhoTexto: doc.cabecalhoTexto || '',
    corpo: doc.corpo || '',
    rodape: doc.rodape || '',
    botoes: (doc.botoes || []).map((item) => ({
      tipo: item.tipo || 'personalizado',
      texto: item.texto,
      telefone: item.telefone || '',
      tipoUrl: item.tipoUrl || 'estatico',
      url: item.url || '',
      codigoOferta: item.codigoOferta || '',
      textoRodape: item.textoRodape || '',
      confirmacaoResponsabilidade: Boolean(item.confirmacaoResponsabilidade),
    })),
    autenticacaoBotaoTexto: doc.autenticacaoBotaoTexto || AUTENTICACAO_BOTAO_TEXTO_PADRAO,
    autenticacaoRecomendacaoSeguranca: Boolean(doc.autenticacaoRecomendacaoSeguranca),
    autenticacaoExpiracaoAtiva: doc.autenticacaoExpiracaoAtiva !== undefined ? Boolean(doc.autenticacaoExpiracaoAtiva) : true,
    autenticacaoExpiracaoMinutos: doc.autenticacaoExpiracaoMinutos || AUTENTICACAO_EXPIRACAO_MINUTOS_PADRAO,
    contentSid: doc.contentSid || '',
    status: doc.status,
    updatedBy: doc.updatedBy || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function sanitizeDisponibilidade(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.length) return ['Todos os usuários'];
  const list = raw.map((item) => String(item ?? '').trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : ['Todos os usuários'];
}

function sanitizeBotoes(raw: unknown): IWhatsappTemplateBotao[] {
  if (!Array.isArray(raw)) return [];
  const contagemPorTipo: Partial<Record<WhatsappTemplateBotaoTipo, number>> = {};
  const resultado: IWhatsappTemplateBotao[] = [];

  for (const raw_item of raw) {
    if (resultado.length >= MAX_BOTOES) break;
    const item = raw_item as Record<string, unknown>;
    const texto = String(item?.texto ?? '').trim().slice(0, 25);
    if (!texto) continue;
    const tipo = WHATSAPP_TEMPLATE_BOTAO_TIPOS.includes(item?.tipo as WhatsappTemplateBotaoTipo)
      ? (item.tipo as WhatsappTemplateBotaoTipo)
      : 'personalizado';

    // Cancelar marketing exige a ciência de responsabilidade marcada (checkbox obrigatório
    // na Meta) — sem isso o botão não é um modelo válido pra submeter, então nem salva.
    if (tipo === 'cancelar_marketing' && !item?.confirmacaoResponsabilidade) continue;

    const limite = BOTAO_TIPO_MAX[tipo];
    const atual = contagemPorTipo[tipo] || 0;
    if (limite !== undefined && atual >= limite) continue;
    contagemPorTipo[tipo] = atual + 1;

    const botao: IWhatsappTemplateBotao = { tipo, texto };
    if (tipo === 'ligar') {
      botao.telefone = String(item?.telefone ?? '').trim().slice(0, 20);
    } else if (tipo === 'acessar_site') {
      botao.tipoUrl = WHATSAPP_TEMPLATE_BOTAO_TIPO_URL.includes(item?.tipoUrl as WhatsappTemplateBotaoTipoUrl)
        ? (item.tipoUrl as WhatsappTemplateBotaoTipoUrl)
        : 'estatico';
      botao.url = String(item?.url ?? '').trim().slice(0, 2000);
    } else if (tipo === 'copiar_codigo') {
      botao.codigoOferta = String(item?.codigoOferta ?? '').trim().slice(0, 15);
    } else if (tipo === 'cancelar_marketing') {
      botao.textoRodape = String(item?.textoRodape ?? '').trim().slice(0, 60);
      botao.confirmacaoResponsabilidade = true;
    }
    resultado.push(botao);
  }

  return resultado;
}

interface WhatsappTemplatePayload {
  nome?: string;
  categoria?: string;
  idioma?: string;
  disponibilidade?: unknown;
  cabecalhoTipo?: string;
  cabecalhoTexto?: string;
  corpo?: string;
  rodape?: string;
  botoes?: unknown;
  autenticacaoBotaoTexto?: string;
  autenticacaoRecomendacaoSeguranca?: boolean;
  autenticacaoExpiracaoAtiva?: boolean;
  autenticacaoExpiracaoMinutos?: number;
  contentSid?: string;
  status?: string;
}

interface AutenticacaoCampos {
  autenticacaoBotaoTexto: string;
  autenticacaoRecomendacaoSeguranca: boolean;
  autenticacaoExpiracaoAtiva: boolean;
  autenticacaoExpiracaoMinutos: number;
}

function sanitizeAutenticacao(payload: WhatsappTemplatePayload): AutenticacaoCampos {
  const minutos = Number(payload.autenticacaoExpiracaoMinutos);
  return {
    autenticacaoBotaoTexto: String(payload.autenticacaoBotaoTexto || '').trim().slice(0, 25) || AUTENTICACAO_BOTAO_TEXTO_PADRAO,
    autenticacaoRecomendacaoSeguranca: Boolean(payload.autenticacaoRecomendacaoSeguranca),
    autenticacaoExpiracaoAtiva: payload.autenticacaoExpiracaoAtiva === undefined ? true : Boolean(payload.autenticacaoExpiracaoAtiva),
    autenticacaoExpiracaoMinutos: Number.isFinite(minutos)
      ? Math.min(AUTENTICACAO_EXPIRACAO_MAX, Math.max(AUTENTICACAO_EXPIRACAO_MIN, Math.round(minutos)))
      : AUTENTICACAO_EXPIRACAO_MINUTOS_PADRAO,
  };
}

/**
 * Modelo de autenticação tem corpo fixo exigido pela Meta (entrega de código de
 * verificação) — não é texto livre. Tanto a recomendação de segurança quanto o aviso de
 * expiração entram no rodapé (ver buildAutenticacaoRodape), não no corpo.
 */
function buildAutenticacaoCorpo(_campos: AutenticacaoCampos): string {
  return 'Seu código de verificação é {{1}}.';
}

function buildAutenticacaoRodape(campos: AutenticacaoCampos): string {
  const partes: string[] = [];
  if (campos.autenticacaoRecomendacaoSeguranca) partes.push('Não compartilhe este código com ninguém.');
  if (campos.autenticacaoExpiracaoAtiva) partes.push(`Este código expira em ${campos.autenticacaoExpiracaoMinutos} minutos.`);
  return partes.join(' ');
}

function sanitizeForCreate(payload: WhatsappTemplatePayload) {
  const nome = String(payload.nome || '').trim();
  if (!nome) throw new Error('Informe o nome do modelo.');
  const categoria = WHATSAPP_TEMPLATE_CATEGORIAS.includes(payload.categoria as WhatsappTemplateCategoria)
    ? (payload.categoria as WhatsappTemplateCategoria)
    : 'marketing';
  const isAutenticacao = categoria === 'autenticacao';
  const autenticacao = sanitizeAutenticacao(payload);

  const corpo = isAutenticacao ? buildAutenticacaoCorpo(autenticacao) : String(payload.corpo || '').trim();
  if (!isAutenticacao && !corpo) throw new Error('Informe o corpo da mensagem.');

  const idioma = WHATSAPP_TEMPLATE_IDIOMAS.includes(payload.idioma as WhatsappTemplateIdioma)
    ? (payload.idioma as WhatsappTemplateIdioma)
    : 'pt_BR';
  const cabecalhoTipo = WHATSAPP_TEMPLATE_CABECALHO_TIPOS.includes(payload.cabecalhoTipo as WhatsappTemplateCabecalhoTipo)
    ? (payload.cabecalhoTipo as WhatsappTemplateCabecalhoTipo)
    : 'nenhum';
  return {
    nome,
    corpo,
    categoria,
    idioma,
    disponibilidade: sanitizeDisponibilidade(payload.disponibilidade),
    cabecalhoTipo: isAutenticacao ? 'nenhum' : cabecalhoTipo,
    cabecalhoTexto: !isAutenticacao && cabecalhoTipo === 'texto' ? String(payload.cabecalhoTexto || '').trim() : '',
    rodape: isAutenticacao ? buildAutenticacaoRodape(autenticacao) : String(payload.rodape || '').trim(),
    botoes: isAutenticacao
      ? [{ tipo: 'copiar_codigo' as const, texto: autenticacao.autenticacaoBotaoTexto }]
      : sanitizeBotoes(payload.botoes),
    ...autenticacao,
  };
}

export async function listWhatsappTemplates() {
  const Model = getWhatsappTemplateModel();
  const docs = await Model.find({}).sort({ nome: 1 }).lean().exec();
  return docs.map(serializeWhatsappTemplate);
}

export async function getWhatsappTemplateById(id: string) {
  const Model = getWhatsappTemplateModel();
  const doc = await Model.findById(id).lean().exec();
  return doc ? serializeWhatsappTemplate(doc) : null;
}

export async function createWhatsappTemplate(payload: WhatsappTemplatePayload, actor: string) {
  const Model = getWhatsappTemplateModel();
  const doc = await Model.create({
    ...sanitizeForCreate(payload),
    updatedBy: actor,
  });
  return serializeWhatsappTemplate(doc);
}

export async function updateWhatsappTemplate(id: string, payload: WhatsappTemplatePayload, actor: string) {
  const $set: Record<string, unknown> = { updatedBy: actor };

  const categoriaValida = payload.categoria !== undefined
    && WHATSAPP_TEMPLATE_CATEGORIAS.includes(payload.categoria as WhatsappTemplateCategoria);
  const categoria = categoriaValida ? (payload.categoria as WhatsappTemplateCategoria) : undefined;
  const isAutenticacao = categoria === 'autenticacao';

  if (payload.nome !== undefined) {
    const nome = String(payload.nome || '').trim();
    if (!nome) throw new Error('Informe o nome do modelo.');
    $set.nome = nome;
  }
  if (isAutenticacao) {
    const autenticacao = sanitizeAutenticacao(payload);
    $set.corpo = buildAutenticacaoCorpo(autenticacao);
    $set.cabecalhoTipo = 'nenhum';
    $set.cabecalhoTexto = '';
    $set.rodape = buildAutenticacaoRodape(autenticacao);
    $set.botoes = [{ tipo: 'copiar_codigo', texto: autenticacao.autenticacaoBotaoTexto }];
    $set.autenticacaoBotaoTexto = autenticacao.autenticacaoBotaoTexto;
    $set.autenticacaoRecomendacaoSeguranca = autenticacao.autenticacaoRecomendacaoSeguranca;
    $set.autenticacaoExpiracaoAtiva = autenticacao.autenticacaoExpiracaoAtiva;
    $set.autenticacaoExpiracaoMinutos = autenticacao.autenticacaoExpiracaoMinutos;
  } else {
    if (payload.corpo !== undefined) {
      const corpo = String(payload.corpo || '').trim();
      if (!corpo) throw new Error('Informe o corpo da mensagem.');
      $set.corpo = corpo;
    }
    if (payload.cabecalhoTipo !== undefined && WHATSAPP_TEMPLATE_CABECALHO_TIPOS.includes(payload.cabecalhoTipo as WhatsappTemplateCabecalhoTipo)) {
      $set.cabecalhoTipo = payload.cabecalhoTipo;
      $set.cabecalhoTexto = payload.cabecalhoTipo === 'texto' ? String(payload.cabecalhoTexto || '').trim() : '';
    } else if (payload.cabecalhoTexto !== undefined) {
      $set.cabecalhoTexto = String(payload.cabecalhoTexto || '').trim();
    }
    if (payload.rodape !== undefined) $set.rodape = String(payload.rodape || '').trim();
    if (payload.botoes !== undefined) $set.botoes = sanitizeBotoes(payload.botoes);
  }
  if (categoriaValida) $set.categoria = categoria;
  if (payload.idioma !== undefined && WHATSAPP_TEMPLATE_IDIOMAS.includes(payload.idioma as WhatsappTemplateIdioma)) {
    $set.idioma = payload.idioma;
  }
  if (payload.disponibilidade !== undefined) $set.disponibilidade = sanitizeDisponibilidade(payload.disponibilidade);

  // contentSid/status: preenchidos depois que a aprovação na Twilio acontece (fora do Velodesk)
  // — não tem validação de formato aqui de propósito, só registra o que foi configurado lá.
  if (payload.contentSid !== undefined) {
    const contentSid = String(payload.contentSid || '').trim();
    $set.contentSid = contentSid;
    if (payload.status === undefined) {
      $set.status = contentSid ? 'aprovado' : 'pendente';
    }
  }
  if (payload.status !== undefined && WHATSAPP_TEMPLATE_STATUS.includes(payload.status as WhatsappTemplateStatus)) {
    $set.status = payload.status;
  }

  const Model = getWhatsappTemplateModel();
  const doc = await Model.findByIdAndUpdate(id, { $set }, { new: true }).lean().exec();
  return doc ? serializeWhatsappTemplate(doc) : null;
}

export async function deleteWhatsappTemplate(id: string) {
  const Model = getWhatsappTemplateModel();
  const result = await Model.deleteOne({ _id: id }).exec();
  return result.deletedCount === 1;
}
