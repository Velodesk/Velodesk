/**
 * chamadoIaAnalise.service v1.0.0 — classificação de IA do texto real do cliente por ticket
 * VERSION: v1.0.0 | DATE: 2026-07-23
 *
 * Adaptado da técnica usada no projeto wfm_atendimento (análise de IA do Octadesk): lê
 * título + mensagens do CLIENTE (não a tabulação feita pelo atendente) e classifica cada
 * ticket via OpenAI Responses API (Structured Outputs). MVP focado em alerta precoce de
 * "caso grave" — menção a Bacen/Procon/Reclame Aqui/ação judicial/órgão regulador dentro de
 * um ticket comum, ainda não escalonado formalmente. motivo/sentimentoClasse já saem da
 * mesma chamada (sem custo adicional) para uso futuro em cards complementares.
 *
 * Cache por hash de conteúdo (textoHash): evita reclassificar um ticket cujo texto do
 * cliente não mudou, mesmo que status/tags tenham sido atualizados depois.
 */
import { hashTextoClassificacao } from './iaTextoHash.util';
import mongoose from 'mongoose';
import { ChamadoN1, IChamadoN1 } from '../models/ChamadoN1';
import { ChamadoIaAnalise, SentimentoClasseIA } from '../models/ChamadoIaAnalise';
import { TicketIaExemplo } from '../models/TicketIaExemplo';
import type { ITicketIaSettings } from '../models/TicketIaSettings';
import { currentStatus, GESTAO_TERMINAL_STATUSES, lastStatusNotInFilter } from './chamado.mapper';
import { env } from '../config/env';
import {
  adaptChamadoToTicketIa,
  buildTicketIaText,
  resolveFormalCaseSource,
  TicketIaPayload,
} from './ticketIaAdapter.service';
import {
  ensureTicketIaSettings,
  getTicketIaExamplesForPrompt,
  normalizeForComparison,
  TicketIaExamplePrompt,
  updateTicketIaSettings,
} from './ticketIaSettings.service';
import { resolvePeriodRange, GestaoInsightsQuery } from './gestaoInsights.service';
import { executarClassificacaoIaLote, type IaClassificacaoCandidato } from './iaClassificacaoBatch.service';

const MAX_TEXTO_CLIENTE = 4000;

export interface CandidatoIaAnalise {
  chamado: IChamadoN1;
  payload: TicketIaPayload;
  textoCliente: string;
  textoHash: string;
}

export { hashTextoClassificacao } from './iaTextoHash.util';

/** Elegível quando há relato analisável e o ticket ainda não pertence a um canal especial formal. */
export function isElegivelParaAnaliseIa(chamado: IChamadoN1): boolean {
  const payload = adaptChamadoToTicketIa(chamado);
  return Boolean(payload && !payload.formalCaseSource && buildTicketIaText(payload).length > 0);
}

