/** reclamacao.service v1.4.1 — produto/motivo RA leem tabulação quando o meta vier vazio */
import { Types, type Model } from 'mongoose';
import { ChamadoN1, type IChamadoN1 } from '../../models/ChamadoN1';
import type { IReclamacao } from '../../models/reclamacoes/reclamacaoModels';
import {
  getReclamacaoBacenModel,
  getReclamacaoConsumidorGovModel,
  getReclamacaoProconModel,
  getReclamacaoReclameAquiModel,
} from '../../models/reclamacoes/reclamacaoModels';
import {
  bacenChannelMongoFilter,
  consumidorGovChannelMongoFilter,
  currentStatus,
  findBacenFromChamado,
  findConsumidorGovFromChamado,
  findProconFromChamado,
  findReclameAquiFromChamado,
  normalizeStatusValue,
  proconChannelMongoFilter,
  readTabulacaoSnapshot,
  reclameAquiChannelMongoFilter,
} from '../chamado.mapper';
import type {
  CasoEspecialOrgao,
  CasoEspecialTriagemPersisted,
} from '../agents/casosEspeciais.types';
import { isMongoConnected, isReclamacoesConnected } from '../../config/database';

const AGENTE_VERSAO = 'casosEspeciaisAgent v1.0.0';

export type ReclamacaoOrgaoRoute =
  | 'reclame-aqui'
  | 'procon'
  | 'bacen'
  | 'consumidor-gov';

const ROUTE_TO_ORGAO: Record<ReclamacaoOrgaoRoute, CasoEspecialOrgao> = {
  'reclame-aqui': 'reclame_aqui',
  procon: 'procon',
  bacen: 'bacen',
  'consumidor-gov': 'consumidor_gov',
};

const ORGAO_TO_ROUTE: Record<Exclude<CasoEspecialOrgao, 'indefinido'>, ReclamacaoOrgaoRoute> = {
  reclame_aqui: 'reclame-aqui',
  procon: 'procon',
  bacen: 'bacen',
  consumidor_gov: 'consumidor-gov',
};

export interface ReclamacaoPersistContext {
  origemEntrada: string;
  inboxDedicada?: boolean;
  emailThreadRootId?: string;
  workflowSlug?: string;
}

export interface ReclamacaoListFilters {
  aberta?: boolean;
  statusCanal?: string;
  limit?: number;
  skip?: number;
}

function registroMetadados(chamado: IChamadoN1): Record<string, unknown> {
  for (const reg of chamado.registro ?? []) {
    if (reg.metadados && typeof reg.metadados === 'object' && !Array.isArray(reg.metadados)) {
      return reg.metadados as Record<string, unknown>;
    }
  }
  return {};
}

export function parseReclamacaoOrgaoRoute(raw: string): CasoEspecialOrgao | null {
  const key = String(raw ?? '').trim().toLowerCase() as ReclamacaoOrgaoRoute;
  return ROUTE_TO_ORGAO[key] ?? null;
}

export function orgaoToRoute(orgao: CasoEspecialOrgao): ReclamacaoOrgaoRoute | null {
  if (orgao === 'indefinido') return null;
  return ORGAO_TO_ROUTE[orgao] ?? null;
}

export function resolveReclamacaoModel(orgao: CasoEspecialOrgao): Model<IReclamacao> | null {
  switch (orgao) {
    case 'reclame_aqui':
      // Schema próprio (campos de primeira classe) — compatível estruturalmente com o uso
      // genérico deste resolver (list/count/search/patch só tocam campos comuns às duas formas).
      return getReclamacaoReclameAquiModel() as unknown as Model<IReclamacao>;
    case 'procon':
      return getReclamacaoProconModel();
    case 'bacen':
      return getReclamacaoBacenModel();
    case 'consumidor_gov':
      return getReclamacaoConsumidorGovModel();
    default:
      return null;
  }
}

