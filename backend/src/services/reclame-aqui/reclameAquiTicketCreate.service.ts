/** reclameAquiTicketCreate.service v1.2.0 — produto da tabulação Desk; motivo do órgão fora da árvore */
import { Types } from 'mongoose';
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { createChamadoFromBody } from '../chamado.mapper';
import { buildFastPathTriagem } from '../agents/casosEspeciaisAgent.service';
import { routeCasoEspecialFormal } from '../agents/casosEspeciaisRouting.service';
import {
  findByChamadoId,
  findByIdDemandaExterna,
  upsertFromChamado,
} from '../reclamacoes/reclamacao.service';
import type { ParsedHugmeRow } from './hugmeSpreadsheet.service';
import { mapTicketStatusFromHugme } from './hugmeSpreadsheet.service';
import { getActiveTabulation } from '../tabulation.service';
import { getReclamacaoReclameAquiModel } from '../../models/reclamacoes/reclamacaoModels';

export interface RaTicketSource {
  idOrigem: string;
  consumidor: string;
  cpf?: string;
  email?: string;
  telefoneWhatsapp?: string;
  assunto: string;
  descricao: string;
  /** Já na formatação da tabulação própria do Desk (produto da árvore comum) — só presente na
   * base histórica (coluna "Produto"); cadastro manual usa RaClassificacaoFields. */
  produto?: string;
  /** Motivo da lista própria do RA (fora da árvore produto→motivo) — coluna "Motivo". */
  motivo?: string;
  /** Taxonomia bruta da plataforma RA (coluna "Produto RA"), sem relação com a tabulação Desk. */
  produtoRa?: string;
  tipo?: string;
  /** Coluna A (Origem) — canal de entrada da reclamação na plataforma RA. */
  canal?: string;
  hugmeMotivoRa?: string;
  hugmeCategoriaRa?: string;
  hugmeProblemaRa?: string;
  hugmeSentimentoRa?: string;
  statusRa?: string;
  statusRaLabel?: string;
  statusHugme?: string;
  dataReclamacao?: string | Date;
  dataResposta?: string | Date;
  respostaPublica?: string;
  cidade?: string;
  uf?: string;
  nomeSocial?: string;
  nota?: string;
  /** Captura literal de todas as colunas da planilha (nome da coluna = chave) — só presente
   * quando a origem é a planilha HugMe; cadastro manual no CRM não tem isso. */
  dadosPlanilha?: Record<string, string>;
}

function asIso(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const raw = String(value).trim();
  return raw || undefined;
}

function normalizeProdutoLabel(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

async function resolveTabulacaoProduto(raw?: string): Promise<string> {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const config = await getActiveTabulation();
    const names = (config.produtos || [])
      .filter((item) => item.ativo !== false)
      .map((item) => String(item.produto || '').trim())
      .filter(Boolean);
    const target = normalizeProdutoLabel(value);
    return names.find((name) => normalizeProdutoLabel(name) === target) || '';
  } catch {
    return '';
  }
}

export function parsedRowToRaTicketSource(row: ParsedHugmeRow): RaTicketSource {
  return {
    idOrigem: String(row.idOrigem || '').trim(),
    consumidor: String(row.consumidor || '').trim(),
    cpf: String(row.cpf || '').trim(),
    email: String(row.email || '').trim(),
    telefoneWhatsapp: String(row.telefoneWhatsapp || '').trim(),
    assunto: String(row.assunto || '').trim(),
    descricao: String(row.descricao || '').trim(),
    produto: String(row.produto || '').trim(),
    motivo: String(row.motivo || '').trim(),
    produtoRa: String(row.produtoRa || '').trim(),
    tipo: String(row.tipo || 'Reclamação').trim(),
    canal: row.canal || '',
    nomeSocial: row.nomeSocial || '',
    hugmeMotivoRa: row.hugmeMotivoRa || '',
    hugmeCategoriaRa: row.hugmeCategoriaRa || '',
    hugmeProblemaRa: row.hugmeProblemaRa || '',
    hugmeSentimentoRa: row.hugmeSentimentoRa || '',
    statusRa: String(row.statusRa || '').trim() || 'nao-respondida',
    statusRaLabel: String(row.statusRaLabel || '').trim(),
    statusHugme: String(row.statusHugme || '').trim(),
    dataReclamacao: row.dataReclamacao,
    dataResposta: row.dataResposta,
    respostaPublica: String(row.respostaPublica || '').trim(),
    cidade: String(row.cidade || '').trim(),
    uf: String(row.uf || '').trim(),
    nota: String(row.nota || '').trim(),
    dadosPlanilha: row.colunasOriginais,
  };
}

