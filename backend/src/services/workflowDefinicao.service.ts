/** workflowDefinicao.service v2.0.0 — ensurePassoIds recursivo (bifurcação em árvore); validateWorkflowPassos removida (etapas aninhadas nunca ficam órfãs) */
import { migratePassoAutomaticaConfig } from './workflowAutomatica.util';
import { Types } from 'mongoose';
import { normalizeRequisicaoConfig } from '../config/workflowRequisicaoDefaults';
import {
  getWorkflowDefinicaoModel,
  IWorkflowDefinicao,
  IWorkflowGatilho,
  IWorkflowPassoEnvelope,
} from '../models/WorkflowDefinicao';
import { evaluateGatilhoCriterios, buildTabulationFieldsFromTicket } from './workflowMatcher.service';

let cachedActive: IWorkflowDefinicao[] | null = null;

export function invalidateWorkflowCache(): void {
  cachedActive = null;
}

function sortPassos(passos: IWorkflowPassoEnvelope[] = []): IWorkflowPassoEnvelope[] {
  return [...passos].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

function sanitizePassoConfig(passo: IWorkflowPassoEnvelope['passo']): IWorkflowPassoEnvelope['passo'] {
  const raw = { ...(passo || {}) } as Record<string, unknown>;
  delete raw.icone;
  delete raw.criterios;
  migratePassoAutomaticaConfig(raw);
  return raw as unknown as IWorkflowPassoEnvelope['passo'];
}

/**
 * Garante `_id`/`ordem` e sanitiza cada etapa, descendo recursivamente pelas
 * sub-listas de cada rota (`rota.passos`) — bifurcação real: uma etapa dentro
 * de um ramo pode ela mesma ser uma etapa de aprovação com seus próprios
 * sub-ramos, então isso precisa se aplicar em qualquer profundidade.
 */
function ensurePassoIds(passos: IWorkflowPassoEnvelope[] = []): IWorkflowPassoEnvelope[] {
  return sortPassos(passos).map((envelope, index) => {
    const passo = sanitizePassoConfig(envelope.passo);
    if (passo?.acao?.tipo === 'aprovacao' && Array.isArray(passo.acao.rotas)) {
      passo.acao = {
        ...passo.acao,
        rotas: passo.acao.rotas.map((rota) => ({
          ...rota,
          passos: ensurePassoIds(rota.passos || []),
        })),
      };
    }
    return {
      ...envelope,
      ordem: index,
      _id: envelope._id ? new Types.ObjectId(String(envelope._id)) : new Types.ObjectId(),
      passo,
    };
  });
}

function normalizePassoInicialId(
  passos: IWorkflowPassoEnvelope[],
  passoInicialId?: Types.ObjectId | string | null,
): Types.ObjectId | null {
  const sorted = sortPassos(passos);
  if (passoInicialId) {
    const found = sorted.find((p) => String(p._id) === String(passoInicialId));
    if (found?._id) return found._id as Types.ObjectId;
  }
  return (sorted[0]?._id as Types.ObjectId) || null;
}

function normalizeGatilho(gatilho?: Partial<IWorkflowGatilho> | null): IWorkflowGatilho {
  return {
    tipo: String(gatilho?.tipo || 'tabulacao'),
    criterios: Array.isArray(gatilho?.criterios) ? gatilho.criterios : [],
  };
}

function normalizeFuncoesAdicionais(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    const slug = String(item ?? '').trim().toLowerCase();
    if (slug) seen.add(slug);
  }
  return Array.from(seen);
}

export async function listWorkflows(includeInactive = false): Promise<IWorkflowDefinicao[]> {
  const Model = getWorkflowDefinicaoModel();
  const filter = includeInactive ? {} : { ativo: true };
  const docs = await Model.find(filter).sort({ ordem: 1, titulo: 1 }).lean();
  return docs as unknown as IWorkflowDefinicao[];
}

export async function getActiveWorkflows(): Promise<IWorkflowDefinicao[]> {
  if (cachedActive) return cachedActive;
  cachedActive = await listWorkflows(false);
  return cachedActive;
}