function readCanalMeta(chamado: IChamadoN1): Record<string, unknown> {
  const tab = readTabulacaoSnapshot(
    chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0],
  ) as unknown as Record<string, unknown>;
  const procon = tab.procon;
  if (procon && typeof procon === 'object' && !Array.isArray(procon)) {
    return procon as Record<string, unknown>;
  }
  const proconFromRegistro = findProconFromChamado(chamado);
  if (proconFromRegistro) return proconFromRegistro;
  const gov = tab.consumidorGov;
  if (gov && typeof gov === 'object' && !Array.isArray(gov)) {
    return gov as Record<string, unknown>;
  }
  const govFromRegistro = findConsumidorGovFromChamado(chamado);
  if (govFromRegistro) return govFromRegistro;
  const ra = tab.reclameAqui;
  if (ra && typeof ra === 'object' && !Array.isArray(ra)) {
    return ra as Record<string, unknown>;
  }
  const raFromRegistro = findReclameAquiFromChamado(chamado);
  if (raFromRegistro) return raFromRegistro;
  const bacen = tab.bacen;
  if (bacen && typeof bacen === 'object' && !Array.isArray(bacen)) {
    return bacen as Record<string, unknown>;
  }
  const bacenFromRegistro = findBacenFromChamado(chamado);
  if (bacenFromRegistro) return bacenFromRegistro;
  return {};
}

function readClientCpf(chamado: IChamadoN1, meta: Record<string, unknown>): string {
  const fromCliente = chamado.cliente?.[0]?.clienteCpf;
  if (fromCliente) return String(fromCliente).trim();
  const tab = readTabulacaoSnapshot(
    chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0],
  ) as unknown as Record<string, unknown>;
  return String(meta.cpf ?? tab.clienteCpf ?? tab.cpf ?? '').trim();
}

function defaultStatusForOrgao(orgao: CasoEspecialOrgao): string {
  switch (orgao) {
    case 'reclame_aqui':
      return 'nao-respondida';
    case 'procon':
      return 'nao-respondida';
    case 'consumidor_gov':
      return 'nao-respondida';
    case 'bacen':
      return 'nao-respondida';
    default:
      return 'nao-respondida';
  }
}

function buildMetaForOrgao(
  orgao: CasoEspecialOrgao,
  canalMeta: Record<string, unknown>,
): Record<string, unknown> {
  const base = { ...canalMeta };
  if (orgao === 'procon' && canalMeta.statusPc) {
    base.statusPc = canalMeta.statusPc;
  }
  if (orgao === 'consumidor_gov' && canalMeta.statusGov) {
    base.statusGov = canalMeta.statusGov;
  }
  if (orgao === 'reclame_aqui' && canalMeta.statusRa) {
    base.statusRa = canalMeta.statusRa;
    if (canalMeta.passivelNota != null) base.passivelNota = canalMeta.passivelNota;
  }
  if (orgao === 'bacen' && canalMeta.protocoloBacen) {
    base.protocoloBacen = canalMeta.protocoloBacen;
  }
  if (orgao === 'bacen' && canalMeta.statusBc) {
    base.statusBc = canalMeta.statusBc;
  }
  return base;
}

