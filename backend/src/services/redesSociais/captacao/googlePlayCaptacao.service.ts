/** googlePlayCaptacao.service v1.0.0 — captação de avaliações do Google Play
 *
 * Acesso liberado direto pelo Play Console (Configurações → Acesso à API), vinculando
 * uma conta de serviço do Google Cloud como colaboradora do app — sem App Review, sem
 * prazo incerto (diferente do Facebook/Instagram nesse aspecto).
 *
 * LIMITAÇÃO DA PRÓPRIA API DO GOOGLE (não dá pra contornar): ela só devolve avaliações
 * criadas OU modificadas na ÚLTIMA SEMANA — não existe parâmetro de data mais antiga
 * nem forma de pedir o histórico completo desde sempre. Isso não atrapalha o objetivo
 * de "captar todo comentário novo a cada ciclo" (toda avaliação nova cai dentro da
 * janela de 7 dias no momento em que aparece) — só significa que não há como recuperar
 * o histórico de avaliações anteriores a começarmos a rodar este serviço. Se isso for
 * importante, o único jeito é uma exportação manual pontual pelo próprio Play Console
 * (tela de exportar reviews em CSV) — não dá pra automatizar via API.
 *
 * COMO A DEDUPLICAÇÃO FUNCIONA AQUI: diferente do Facebook/Instagram (que têm um
 * "cursor" — o post/comentário mais recente conhecido), a API do Google Play não tem
 * esse conceito. A cada ciclo, ela devolve as avaliações da última semana inteira, sem
 * filtro. A dedução do que é "novo" não acontece aqui — é feita pelo índice único de
 * `idOrigem` em RedesSociaisComentario (ver redesSociaisComentario.service.ts).
 *
 * Pré-requisito (uma vez, no Play Console):
 *   1. Configurações → Acesso à API → vincular/criar um projeto do Google Cloud.
 *   2. Nesse projeto, criar uma Service Account e gerar uma chave JSON.
 *   3. No Play Console → Acesso à API → convidar essa conta de serviço, com a
 *      permissão "Responder a avaliações" (já inclui a leitura) no app específico.
 */
import { createSign } from 'node:crypto';
import type { ComentarioParaClassificar } from '../redesSociaisComentario.service';

export interface ContaDeServicoGoogle {
  client_email: string;
  private_key: string;
}

interface GoogleUserComment {
  text: string;
  lastModified: { seconds: string; nanos?: number };
  starRating?: number;
  reviewerLanguage?: string;
  device?: string;
  androidOsVersion?: number;
  appVersionName?: string;
  thumbsUpCount?: number;
  thumbsDownCount?: number;
}

interface GoogleDeveloperComment {
  text: string;
  lastModified: { seconds: string; nanos?: number };
}

interface GoogleReviewComment {
  userComment?: GoogleUserComment;
  developerComment?: GoogleDeveloperComment;
}

export interface GoogleReview {
  reviewId: string;
  authorName?: string;
  comments: GoogleReviewComment[];
}

interface GoogleReviewsListResponse {
  reviews?: GoogleReview[];
  tokenPagination?: { nextPageToken?: string };
}

interface GoogleErroResponse {
  error: { code: number; message: string; status: string };
}

export class ErroGooglePlayAPI extends Error {
  constructor(mensagemOriginal: string) {
    super(
      `A API do Google Play recusou a consulta: "${mensagemOriginal}". `
      + 'Confirme, no Play Console → Configurações → Acesso à API, que a conta de '
      + 'serviço está convidada com permissão de responder/ver avaliações para este app.',
    );
    this.name = 'ErroGooglePlayAPI';
  }
}

const ESCOPO_ANDROID_PUBLISHER = 'https://www.googleapis.com/auth/androidpublisher';
const ENDPOINT_TOKEN = 'https://oauth2.googleapis.com/token';

let tokenEmCache: { accessToken: string; expiraEm: number } | null = null;