function buildReclameAquiMeta(source: RaTicketSource) {
  const idOrigem = String(source.idOrigem || '').trim();
  return {
    protocoloRa: idOrigem,
    idReclamacaoRa: idOrigem,
    idOrigem,
    canal: String(source.canal || '').trim(),
    statusRa: source.statusRa || 'nao-respondida',
    dataReclamacao: asIso(source.dataReclamacao),
    assunto: source.assunto,
    descricao: source.descricao,
    consumidor: source.consumidor,
    cpf: source.cpf,
    produto: source.produto,
    tipo: source.tipo,
    cidade: source.cidade,
    uf: source.uf,
    produtoRa: source.produtoRa || '',
    hugmeMotivoRa: source.hugmeMotivoRa || '',
    hugmeCategoriaRa: source.hugmeCategoriaRa || '',
    hugmeProblemaRa: source.hugmeProblemaRa || '',
    passivelNota: false,
  };
}

export function buildTicketPayloadFromRaSource(source: RaTicketSource, author = 'sistema') {
  const meta = buildReclameAquiMeta(source);
  const cpf = String(source.cpf ?? '').replace(/\D/g, '');

  return {
    chamadoTitulo: String(source.assunto || '').trim() || 'Reclamação Reclame Aqui',
    title: String(source.assunto || '').trim() || 'Reclamação Reclame Aqui',
    text: String(source.descricao || '').trim(),
    description: String(source.descricao || '').trim(),
    status: mapTicketStatusFromHugme(source.statusHugme || ''),
    clientName: String(source.consumidor || '').trim(),
    clientCPF: cpf || undefined,
    author,
    lateralForm: {
      classificacaoTipo: source.tipo || 'Reclamação',
      tipoChamado: source.tipo || 'Reclamação',
      produto: source.produto || '',
      motivo: source.motivo || '',
      detalhe: 'Reclamação Reclame Aqui',
      canal: 'Reclame Aqui',
      responsavel: author,
      clienteCpf: cpf,
      cpf,
      clienteNome: source.consumidor || '',
      clienteTelefone: source.telefoneWhatsapp ? [source.telefoneWhatsapp] : [],
      clienteEmail: source.email ? [source.email] : [],
      reclameAqui: meta,
    },
  };
}

function buildPersistedTriagem(idOrigem: string, origemEntrada: string) {
  const triagem = buildFastPathTriagem('reclame_aqui', [
    `${origemEntrada}:reclame-aqui`,
    `idOrigem:${idOrigem}`,
  ]);
  return {
    ...triagem,
    signals: [`${origemEntrada}:reclame-aqui`],
    at: new Date().toISOString(),
  };
}

/**
 * Promove os campos específicos do RA a campos de primeira classe no documento
 * reclamacoes_reclameAqui — em vez de ficarem só dentro do `meta: Mixed` genérico que
 * upsertFromChamado/routeCasoEspecialFormal (compartilhados com Procon/Bacen/Consumidor.gov)
 * conseguem preencher. Roda depois do fluxo padrão, sem alterar nada desse fluxo.
 */
async function enrichRaReclamacaoFirstClassFields(
  reclamacaoId: Types.ObjectId,
  source: RaTicketSource,
): Promise<void> {
  const set: Record<string, unknown> = {
    idOrigem: source.idOrigem,
    canal: source.canal || '',
    nomeSocial: source.nomeSocial || '',
    motivoRa: source.hugmeMotivoRa || '',
    produtoRa: source.produtoRa || '',
    categoriaRa: source.hugmeCategoriaRa || '',
    problemaRa: source.hugmeProblemaRa || '',
    sentimentoRa: source.hugmeSentimentoRa || '',
    nota: source.nota || '',
    statusRaLabel: source.statusRaLabel || '',
    statusHugme: source.statusHugme || '',
  };
  const dataResposta = asIso(source.dataResposta);
  if (dataResposta) set.dataResposta = new Date(dataResposta);
  if (source.dadosPlanilha && Object.keys(source.dadosPlanilha).length) {
    set.dadosPlanilha = source.dadosPlanilha;
  }

  await getReclamacaoReclameAquiModel().updateOne(
    { _id: reclamacaoId },
    { $set: set },
  ).exec();
}

async function persistRaReclamacao(
  chamado: IChamadoN1,
  source: RaTicketSource,
  origemEntrada: string,
  options: { route?: boolean } = {},
) {
  const persisted = buildPersistedTriagem(source.idOrigem, origemEntrada);
  if (options.route !== false) {
    const routed = await routeCasoEspecialFormal(chamado, persisted, { origemEntrada });
    if (!routed.success) {
      throw new Error(routed.error || 'Falha no roteamento Reclame Aqui');
    }
  }

  let reclamacao = await findByChamadoId('reclame_aqui', chamado._id!.toString());
  if (!reclamacao || options.route === false) {
    reclamacao = await upsertFromChamado(chamado, persisted, { origemEntrada });
  }
  if (!reclamacao) {
    throw new Error('Falha ao persistir reclamacao em reclamacoes_reclameAqui');
  }

  await enrichRaReclamacaoFirstClassFields(reclamacao._id as Types.ObjectId, source);

  return reclamacao;
}