function buildReclamacaoPayload(
  chamado: IChamadoN1,
  orgao: CasoEspecialOrgao,
  triagem: CasoEspecialTriagemPersisted,
  ctx: ReclamacaoPersistContext,
): Partial<IReclamacao> {
  const tab = readTabulacaoSnapshot(
    chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0],
  );
  const meta = readCanalMeta(chamado);
  const rootMeta = registroMetadados(chamado);
  const status = normalizeStatusKey(currentStatus(chamado));
  const terminal = ['resolvido', 'fechado', 'cancelado'].includes(status);

  const protocoloExterno = String(
    meta.protocoloProcon
    ?? meta.protocoloGov
    ?? meta.protocoloRa
    ?? meta.protocoloBacen
    ?? '',
  ).trim();

  const idDemandaExterna = String(
    meta.idDemanda
    ?? meta.idReclamacaoRa
    ?? meta.idDemandaExterna
    ?? '',
  ).trim();

  return {
    orgao,
    chamadoId: chamado._id as Types.ObjectId,
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? '').trim(),
    origemEntrada: ctx.origemEntrada,
    inboxDedicada: Boolean(ctx.inboxDedicada ?? rootMeta.inboxDedicada),
    emailThreadRootId: String(
      ctx.emailThreadRootId ?? rootMeta.emailThreadRootId ?? '',
    ).trim() || undefined,
    triagem: {
      classificacao: triagem.classificacao,
      orgao: triagem.orgao,
      confianca: triagem.confianca,
      evidencia: triagem.evidencia,
      justificativa: triagem.justificativa,
      signals: triagem.signals ?? [],
      at: triagem.at ? new Date(triagem.at) : new Date(),
      agenteVersao: AGENTE_VERSAO,
    },
    consumidor: String(
      meta.consumidor
      ?? (chamado.cliente?.[0] as { clienteNome?: string } | undefined)?.clienteNome
      ?? '',
    ).trim(),
    cpf: readClientCpf(chamado, meta) || undefined,
    email: Array.isArray(meta.email)
      ? (meta.email as string[]).map(String)
      : undefined,
    telefoneWhatsapp: String(meta.telefoneWhatsapp ?? '').trim() || undefined,
    assunto: String(meta.assunto ?? chamado.chamadoTitulo ?? '').trim(),
    descricao: String(
      meta.descricao
      ?? tab.detalhe
      ?? chamado.registro?.[0]?.mensagemPublica
      ?? '',
    ).trim(),
    produto: String(meta.produto ?? tab.produto ?? '').trim() || undefined,
    tipo: String(meta.tipo ?? tab.tipoChamado ?? (tab as { classificacaoTipo?: string }).classificacaoTipo ?? '').trim() || undefined,
    motivo: String(meta.motivo ?? tab.motivo ?? '').trim() || undefined,
    statusCanal: String(
      meta.statusPc
      ?? meta.statusGov
      ?? meta.statusRa
      ?? meta.statusBc
      ?? meta.statusCanal
      ?? defaultStatusForOrgao(orgao),
    ).trim(),
    prazoLegal: meta.prazoLegal
      ? new Date(String(meta.prazoLegal))
      : meta.prazoRa
        ? new Date(String(meta.prazoRa))
        : undefined,
    orgaoInstituicao: String(
      meta.orgaoProcon ?? meta.orgaoGov ?? meta.orgaoInstituicao ?? '',
    ).trim() || undefined,
    cidade: String(meta.cidade ?? '').trim() || undefined,
    uf: String(meta.uf ?? '').trim() || undefined,
    protocoloExterno: protocoloExterno || undefined,
    idDemandaExterna: idDemandaExterna || undefined,
    atendente: String(tab.responsavel ?? '').trim() || undefined,
    responsavel: String(tab.responsavel ?? '').trim() || undefined,
    workflowId: chamado.workflow?.workflowId ?? undefined,
    workflowSlug: ctx.workflowSlug ?? undefined,
    workflowAtivo: Boolean(chamado.workflow?.active),
    workflow: buildReclamacaoWorkflowSnapshot(chamado),
    aberta: !terminal,
    meta: buildMetaForOrgao(orgao, meta),
  };
}

function buildReclamacaoWorkflowSnapshot(chamado: IChamadoN1): IReclamacao['workflow'] {
  const wf = chamado.workflow;
  if (!wf) return undefined;
  return {
    active: Boolean(wf.active),
    workflowStatus: wf.workflowStatus ?? (wf.active ? 'active' : null),
    workflowId: wf.workflowId ?? null,
    step: wf.step ?? 0,
    passoId: wf.passoId ?? null,
    startedAt: wf.startedAt ?? null,
    completedAt: wf.completedAt ?? null,
    pendingDecision: wf.pendingDecision ?? null,
    requisicao: wf.requisicao
      ? {
        preenchidaEm: wf.requisicao.preenchidaEm,
        preenchidaPor: wf.requisicao.preenchidaPor,
        valores: wf.requisicao.valores,
        comunicacaoWorkflow: wf.requisicao.comunicacaoWorkflow,
      }
      : undefined,
  };
}

function normalizeStatusKey(status: unknown): string {
  return normalizeStatusValue(status);
}

