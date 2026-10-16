/**
 * autonomyRules.service v1.1.0 — allowlist de envio autônomo pela árvore de tabulação
 * VERSION: v1.1.0 | DATE: 2026-10-07
 *
 * - Escopo: produto (obrigatório) > motivo > detalhe; campo vazio = curinga para baixo.
 * - Escrita validada contra a árvore ativa (getActiveTabulation).
 * - Regra mais específica vence; prioridade só desempata.
 * - Sem fallback de regras padrão: nenhuma regra cadastrada = nada é autônomo.
 */
import { AgentAutonomyRule, type IAgentAutonomyRule } from '../../models/AgentAutonomyRule';
import { getAgentesConfigModel, type AgentesModoEnvio, type IAgentesConfig } from '../../models/AgentesConfig';
import { env } from '../../config/env';
import { getActiveTabulation, type TabulationActiveDto } from '../tabulation.service';
import type { TicketAiTabulationResult } from './agentTypes';
import { hasCriticalKeywords } from './criticalKeywords.service';

export class AutonomyRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutonomyRuleValidationError';
  }
}

export interface AutonomyEvaluateInput {
  tabulacao: TicketAiTabulationResult;
  canal?: string;
  threadMessageCount: number;
  auditScore: number;
  clientContext?: string;
  responseText?: string;
}

export interface AutonomyEvaluateResult {
  allowed: boolean;
  matchedRuleId?: string;
  modoEnvio?: AgentesModoEnvio;
  minAuditScoreEstrito?: number;
  reason?: string;
}

export interface AgentesConfigDto {
  autonomiaHabilitada: boolean;
  modoEnvio: AgentesModoEnvio;
  minAuditScoreEstrito: number;
  hidratacaoConsulta: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

/** Um documento (singleton) por agente em acionamento_servicos. */
const CONFIG_KEY = 'agente_autonomo';
const CACHE_TTL_MS = 10_000;
let configCache: { at: number; value: AgentesConfigDto } | null = null;
const MODOS_ENVIO: AgentesModoEnvio[] = ['fila_aprovacao', 'envio_direto'];

function toConfigDto(doc: Pick<IAgentesConfig, 'autonomiaHabilitada' | 'modoEnvio' | 'minAuditScoreEstrito' | 'hidratacaoConsulta' | 'updatedAt' | 'updatedBy'> | null): AgentesConfigDto {
  return {
    autonomiaHabilitada: doc?.autonomiaHabilitada === true,
    modoEnvio: doc?.modoEnvio === 'envio_direto' ? 'envio_direto' : 'fila_aprovacao',
    minAuditScoreEstrito: typeof doc?.minAuditScoreEstrito === 'number' ? doc.minAuditScoreEstrito : 95,
    hidratacaoConsulta: doc?.hidratacaoConsulta === true,
    updatedAt: doc?.updatedAt,
    updatedBy: doc?.updatedBy,
  };
}

export async function getAgentesConfig(opts: { fresh?: boolean } = {}): Promise<AgentesConfigDto> {
  if (!opts.fresh && configCache && Date.now() - configCache.at < CACHE_TTL_MS) return configCache.value;
  const doc = await getAgentesConfigModel().findOne({ key: CONFIG_KEY }).lean();
  const value = toConfigDto(doc as unknown as IAgentesConfig | null);
  configCache = { at: Date.now(), value };
  return value;
}

export async function updateAgentesConfig(
  patch: { autonomiaHabilitada?: unknown; modoEnvio?: unknown; minAuditScoreEstrito?: unknown; hidratacaoConsulta?: unknown },
  updatedBy: string,
): Promise<AgentesConfigDto> {
  const $set: Record<string, unknown> = { updatedBy };
  if (patch.autonomiaHabilitada !== undefined) {
    if (typeof patch.autonomiaHabilitada !== 'boolean') {
      throw new AutonomyRuleValidationError('autonomiaHabilitada deve ser booleano');
    }
    $set.autonomiaHabilitada = patch.autonomiaHabilitada;
  }
  if (patch.modoEnvio !== undefined) {
    if (!MODOS_ENVIO.includes(patch.modoEnvio as AgentesModoEnvio)) {
      throw new AutonomyRuleValidationError('modoEnvio inválido');
    }
    $set.modoEnvio = patch.modoEnvio;
  }
  if (patch.hidratacaoConsulta !== undefined) {
    if (typeof patch.hidratacaoConsulta !== 'boolean') {
      throw new AutonomyRuleValidationError('hidratacaoConsulta deve ser booleano');
    }
    $set.hidratacaoConsulta = patch.hidratacaoConsulta;
  }
  if (patch.minAuditScoreEstrito !== undefined) {
    $set.minAuditScoreEstrito = finiteNumber(patch.minAuditScoreEstrito, 'minAuditScoreEstrito', 50, 100);
  }
  const doc = await getAgentesConfigModel()
    .findOneAndUpdate({ key: CONFIG_KEY }, { $set, $setOnInsert: { key: CONFIG_KEY } }, { new: true, upsert: true })
    .lean();
  configCache = null;
  return toConfigDto(doc as unknown as IAgentesConfig | null);
}

export async function listAutonomyRules(): Promise<IAgentAutonomyRule[]> {
  const rules = await AgentAutonomyRule.find().sort({ prioridade: -1, createdAt: -1 }).lean();
  return rules as unknown as IAgentAutonomyRule[];
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item)).filter(Boolean);
}