async function appendRespostaPublica(chamado: IChamadoN1, text: string, author: string) {
  if (!text.trim() || !chamado.registro?.[0]) return;
  chamado.registro.push({
    data: new Date(),
    origin: 'agente',
    autor: author,
    mensagemPublica: text.trim(),
    anexosMensagemPublica: [],
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados: { source: 'hugme-import-resposta' },
    status: 'novo',
  });
  chamado.markModified('registro');
  await chamado.save();
}

export interface CreateRaTicketResult {
  chamadoId: Types.ObjectId;
  chamadoProtocolo: string;
  reclamacaoId: Types.ObjectId;
  updated?: boolean;
}

export async function upsertRaTicketFromSource(
  source: RaTicketSource,
  author = 'sistema',
  origemEntrada = 'hugme-import',
): Promise<CreateRaTicketResult> {
  const idOrigem = String(source.idOrigem || '').trim();
  if (!idOrigem) {
    throw new Error('Id Origem obrigatório');
  }

  const existing = await findByIdDemandaExterna('reclame_aqui', idOrigem);
  // Import Hugme (base histórica) grava o produto literal da planilha — exigir match exato
  // contra o catálogo ATIVO hoje perderia a classificação de produtos antigos/renomeados desde
  // que a reclamação foi registrada (é dado de consulta/controle, não precisa validar contra a
  // árvore de tabulação vigente). Outras origens (cadastro manual/registro) continuam resolvendo
  // contra o catálogo, porque ali o ticket é operado ao vivo e precisa ficar consistente com ele.
  const deskProduto = origemEntrada === 'hugme-import'
    ? String(source.produto || '').trim()
    : await resolveTabulacaoProduto(source.produto);
  const sourced = { ...source, produto: deskProduto };

  if (existing?.chamadoId) {
    const chamado = await ChamadoN1.findById(existing.chamadoId);
    if (!chamado) {
      throw new Error(`Chamado ${existing.chamadoId} não encontrado para Id Origem ${idOrigem}`);
    }

    const payload = buildTicketPayloadFromRaSource(sourced, author);
    const lf = payload.lateralForm as Record<string, unknown>;
    chamado.chamadoTitulo = payload.chamadoTitulo;
    const raMeta = lf.reclameAqui;
    const registros = chamado.registro ?? [];
    const raIdx = registros.findIndex(
      (reg) => String(reg.metadados?.source ?? '').toLowerCase() === 'reclame-aqui',
    );
    if (raIdx >= 0) {
      const existingMeta = registros[raIdx].metadados && typeof registros[raIdx].metadados === 'object'
        ? registros[raIdx].metadados
        : {};
      registros[raIdx].metadados = {
        ...existingMeta,
        source: 'reclame-aqui',
        reclameAqui: raMeta,
      };
      chamado.markModified('registro');
    }
    const lastIdx = chamado.tabulacao?.length ? chamado.tabulacao.length - 1 : -1;
    if (lastIdx >= 0) {
      chamado.tabulacao[lastIdx] = {
        ...chamado.tabulacao[lastIdx],
        canal: 'Reclame Aqui',
        ...(deskProduto ? { produto: deskProduto } : {}),
        ...(sourced.motivo ? { motivo: sourced.motivo } : {}),
      };
      chamado.markModified('tabulacao');
    }
    await chamado.save();

    const reclamacao = await persistRaReclamacao(chamado, sourced, origemEntrada, { route: false });

    return {
      chamadoId: chamado._id as Types.ObjectId,
      chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
      reclamacaoId: reclamacao._id as Types.ObjectId,
      updated: true,
    };
  }

  const payload = buildTicketPayloadFromRaSource(sourced, author);
  // O status do registro (currentStatus/box do ticket) vem do 2º parâmetro aqui, não de
  // payload.status — sem passar o status real, todo ticket nasceria "novo" (fila aberta),
  // mesmo o histórico já encerrado na plataforma RA (só "Status Hugme"=Novo continua aberto).
  const partial = await createChamadoFromBody(payload, mapTicketStatusFromHugme(source.statusHugme || ''));
  const chamado = await ChamadoN1.create(partial) as IChamadoN1;
  const reclamacao = await persistRaReclamacao(chamado, sourced, origemEntrada, {
    route: origemEntrada !== 'hugme-import',
  });
  await appendRespostaPublica(chamado, source.respostaPublica || '', author);

  return {
    chamadoId: chamado._id as Types.ObjectId,
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
    reclamacaoId: reclamacao._id as Types.ObjectId,
    updated: false,
  };
}
