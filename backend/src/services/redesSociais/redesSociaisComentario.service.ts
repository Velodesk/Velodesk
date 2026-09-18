/** redesSociaisComentario.service v1.0.0 — CRUD + relatório dos comentários/avaliações
 * classificados de Facebook/Instagram/Google Play (ver models/RedesSociaisComentario). */
import {
  getRedesSociaisComentarioModel,
  IRedesSociaisComentario,
  RedesSociaisCanal,
} from '../../models/RedesSociaisComentario';

export interface ComentarioParaClassificar {
  idOrigem: string;
  canal: RedesSociaisCanal;
  nomeCliente: string;
  mensagem: string;
  dataHora: string; // ISO 8601
  linkOriginal?: string;
  notaEstrelas?: number;
}

export interface ComentarioClassificadoParaSalvar extends ComentarioParaClassificar {
  sentimento: IRedesSociaisComentario['sentimento'];
  motivo: IRedesSociaisComentario['motivo'];
  confiancaIa?: number;
}

/** Evita reclassificar/reprocessar o que já foi captado antes (idempotência por idOrigem). */
export async function idsJaExistentes(idsOrigem: string[]): Promise<Set<string>> {
  if (!idsOrigem.length) return new Set();
  const Model = getRedesSociaisComentarioModel();
  const existentes = await Model.find({ idOrigem: { $in: idsOrigem } }).select('idOrigem').lean();
  return new Set(existentes.map((doc) => doc.idOrigem));
}

export async function salvarComentarioClassificado(
  comentario: ComentarioClassificadoParaSalvar,
): Promise<IRedesSociaisComentario> {
  const Model = getRedesSociaisComentarioModel();
  return Model.findOneAndUpdate(
    { idOrigem: comentario.idOrigem },
    {
      $setOnInsert: {
        idOrigem: comentario.idOrigem,
        canal: comentario.canal,
        nomeCliente: comentario.nomeCliente,
        mensagem: comentario.mensagem,
        dataHora: new Date(comentario.dataHora),
        linkOriginal: comentario.linkOriginal,
        notaEstrelas: comentario.notaEstrelas,
        sentimento: comentario.sentimento,
        motivo: comentario.motivo,
        confiancaIa: comentario.confiancaIa,
        dataClassificacao: new Date(),
        respondido: false,
        ignorado: false,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).exec();
}

export interface ListarComentariosFiltro {
  /** Um canal (`facebook`) ou vários (`['facebook','instagram']` → ainda exclui google_play). */
  canal?: RedesSociaisCanal | RedesSociaisCanal[];
  sentimento?: IRedesSociaisComentario['sentimento'];
  respondido?: boolean;
  ignorado?: boolean;
  busca?: string;
  page?: number;
  pageSize?: number;
}

export async function listarComentarios(filtro: ListarComentariosFiltro = {}) {
  const Model = getRedesSociaisComentarioModel();
  const query: Record<string, unknown> = {};
  if (Array.isArray(filtro.canal)) {
    if (filtro.canal.length) query.canal = { $in: filtro.canal };
  } else if (filtro.canal) {
    query.canal = filtro.canal;
  }
  if (filtro.sentimento) query.sentimento = filtro.sentimento;
  if (filtro.respondido !== undefined) query.respondido = filtro.respondido;
  if (filtro.ignorado !== undefined) query.ignorado = filtro.ignorado;
  if (filtro.busca?.trim()) {
    const regex = new RegExp(filtro.busca.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ nomeCliente: regex }, { mensagem: regex }];
  }

  const page = Math.max(1, filtro.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filtro.pageSize ?? 25));

  const [items, total] = await Promise.all([
    Model.find(query)
      .sort({ dataHora: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Model.countDocuments(query),
  ]);

  return { items, total, page, pageSize };
}

export async function marcarComentarioRespondido(
  id: string,
  resposta: string,
  respondidoPor: string,
): Promise<IRedesSociaisComentario | null> {
  const Model = getRedesSociaisComentarioModel();
  return Model.findByIdAndUpdate(
    id,
    {
      $set: {
        respondido: true,
        resposta,
        respondidoEm: new Date(),
        respondidoPor,
      },
    },
    { new: true },
  ).exec();
}

export async function marcarComentarioIgnorado(id: string): Promise<IRedesSociaisComentario | null> {
  const Model = getRedesSociaisComentarioModel();
  return Model.findByIdAndUpdate(id, { $set: { ignorado: true } }, { new: true }).exec();
}

export interface RelatorioRedesSociais {
  totalPorCanal: Record<string, number>;
  totalPorSentimento: Record<string, number>;
  totalPorMotivo: Record<string, number>;
  semResposta: number;
}

export async function gerarRelatorio(desde?: Date, canal?: RedesSociaisCanal): Promise<RelatorioRedesSociais> {
  const Model = getRedesSociaisComentarioModel();
  const match: Record<string, unknown> = {};
  if (desde) match.dataHora = { $gte: desde };
  if (canal) match.canal = canal;

  const [porCanal, porSentimento, porMotivo, semResposta] = await Promise.all([
    Model.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: '$canal', count: { $sum: 1 } } },
    ]),
    Model.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: '$sentimento', count: { $sum: 1 } } },
    ]),
    Model.aggregate<{ _id: string; count: number }>([
      { $match: match },
      { $group: { _id: '$motivo', count: { $sum: 1 } } },
    ]),
    Model.countDocuments({ ...match, respondido: false, ignorado: false }),
  ]);

  const toRecord = (rows: { _id: string; count: number }[]) =>
    rows.reduce<Record<string, number>>((acc, row) => {
      acc[row._id] = row.count;
      return acc;
    }, {});

  return {
    totalPorCanal: toRecord(porCanal),
    totalPorSentimento: toRecord(porSentimento),
    totalPorMotivo: toRecord(porMotivo),
    semResposta,
  };
}