export async function getWorkflowById(id: string): Promise<IWorkflowDefinicao | null> {
  const Model = getWorkflowDefinicaoModel();
  return Model.findById(id).lean() as Promise<IWorkflowDefinicao | null>;
}

export async function getWorkflowsByIds(ids: string[]): Promise<Map<string, IWorkflowDefinicao>> {
  const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  const map = new Map<string, IWorkflowDefinicao>();
  if (!unique.length) return map;

  const objectIds = unique
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  if (!objectIds.length) return map;

  const Model = getWorkflowDefinicaoModel();
  const docs = await Model.find({ _id: { $in: objectIds } }).lean();
  docs.forEach((doc) => {
    map.set(String(doc._id), doc as unknown as IWorkflowDefinicao);
  });
  return map;
}

export async function getWorkflowBySlug(slug: string): Promise<IWorkflowDefinicao | null> {
  const Model = getWorkflowDefinicaoModel();
  return Model.findOne({ slug: String(slug).trim().toLowerCase() }).lean() as Promise<IWorkflowDefinicao | null>;
}

function normalizeRequisicaoForSave(
  requisicao: Partial<IWorkflowDefinicao>['requisicao'],
  gatilho?: IWorkflowGatilho | null,
) {
  return normalizeRequisicaoConfig(requisicao, gatilho);
}

export async function createWorkflow(
  payload: Partial<IWorkflowDefinicao>,
  updatedBy: string,
): Promise<IWorkflowDefinicao> {
  const Model = getWorkflowDefinicaoModel();
  const slug = String(payload.slug || '').trim().toLowerCase();
  if (!slug) throw new Error('Informe o slug do workflow.');
  const exists = await Model.findOne({ slug }).select('_id').lean();
  if (exists) throw new Error('Workflow já cadastrado.');

  const passos = ensurePassoIds(payload.passos || []);
  const passoInicialId = normalizePassoInicialId(passos, payload.passoInicialId);
  const gatilho = normalizeGatilho(payload.gatilho);

  const doc = await Model.create({
    slug,
    titulo: String(payload.titulo || '').trim(),
    descricao: String(payload.descricao || '').trim(),
    ordem: payload.ordem ?? 0,
    ativo: payload.ativo !== false,
    gatilho,
    requisicao: normalizeRequisicaoForSave(payload.requisicao, gatilho),
    passos,
    passoInicialId,
    // Todo workflow novo já nasce visível/decidível pra gestão, além de quem for atribuído
    // por etapa — não depende de configuração manual (funcoesAdicionais nunca fica vazio).
    funcoesAdicionais: normalizeFuncoesAdicionais([...(payload.funcoesAdicionais || []), 'gestao']),
    updatedBy,
  });
  invalidateWorkflowCache();
  return doc.toObject() as IWorkflowDefinicao;
}

export async function replaceWorkflow(
  id: string,
  payload: Partial<IWorkflowDefinicao>,
  updatedBy: string,
): Promise<IWorkflowDefinicao | null> {
  const Model = getWorkflowDefinicaoModel();
  const passos = ensurePassoIds(payload.passos || []);
  const passoInicialId = normalizePassoInicialId(passos, payload.passoInicialId);
  const gatilho = normalizeGatilho(payload.gatilho);

  // A tela de edição de workflows ainda não manda funcoesAdicionais — sem essa checagem,
  // qualquer salvamento normal (editar etapas, etc.) apagaria a configuração de gestão.
  // Só sobrescreve quando o payload explicitamente informar o campo.
  const funcoesAdicionaisUpdate = payload.funcoesAdicionais !== undefined
    ? { funcoesAdicionais: normalizeFuncoesAdicionais(payload.funcoesAdicionais) }
    : {};

  const doc = await Model.findByIdAndUpdate(
    id,
    {
      slug: String(payload.slug || '').trim().toLowerCase(),
      titulo: String(payload.titulo || '').trim(),
      descricao: String(payload.descricao || '').trim(),
      ordem: payload.ordem ?? 0,
      ativo: payload.ativo !== false,
      gatilho,
      requisicao: normalizeRequisicaoForSave(payload.requisicao, gatilho),
      passos,
      passoInicialId,
      ...funcoesAdicionaisUpdate,
      updatedBy,
    },
    { new: true, runValidators: true },
  ).lean();
  invalidateWorkflowCache();
  return doc as IWorkflowDefinicao | null;
}