export async function upsertFromChamado(
  chamado: IChamadoN1,
  triagem: CasoEspecialTriagemPersisted,
  ctx: ReclamacaoPersistContext,
): Promise<IReclamacao | null> {
  if (triagem.classificacao !== 'caso_formal_real') return null;
  if (!chamado._id) return null;

  const orgao = triagem.orgao;
  if (orgao === 'indefinido') return null;

  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return null;

  const payload = buildReclamacaoPayload(chamado, orgao, triagem, ctx);
  const doc = await Model.findOneAndUpdate(
    { chamadoId: chamado._id },
    { $set: payload },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();

  return doc;
}

export async function findByChamadoId(
  orgao: CasoEspecialOrgao,
  chamadoId: string | Types.ObjectId,
): Promise<IReclamacao | null> {
  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return null;
  return Model.findOne({ chamadoId: new Types.ObjectId(String(chamadoId)) }).exec();
}

export async function findByIdDemandaExterna(
  orgao: CasoEspecialOrgao,
  idDemandaExterna: string,
): Promise<IReclamacao | null> {
  const Model = resolveReclamacaoModel(orgao);
  const id = String(idDemandaExterna ?? '').trim();
  if (!Model || !id) return null;
  return Model.findOne({ idDemandaExterna: id }).exec();
}

export async function findReclamacaoByChamadoIdAnyOrgao(
  chamadoId: string | Types.ObjectId,
): Promise<IReclamacao | null> {
  const id = new Types.ObjectId(String(chamadoId));
  for (const orgao of ['reclame_aqui', 'procon', 'bacen', 'consumidor_gov'] as const) {
    const doc = await findByChamadoId(orgao, id);
    if (doc) return doc;
  }
  return null;
}

export async function syncFromChamado(chamado: IChamadoN1): Promise<IReclamacao | null> {
  if (!chamado._id) return null;

  const existing = await findReclamacaoByChamadoIdAnyOrgao(chamado._id);
  if (!existing) return null;

  const orgao = existing.orgao as CasoEspecialOrgao;
  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return null;

  const tab = readTabulacaoSnapshot(
    chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0],
  );
  const meta = readCanalMeta(chamado);
  const status = normalizeStatusKey(currentStatus(chamado));
  const terminal = ['resolvido', 'fechado', 'cancelado'].includes(status);

  const patch: Partial<IReclamacao> = {
    responsavel: String(tab.responsavel ?? existing.responsavel ?? '').trim() || undefined,
    atendente: String(tab.responsavel ?? existing.atendente ?? '').trim() || undefined,
    workflowAtivo: Boolean(chamado.workflow?.active),
    workflowId: chamado.workflow?.workflowId ?? existing.workflowId,
    workflow: buildReclamacaoWorkflowSnapshot(chamado) ?? existing.workflow,
    aberta: !terminal,
    statusCanal: String(
      meta.statusPc
      ?? meta.statusGov
      ?? meta.statusRa
      ?? meta.statusBc
      ?? existing.statusCanal,
    ).trim(),
    meta: buildMetaForOrgao(orgao, { ...(existing.meta as Record<string, unknown>), ...meta }),
  };

  return Model.findOneAndUpdate(
    { chamadoId: chamado._id },
    { $set: patch },
    { new: true },
  ).exec();
}

export async function listByOrgao(
  orgao: CasoEspecialOrgao,
  filters: ReclamacaoListFilters = {},
): Promise<IReclamacao[]> {
  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return [];

  const query: Record<string, unknown> = {};
  if (filters.aberta != null) query.aberta = filters.aberta;
  if (filters.statusCanal) query.statusCanal = filters.statusCanal;

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const skip = Math.max(filters.skip ?? 0, 0);

  return Model.find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .exec();
}