function finiteNumber(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new AutonomyRuleValidationError(`${label} deve estar entre ${min} e ${max}`);
  }
  return n;
}

/** Garante que produto/motivo/detalhe existem (ativos) na árvore e respeitam a hierarquia. */
function assertScopeInTree(tree: TabulationActiveDto, produto: string, motivo: string, detalhe: string): void {
  if (!produto) throw new AutonomyRuleValidationError('Produto é obrigatório');
  if (!motivo && detalhe) throw new AutonomyRuleValidationError('Detalhe exige motivo');

  const prod = tree.produtos.find((p) => p.produto === produto && p.ativo);
  if (!prod) throw new AutonomyRuleValidationError(`Produto "${produto}" não existe na árvore de tabulação`);
  if (!motivo) return;

  const mot = (prod.motivos || []).find((m) => m.motivo === motivo && m.ativo !== false);
  if (!mot) throw new AutonomyRuleValidationError(`Motivo "${motivo}" não existe em "${produto}"`);
  if (!detalhe) return;

  const det = (mot.detalhes || []).find((d) => d.detalhe === detalhe && d.ativo !== false);
  if (!det) throw new AutonomyRuleValidationError(`Detalhe "${detalhe}" não existe em "${produto} > ${motivo}"`);
}

interface NormalizedRule {
  enabled?: boolean;
  produto: string;
  motivo: string;
  detalhe: string;
  minAuditScore?: number;
  maxMessagesInThread?: number;
  canais?: string[];
  bloqueios?: string[];
  prioridade?: number;
}

async function normalizeRuleInput(
  body: Record<string, unknown>,
  existing?: Partial<IAgentAutonomyRule> | null,
): Promise<NormalizedRule> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  const produto = has('produto') ? clean(body.produto) : clean(existing?.produto);
  const motivo = has('motivo') ? clean(body.motivo) : clean(existing?.motivo);
  const detalhe = has('detalhe') ? clean(body.detalhe) : clean(existing?.detalhe);

  assertScopeInTree(await getActiveTabulation(), produto, motivo, detalhe);

  const out: NormalizedRule = { produto, motivo, detalhe };
  if (has('enabled')) out.enabled = body.enabled !== false;
  const minAuditScore = finiteNumber(body.minAuditScore, 'minAuditScore', 0, 100);
  if (minAuditScore !== undefined) out.minAuditScore = minAuditScore;
  const maxMessages = finiteNumber(body.maxMessagesInThread, 'maxMessagesInThread', 1, 50);
  if (maxMessages !== undefined) out.maxMessagesInThread = maxMessages;
  const prioridade = finiteNumber(body.prioridade, 'prioridade', -1000, 1000);
  if (prioridade !== undefined) out.prioridade = prioridade;
  if (has('canais')) out.canais = cleanList(body.canais);
  if (has('bloqueios')) out.bloqueios = cleanList(body.bloqueios);
  return out;
}

export async function createAutonomyRule(body: Record<string, unknown>, by: string) {
  const data = await normalizeRuleInput(body);

  const dup = await AgentAutonomyRule.findOne({
    produto: data.produto,
    motivo: data.motivo || { $in: [null, ''] },
    detalhe: data.detalhe || { $in: [null, ''] },
  }).lean();
  if (dup) throw new AutonomyRuleValidationError('Já existe uma regra para este escopo');

  return AgentAutonomyRule.create({ ...data, createdBy: by, updatedBy: by });
}

