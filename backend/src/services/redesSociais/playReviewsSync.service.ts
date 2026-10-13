/** playReviewsSync.service v1.0.0 — ciclo de sincronização dos reviews do Google Play
 * (API do parceiro → classificação por IA → redes_sociais_comentarios).
 *
 * Diferente de Facebook/Instagram (dedup só por idOrigem), o Play precisa tratar:
 *  - EDIÇÃO: usuário edita o review (lastModified muda) → atualiza texto/nota, reclassifica,
 *    e marca `editadoAposResposta` se já havia resposta nossa.
 *  - RESPOSTA EXTERNA: alguém respondeu direto no Play Console → importa a resposta para
 *    não deixar o review "sem resposta" no Desk. Nunca sobrescreve resposta já registrada.
 * Idempotente: rodar N vezes seguidas sobre os mesmos reviews não muda nada depois da 1ª.
 * Um review com falha não interrompe os demais (volta no próximo ciclo: ainda está na
 * janela de 7 dias).
 */
import { getRedesSociaisComentarioModel } from '../../models/RedesSociaisComentario';
import { classificarComentario } from './classificacaoComentario.service';
import { buscarReviewsDoParceiro, isPlayReviewsApiConfigured } from './captacao/playReviewsApi.client';
import { normalizarDePlayReview, type ReviewNormalizadoPlay } from './captacao/googlePlayCaptacao.service';

/** Injetável só para teste (scripts/test-play-reviews.ts) — produção usa a IA real. */
export type Classificador = typeof classificarComentario;

export interface ResultadoSyncPlay {
  recebidos: number;
  novos: number;
  editados: number;
  respostasImportadas: number;
  semMudanca: number;
  falhas: { idOrigem: string; erro: string }[];
}

type DocExistente = {
  _id: unknown;
  idOrigem: string;
  mensagem: string;
  notaEstrelas?: number;
  dataHora: Date;
  respondido: boolean;
  ultimaModificacaoOrigem?: Date;
};

function camposDeRespostaExterna(review: ReviewNormalizadoPlay) {
  if (!review.respostaPublicada) return null;
  return {
    respondido: true,
    resposta: review.respostaPublicada.texto,
    respondidoEm: review.respostaPublicada.dataHora,
    respondidoPor: 'Play Console',
    origemResposta: 'play_console' as const,
    publicadoEm: review.respostaPublicada.dataHora,
  };
}

async function inserirNovo(review: ReviewNormalizadoPlay, classificar: Classificador): Promise<boolean> {
  const classificacao = await classificar({
    idOrigem: review.idOrigem,
    canal: 'google_play',
    nomeCliente: review.nomeCliente,
    mensagem: review.mensagem,
    dataHora: review.dataHora,
    linkOriginal: review.linkOriginal,
    notaEstrelas: review.notaEstrelas,
  });
  if (!classificacao) throw new Error('Classificação por IA indisponível ou inválida');

  const Model = getRedesSociaisComentarioModel();
  await Model.updateOne(
    { idOrigem: review.idOrigem },
    {
      $setOnInsert: {
        idOrigem: review.idOrigem,
        canal: 'google_play',
        nomeCliente: review.nomeCliente,
        mensagem: review.mensagem,
        dataHora: new Date(review.dataHora),
        linkOriginal: review.linkOriginal,
        notaEstrelas: review.notaEstrelas,
        sentimento: classificacao.sentimento,
        motivo: classificacao.motivo,
        confiancaIa: classificacao.confianca,
        dataClassificacao: new Date(),
        ultimaModificacaoOrigem: review.ultimaModificacaoOrigem,
        ignorado: false,
        editadoAposResposta: false,
        ...(camposDeRespostaExterna(review) ?? { respondido: false }),
      },
    },
    { upsert: true },
  );
  return true;
}

async function atualizarExistente(
  doc: DocExistente,
  review: ReviewNormalizadoPlay,
  classificar: Classificador,
): Promise<{ editado: boolean; respostaImportada: boolean }> {
  const Model = getRedesSociaisComentarioModel();
  const set: Record<string, unknown> = {};

  const referencia = doc.ultimaModificacaoOrigem ?? doc.dataHora;
  const foiModificado = review.ultimaModificacaoOrigem.getTime() > new Date(referencia).getTime();
  const conteudoMudou = review.mensagem !== doc.mensagem || (review.notaEstrelas ?? null) !== (doc.notaEstrelas ?? null);

  let editado = false;
  if (foiModificado) {
    set.ultimaModificacaoOrigem = review.ultimaModificacaoOrigem;
    if (conteudoMudou) {
      editado = true;
      set.mensagem = review.mensagem;
      set.notaEstrelas = review.notaEstrelas;
      if (doc.respondido) set.editadoAposResposta = true;
      try {
        const nova = await classificar({
          idOrigem: review.idOrigem,
          canal: 'google_play',
          nomeCliente: review.nomeCliente,
          mensagem: review.mensagem,
          dataHora: review.dataHora,
          linkOriginal: review.linkOriginal,
          notaEstrelas: review.notaEstrelas,
        });
        if (nova) {
          set.sentimento = nova.sentimento;
          set.motivo = nova.motivo;
          set.confiancaIa = nova.confianca;
          set.dataClassificacao = new Date();
        }
      } catch (err) {
        // Mantém a classificação anterior: o texto novo é mais importante que o rótulo.
        console.warn(`[play-sync] reclassificação falhou para ${review.idOrigem}: ${(err as Error).message}`);
      }
    }
  }

  let respostaImportada = false;
  const externa = !doc.respondido ? camposDeRespostaExterna(review) : null;
  if (externa) {
    Object.assign(set, externa);
    respostaImportada = true;
  }

  if (Object.keys(set).length) {
    await Model.updateOne({ _id: doc._id }, { $set: set });
  }
  return { editado, respostaImportada };
}

export async function sincronizarReviewsPlay(
  classificar: Classificador = classificarComentario,
): Promise<ResultadoSyncPlay> {
  const resultado: ResultadoSyncPlay = {
    recebidos: 0, novos: 0, editados: 0, respostasImportadas: 0, semMudanca: 0, falhas: [],
  };

  if (!isPlayReviewsApiConfigured()) {
    console.info('[play-sync] PLAY_REVIEWS_API_URL/PLAY_REVIEWS_API_KEY não configurados — pulando.');
    return resultado;
  }

  const brutos = await buscarReviewsDoParceiro();
  resultado.recebidos = brutos.length;

  const reviews = brutos
    .map((r) => normalizarDePlayReview(r))
    .filter((r): r is ReviewNormalizadoPlay => r !== null);
  if (!reviews.length) return resultado;

  const Model = getRedesSociaisComentarioModel();
  const existentes = await Model.find({ idOrigem: { $in: reviews.map((r) => r.idOrigem) } })
    .select('idOrigem mensagem notaEstrelas dataHora respondido ultimaModificacaoOrigem')
    .lean<DocExistente[]>();
  const porId = new Map(existentes.map((d) => [d.idOrigem, d]));

  for (const review of reviews) {
    try {
      const doc = porId.get(review.idOrigem);
      if (!doc) {
        await inserirNovo(review, classificar);
        resultado.novos += 1;
        continue;
      }
      const { editado, respostaImportada } = await atualizarExistente(doc, review, classificar);
      if (editado) resultado.editados += 1;
      if (respostaImportada) resultado.respostasImportadas += 1;
      if (!editado && !respostaImportada) resultado.semMudanca += 1;
    } catch (err) {
      resultado.falhas.push({ idOrigem: review.idOrigem, erro: (err as Error).message });
    }
  }

  return resultado;
}
