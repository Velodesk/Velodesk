/**
 * autonomyRules.service v2.0.0 — configuração e escopo do agente autônomo
 * VERSION: v2.0.0 | DATE: 2026-10-19
 *
 * Um ticket entra na fila do agente autônomo quando (1) o agente está ligado, (2) o canal de origem tem o switch
 * ligado e (3) a tabulação enviada pelo canal está coberta por uma regra: produto (obrigatório) > motivo > detalhe,
 * campo vazio = curinga para baixo. Nenhuma regra cadastrada = nada é autônomo. Decisão única, tomada na criação.
 */
import { AgentAutonomyRule, type IAgentAutonomyRule } from '../../models/AgentAutonomyRule';
import { getAgentesConfigModel, type AgentesModoEnvio, type IAgentesConfig } from '../../models/AgentesConfig';
import { CANAIS_AUTONOMOS } from '../../config/agenteAutonomo';
import { getActiveTabulation, type TabulationActiveDto } from '../tabulation.service';

export class AutonomyRuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AutonomyRuleValidationError';
  }
}

export interface AgentesConfigDto {
  autonomiaHabilitada: boolean;
  modoEnvio: AgentesModoEnvio;
  minAuditScoreEstrito: number;
  hidratacaoConsulta: boolean;
  canaisHabilitados: Record<string, boolean>;
  updatedAt?: Date;
  updatedBy?: string;
}

/** Um documento (singleton) por agente em acionamento_servicos. */
const CONFIG_KEY = 'agente_autonomo';
const CACHE_TTL_MS = 10_000;
let configCache: { at: number; value: AgentesConfigDto } | null = null;
const MODOS_ENVIO: AgentesModoEnvio[] = ['fila_aprovacao', 'envio_direto'];

function toConfigDto(doc: Pick<IAgentesConfig, 'autonomiaHabilitada' | 'modoEnvio' | 'minAuditScoreEstrito' | 'hidratacaoConsulta' | 'canaisHabilitados' | 'updatedAt' | 'updatedBy'> | null): AgentesConfigDto {
  return {
    autonomiaHabilitada: doc?.autonomiaHabilitada === true,
    modoEnvio: doc?.modoEnvio === 'envio_direto' ? 'envio_direto' : 'fila_aprovacao',
    minAuditScoreEstrito: typeof doc?.minAuditScoreEstrito === 'number' ? doc.minAuditScoreEstrito : 85,
    hidratacaoConsulta: doc?.hidratacaoConsulta === true,
    canaisHabilitados: Object.fromEntries(CANAIS_AUTONOMOS.map((c) => [c, doc?.canaisHabilitados?.[c] === true])),
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
  patch: { autonomiaHabilitada?: unknown; modoEnvio?: unknown; minAuditScoreEstrito?: unknown; hidratacaoConsulta?: unknown; canaisHabilitados?: unknown },
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
  if (patch.canaisHabilitados !== undefined) {
    const canais = patch.canaisHabilitados as Record<string, unknown> | null;
    if (!canais || typeof canais !== 'object') throw new AutonomyRuleValidationError('canaisHabilitados inválido');
    for (const [canal, ligado] of Object.entries(canais)) {
      if (!(CANAIS_AUTONOMOS as readonly string[]).includes(canal) || typeof ligado !== 'boolean') {
        throw new AutonomyRuleValidationError(`Canal inválido: ${canal}`);
      }
      $set[`canaisHabilitados.${canal}`] = ligado;
    }
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
  const rules = await AgentAutonomyRule.find().sort({ createdAt: -1 }).lean();
  return rules as unknown as IAgentAutonomyRule[];
}

function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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

/** A regra cobre a tabulação: produto igual e, se a regra definir motivo/detalhe, também iguais (textos da árvore). */
function ruleCoversTabulacao(
  rule: Partial<IAgentAutonomyRule>,
  tab: { produto?: string; motivo?: string; detalhe?: string },
): boolean {
  if (!normalizeText(rule.produto) || normalizeText(rule.produto) !== normalizeText(tab.produto)) return false;
  if (normalizeText(rule.motivo) && normalizeText(rule.motivo) !== normalizeText(tab.motivo)) return false;
  if (normalizeText(rule.detalhe) && normalizeText(rule.detalhe) !== normalizeText(tab.detalhe)) return false;
  return true;
}

/**
 * Decisão única de escopo, tomada na criação do ticket: agente ligado + canal liberado + tabulação de origem coberta
 * por uma regra ativa. Retorna a regra mais específica que cobre o caso, ou null (ticket segue a fila convencional).
 */
export async function resolveEscopoAutonomo(
  canal: string,
  tab: { produto?: string; motivo?: string; detalhe?: string },
): Promise<{ ruleId?: string } | null> {
  try {
    const config = await getAgentesConfig();
    if (!config.autonomiaHabilitada || config.canaisHabilitados[canal] !== true) return null;
    const regras = (await listAutonomyRules())
      .filter((r) => r.enabled !== false)
      .sort((a, b) => specificity(b) - specificity(a));
    const rule = regras.find((r) => ruleCoversTabulacao(r, tab));
    return rule ? { ruleId: rule._id?.toString?.() } : null;
  } catch (err) {
    console.warn('[agent-autonomo] escopo indisponível — ticket segue a fila convencional:', (err as Error)?.message);
    return null;
  }
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
