/** Cliente v1.2.0 — e-mail de resposta em clienteEmail.resposta */
import { Schema, Document, Model } from 'mongoose';
import { getCadastrosConnection } from '../config/database';

export interface IClienteTelefone {
  lista: string[];
  whatsapp?: string;
}

export interface IClienteEmail {
  lista: string[];
  resposta?: string;
}

export interface IClienteDados {
  clienteCpf: string;
  clienteNome: string;
  clienteEmail: IClienteEmail;
  clienteTelefone: IClienteTelefone;
  /** Slugs de produtos Velotax contratados, conforme último overview da Customer Data API. */
  produtosContratados?: string[];
}

export interface IAtendimentoHistorico {
  chamadoProtocolo: string;
  resumo: string;
  avaliacao: string;
}

export interface ICliente extends Document {
  clienteDados: IClienteDados[];
  atendimentoHistorico: IAtendimentoHistorico[];
  createdAt: Date;
  updatedAt: Date;
}

const ClienteDadosSchema = new Schema<IClienteDados>(
  {
    // Sem default: cadastros criados só com e-mail (sem CPF) precisam deixar o campo
    // genuinamente ausente — o índice único abaixo é sparse, e um default '' faria
    // o segundo cadastro sem CPF colidir com o primeiro (chave duplicada).
    clienteCpf: { type: String },
    clienteNome: { type: String, default: '' },
    clienteEmail: {
      lista: { type: [String], default: [] },
      resposta: { type: String, default: '' },
    },
    clienteTelefone: {
      lista: { type: [String], default: [] },
      whatsapp: { type: String, default: '' },
    },
    produtosContratados: { type: [String], default: [] },
  },
  { _id: false }
);

const AtendimentoHistoricoSchema = new Schema<IAtendimentoHistorico>(
  {
    chamadoProtocolo: { type: String, default: '' },
    resumo: { type: String, default: '' },
    avaliacao: { type: String, default: '' },
  },
  { _id: false }
);

const ClienteSchema = new Schema<ICliente>(
  {
    clienteDados: { type: [ClienteDadosSchema], default: [] },
    atendimentoHistorico: { type: [AtendimentoHistoricoSchema], default: [] },
  },
  {
    timestamps: true,
    collection: 'clientes',
  }
);

ClienteSchema.index({ 'clienteDados.clienteCpf': 1 }, { unique: true, sparse: true });

export function getClienteModel(): Model<ICliente> {
  const conn = getCadastrosConnection();
  if (conn.models.Cliente) {
    return conn.models.Cliente as Model<ICliente>;
  }
  return conn.model<ICliente>('Cliente', ClienteSchema);
}
