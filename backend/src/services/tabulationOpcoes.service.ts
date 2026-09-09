/** tabulationOpcoes.service v1.2.0 — motivos por órgão + seed RA/Procon/Bacen */
import { Types } from 'mongoose';
import {
  getTabulacaoOpcoesModel,
  TABULACAO_OPCOES_CATEGORIAS,
  type ITabulacaoOpcaoItem,
  type ITabulacaoOpcoes,
  type TabulacaoOpcoesCategoria,
} from '../models/TabulacaoOpcoes';

export interface TabulacaoOpcaoItemDto {
  _id: string;
  valor: string;
  ordem: number;
  ativo: boolean;
}

export interface TabulacaoOpcoesDto {
  _id: string;
  categoria: TabulacaoOpcoesCategoria;
  opcoes: TabulacaoOpcaoItemDto[];
}

export interface TabulacaoOpcoesActiveDto {
  tipoChamado: string[];
  canalContato: string[];
}

const VALID_CATEGORIAS = new Set<string>(Object.values(TABULACAO_OPCOES_CATEGORIAS));

let cachedActiveOpcoes: TabulacaoOpcoesActiveDto | null = null;

export function invalidateTabulationOpcoesCache(): void {
  cachedActiveOpcoes = null;
}

function assertCategoria(categoria: string): TabulacaoOpcoesCategoria {
  const key = String(categoria || '').trim();
  if (!VALID_CATEGORIAS.has(key)) {
    throw new Error('Categoria de opções inválida');
  }
  return key as TabulacaoOpcoesCategoria;
}

function sortByOrdem(items: ITabulacaoOpcaoItem[]): ITabulacaoOpcaoItem[] {
  return [...items].sort((a, b) => {
    const ordemDiff = (a.ordem ?? 0) - (b.ordem ?? 0);
    if (ordemDiff !== 0) return ordemDiff;
    return (a.valor || '').localeCompare(b.valor || '', 'pt-BR');
  });
}

function resolveId(value: { _id?: Types.ObjectId; id?: string } | null | undefined): string {
  const id = value?._id ?? value?.id;
  return id ? String(id) : '';
}

function itemToDto(item: ITabulacaoOpcaoItem): TabulacaoOpcaoItemDto {
  return {
    _id: resolveId(item),
    valor: item.valor,
    ordem: item.ordem ?? 0,
    ativo: item.ativo !== false,
  };
}

async function ensureOpcoesItemIds(doc: ITabulacaoOpcoes): Promise<void> {
  let changed = false;
  for (const item of doc.opcoes || []) {
    if (!item._id) {
      item._id = new Types.ObjectId();
      changed = true;
    }
  }
  if (changed) {
    doc.markModified('opcoes');
    await doc.save();
  }
}

function docToDto(doc: ITabulacaoOpcoes): TabulacaoOpcoesDto {
  return {
    _id: resolveId(doc),
    categoria: doc.categoria,
    opcoes: sortByOrdem(doc.opcoes || []).map(itemToDto),
  };
}

function activeValues(items: ITabulacaoOpcaoItem[]): string[] {
  return sortByOrdem(items)
    .filter((item) => item.ativo !== false)
    .map((item) => item.valor);
}

async function getOrCreateDoc(categoria: TabulacaoOpcoesCategoria): Promise<ITabulacaoOpcoes> {
  const Model = getTabulacaoOpcoesModel();
  let doc = await Model.findOne({ categoria });
  if (!doc) {
    doc = await Model.create({ categoria, opcoes: [], updatedBy: 'sistema' });
  }
  return doc;
}

export const MOTIVO_RECLAME_AQUI_SEED = [
  'Reativação cadastral',
  'Alteração cadastral',
  'Abatimento de Juros',
  'Valor mínimo para contratação',
  'Limite baixo do pix',
  'Portabilidade Pix',
  'Em cobrança',
  'Cancelamento até 7 dias',
  'Cancelamento sup. 7 dias',
  'Erro Gov',
  'Não Elegível a crédito',
  'Alega Fraude',
  'Desativado',
  'Dívida Prescrita',
  'Dúvidas Gerais',
  'Encerramento conta App',
  'Encerramento conta Celcoin',
  'Erro app',
  'Liberação chave pix',
  'Juros Abusivo',
  'Quitação do contrato',
  'Quitação automática sem chave pix',
];

