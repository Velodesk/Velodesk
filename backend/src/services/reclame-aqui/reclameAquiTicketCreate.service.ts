/** reclameAquiTicketCreate.service v1.2.0 — produto da tabulação Desk; motivo do órgão fora da árvore */
import { Types } from 'mongoose';
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { createChamadoFromBody, currentStatus } from '../chamado.mapper';
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
  /** Coluna "Consideração Consumidor" — réplica do cliente à resposta pública; sobe no chat
   * como continuação dela (ver appendRaMensagem/upsertRaTicketFromSource). */
  consideracaoConsumidor?: string;
  /** Coluna "Data Consideração Consumidor" — data/hora real da réplica, usada como `data` da
   * mensagem no chat em vez do momento da importação. */
  dataConsideracaoConsumidor?: string | Date;
  /** Coluna "Moderação status" — vazio = sem solicitação; texto preenchido ("Aceita"/"Recusada")
   * diz o desfecho da solicitação. */
  moderacaoStatus?: string;
  /** Coluna "Moderações neste ticket" — quantidade de solicitações feitas. */
  moderacaoQtd?: string;
  cidade?: string;
  uf?: string;
  nomeSocial?: string;
  nota?: string;
  /** Coluna "Seu problema foi resolvido?" da planilha HugMe — avaliação do consumidor. */
  raResolvido?: string;
  /** Coluna "Voltaria a fazer negócio?" da planilha HugMe — avaliação do consumidor. */
  raVoltariaNegocio?: string;
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

