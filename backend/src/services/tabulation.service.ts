/** tabulation.service v1.7.0 — CE: skip cascata POP; exige motivo do órgão */
import type { ITabulacao } from '../models/ChamadoN1';
import type { ITabulacaoDetalhe, ITabulacaoMotivo, ITabulacaoProduto } from '../models/TabulacaoProduto';
import { getTabulacaoProdutoModel } from '../models/TabulacaoProduto';
import { getActiveOpcoes, type TabulacaoOpcoesActiveDto } from './tabulationOpcoes.service';

export class TabulacaoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TabulacaoValidationError';
  }
}

const STATUSES_REQUIRING_TABULATION = new Set(['em-aberto', 'em-andamento', 'resolvido']);

function isCasosEspeciaisCanal(canal: string): boolean {
  const raw = String(canal || '').trim().toLowerCase();
  if (raw.includes('reclame') && raw.includes('aqui')) return true;
  if (raw.includes('procon')) return true;
  if (raw.includes('bacen')) return true;
  if (raw.includes('consumidor') && (raw.includes('gov') || raw.includes('.gov'))) return true;
  return false;
}
function activeMotivos(config: TabulationActiveDto, produtoName: string): string[] {
  const produto = config.produtos.find((item) => item.produto === produtoName && item.ativo);
  if (!produto) return [];
  return produto.motivos.filter((m) => m.ativo !== false).map((m) => m.motivo);
}

function activeDetalhes(config: TabulationActiveDto, produtoName: string, motivoName: string): string[] {
  const produto = config.produtos.find((item) => item.produto === produtoName && item.ativo);
  if (!produto) return [];
  const motivo = produto.motivos.find((m) => m.motivo === motivoName && m.ativo !== false);
  if (!motivo) return [];
  return (motivo.detalhes || []).filter((d) => d.ativo !== false).map((d) => d.detalhe);
}

export interface TabulationProdutoDto {
  _id: string;
  produto: string;
  ordem: number;
  ativo: boolean;
  apenasInterno: boolean;
  motivos: ITabulacaoMotivo[];
}

export interface TabulationActiveDto {
  produtos: TabulationProdutoDto[];
  opcoes: TabulacaoOpcoesActiveDto;
}

let cachedActive: TabulationActiveDto | null = null;

export function invalidateTabulationCache(): void {
  cachedActive = null;
}

function sortByOrdem<T extends { ordem: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.ordem - b.ordem);
}

function normalizeDetalhe(d: ITabulacaoDetalhe): ITabulacaoDetalhe {
  return {
    detalhe: d.detalhe,
    ordem: d.ordem ?? 0,
    ativo: d.ativo !== false,
  };
}

function normalizeMotivos(motivos: ITabulacaoMotivo[]): ITabulacaoMotivo[] {
  return sortByOrdem(motivos).map((m) => ({
    motivo: m.motivo,
    ordem: m.ordem ?? 0,
    ativo: m.ativo !== false,
    detalhes: sortByOrdem(m.detalhes || []).map(normalizeDetalhe),
  }));
}

function produtoToDto(doc: ITabulacaoProduto): TabulationProdutoDto {
  return {
    _id: doc._id.toString(),
    produto: doc.produto,
    ordem: doc.ordem,
    ativo: doc.ativo,
    apenasInterno: doc.apenasInterno === true,
    motivos: normalizeMotivos(doc.motivos || []),
  };
}

export async function listProdutos(includeInactive = true): Promise<TabulationProdutoDto[]> {
  const Model = getTabulacaoProdutoModel();
  const filter = includeInactive ? {} : { ativo: true };
  const docs = await Model.find(filter).sort({ ordem: 1, produto: 1 });
  return docs.map(produtoToDto);
}

/** Produtos elegíveis para consulta pela API externa (app): ativos e não marcados como uso interno. */
export async function listProdutosPublicos(): Promise<TabulationProdutoDto[]> {
  const produtos = await listProdutos(false);
  return produtos.filter((p) => !p.apenasInterno);
}

export async function getProdutoById(id: string): Promise<TabulationProdutoDto | null> {
  const Model = getTabulacaoProdutoModel();
  const doc = await Model.findById(id);
  return doc ? produtoToDto(doc) : null;
}

export async function getActiveTabulation(): Promise<TabulationActiveDto> {
  if (cachedActive) return cachedActive;
  const produtos = await listProdutos(false);
  let opcoes: TabulacaoOpcoesActiveDto = { tipoChamado: [], canalContato: [] };
  try {
    opcoes = await getActiveOpcoes();
  } catch (err) {
    console.error('[tabulation] opções indisponíveis — continuando só com produtos:', (err as Error)?.message);
  }
  cachedActive = { produtos, opcoes };
  return cachedActive;
}

