/**
 * reclamacaoModels v1.1.0 — Reclame Aqui ganha schema próprio (ReclamacaoReclameAquiSchema,
 * campos de primeira classe); Procon/Bacen/Consumidor.gov continuam no ReclamacaoBaseSchema
 * genérico, inalterados.
 */
import type { Model } from 'mongoose';
import { getReclamacoesConnection } from '../../config/database';
import {
  ReclamacaoBaseSchema,
  type IReclamacao,
} from './ReclamacaoBase.schema';
import {
  ReclamacaoReclameAquiSchema,
  type IReclamacaoReclameAqui,
} from './ReclamacaoReclameAqui.schema';

const MODEL_CONFIG = {
  ReclamacaoProcon: 'reclamacoes_procon',
  ReclamacaoBacen: 'reclamacoes_bacen',
  ReclamacaoConsumidorGov: 'reclamacoes_consumidorGov',
} as const;

type ReclamacaoModelName = keyof typeof MODEL_CONFIG;

function getReclamacaoModel(modelName: ReclamacaoModelName): Model<IReclamacao> {
  const conn = getReclamacoesConnection();
  const collection = MODEL_CONFIG[modelName];
  if (conn.models[modelName]) {
    return conn.models[modelName] as Model<IReclamacao>;
  }
  return conn.model<IReclamacao>(modelName, ReclamacaoBaseSchema, collection);
}

const RA_MODEL_NAME = 'ReclamacaoReclameAqui';
const RA_COLLECTION = 'reclamacoes_reclameAqui';

export function getReclamacaoReclameAquiModel(): Model<IReclamacaoReclameAqui> {
  const conn = getReclamacoesConnection();
  if (conn.models[RA_MODEL_NAME]) {
    return conn.models[RA_MODEL_NAME] as Model<IReclamacaoReclameAqui>;
  }
  return conn.model<IReclamacaoReclameAqui>(RA_MODEL_NAME, ReclamacaoReclameAquiSchema, RA_COLLECTION);
}

export function getReclamacaoProconModel(): Model<IReclamacao> {
  return getReclamacaoModel('ReclamacaoProcon');
}

export function getReclamacaoBacenModel(): Model<IReclamacao> {
  return getReclamacaoModel('ReclamacaoBacen');
}

export function getReclamacaoConsumidorGovModel(): Model<IReclamacao> {
  return getReclamacaoModel('ReclamacaoConsumidorGov');
}

export type { IReclamacao };
export type { IReclamacaoReclameAqui };