export async function updateAutonomyRule(id: string, body: Record<string, unknown>, by: string) {
  const existing = await AgentAutonomyRule.findById(id).lean();
  if (!existing) return null;
  const data = await normalizeRuleInput(body, existing as unknown as IAgentAutonomyRule);

  const dup = await AgentAutonomyRule.findOne({
    _id: { $ne: id },
    produto: data.produto,
    motivo: data.motivo || { $in: [null, ''] },
    detalhe: data.detalhe || { $in: [null, ''] },
  }).lean();
  if (dup) throw new AutonomyRuleValidationError('Já existe uma regra para este escopo');

  return AgentAutonomyRule.findByIdAndUpdate(id, { ...data, updatedBy: by }, { new: true });
}

export async function deleteAutonomyRule(id: string) {
  return AgentAutonomyRule.findByIdAndDelete(id);
}

/** Quantos níveis da árvore a regra fixa (produto=1, +motivo=2, +detalhe=3). */
function specificity(rule: Partial<IAgentAutonomyRule>): number {
  if (clean(rule.detalhe)) return 3;
  if (clean(rule.motivo)) return 2;
  if (clean(rule.produto)) return 1;
  return 0;
}

function ruleMatches(
  rule: Partial<IAgentAutonomyRule>,
  input: AutonomyEvaluateInput,
): boolean {
  if (rule.enabled === false) return false;
  // Allowlist: sem produto não há escopo válido.
  if (!clean(rule.produto)) return false;
  if (input.auditScore < (rule.minAuditScore ?? env.agentAuditThresholdAuto)) return false;
  if (input.threadMessageCount > (rule.maxMessagesInThread ?? 2)) return false;

  if (clean(rule.produto) !== input.tabulacao.produto) return false;
  if (clean(rule.motivo) && clean(rule.motivo) !== input.tabulacao.motivo) return false;
  if (clean(rule.detalhe) && clean(rule.detalhe) !== input.tabulacao.detalhe) return false;

  if (rule.canais?.length) {
    const canal = String(input.canal || '').trim().toLowerCase();
    const allowed = rule.canais.map((c) => String(c).trim().toLowerCase());
    if (canal && !allowed.some((c) => canal.includes(c) || c.includes(canal))) return false;
  }

  const bloqueios = rule.bloqueios || [];
  if (bloqueios.length && hasCriticalKeywords(input.clientContext, input.responseText, bloqueios.join(' '))) {
    return false;
  }

  return true;
}

export async function evaluateAutonomy(input: AutonomyEvaluateInput): Promise<AutonomyEvaluateResult> {

  const config = await getAgentesConfig();
  if (!config.autonomiaHabilitada) {
    return { allowed: false, reason: 'Agente autônomo desligado na configuração' };
  }

  if (hasCriticalKeywords(input.clientContext, input.responseText)) {
    return { allowed: false, reason: 'Palavras críticas detectadas no contexto' };
  }

  const enabledRules = (await listAutonomyRules()).filter((r) => r.enabled !== false);
  if (enabledRules.length === 0) {
    return { allowed: false, reason: 'Nenhuma regra de autonomia cadastrada' };
  }

  const ordered = [...enabledRules].sort(
    (a, b) => specificity(b) - specificity(a) || (b.prioridade ?? 0) - (a.prioridade ?? 0),
  );
  for (const rule of ordered) {
    if (ruleMatches(rule, input)) {
      return {
        allowed: true,
        matchedRuleId: rule._id?.toString?.(),
        modoEnvio: config.modoEnvio,
        minAuditScoreEstrito: config.minAuditScoreEstrito,
      };
    }
  }

  return { allowed: false, reason: 'Nenhuma regra compatível com o caso' };
}

/** Interruptor do agente autônomo (lido do banco, cache de 10 s). Falha ao ler ⇒ desligado. */
export async function isAutonomyEnabled(): Promise<boolean> {
  try {
    return (await getAgentesConfig()).autonomiaHabilitada;
  } catch (err) {
    console.warn('[agent-autonomo] config indisponível — tratando como desligado:', (err as Error)?.message);
    return false;
  }
}

/** Hidratação do prompt com dados reais da conta (lido do banco, cache de 10 s). Falha ⇒ desligada. */
export async function isHidratacaoEnabled(): Promise<boolean> {
  try {
    return (await getAgentesConfig()).hidratacaoConsulta;
  } catch {
    return false;
  }
}