/** Motivos oficiais Procon e Bacen (casos especiais). */
export const MOTIVO_PROCON_BACEN_SEED = [
  'Liberação Chave Pix',
  'Portabilidade Chave Pix',
  'Abatimento de Juros',
  'Juros Abusivos',
  'Cancelamento Até 7 Dias',
  'Cancelamento Superior a 7 Dias',
  'Quitação de Contrato',
  'Quitação Automática Sem Chave Pix',
  'Em Cobrança',
  'Alega Fraude',
  'Erro App',
  'Elegibilidade',
  'Encerramento Cta Celcoin',
  'Encerramento Cta App',
  'Superendividamento',
];

function mapSeedToOpcoes(valores: string[]): ITabulacaoOpcaoItem[] {
  return valores.map((valor, ordem) => ({
    valor,
    ordem,
    ativo: true,
  })) as ITabulacaoOpcaoItem[];
}

async function seedOrgaoMotivosIfEmpty(
  doc: ITabulacaoOpcoes,
  valores: string[],
): Promise<boolean> {
  if (doc.opcoes?.length) return false;
  doc.opcoes = mapSeedToOpcoes(valores);
  doc.updatedBy = 'seed';
  await doc.save();
  return true;
}

const ORGAO_MOTIVO_CATEGORIAS: TabulacaoOpcoesCategoria[] = [
  TABULACAO_OPCOES_CATEGORIAS.MOTIVO_RECLAME_AQUI,
  TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON,
  TABULACAO_OPCOES_CATEGORIAS.MOTIVO_CONSUMIDOR_GOV,
  TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN,
];

export async function ensureOrgaoMotivoCategorias(): Promise<{ seeded: string[] }> {
  const seeded: string[] = [];
  for (const categoria of ORGAO_MOTIVO_CATEGORIAS) {
    const doc = await getOrCreateDoc(categoria);
    let didSeed = false;

    if (categoria === TABULACAO_OPCOES_CATEGORIAS.MOTIVO_RECLAME_AQUI) {
      didSeed = await seedOrgaoMotivosIfEmpty(doc, MOTIVO_RECLAME_AQUI_SEED);
    } else if (categoria === TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON) {
      didSeed = await seedOrgaoMotivosIfEmpty(doc, MOTIVO_PROCON_BACEN_SEED);
    } else if (categoria === TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN) {
      didSeed = await seedOrgaoMotivosIfEmpty(doc, MOTIVO_PROCON_BACEN_SEED);
    }

    if (didSeed) seeded.push(categoria);
  }
  if (seeded.length) invalidateTabulationOpcoesCache();
  return { seeded };
}

export async function listOpcoes(includeInactive = true): Promise<TabulacaoOpcoesDto[]> {
  await ensureOrgaoMotivoCategorias();
  const Model = getTabulacaoOpcoesModel();
  const docs = await Model.find({}).sort({ categoria: 1 });
  for (const doc of docs) {
    await ensureOpcoesItemIds(doc);
  }
  const mapped = docs.map(docToDto).filter((doc) => doc._id && doc.categoria);
  if (includeInactive) return mapped;

  return mapped.map((doc) => ({
    ...doc,
    opcoes: doc.opcoes.filter((item) => item.ativo !== false),
  }));
}

export async function getOpcoesByCategoria(
  categoriaInput: string,
  includeInactive = true
): Promise<TabulacaoOpcoesDto | null> {
  const categoria = assertCategoria(categoriaInput);
  await ensureOrgaoMotivoCategorias();
  const Model = getTabulacaoOpcoesModel();
  const doc = await Model.findOne({ categoria });
  if (!doc) return null;
  await ensureOpcoesItemIds(doc);
  const dto = docToDto(doc);
  if (includeInactive) return dto;
  return {
    ...dto,
    opcoes: dto.opcoes.filter((item) => item.ativo !== false),
  };
}

export async function getActiveOpcoes(): Promise<TabulacaoOpcoesActiveDto> {
  if (cachedActiveOpcoes) return cachedActiveOpcoes;

  const Model = getTabulacaoOpcoesModel();
  const docs = await Model.find({});
  const byCategoria = new Map(docs.map((doc) => [doc.categoria, doc]));

  const tipoDoc = byCategoria.get(TABULACAO_OPCOES_CATEGORIAS.TIPO_CHAMADO);
  const canalDoc = byCategoria.get(TABULACAO_OPCOES_CATEGORIAS.CANAL_CONTATO);

  cachedActiveOpcoes = {
    tipoChamado: activeValues(tipoDoc?.opcoes || []),
    canalContato: activeValues(canalDoc?.opcoes || []),
  };
  return cachedActiveOpcoes;
}