export function parseReclamacaoDate(value: string | Date | undefined): Date | null {
  const iso = asIso(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeProdutoLabel(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Deriva solicitada/aceita a partir da coluna "Moderação status": vazio = nunca solicitada;
 * preenchido = solicitada, e o próprio texto ("Aceita"/"Recusada") diz o desfecho — confirmado
 * com o negócio que são só esses 3 estados possíveis na planilha.
 */
function deriveModeracaoFlags(raw?: string): { solicitada: boolean; aceita: boolean } {
  const value = normalizeProdutoLabel(raw || '');
  if (!value) return { solicitada: false, aceita: false };
  return { solicitada: true, aceita: value.includes('aceit') };
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
    consideracaoConsumidor: String(row.consideracaoConsumidor || '').trim(),
    dataConsideracaoConsumidor: row.dataConsideracaoConsumidor,
    moderacaoStatus: String(row.moderacaoStatus || '').trim(),
    moderacaoQtd: String(row.moderacaoQtd || '').trim(),
    cidade: String(row.cidade || '').trim(),
    uf: String(row.uf || '').trim(),
    nota: String(row.nota || '').trim(),
    raResolvido: String(row.raResolvido || '').trim(),
    raVoltariaNegocio: String(row.raVoltariaNegocio || '').trim(),
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

export function buildTicketPayloadFromRaSource(
  source: RaTicketSource,
  author = 'sistema',
  origemEntrada = 'manual',
) {
  const meta = buildReclameAquiMeta(source);
  const cpf = String(source.cpf ?? '').replace(/\D/g, '');
  // Import em massa da planilha (hugme-import) não representa atendimento real de quem faz o
  // upload — atribuir o uploader como responsável de milhares de tickets históricos é falso.
  // A planilha não traz um responsável real, então o campo fica vazio (decisão explícita do
  // usuário) em vez de usar o autor do upload.
  const responsavel = origemEntrada === 'hugme-import' ? '' : author;

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
      responsavel,
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
/**
 * Monta o `$set` dos campos de primeira classe do RA a partir de um RaTicketSource — função pura,
 * sem I/O, reusada tanto no fluxo de import (ao vivo) quanto em backfills que reconstroem o
 * source a partir de `dadosPlanilha` já salvo (handoff RA-datas), sem precisar reler o .xlsx.
 */
export function buildRaFirstClassSet(
  source: RaTicketSource,
  options: { respostaPublicaToApply?: string; consideracaoConsumidorToApply?: string } = {},
): Record<string, unknown> {
  const { solicitada, aceita } = deriveModeracaoFlags(source.moderacaoStatus);
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
    raResolvido: source.raResolvido || '',
    raVoltariaNegocio: source.raVoltariaNegocio || '',
    statusRaLabel: source.statusRaLabel || '',
    statusHugme: source.statusHugme || '',
    // Moderação (solicitada/aceita/quantidade) vem da base e é sobrescrita a cada reimport —
    // diferente de respostaPublica/consideracaoConsumidor, que são fatos imutáveis uma vez
    // aplicados. Fica dentro de `meta` (Mixed) porque o painel de moderação já lia/gravava ali.
    'meta.moderacaoSolicitada': solicitada,
    'meta.moderacaoAceita': aceita,
    'meta.moderacaoQtd': source.moderacaoQtd || '',
    'meta.moderacaoStatusBase': source.moderacaoStatus || '',
  };
  const dataResposta = asIso(source.dataResposta);
  if (dataResposta) set.dataResposta = new Date(dataResposta);
  // Bug conhecido (handoff RA-datas): dataReclamacao nunca era gravada aqui, mesmo com o dado
  // disponível em source — ficava sempre null em reclamacoes_reclameAqui, obrigando quem
  // precisava da data real da reclamação a ler dadosPlanilha.
  const dataReclamacao = asIso(source.dataReclamacao);
  if (dataReclamacao) set.dataReclamacao = new Date(dataReclamacao);
  // Resposta pública e consideração do consumidor são imutáveis depois de aplicadas uma vez (ver
  // upsertRaTicketFromSource) — só gravam aqui quando o chamador decidiu explicitamente que ainda
  // não havia nenhuma registrada.
  if (options.respostaPublicaToApply) set.respostaPublica = options.respostaPublicaToApply;
  if (options.consideracaoConsumidorToApply) {
    set.consideracaoConsumidor = options.consideracaoConsumidorToApply;
  }
  if (source.dadosPlanilha && Object.keys(source.dadosPlanilha).length) {
    set.dadosPlanilha = source.dadosPlanilha;
  }
  return set;
}

async function enrichRaReclamacaoFirstClassFields(
  reclamacaoId: Types.ObjectId,
  source: RaTicketSource,
  options: { respostaPublicaToApply?: string; consideracaoConsumidorToApply?: string } = {},
): Promise<void> {
  const set = buildRaFirstClassSet(source, options);
  await getReclamacaoReclameAquiModel().updateOne(
    { _id: reclamacaoId },
    { $set: set },
  ).exec();
}

async function persistRaReclamacao(
  chamado: IChamadoN1,
  source: RaTicketSource,
  origemEntrada: string,
  options: { route?: boolean; respostaPublicaToApply?: string; consideracaoConsumidorToApply?: string } = {},
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

  await enrichRaReclamacaoFirstClassFields(reclamacao._id as Types.ObjectId, source, {
    respostaPublicaToApply: options.respostaPublicaToApply,
    consideracaoConsumidorToApply: options.consideracaoConsumidorToApply,
  });

  return reclamacao;
}

/** Empurra uma mensagem direto no registro do chamado, fora de pushRegistroEntry (caso especial
 * é vetado do outbound, então não dispara webhook de saída). `origin: 'agente'` pra resposta
 * pública da empresa; `origin: 'cliente'` pra consideração do consumidor (réplica à resposta).
 * `date` é a data/hora REAL do evento na planilha ("Data de Resposta"/"Data Consideração
 * Consumidor") — sem isso a mensagem ficava datada do momento da importação, não do fato real. */
async function appendRaMensagem(
  chamado: IChamadoN1,
  text: string,
  author: string,
  origin: 'agente' | 'cliente',
  metaSource: string,
  date?: Date | null,
) {
  if (!text.trim() || !chamado.registro?.[0]) return;
  chamado.registro.push({
    data: date && !Number.isNaN(date.getTime()) ? date : new Date(),
    origin,
    autor: origin === 'cliente' ? (chamado.cliente?.[0] as { clienteNome?: string } | undefined)?.clienteNome || 'Consumidor' : author,
    mensagemPublica: text.trim(),
    anexosMensagemPublica: [],
    anotacaoInterna: '',
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados: { source: metaSource },
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

    const payload = buildTicketPayloadFromRaSource(sourced, author, origemEntrada);
    const lf = payload.lateralForm as Record<string, unknown>;
    chamado.chamadoTitulo = payload.chamadoTitulo;
    const raMeta = lf.reclameAqui;
    const registros = chamado.registro ?? [];
    const raIdx = registros.findIndex(
      (reg) => String(reg.metadados?.source ?? '').toLowerCase() === 'reclame-aqui',
    );
    const reclamacaoDate = parseReclamacaoDate(sourced.dataReclamacao);
    if (raIdx >= 0) {
      const existingMeta = registros[raIdx].metadados && typeof registros[raIdx].metadados === 'object'
        ? registros[raIdx].metadados
        : {};
      registros[raIdx].metadados = {
        ...existingMeta,
        source: 'reclame-aqui',
        reclameAqui: raMeta,
      };
      // Reupload da planilha (enriquecida/corrigida) deve corrigir a data da mensagem do cliente
      // no ticket já existente, não só na criação — senão um reimport nunca corrige histórico.
      if (reclamacaoDate) {
        registros[raIdx].data = reclamacaoDate;
      }
      chamado.markModified('registro');
    }
    // chamado.createdAt NÃO é mais retroagido à data da reclamação (handoff RA-datas, Bug 1):
    // createdAt passa a significar "quando o ticket entrou no Velodesk" de verdade — a data da
    // reclamação em si já fica só em reclamacoes_reclameAqui.dataReclamacao (ver Bug 2 acima) e
    // em registros[raIdx].data, logo acima, que continua sendo corrigido a cada reimport.
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

    // Alinha o status do chamado ao Hugme: "Novo" fica `novo`; qualquer outro status (Respondido,
    // Pendente, Fechado) = `resolvido`. A criação já fazia isso, mas o reenvio da planilha só
    // atualizava a reclamação e deixava o chamado `novo` para sempre (fila/roleta/gestão o viam
    // como backlog). Só mexe em chamado ainda `novo` — nunca sobrescreve um atendimento em curso
    // nem um chamado já resolvido/fechado — e empurra o registro direto (fora de pushRegistroEntry)
    // para não disparar webhook de saída: caso especial é vetado do outbound.
    const hugmeLabel = String(sourced.statusHugme || '').trim();
    if (
      hugmeLabel
      && mapTicketStatusFromHugme(hugmeLabel) === 'resolvido'
      && currentStatus(chamado) === 'novo'
    ) {
      chamado.registro.push({
        data: new Date(),
        origin: 'sistema',
        autor: 'Importação RA',
        mensagemPublica: '',
        anexosMensagemPublica: [],
        anotacaoInterna: '',
        anexosAnotacaoInterna: [],
        alteracoes: [{ status: 'resolvido' }],
        metadados: { source: 'reclame-aqui-status-sync', statusHugme: hugmeLabel },
        status: 'resolvido',
      });
      chamado.markModified('registro');
    }
    await chamado.save();

    // Resposta pública e consideração do consumidor são imutáveis depois de aplicadas uma vez:
    // reupload da mesma base não deve reinserir as mensagens no chat. Só aplicam quando o ticket
    // ainda não tinha nenhuma registrada e a base atual já traz uma — cobre o caso de reimport
    // trazer status/resposta mais atualizados do que os que tínhamos (6 meses de base viva).
    const existingRa = existing as unknown as {
      respostaPublica?: string;
      consideracaoConsumidor?: string;
    };
    const previousRespostaPublica = String(existingRa?.respostaPublica || '').trim();
    const incomingRespostaPublica = String(sourced.respostaPublica || '').trim();
    const shouldApplyResposta = !previousRespostaPublica && Boolean(incomingRespostaPublica);

    const previousConsideracao = String(existingRa?.consideracaoConsumidor || '').trim();
    const incomingConsideracao = String(sourced.consideracaoConsumidor || '').trim();
    const shouldApplyConsideracao = !previousConsideracao && Boolean(incomingConsideracao);

    const reclamacao = await persistRaReclamacao(chamado, sourced, origemEntrada, {
      route: false,
      respostaPublicaToApply: shouldApplyResposta ? incomingRespostaPublica : undefined,
      consideracaoConsumidorToApply: shouldApplyConsideracao ? incomingConsideracao : undefined,
    });

    if (shouldApplyResposta) {
      await appendRaMensagem(
        chamado, incomingRespostaPublica, author, 'agente', 'hugme-import-resposta',
        parseReclamacaoDate(sourced.dataResposta),
      );
    }
    if (shouldApplyConsideracao) {
      await appendRaMensagem(
        chamado, incomingConsideracao, author, 'cliente', 'hugme-import-consideracao',
        parseReclamacaoDate(sourced.dataConsideracaoConsumidor),
      );
    }

    return {
      chamadoId: chamado._id as Types.ObjectId,
      chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
      reclamacaoId: reclamacao._id as Types.ObjectId,
      updated: true,
    };
  }

  const payload = buildTicketPayloadFromRaSource(sourced, author, origemEntrada);
  // Sempre cria com status "novo" — createChamadoFromBody usa o 2º parâmetro pra decidir se
  // exige tabulação completa (assertTabulacaoForStatus), e boa parte da base histórica do RA
  // nunca teve produto/motivo classificados no Desk mesmo já estando fechada na plataforma RA.
  // Passar "resolvido" aqui bloquearia a importação dessas linhas com "Preencha a tabulação".
  const partial = await createChamadoFromBody(payload, 'novo');
  // createdAt NÃO é mais retroagido à data da reclamação (handoff RA-datas, Bug 1) — o Mongoose
  // grava o momento real de criação no Velodesk, que é o que dashboards/TMA/TME devem enxergar
  // como "criado". A data real da reclamação vive em reclamacoes_reclameAqui.dataReclamacao
  // (Bug 2) e no registro[] do chat (abaixo), não mais em createdAt.
  const chamado = await ChamadoN1.create(partial) as IChamadoN1;

  // Ajusta o status real do registro DEPOIS da criação, sem passar pela validação de
  // tabulação (que é para ações de agente ao vivo, não para reidratar histórico já encerrado).
  const ticketStatus = mapTicketStatusFromHugme(source.statusHugme || '');
  if (ticketStatus === 'resolvido' && chamado.registro?.length) {
    chamado.registro[chamado.registro.length - 1].status = 'resolvido';
    chamado.markModified('registro');
    await chamado.save();
  }

  const respostaPublicaInicial = String(source.respostaPublica || '').trim();
  const consideracaoInicial = String(source.consideracaoConsumidor || '').trim();
  const reclamacao = await persistRaReclamacao(chamado, sourced, origemEntrada, {
    route: origemEntrada !== 'hugme-import',
    respostaPublicaToApply: respostaPublicaInicial || undefined,
    consideracaoConsumidorToApply: consideracaoInicial || undefined,
  });
  await appendRaMensagem(
    chamado, respostaPublicaInicial, author, 'agente', 'hugme-import-resposta',
    parseReclamacaoDate(sourced.dataResposta),
  );
  await appendRaMensagem(
    chamado, consideracaoInicial, author, 'cliente', 'hugme-import-consideracao',
    parseReclamacaoDate(sourced.dataConsideracaoConsumidor),
  );

  return {
    chamadoId: chamado._id as Types.ObjectId,
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
    reclamacaoId: reclamacao._id as Types.ObjectId,
    updated: false,
  };
}