export async function countByOrgao(
  orgao: CasoEspecialOrgao,
  filters: Pick<ReclamacaoListFilters, 'aberta' | 'statusCanal'> = {},
): Promise<number> {
  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return 0;
  const query: Record<string, unknown> = {};
  if (filters.aberta != null) query.aberta = filters.aberta;
  if (filters.statusCanal) query.statusCanal = filters.statusCanal;
  return Model.countDocuments(query).exec();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function channelMongoFilterForOrgao(orgao: CasoEspecialOrgao): Record<string, unknown> | null {
  switch (orgao) {
    case 'reclame_aqui':
      return reclameAquiChannelMongoFilter();
    case 'procon':
      return proconChannelMongoFilter();
    case 'bacen':
      return bacenChannelMongoFilter();
    case 'consumidor_gov':
      return consumidorGovChannelMongoFilter();
    default:
      return null;
  }
}

function buildReclamacaoTextSearchFilter(
  q: string,
  digits: string,
  ticketObjectId: Types.ObjectId | null,
): Record<string, unknown> {
  const re = new RegExp(escapeRegex(q), 'i');
  const clauses: Record<string, unknown>[] = [
    { chamadoProtocolo: re },
    { protocoloExterno: re },
    { idDemandaExterna: re },
    { consumidor: re },
    { assunto: re },
    { descricao: re },
    { atendente: re },
    { responsavel: re },
    { orgaoInstituicao: re },
  ];
  if (digits.length >= 3) {
    const digitRe = new RegExp(escapeRegex(digits));
    clauses.push({ cpf: digitRe });
    clauses.push({ chamadoProtocolo: digitRe });
    clauses.push({ protocoloExterno: digitRe });
  }
  if (ticketObjectId) {
    clauses.push({ chamadoId: ticketObjectId });
  }
  return { $or: clauses };
}

function buildChamadoN1TextSearchFilter(
  q: string,
  digits: string,
  ticketObjectId: Types.ObjectId | null,
): Record<string, unknown> {
  const re = new RegExp(escapeRegex(q), 'i');
  const clauses: Record<string, unknown>[] = [
    { chamadoProtocolo: re },
    { chamadoTitulo: re },
    { 'cliente.clienteNome': re },
    { 'cliente.clienteEmail': re },
    { 'registro.metadados.protocoloRa': re },
    { 'registro.metadados.protocoloProcon': re },
    { 'registro.metadados.protocoloGov': re },
    { 'registro.metadados.protocoloBacen': re },
    { 'registro.metadados.reclameAqui.protocoloRa': re },
    { 'registro.metadados.procon.protocoloProcon': re },
    { 'registro.metadados.consumidorGov.protocoloGov': re },
    { 'registro.metadados.bacen.protocoloBacen': re },
    { 'registro.metadados.consumidor': re },
    { 'registro.metadados.assunto': re },
  ];
  if (digits.length >= 3) {
    const digitRe = new RegExp(escapeRegex(digits));
    clauses.push({ 'cliente.clienteCpf': digitRe });
    clauses.push({ chamadoProtocolo: digitRe });
    clauses.push({ 'registro.metadados.cpf': digitRe });
    clauses.push({ 'registro.metadados.reclameAqui.cpf': digitRe });
    clauses.push({ 'registro.metadados.procon.cpf': digitRe });
    clauses.push({ 'registro.metadados.consumidorGov.cpf': digitRe });
    clauses.push({ 'registro.metadados.bacen.cpf': digitRe });
  }
  if (ticketObjectId) {
    clauses.push({ _id: ticketObjectId });
  }
  return { $or: clauses };
}

function chamadoToPortalDto(chamado: IChamadoN1, orgao: CasoEspecialOrgao): Record<string, unknown> {
  const tab = readTabulacaoSnapshot(
    chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0],
  );
  const meta = readCanalMeta(chamado);
  const status = normalizeStatusKey(currentStatus(chamado));
  const terminal = ['resolvido', 'fechado', 'cancelado'].includes(status);
  const protocoloExterno = String(
    meta.protocoloProcon
    ?? meta.protocoloGov
    ?? meta.protocoloRa
    ?? meta.protocoloBacen
    ?? '',
  ).trim();
  const consumidor = String(
    meta.consumidor
    ?? (chamado.cliente?.[0] as { clienteNome?: string } | undefined)?.clienteNome
    ?? '',
  ).trim();
  const statusCanal = String(
    meta.statusPc
    ?? meta.statusGov
    ?? meta.statusRa
    ?? meta.statusBc
    ?? meta.statusCanal
    ?? defaultStatusForOrgao(orgao),
  ).trim();

  return {
    id: String(chamado._id),
    chamadoId: String(chamado._id),
    ticketId: String(chamado._id),
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? '').trim(),
    orgao,
    consumidor,
    iniciais: computeIniciais(consumidor),
    cpf: readClientCpf(chamado, meta) || undefined,
    email: Array.isArray(meta.email) ? (meta.email as string[]).map(String) : undefined,
    telefoneWhatsapp: String(meta.telefoneWhatsapp ?? '').trim() || undefined,
    assunto: String(meta.assunto ?? chamado.chamadoTitulo ?? '').trim(),
    descricao: String(
      meta.descricao
      ?? tab.detalhe
      ?? chamado.registro?.[0]?.mensagemPublica
      ?? '',
    ).trim(),
    produto: String(meta.produto ?? tab.produto ?? '').trim() || undefined,
    tipo: String(meta.tipo ?? tab.tipoChamado ?? '').trim() || undefined,
    motivo: String(meta.motivo ?? tab.motivo ?? '').trim() || undefined,
    statusCanal,
    statusPc: meta.statusPc ?? (orgao === 'procon' ? statusCanal : undefined),
    statusGov: meta.statusGov ?? (orgao === 'consumidor_gov' ? statusCanal : undefined),
    statusRa: meta.statusRa ?? (orgao === 'reclame_aqui' ? statusCanal : undefined),
    statusBc: meta.statusBc ?? (orgao === 'bacen' ? statusCanal : undefined),
    protocoloProcon: orgao === 'procon' ? protocoloExterno || undefined : undefined,
    protocoloGov: orgao === 'consumidor_gov' ? protocoloExterno || undefined : undefined,
    protocoloRa: orgao === 'reclame_aqui' ? protocoloExterno || undefined : undefined,
    protocoloBacen: orgao === 'bacen' ? protocoloExterno || undefined : undefined,
    idDemanda: String(meta.idDemanda ?? meta.idReclamacaoRa ?? '').trim() || undefined,
    idReclamacaoRa: orgao === 'reclame_aqui'
      ? String(meta.idReclamacaoRa ?? meta.idDemanda ?? '').trim() || undefined
      : undefined,
    prazoLegal: meta.prazoLegal || meta.prazoRa || undefined,
    prazoRa: meta.prazoRa || undefined,
    slaPct: typeof meta.slaPct === 'number' ? meta.slaPct : undefined,
    orgaoProcon: orgao === 'procon' ? String(meta.orgaoProcon ?? '').trim() || undefined : undefined,
    orgaoGov: orgao === 'consumidor_gov' ? String(meta.orgaoGov ?? '').trim() || undefined : undefined,
    cidade: String(meta.cidade ?? '').trim() || undefined,
    uf: String(meta.uf ?? '').trim() || undefined,
    atendente: String(tab.responsavel ?? '').trim() || undefined,
    responsavel: String(tab.responsavel ?? '').trim() || undefined,
    workflowAtivo: Boolean(chamado.workflow?.active),
    workflow: buildReclamacaoWorkflowSnapshot(chamado),
    aberta: !terminal,
    inboxDedicada: Boolean(registroMetadados(chamado).inboxDedicada),
    meta: buildMetaForOrgao(orgao, meta),
    sourceDb: 'chamados_n1',
    createdAt: (chamado as { createdAt?: Date }).createdAt,
    updatedAt: (chamado as { updatedAt?: Date }).updatedAt,
  };
}