export async function createOpcaoItem(
  categoriaInput: string,
  body: { valor: string; ordem?: number; ativo?: boolean },
  updatedBy: string
): Promise<TabulacaoOpcoesDto> {
  const categoria = assertCategoria(categoriaInput);
  const valor = String(body.valor || '').trim();
  if (!valor) throw new Error('Valor da opção é obrigatório');

  const doc = await getOrCreateDoc(categoria);
  const duplicate = (doc.opcoes || []).some(
    (item) => item.valor.localeCompare(valor, 'pt-BR', { sensitivity: 'accent' }) === 0
  );
  if (duplicate) throw new Error('Opção já cadastrada');

  let ordem = body.ordem;
  if (ordem === undefined) {
    const last = sortByOrdem(doc.opcoes || []).at(-1);
    ordem = (last?.ordem ?? -1) + 1;
  }

  doc.opcoes.push({
    valor,
    ordem,
    ativo: body.ativo !== false,
  } as ITabulacaoOpcaoItem);
  doc.updatedBy = updatedBy;
  await doc.save();
  invalidateTabulationOpcoesCache();
  return docToDto(doc);
}

export async function updateOpcaoItem(
  categoriaInput: string,
  itemId: string,
  body: { valor?: string; ordem?: number; ativo?: boolean },
  updatedBy: string
): Promise<TabulacaoOpcoesDto | null> {
  const categoria = assertCategoria(categoriaInput);
  const Model = getTabulacaoOpcoesModel();
  const doc = await Model.findOne({ categoria });
  if (!doc) return null;

  const item = doc.opcoes.find((entry) => entry._id.toString() === itemId);
  if (!item) return null;

  if (body.valor !== undefined) {
    const valor = String(body.valor).trim();
    if (!valor) throw new Error('Valor da opção é obrigatório');
    const duplicate = doc.opcoes.some(
      (entry) =>
        entry._id.toString() !== itemId
        && entry.valor.localeCompare(valor, 'pt-BR', { sensitivity: 'accent' }) === 0
    );
    if (duplicate) throw new Error('Opção já cadastrada');
    item.valor = valor;
  }
  if (body.ordem !== undefined) item.ordem = body.ordem;
  if (body.ativo !== undefined) item.ativo = body.ativo;
  doc.updatedBy = updatedBy;

  await doc.save();
  invalidateTabulationOpcoesCache();
  return docToDto(doc);
}

export async function deleteOpcaoItem(
  categoriaInput: string,
  itemId: string
): Promise<boolean> {
  const categoria = assertCategoria(categoriaInput);
  const Model = getTabulacaoOpcoesModel();
  const doc = await Model.findOne({ categoria });
  if (!doc) return false;

  const beforeCount = doc.opcoes.length;
  doc.opcoes = doc.opcoes.filter((entry) => entry._id.toString() !== itemId);
  if (doc.opcoes.length === beforeCount) return false;
  await doc.save();
  invalidateTabulationOpcoesCache();
  return true;
}

export const DEFAULT_TABULACAO_OPCOES: Array<{
  categoria: TabulacaoOpcoesCategoria;
  opcoes: Array<{ valor: string; ordem: number; ativo: boolean }>;
}> = [
  {
    categoria: TABULACAO_OPCOES_CATEGORIAS.TIPO_CHAMADO,
    opcoes: [
      { valor: 'Reclamação', ordem: 0, ativo: true },
      { valor: 'Solicitação', ordem: 1, ativo: true },
      { valor: 'Dúvida', ordem: 2, ativo: true },
      { valor: 'Informação', ordem: 3, ativo: true },
    ],
  },
  {
    categoria: TABULACAO_OPCOES_CATEGORIAS.CANAL_CONTATO,
    opcoes: [
      { valor: 'WhatsApp', ordem: 0, ativo: true },
      { valor: 'Telefone', ordem: 1, ativo: true },
      { valor: 'E-mail', ordem: 2, ativo: true },
    ],
  },
  {
    categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_RECLAME_AQUI,
    opcoes: MOTIVO_RECLAME_AQUI_SEED.map((valor, ordem) => ({ valor, ordem, ativo: true })),
  },
  {
    categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_PROCON,
    opcoes: MOTIVO_PROCON_BACEN_SEED.map((valor, ordem) => ({ valor, ordem, ativo: true })),
  },
  {
    categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_CONSUMIDOR_GOV,
    opcoes: [],
  },
  {
    categoria: TABULACAO_OPCOES_CATEGORIAS.MOTIVO_BACEN,
    opcoes: MOTIVO_PROCON_BACEN_SEED.map((valor, ordem) => ({ valor, ordem, ativo: true })),
  },
];
