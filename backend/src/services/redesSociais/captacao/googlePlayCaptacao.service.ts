/** googlePlayCaptacao.service v2.0.0 — normaliza reviews do Google Play vindos da API do
 * parceiro (play-reviews) para o formato interno de Redes Sociais.
 *
 * v2.0.0: o Velodesk deixou de falar direto com a Play Developer API (antes: JWT de
 * service account + androidpublisher). Toda leitura/resposta passa pela API do parceiro
 * (ver playReviewsApi.client.ts) — é ele quem guarda a credencial do Google.
 *
 * LIMITAÇÃO DA ORIGEM: a API só devolve reviews com texto criadas OU editadas nos últimos
 * 7 dias. Por isso a captação precisa rodar com folga bem menor que isso (Cloud Run Job a
 * cada 10 min) e o histórico anterior à nossa base só vem de backfill via /reports.
 */
import { env } from '../../../config/env';
import type { PlayReview } from './playReviewsApi.client';

export interface ReviewNormalizadoPlay {
  idOrigem: string;
  canal: 'google_play';
  nomeCliente: string;
  mensagem: string;
  /** lastModified do review na origem — usado como dataHora e para detectar edições. */
  dataHora: string;
  linkOriginal: string;
  notaEstrelas?: number;
  ultimaModificacaoOrigem: Date;
  /** Resposta do desenvolvedor já publicada no Play (pode ter sido feita fora do Desk). */
  respostaPublicada: { texto: string; dataHora: Date } | null;
}

function parseData(valor: string | null | undefined): Date | null {
  if (!valor) return null;
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function normalizarDePlayReview(review: PlayReview, packageName = env.googlePlayPackageName): ReviewNormalizadoPlay | null {
  if (!review?.reviewId) return null;

  const titulo = (review.title ?? '').trim();
  const corpo = (review.text ?? '').trim();
  const mensagem = titulo && corpo ? `${titulo}\n\n${corpo}` : titulo || corpo;
  if (!mensagem) return null; // sem texto: não há o que classificar nem responder

  const modificado = parseData(review.lastModified) ?? new Date();
  const nota = Number(review.starRating);
  const respostaTexto = review.reply?.text?.trim();

  return {
    idOrigem: review.reviewId,
    canal: 'google_play',
    nomeCliente: review.authorName?.trim() || 'Usuário do Google Play',
    mensagem,
    dataHora: modificado.toISOString(),
    linkOriginal: packageName
      ? `https://play.google.com/store/apps/details?id=${packageName}`
      : 'https://play.google.com/store',
    notaEstrelas: nota >= 1 && nota <= 5 ? nota : undefined,
    ultimaModificacaoOrigem: modificado,
    respostaPublicada: respostaTexto
      ? { texto: respostaTexto, dataHora: parseData(review.reply?.lastModified) ?? modificado }
      : null,
  };
}