/**
 * Busca rápida do portal de órgãos: consulta `chamados_reclamacoes` (collection do órgão)
 * e `chamados_n1` (filtro de canal), unificando por chamadoId.
 */
export async function searchPortalByOrgao(
  orgao: CasoEspecialOrgao,
  rawQuery: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const q = String(rawQuery ?? '').trim();
  if (!q || orgao === 'indefinido') return [];

  const capped = Math.min(Math.max(limit, 1), 200);
  const digits = q.replace(/\D/g, '');
  // Types.ObjectId.isValid aceita qualquer string de 12 chars (buffer bruto) — restringe ao
  // formato hex de 24 chars, que é o único formato real de _id/chamadoId usado no app.
  const ticketObjectId = /^[a-fA-F0-9]{24}$/.test(q) ? new Types.ObjectId(q) : null;
  const byChamadoId = new Map<string, Record<string, unknown>>();

  const Model = resolveReclamacaoModel(orgao);
  if (Model) {
    const reclamacoes = await Model.find(buildReclamacaoTextSearchFilter(q, digits, ticketObjectId))
      .sort({ updatedAt: -1 })
      .limit(capped)
      .exec();
    for (const doc of reclamacoes) {
      const dto = reclamacaoToPortalDto(doc);
      dto.sourceDb = 'chamados_reclamacoes';
      byChamadoId.set(String(doc.chamadoId), dto);
    }
  }

  if (isMongoConnected()) {
    const channelFilter = channelMongoFilterForOrgao(orgao);
    if (channelFilter) {
      const n1Hits = await ChamadoN1.find({
        $and: [channelFilter, buildChamadoN1TextSearchFilter(q, digits, ticketObjectId)],
      })
        .sort({ updatedAt: -1 })
        .limit(capped)
        .exec();

      for (const chamado of n1Hits) {
        const key = String(chamado._id);
        if (byChamadoId.has(key)) continue;
        byChamadoId.set(key, chamadoToPortalDto(chamado, orgao));
      }
    }
  }

  return Array.from(byChamadoId.values()).slice(0, capped);
}

export async function findByIdOrgao(
  orgao: CasoEspecialOrgao,
  id: string,
): Promise<IReclamacao | null> {
  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return null;

  if (Types.ObjectId.isValid(id)) {
    const byId = await Model.findById(id).exec();
    if (byId) return byId;
    return Model.findOne({ chamadoId: new Types.ObjectId(id) }).exec();
  }

  return Model.findOne({ chamadoProtocolo: id }).exec();
}

export function readInboxDedicadaHint(chamado: IChamadoN1): boolean {
  const meta = registroMetadados(chamado);
  return Boolean(meta.inboxDedicada);
}

export function readCanalProvavelHint(chamado: IChamadoN1): string | null {
  const meta = registroMetadados(chamado);
  const hint = String(meta.canalProvavel ?? '').trim();
  return hint || null;
}