export async function createProduto(
  body: { produto: string; ordem?: number; ativo?: boolean; apenasInterno?: boolean; motivos?: ITabulacaoMotivo[] },
  updatedBy: string
): Promise<TabulationProdutoDto> {
  const Model = getTabulacaoProdutoModel();
  const produto = String(body.produto || '').trim();
  if (!produto) throw new Error('Nome do produto é obrigatório');

  const existing = await Model.findOne({ produto });
  if (existing) throw new Error('Produto já cadastrado');

  let ordem = body.ordem;
  if (ordem === undefined) {
    const last = await Model.findOne().sort({ ordem: -1 }).select('ordem').lean();
    ordem = ((last as { ordem?: number } | null)?.ordem ?? -1) + 1;
  }

  const doc = await Model.create({
    produto,
    ordem,
    ativo: body.ativo !== false,
    apenasInterno: body.apenasInterno === true,
    motivos: normalizeMotivos(body.motivos || []),
    updatedBy,
  });
  invalidateTabulationCache();
  return produtoToDto(doc);
}

export async function replaceProduto(
  id: string,
  body: { produto?: string; ordem?: number; ativo?: boolean; apenasInterno?: boolean; motivos?: ITabulacaoMotivo[] },
  updatedBy: string
): Promise<TabulationProdutoDto | null> {
  const Model = getTabulacaoProdutoModel();
  const doc = await Model.findById(id);
  if (!doc) return null;

  if (body.produto !== undefined) {
    const produto = String(body.produto).trim();
    if (!produto) throw new Error('Nome do produto é obrigatório');
    const dup = await Model.findOne({ produto, _id: { $ne: id } });
    if (dup) throw new Error('Produto já cadastrado');
    doc.produto = produto;
  }
  if (body.ordem !== undefined) doc.ordem = body.ordem;
  if (body.ativo !== undefined) doc.ativo = body.ativo;
  if (body.apenasInterno !== undefined) doc.apenasInterno = body.apenasInterno;
  if (body.motivos !== undefined) doc.motivos = normalizeMotivos(body.motivos);
  doc.updatedBy = updatedBy;

  await doc.save();
  invalidateTabulationCache();
  return produtoToDto(doc);
}

export async function patchProduto(
  id: string,
  body: { produto?: string; ordem?: number; ativo?: boolean; apenasInterno?: boolean },
  updatedBy: string
): Promise<TabulationProdutoDto | null> {
  return replaceProduto(id, body, updatedBy);
}

export async function deleteProduto(id: string): Promise<boolean> {
  const Model = getTabulacaoProdutoModel();
  const result = await Model.findByIdAndDelete(id);
  if (result) invalidateTabulationCache();
  return Boolean(result);
}

export async function assertTabulacaoForStatus(tab: ITabulacao | undefined, status: string): Promise<void> {
  if (!STATUSES_REQUIRING_TABULATION.has(status)) return;

  const missing: string[] = [];
  const produto = String(tab?.produto ?? '').trim();
  const tipo = String(tab?.tipoChamado ?? '').trim();
  const motivo = String(tab?.motivo ?? '').trim();
  const detalhe = String(tab?.detalhe ?? '').trim();
  const canal = String(tab?.canal ?? '').trim().toLowerCase();
  const skipTreeMotivo = isCasosEspeciaisCanal(canal);

  if (!produto) missing.push('Produto');
  if (!tipo) missing.push('Tipo');

  if (skipTreeMotivo) {
    if (!motivo) missing.push('Motivo');
  } else if (produto) {
    const config = await getActiveTabulation();
    const motivos = activeMotivos(config, produto);
    if (motivos.length > 0 && !motivo) missing.push('Motivo');
    if (motivo) {
      const detalhes = activeDetalhes(config, produto, motivo);
      if (detalhes.length > 0 && !detalhe) missing.push('Detalhe');
    }
  }

  if (missing.length) {
    throw new TabulacaoValidationError(
      `Preencha a tabulação antes de enviar: ${missing.join(', ')}.`
    );
  }
}

export function validateComboSoft(
  config: TabulationActiveDto,
  produto: string,
  motivo: string,
  detalhe: string
): boolean {
  if (!produto) return true;
  const p = config.produtos.find((item) => item.produto === produto && item.ativo);
  if (!p) return false;
  if (!motivo) return true;
  const m = p.motivos.find((item) => item.motivo === motivo && item.ativo);
  if (!m) return false;
  if (!detalhe) return true;
  return (m.detalhes || []).some((item) => item.detalhe === detalhe && item.ativo);
}