/** Busca candidatos elegíveis e ainda sem cache válido (hash do texto do cliente mudou ou nunca foi analisado). */
async function coletarCandidatos(
  maxCandidatos: number,
  contextoVersao: number,
): Promise<CandidatoIaAnalise[]> {
  // Universo: tickets ativos (não terminais) OU resolvidos/fechados/cancelados recentemente
  // (últimos 14 dias) — cobre o caso de um ticket já fechado sem a menção ter sido notada.
  const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const chamados = await ChamadoN1.find({
    $or: [
      lastStatusNotInFilter([...GESTAO_TERMINAL_STATUSES]),
      { updatedAt: { $gte: desde } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(2000)
    .exec();

  const candidatos: CandidatoIaAnalise[] = [];
  const idsElegiveis: string[] = [];
  for (const chamado of chamados) {
    const payload = adaptChamadoToTicketIa(chamado);
    if (!payload || payload.formalCaseSource) continue;
    const textoCliente = buildTicketIaText(payload, MAX_TEXTO_CLIENTE);
    if (!textoCliente) continue;
    candidatos.push({
      chamado,
      payload,
      textoCliente,
      textoHash: hashTextoClassificacao(textoCliente),
    });
    idsElegiveis.push(String(chamado._id));
    if (candidatos.length >= 2000) break;
  }
  if (candidatos.length === 0) return [];

  const cacheRows = await ChamadoIaAnalise.find({ chamadoId: { $in: idsElegiveis } })
    .select('chamadoId textoHash needsReanalysis contextoVersao origem')
    .lean();
  const cachePorId = new Map(cacheRows.map((r) => [String(r.chamadoId), r]));

  const precisaClassificar = candidatos.filter((c) => {
    const row = cachePorId.get(String(c.chamado._id));
    if (!row) return true;
    if (row.needsReanalysis) return true;
    if (row.origem === 'manual') return false;
    if (row.contextoVersao !== contextoVersao) return true;
    return row.textoHash !== c.textoHash;
  });

  return precisaClassificar.slice(0, maxCandidatos);
}

/** Classifica um lote de candidatos via OpenAI Responses API e persiste no cache. Retorna quantos foram classificados. */
async function classificarLote(
  candidatos: CandidatoIaAnalise[],
  settings: ITicketIaSettings,
  examples: TicketIaExamplePrompt[],
  recentNewReasons: string[],
): Promise<number> {
  if (candidatos.length === 0) return 0;

  const batchInput: IaClassificacaoCandidato[] = candidatos.map((c) => ({
    itemId: c.payload.chamadoId,
    protocolo: c.payload.protocolo,
    canal: c.payload.canal,
    abertoEm: c.payload.abertoEm,
    qualidadeFonte: c.payload.qualidadeFonte,
    textoCliente: c.textoCliente,
    textoHash: c.textoHash,
  }));

  const resultados = await executarClassificacaoIaLote(
    batchInput,
    settings,
    examples,
    recentNewReasons,
    'chamado_ia_analise',
  );

  const porId = new Map(candidatos.map((c) => [c.payload.chamadoId, c]));
  let classificadosTotal = 0;

  for (const item of resultados) {
    const candidato = porId.get(item.itemId);
    if (!candidato) continue;
    await ChamadoIaAnalise.findOneAndUpdate(
      { chamadoId: candidato.chamado._id },
      {
        chamadoId: candidato.chamado._id,
        chamadoProtocolo: candidato.chamado.chamadoProtocolo || '',
        ticketCreatedAt: candidato.chamado.createdAt ?? new Date(),
        motivo: item.motivo,
        motivoNovo: item.motivoNovo,
        sentimentoClasse: item.sentimentoClasse,
        casoGrave: item.casoGrave,
        textoHash: item.textoHash,
        qualidadeFonte: item.qualidadeFonte,
        canal: item.canal,
        contextoVersao: settings.contextoVersao,
        modelo: item.modelo,
        origem: 'auto' as const,
        needsReanalysis: false,
        analisadoEm: new Date(),
      },
      { upsert: true, new: true },
    );
    classificadosTotal += 1;
  }

  return classificadosTotal;
}

export async function runChamadoIaAnaliseCycle(): Promise<{ candidatos: number; classificados: number }> {
  const settings = await ensureTicketIaSettings();
  const maxCandidates = Math.min(env.chamadoIaAnaliseMaxPerCycle, settings.maxTicketsPorCiclo);
  const [candidatos, examples, recentRows] = await Promise.all([
    coletarCandidatos(maxCandidates, settings.contextoVersao),
    getTicketIaExamplesForPrompt(settings.maxExemplosPorMotivo, settings.maxExemplosTotal),
    ChamadoIaAnalise.find({
      motivoNovo: true,
      analisadoEm: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
    }).select('motivo').sort({ analisadoEm: -1 }).limit(100).lean(),
  ]);
  const recentNewReasons = [...new Set(recentRows.map((row) => row.motivo).filter(Boolean))].slice(0, 30);
  const classificados = await classificarLote(candidatos, settings, examples, recentNewReasons);
  return { candidatos: candidatos.length, classificados };
}

export async function runChamadoIaBackfill(options: {
  max?: number;
  dryRun?: boolean;
} = {}): Promise<{
  candidatos: number;
  classificados: number;
  preview: Array<{ chamadoId: string; protocolo: string; qualidadeFonte: string }>;
}> {
  const settings = await ensureTicketIaSettings();
  const max = Math.min(100, Math.max(1, options.max ?? 10));
  const [candidatos, examples] = await Promise.all([
    coletarCandidatos(max, settings.contextoVersao),
    getTicketIaExamplesForPrompt(settings.maxExemplosPorMotivo, settings.maxExemplosTotal),
  ]);
  const preview = candidatos.map((item) => ({
    chamadoId: item.payload.chamadoId,
    protocolo: item.payload.protocolo,
    qualidadeFonte: item.payload.qualidadeFonte,
  }));
  if (options.dryRun !== false) {
    return { candidatos: candidatos.length, classificados: 0, preview };
  }
  const classificados = await classificarLote(candidatos, settings, examples, []);
  return { candidatos: candidatos.length, classificados, preview };
}

export interface RiscoCasoEspecialItem {
  id: string;
  protocolo: string;
  titulo: string;
  tipo: string;
  trecho: string;
  status: string;
  ageDays: number;
  analisadoEm: string;
}

/** Tickets ativos (não resolvidos/cancelados/fechados) com menção real a caso grave, ainda não escalonados formalmente. */
export async function getRiscosCasoEspecial(limit = 10): Promise<RiscoCasoEspecialItem[]> {
  const analises = await ChamadoIaAnalise.find({ 'casoGrave.tipo': { $exists: true, $ne: null } })
    .sort({ analisadoEm: -1 })
    .limit(500)
    .populate<{ chamadoId: IChamadoN1 }>('chamadoId')
    .lean();

  const terminais = new Set<string>([...GESTAO_TERMINAL_STATUSES]);
  const itens: RiscoCasoEspecialItem[] = [];

  for (const analise of analises) {
    const chamado = analise.chamadoId as unknown as IChamadoN1 | null;
    if (!chamado || !chamado.registro) continue;
    const status = currentStatus(chamado);
    if (terminais.has(status)) continue;
    if (resolveFormalCaseSource(chamado)) continue;

    const createdAt = (chamado as unknown as { createdAt?: Date }).createdAt ?? new Date();
    const ageDays = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / (24 * 3600 * 1000)));

    itens.push({
      id: String(chamado._id),
      protocolo: chamado.chamadoProtocolo || '',
      titulo: chamado.chamadoTitulo || '',
      tipo: analise.casoGrave?.tipo ?? 'Outro',
      trecho: analise.casoGrave?.trecho ?? '',
      status,
      ageDays,
      analisadoEm: new Date(analise.analisadoEm).toISOString(),
    });
    if (itens.length >= limit) break;
  }

  return itens;
}

export async function markChamadoIaForReanalysis(chamadoId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(chamadoId)) return;
  await ChamadoIaAnalise.updateOne(
    { chamadoId },
    { $set: { needsReanalysis: true, origem: 'auto' }, $unset: { corrigidoPor: 1, corrigidoEm: 1 } },
  );
}

export async function markChamadosIaForReanalysis(chamadoIds: string[]): Promise<void> {
  const validIds = chamadoIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  if (!validIds.length) return;
  await ChamadoIaAnalise.updateMany(
    { chamadoId: { $in: validIds } },
    { $set: { needsReanalysis: true, origem: 'auto' }, $unset: { corrigidoPor: 1, corrigidoEm: 1 } },
  );
}

export async function correctChamadoIaReason(params: {
  chamadoIds: string[];
  motivo: string;
  userId?: string;
  promoteTaxonomy?: boolean;
  createAliasFrom?: string;
}): Promise<{ updated: number; motivo: string }> {
  const chamadoIds = params.chamadoIds.filter((id) => mongoose.Types.ObjectId.isValid(id));
  const motivo = String(params.motivo ?? '').trim();
  if (!chamadoIds.length || !motivo) throw new Error('Informe tickets e motivo válidos.');

  let settings = await ensureTicketIaSettings();
  const taxonomy = settings.taxonomiaMotivos;
  const shouldPromote = params.promoteTaxonomy
    && !taxonomy.some((item) => normalizeForComparison(item) === normalizeForComparison(motivo));
  const aliases = [...settings.motivoAliases];
  const aliasFrom = String(params.createAliasFrom ?? '').trim();
  if (
    aliasFrom
    && !['outros', 'outro'].includes(normalizeForComparison(aliasFrom))
    && !aliases.some((item) => normalizeForComparison(item.de) === normalizeForComparison(aliasFrom))
  ) {
    aliases.push({ de: aliasFrom, para: motivo });
  }
  if (shouldPromote || aliases.length !== settings.motivoAliases.length) {
    settings = await updateTicketIaSettings({
      taxonomiaMotivos: shouldPromote ? [...taxonomy, motivo] : taxonomy,
      motivoAliases: aliases,
    }, params.userId);
  }

  const chamados = await ChamadoN1.find({ _id: { $in: chamadoIds } });
  let updated = 0;
  for (const chamado of chamados) {
    const payload = adaptChamadoToTicketIa(chamado);
    if (!payload) continue;
    const text = buildTicketIaText(payload, MAX_TEXTO_CLIENTE);
    const existing = await ChamadoIaAnalise.findOne({ chamadoId: chamado._id });
    await ChamadoIaAnalise.findOneAndUpdate(
      { chamadoId: chamado._id },
      {
        chamadoId: chamado._id,
        chamadoProtocolo: chamado.chamadoProtocolo || '',
        ticketCreatedAt: chamado.createdAt ?? new Date(),
        motivo,
        motivoNovo: false,
        sentimentoClasse: existing?.sentimentoClasse ?? 'neutro',
        casoGrave: existing?.casoGrave ?? null,
        textoHash: hashTextoClassificacao(text),
        qualidadeFonte: payload.qualidadeFonte,
        canal: payload.canal,
        contextoVersao: settings.contextoVersao,
        modelo: 'manual',
        origem: 'manual',
        needsReanalysis: false,
        corrigidoPor: params.userId,
        corrigidoEm: new Date(),
        analisadoEm: new Date(),
      },
      { upsert: true, new: true },
    );
    await TicketIaExemplo.findOneAndUpdate(
      { chamadoId: chamado._id, motivo },
      {
        chamadoId: chamado._id,
        protocolo: chamado.chamadoProtocolo,
        titulo: payload.titulo,
        trecho: payload.descricaoCliente.slice(0, 2000),
        motivo,
        confirmadoPor: params.userId,
        ativo: true,
      },
      { upsert: true, new: true },
    );
    updated += 1;
  }
  return { updated, motivo };
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

export async function getCustomerVoiceInsights(query: GestaoInsightsQuery = {}) {
  const range = resolvePeriodRange(query);
  const chamados = await ChamadoN1.find({
    createdAt: { $gte: range.start, $lte: range.end },
  }).select('chamadoProtocolo chamadoTitulo createdAt tabulacao registro').lean();

  const eligible = chamados
    .map((chamado) => ({ chamado, payload: adaptChamadoToTicketIa(chamado as unknown as IChamadoN1) }))
    .filter((entry) => entry.payload && !entry.payload.formalCaseSource);
  const ids = eligible.map((entry) => String(entry.chamado._id));
  const analyses = ids.length
    ? await ChamadoIaAnalise.find({ chamadoId: { $in: ids } }).lean()
    : [];
  const byId = new Map(analyses.map((analysis) => [String(analysis.chamadoId), analysis]));
  const reasonMap = new Map<string, number>();
  const sentimentMap = new Map<string, number>();
  let divergences = 0;
  let directSource = 0;

  for (const { chamado, payload } of eligible) {
    if (payload?.qualidadeFonte === 'direto_cliente') directSource += 1;
    const analysis = byId.get(String(chamado._id));
    if (!analysis) continue;
    reasonMap.set(analysis.motivo, (reasonMap.get(analysis.motivo) ?? 0) + 1);
    sentimentMap.set(
      analysis.sentimentoClasse,
      (sentimentMap.get(analysis.sentimentoClasse) ?? 0) + 1,
    );
    const manualReason = String(chamado.tabulacao?.[chamado.tabulacao.length - 1]?.motivo ?? '').trim();
    if (
      manualReason
      && normalizeForComparison(manualReason) !== normalizeForComparison(analysis.motivo)
    ) {
      divergences += 1;
    }
  }

  const analyzed = analyses.length;
  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    coverage: {
      eligible: eligible.length,
      analyzed,
      pending: Math.max(0, eligible.length - analyzed),
      directSource,
      transcribedSource: Math.max(0, eligible.length - directSource),
      pct: pct(analyzed, eligible.length),
    },
    reasons: [...reasonMap.entries()]
      .map(([motivo, count]) => ({ motivo, count, pct: pct(count, analyzed) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    sentiments: [...sentimentMap.entries()]
      .map(([sentimento, count]) => ({ sentimento, count, pct: pct(count, analyzed) }))
      .sort((a, b) => b.count - a.count),
    divergence: { count: divergences, pct: pct(divergences, analyzed) },
  };
}

export async function getCustomerVoiceTickets(params: {
  query?: GestaoInsightsQuery;
  motivo?: string;
  sentimento?: string;
  limit?: number;
}) {
  const range = resolvePeriodRange(params.query ?? {});
  const filter: Record<string, unknown> = {
    ticketCreatedAt: { $gte: range.start, $lte: range.end },
  };
  if (params.motivo) filter.motivo = params.motivo;
  if (params.sentimento) filter.sentimentoClasse = params.sentimento;
  const rows = await ChamadoIaAnalise.find(filter)
    .sort({ ticketCreatedAt: -1 })
    .limit(Math.min(200, Math.max(1, params.limit ?? 100)))
    .populate<{ chamadoId: IChamadoN1 }>('chamadoId')
    .lean();
  return rows
    .filter((row) => row.chamadoId)
    .map((row) => ({
      id: String(row.chamadoId._id),
      protocolo: row.chamadoProtocolo,
      titulo: row.chamadoId.chamadoTitulo,
      motivo: row.motivo,
      sentimento: row.sentimentoClasse,
      casoGrave: row.casoGrave,
      qualidadeFonte: row.qualidadeFonte,
      analisadoEm: row.analisadoEm,
    }));
}