export function reclamacaoToPortalDto(doc: IReclamacao): Record<string, unknown> {
  const meta = (doc.meta && typeof doc.meta === 'object' ? doc.meta : {}) as Record<string, unknown>;
  return {
    id: String(doc._id),
    chamadoId: String(doc.chamadoId),
    ticketId: String(doc.chamadoId),
    chamadoProtocolo: doc.chamadoProtocolo,
    orgao: doc.orgao,
    origemEntrada: doc.origemEntrada,
    consumidor: doc.consumidor,
    iniciais: computeIniciais(doc.consumidor),
    cpf: doc.cpf,
    email: doc.email,
    telefoneWhatsapp: doc.telefoneWhatsapp,
    assunto: doc.assunto,
    descricao: doc.descricao,
    produto: doc.produto,
    tipo: doc.tipo,
    motivo: doc.motivo,
    dataReclamacao: doc.dataReclamacao,
    statusCanal: doc.statusCanal,
    statusPc: meta.statusPc ?? (doc.orgao === 'procon' ? doc.statusCanal : undefined),
    statusGov: meta.statusGov ?? (doc.orgao === 'consumidor_gov' ? doc.statusCanal : undefined),
    statusRa: meta.statusRa ?? (doc.orgao === 'reclame_aqui' ? doc.statusCanal : undefined),
    protocoloProcon: doc.orgao === 'procon' ? doc.protocoloExterno : undefined,
    protocoloGov: doc.orgao === 'consumidor_gov' ? doc.protocoloExterno : undefined,
    protocoloRa: doc.orgao === 'reclame_aqui' ? doc.protocoloExterno : undefined,
    protocoloBacen: doc.orgao === 'bacen' ? doc.protocoloExterno : undefined,
    idDemanda: doc.idDemandaExterna,
    idReclamacaoRa: doc.orgao === 'reclame_aqui' ? doc.idDemandaExterna : undefined,
    prazoLegal: doc.prazoLegal,
    prazoRa: doc.orgao === 'reclame_aqui' ? (meta.prazoRa || doc.prazoLegal) : undefined,
    passivelNota: doc.orgao === 'reclame_aqui' ? Boolean(meta.passivelNota) : undefined,
    moderacaoSolicitada: doc.orgao === 'reclame_aqui' ? Boolean(meta.moderacaoSolicitada) : undefined,
    moderacaoAceita: doc.orgao === 'reclame_aqui' ? Boolean(meta.moderacaoAceita) : undefined,
    moderacaoMotivo: doc.orgao === 'reclame_aqui' ? String(meta.moderacaoMotivo ?? '') : undefined,
    moderacaoAvaliacaoCliente: doc.orgao === 'reclame_aqui'
      ? String(meta.moderacaoAvaliacaoCliente ?? '')
      : undefined,
    tentativaContato: doc.orgao === 'reclame_aqui' ? String(meta.tentativaContato ?? '') : undefined,
    slaPct: doc.slaPct,
    orgaoProcon: doc.orgao === 'procon' ? doc.orgaoInstituicao : undefined,
    orgaoGov: doc.orgao === 'consumidor_gov' ? doc.orgaoInstituicao : undefined,
    cidade: doc.cidade,
    uf: doc.uf,
    atendente: doc.atendente,
    responsavel: doc.responsavel,
    workflowAtivo: doc.workflowAtivo,
    workflow: doc.workflow,
    aberta: doc.aberta,
    inboxDedicada: doc.inboxDedicada,
    triagem: doc.triagem,
    meta,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    // Campos de primeira classe do schema próprio do RA (ReclamacaoReclameAquiSchema) — só
    // existem quando orgao === 'reclame_aqui'; undefined nos outros 3 órgãos (schema genérico).
    ...(doc.orgao === 'reclame_aqui' ? (() => {
      const ra = doc as unknown as Record<string, unknown>;
      return {
        idOrigem: ra.idOrigem,
        canal: ra.canal,
        nomeSocial: ra.nomeSocial,
        motivoRa: ra.motivoRa,
        categoriaRa: ra.categoriaRa,
        problemaRa: ra.problemaRa,
        produtoRa: ra.produtoRa,
        sentimentoRa: ra.sentimentoRa,
        nota: ra.nota,
        statusHugme: ra.statusHugme,
        statusRaLabelPlanilha: ra.statusRaLabel,
        dataResposta: ra.dataResposta,
        respostaPublica: ra.respostaPublica,
        dadosPlanilha: ra.dadosPlanilha,
        fusao: ra.fusao,
      };
    })() : {}),
  };
}

