/**
 * shared/registro.schema v1.0.0 — extraído de ChamadoN1.ts pra ser reaproveitado por coleções
 * próprias de casos especiais (Fase 3 da separação de persistência) sem duplicar a definição.
 * ChamadoN1.ts reexporta estes símbolos por compatibilidade — nenhum import existente quebra.
 */
import { Schema } from 'mongoose';

/** Valores canônicos de registro.status */
export const CHAMADO_STATUS_VALUES = [
  'novo',
  'em-aberto',
  'em-andamento',
  'em-espera',
  'pendente',
  'resolvido',
  'cancelado',
  'fechado',
] as const;

export type ChamadoStatus = (typeof CHAMADO_STATUS_VALUES)[number];

export interface IRegistro {
  data: Date;
  origin: string;
  autor: string;
  mensagemPublica: string;
  anexosMensagemPublica: string[];
  anotacaoInterna: string;
  anexosAnotacaoInterna: string[];
  /** Histórico de campos alterados neste evento (valores novos). */
  alteracoes: unknown[];
  /** Metadados técnicos do evento (ex.: e-mail inbound), fora do histórico de negócio. */
  metadados: Record<string, unknown>;
  status: string;
}

export interface ITabulacao {
  tipoChamado: string;
  produto: string;
  motivo: string;
  /** Motivo 2/3 — tabulações adicionais só usadas hoje por Bacen e Consumidor.gov. */
  motivo2?: string;
  motivo3?: string;
  detalhe: string;
  canal: string;
  responsavel: string;
  atribuido: string;
}

export const TabulacaoSchema = new Schema<ITabulacao>(
  {
    tipoChamado: { type: String, default: '' },
    produto: { type: String, default: '' },
    motivo: { type: String, default: '' },
    motivo2: { type: String, default: '' },
    motivo3: { type: String, default: '' },
    detalhe: { type: String, default: '' },
    canal: { type: String, default: '' },
    responsavel: { type: String, default: '' },
    atribuido: { type: String, default: '' },
  },
  { _id: false },
);

export const RegistroSchema = new Schema<IRegistro>(
  {
    data: { type: Date, default: Date.now },
    origin: { type: String, default: '' },
    autor: { type: String, default: '' },
    mensagemPublica: { type: String, default: '' },
    anexosMensagemPublica: { type: [String], default: [] },
    anotacaoInterna: { type: String, default: '' },
    anexosAnotacaoInterna: { type: [String], default: [] },
    alteracoes: { type: [Schema.Types.Mixed], default: [] },
    metadados: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: CHAMADO_STATUS_VALUES,
      default: 'novo',
    },
  },
  { _id: false },
);