function base64Url(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input) : input;
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function assinarJWT(contaDeServico: ContaDeServicoGoogle): string {
  const agora = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: contaDeServico.client_email,
    scope: ESCOPO_ANDROID_PUBLISHER,
    aud: ENDPOINT_TOKEN,
    iat: agora,
    exp: agora + 3600,
  };

  const headerCodificado = base64Url(JSON.stringify(header));
  const claimCodificado = base64Url(JSON.stringify(claimSet));
  const entrada = `${headerCodificado}.${claimCodificado}`;

  const assinador = createSign('RSA-SHA256');
  assinador.update(entrada);
  assinador.end();
  const assinatura = base64Url(assinador.sign(contaDeServico.private_key));

  return `${entrada}.${assinatura}`;
}

/** Troca a chave da conta de serviço por um access_token (~1h), com cache em memória. */
export async function obterTokenDeAcesso(contaDeServico: ContaDeServicoGoogle): Promise<string> {
  const agora = Date.now();
  if (tokenEmCache && tokenEmCache.expiraEm > agora + 60_000) {
    return tokenEmCache.accessToken;
  }

  const jwt = assinarJWT(contaDeServico);

  const resposta = await fetch(ENDPOINT_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const corpo = (await resposta.json()) as
    | { access_token: string; expires_in: number }
    | { error: string; error_description?: string };

  if (!resposta.ok || 'error' in corpo) {
    const mensagem = 'error' in corpo ? corpo.error_description ?? corpo.error : `HTTP ${resposta.status}`;
    throw new ErroGooglePlayAPI(`Falha ao autenticar: ${mensagem}`);
  }

  tokenEmCache = { accessToken: corpo.access_token, expiraEm: agora + corpo.expires_in * 1000 };
  return corpo.access_token;
}

const GOOGLE_PLAY_API_BASE = 'https://www.googleapis.com/androidpublisher/v3/applications';
const TAMANHO_DE_PAGINA = 100;

async function chamarGooglePlayAPI<T>(url: URL, accessToken: string): Promise<T> {
  const resposta = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  const corpo = (await resposta.json()) as T | GoogleErroResponse;

  if (!resposta.ok || (corpo as GoogleErroResponse).error) {
    const mensagemErro = (corpo as GoogleErroResponse).error?.message ?? `HTTP ${resposta.status}`;
    throw new ErroGooglePlayAPI(mensagemErro);
  }

  return corpo as T;
}

/** Todas as avaliações disponíveis (última semana, é o máximo que a API entrega). */
export async function buscarReviewsRecentes(packageName: string, accessToken: string): Promise<GoogleReview[]> {
  const todas: GoogleReview[] = [];
  let proximoToken: string | undefined;

  do {
    const url = new URL(`${GOOGLE_PLAY_API_BASE}/${packageName}/reviews`);
    url.searchParams.set('maxResults', String(TAMANHO_DE_PAGINA));
    if (proximoToken) url.searchParams.set('token', proximoToken);

    const corpo = await chamarGooglePlayAPI<GoogleReviewsListResponse>(url, accessToken);
    todas.push(...(corpo.reviews ?? []));
    proximoToken = corpo.tokenPagination?.nextPageToken;
  } while (proximoToken);

  return todas;
}

export function normalizarDeGooglePlay(
  review: GoogleReview,
  packageName: string,
): ComentarioParaClassificar | null {
  const comentarioDoUsuario = review.comments.find((c) => c.userComment)?.userComment;
  if (!comentarioDoUsuario) return null; // review sem texto de usuário (raro, mas existe)

  const segundos = Number(comentarioDoUsuario.lastModified.seconds);

  return {
    idOrigem: review.reviewId,
    canal: 'google_play',
    nomeCliente: review.authorName ?? 'Usuário do Google Play',
    mensagem: comentarioDoUsuario.text,
    dataHora: new Date(segundos * 1000).toISOString(),
    linkOriginal: `https://play.google.com/store/apps/details?id=${packageName}`,
    notaEstrelas: comentarioDoUsuario.starRating,
  };
}

export async function buscarComentariosNovosGooglePlay(
  contaDeServico: ContaDeServicoGoogle,
  packageName: string,
): Promise<ComentarioParaClassificar[]> {
  const accessToken = await obterTokenDeAcesso(contaDeServico);
  const reviews = await buscarReviewsRecentes(packageName, accessToken);

  const comentarios: ComentarioParaClassificar[] = [];
  for (const review of reviews) {
    const normalizado = normalizarDeGooglePlay(review, packageName);
    if (normalizado) comentarios.push(normalizado);
  }

  return comentarios;
}