function computeIniciais(name: string): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export async function patchReclamacao(
  orgao: CasoEspecialOrgao,
  id: string,
  patch: Record<string, unknown>,
): Promise<IReclamacao | null> {
  const doc = await findByIdOrgao(orgao, id);
  if (!doc) return null;

  const Model = resolveReclamacaoModel(orgao);
  if (!Model) return null;

  const allowed: Partial<IReclamacao> = {};
  const scalarFields = [
    'statusCanal', 'prazoLegal', 'atendente', 'responsavel', 'aberta',
    'protocoloExterno', 'idDemandaExterna', 'slaPct', 'motivo', 'produto', 'assunto',
    'dataReclamacao',
  ] as const;

  for (const key of scalarFields) {
    if (patch[key] !== undefined) {
      (allowed as Record<string, unknown>)[key] = patch[key];
    }
  }

  if (patch.meta && typeof patch.meta === 'object') {
    allowed.meta = {
      ...(doc.meta as Record<string, unknown>),
      ...(patch.meta as Record<string, unknown>),
    };
  }

  return Model.findByIdAndUpdate(doc._id, { $set: allowed }, { new: true }).exec();
}

const ORGAO_CANAL_LABEL: Record<Exclude<CasoEspecialOrgao, 'indefinido'>, string> = {
  reclame_aqui: 'Reclame Aqui',
  procon: 'Procon',
  bacen: 'Bacen',
  consumidor_gov: 'Consumidor.Gov',
};

/**
 * Lista reclamações de todos os órgãos com CPF correspondente (histórico Client360).
 */
export async function findReclamacoesByCpf(
  cpfDigits: string,
  limitPerOrgao = 200,
): Promise<IReclamacao[]> {
  if (!isReclamacoesConnected()) return [];
  const cpf = String(cpfDigits || '').replace(/\D/g, '');
  if (cpf.length < 11) return [];

  const digitRe = new RegExp(escapeRegex(cpf));
  const filter = {
    $or: [
      { cpf },
      { cpf: digitRe },
    ],
  };
  const capped = Math.min(Math.max(limitPerOrgao, 1), 500);
  const models = [
    getReclamacaoReclameAquiModel() as unknown as Model<IReclamacao>,
    getReclamacaoProconModel(),
    getReclamacaoBacenModel(),
    getReclamacaoConsumidorGovModel(),
  ];

  const batches = await Promise.all(
    models.map((Model) => Model.find(filter).sort({ updatedAt: -1 }).limit(capped).exec()),
  );
  return batches.flat();
}

/**
 * DTO mínimo compatível com a listagem do histórico do cliente (Client360)
 * quando o chamado não está (ou não aparece) em chamados_n1.
 */
export function reclamacaoToHistoryTicketDto(doc: IReclamacao): Record<string, unknown> {
  const orgao = doc.orgao === 'indefinido' ? 'reclame_aqui' : doc.orgao;
  const canal = ORGAO_CANAL_LABEL[orgao] || 'Órgão';
  const id = String(doc.chamadoId || doc._id);
  const status = doc.aberta === false
    ? 'resolvido'
    : String(doc.statusCanal || 'em-andamento');

  return {
    _id: id,
    id,
    chamadoProtocolo: String(doc.chamadoProtocolo || doc.protocoloExterno || '').trim(),
    chamadoTitulo: String(doc.assunto || '').trim() || `Demanda ${canal}`,
    title: String(doc.assunto || '').trim() || `Demanda ${canal}`,
    description: String(doc.descricao || '').trim() || undefined,
    status,
    priority: 'normal',
    channel: canal,
    source: `reclamacoes:${orgao}`,
    clientName: String(doc.consumidor || '').trim() || undefined,
    clientCPF: String(doc.cpf || '').replace(/\D/g, '') || undefined,
    responsibleAgent: String(doc.responsavel || doc.atendente || '').trim() || undefined,
    lateralForm: {
      canal,
      clienteCpf: String(doc.cpf || '').replace(/\D/g, '') || undefined,
      clienteNome: String(doc.consumidor || '').trim() || undefined,
      responsavel: String(doc.responsavel || doc.atendente || '').trim() || undefined,
    },
    workflow: doc.workflow
      ? {
        active: Boolean(doc.workflow.active),
        workflowId: doc.workflow.workflowId ? String(doc.workflow.workflowId) : null,
        step: doc.workflow.step ?? 0,
        passoId: doc.workflow.passoId ? String(doc.workflow.passoId) : null,
        startedAt: doc.workflow.startedAt ?? null,
        completedAt: doc.workflow.completedAt ?? null,
      }
      : undefined,
    listOnly: true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    fromReclamacoesDb: true,
  };
}