export async function patchWorkflow(
  id: string,
  payload: Partial<IWorkflowDefinicao>,
  updatedBy: string,
): Promise<IWorkflowDefinicao | null> {
  const Model = getWorkflowDefinicaoModel();
  const patch: Record<string, unknown> = { updatedBy };
  if (payload.ativo !== undefined) patch.ativo = payload.ativo;
  if (payload.ordem !== undefined) patch.ordem = payload.ordem;
  if (payload.titulo !== undefined) patch.titulo = payload.titulo;
  if (payload.descricao !== undefined) patch.descricao = payload.descricao;
  if (payload.funcoesAdicionais !== undefined) {
    patch.funcoesAdicionais = normalizeFuncoesAdicionais(payload.funcoesAdicionais);
  }

  const doc = await Model.findByIdAndUpdate(id, patch, { new: true }).lean();
  invalidateWorkflowCache();
  return doc as IWorkflowDefinicao | null;
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const Model = getWorkflowDefinicaoModel();
  const result = await Model.findByIdAndDelete(id);
  invalidateWorkflowCache();
  return Boolean(result);
}

export async function resolveWorkflowForTicket(ticket: {
  tabulacao?: Array<Record<string, string>>;
  lateralForm?: Record<string, unknown>;
}): Promise<IWorkflowDefinicao | null> {
  const fields = buildTabulationFieldsFromTicket(ticket);
  const workflows = await getActiveWorkflows();

  return workflows.find(
    (wf) => evaluateGatilhoCriterios(wf.gatilho?.criterios || [], fields),
  ) || null;
}

function normalizeFuncaoSlug(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Workflow cuja definição pertence à função (slug escalonar-{funcao} ou passo atribuído ao grupo). */
export function workflowDefinitionMatchesFuncao(
  definicao: IWorkflowDefinicao,
  funcaoSlugs: string[],
): boolean {
  const funcoes = new Set(
    (funcaoSlugs || []).map(normalizeFuncaoSlug).filter(Boolean),
  );
  if (!funcoes.size) return false;

  const slug = normalizeFuncaoSlug(definicao.slug);
  for (const funcao of funcoes) {
    if (slug === funcao || slug === `escalonar-${funcao}`) return true;
  }

  const extras = (definicao.funcoesAdicionais || []).map(normalizeFuncaoSlug);
  if (extras.some((f) => funcoes.has(f))) return true;

  return (definicao.passos || []).some((envelope) => {
    const atribuicao = envelope.passo?.atribuicao;
    if (!atribuicao) return false;
    const grupo = normalizeFuncaoSlug(atribuicao.grupoSlug);
    const funcao = normalizeFuncaoSlug(atribuicao.funcaoSlug);
    return (grupo && funcoes.has(grupo)) || (funcao && funcoes.has(funcao));
  });
}

/** IDs de definições visíveis na fila workflow de cada função (escalonar + passos do time). */
export async function resolveWorkflowDefinitionIdsForFuncoes(
  funcaoSlugs: string[],
): Promise<string[]> {
  const funcoes = [
    ...new Set(
      (funcaoSlugs || [])
        .map(normalizeFuncaoSlug)
        .filter(Boolean),
    ),
  ];
  if (!funcoes.length) return [];

  try {
    const all = await listWorkflows(true);
    return all
      .filter((wf) => workflowDefinitionMatchesFuncao(wf, funcoes))
      .map((wf) => String(wf._id));
  } catch (err) {
    console.warn(
      '[workflow] não foi possível carregar definições para filtro de fila:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
