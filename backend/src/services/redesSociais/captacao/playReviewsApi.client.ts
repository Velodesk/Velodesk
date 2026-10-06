/** playReviewsApi.client v1.0.0 — cliente HTTP da API do parceiro (play-reviews), que é a
 * única porta de entrada do Velodesk para o Google Play (leitura e resposta de reviews).
 *
 * Contrato (ver API.md do parceiro): header `x-api-key` em toda rota;
 *   GET  /reviews                  → { reviews: PlayReview[] } (texto, últimos 7 dias)
 *   POST /reviews/:reviewId/reply  → { reviewId, replyText, lastEdited }  (texto ≤ 350)
 *
 * A saída precisa sair pelo IP fixo liberado pelo parceiro — ver infra do Cloud Run.
 * Leitura faz retry em falha transitória (rede/5xx/429); escrita NÃO faz retry automático:
 * o reply substitui a resposta anterior, mas um retry cego após timeout esconderia o
 * estado real. Quem chama decide (o agente vê o erro e tenta de novo).
 */
import { env } from '../../../config/env';

export const PLAY_REPLY_MAX_CHARS = 350;

export interface PlayReview {
  reviewId: string;
  authorName: string;
  starRating: number;
  title: string;
  text: string;
  lastModified: string | null;
  language?: string;
  appVersionName?: string;
  reply: { text: string; lastModified: string | null } | null;
}

export interface PlayReplyResultado {
  reviewId: string;
  replyText: string;
  lastEdited?: { seconds: string; nanos?: number };
}

/** Falha ao falar com a API do parceiro. `status` é o HTTP dele (0 = rede/timeout). */
export class ErroPlayReviewsApi extends Error {
  constructor(
    mensagem: string,
    public readonly status: number,
    public readonly transitorio: boolean,
  ) {
    super(mensagem);
    this.name = 'ErroPlayReviewsApi';
  }
}

export function isPlayReviewsApiConfigured(): boolean {
  return Boolean(env.playReviewsApiUrl && env.playReviewsApiKey);
}

function assertConfigured(): void {
  if (!isPlayReviewsApiConfigured()) {
    throw new ErroPlayReviewsApi('API do Google Play não configurada (PLAY_REVIEWS_API_URL / PLAY_REVIEWS_API_KEY).', 0, false);
  }
}

async function chamar<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  assertConfigured();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.playReviewsTimeoutMs);

  try {
    const resposta = await fetch(`${env.playReviewsApiUrl}${path}`, {
      method,
      headers: {
        'x-api-key': env.playReviewsApiKey,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const texto = await resposta.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* corpo não-JSON (ex.: página de erro de proxy) — tratado abaixo */
    }

    if (!resposta.ok) {
      const mensagemParceiro = (json as { error?: string } | null)?.error;
      const transitorio = resposta.status >= 500 || resposta.status === 429;
      throw new ErroPlayReviewsApi(
        mensagemParceiro || `API do Google Play respondeu HTTP ${resposta.status}.`,
        resposta.status,
        transitorio,
      );
    }
    if (json === null || typeof json !== 'object') {
      throw new ErroPlayReviewsApi('API do Google Play devolveu uma resposta inválida (não-JSON).', resposta.status, true);
    }
    return json as T;
  } catch (err) {
    if (err instanceof ErroPlayReviewsApi) throw err;
    const abortou = (err as Error).name === 'AbortError';
    throw new ErroPlayReviewsApi(
      abortou
        ? `API do Google Play não respondeu em ${env.playReviewsTimeoutMs}ms.`
        : `Falha de rede ao chamar a API do Google Play: ${(err as Error).message}`,
      0,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

const TENTATIVAS_LEITURA = 3;
const ESPERA_BASE_MS = 1_000;

/** Reviews com texto dos últimos 7 dias (a API do parceiro já pagina internamente). */
export async function buscarReviewsDoParceiro(): Promise<PlayReview[]> {
  let ultimoErro: ErroPlayReviewsApi | null = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS_LEITURA; tentativa += 1) {
    try {
      const corpo = await chamar<{ reviews?: PlayReview[] }>('GET', '/reviews');
      if (!Array.isArray(corpo.reviews)) {
        throw new ErroPlayReviewsApi('Resposta de /reviews sem a lista "reviews".', 200, false);
      }
      return corpo.reviews;
    } catch (err) {
      ultimoErro = err as ErroPlayReviewsApi;
      if (!ultimoErro.transitorio || tentativa === TENTATIVAS_LEITURA) break;
      await new Promise((resolve) => setTimeout(resolve, ESPERA_BASE_MS * 2 ** (tentativa - 1)));
    }
  }
  throw ultimoErro as ErroPlayReviewsApi;
}

/** Publica (ou substitui) a resposta do desenvolvedor. Sem retry automático. */
export async function responderReviewNoParceiro(reviewId: string, texto: string): Promise<PlayReplyResultado> {
  const limpo = texto.trim();
  if (!limpo) throw new ErroPlayReviewsApi('A resposta não pode ser vazia.', 400, false);
  if (limpo.length > PLAY_REPLY_MAX_CHARS) {
    throw new ErroPlayReviewsApi(
      `A resposta no Google Play aceita no máximo ${PLAY_REPLY_MAX_CHARS} caracteres (atual: ${limpo.length}).`,
      400,
      false,
    );
  }
  return chamar<PlayReplyResultado>('POST', `/reviews/${encodeURIComponent(reviewId)}/reply`, { text: limpo });
}
