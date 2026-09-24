/** instagramCaptacao.service v1.0.0 — captação de comentários/respostas do Instagram (cobertura total)
 *
 * Mesma ideia do facebookCaptacao.service — cobertura total, sem limite de posts nem de
 * comentários, capturando também respostas em comentários antigos que antes não tinham
 * resposta nenhuma — só que adaptado às diferenças reais da API do Instagram:
 *
 *   1. Host diferente: `graph.instagram.com` (trilha "API do Instagram com Login do
 *      Instagram para Empresas" — instagram_business_basic,
 *      instagram_business_manage_comments, instagram_business_manage_messages).
 *   2. Sem troca de token: o token de acesso do Instagram (@velo_tax) já serve direto,
 *      sem o passo de trocar token de Usuário do Sistema por token de Página.
 *   3. Respostas de comentário ficam num edge PRÓPRIO — `/{comment-id}/replies` —
 *      diferente do Facebook, que reutiliza `/comments` pros dois níveis.
 *
 * Depende de INSTAGRAM_ACCESS_TOKEN (env) — enquanto ausente, o ciclo do Instagram é
 * pulado (ver jobs/redesSociaisCaptacao.job.ts), sem quebrar Facebook/Google Play.
 *
 * PRIORIDADE: igual ao facebookCaptacao.service — o mais novo do perfil sempre vence,
 * mesmo que a mídia seja antiga. Por isso `MAX_PAGINAS_POR_CONTAINER_POR_CICLO` limita
 * quanto cada busca desce no histórico de uma mídia/comentário sem cursor conhecido, e
 * `itensNovos` sai reordenado por `dataHora` no fim do ciclo. Mesma troca deliberada do
 * Facebook: comentário muito antigo além da janela do ciclo fica pra trás.
 */
import { env } from '../../../config/env';
import type { ComentarioParaClassificar } from '../redesSociaisComentario.service';

interface GraphAutorInstagram {
  id: string;
  username?: string;
}

interface GraphComentarioInstagram {
  id: string;
  text?: string;
  from?: GraphAutorInstagram;
  username?: string;
  timestamp: string;
  like_count?: number;
}

interface GraphPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

interface GraphFilhosResponseInstagram {
  data: GraphComentarioInstagram[];
  paging?: GraphPaging;
}

interface GraphMediaResumo {
  id: string;
  timestamp?: string;
  caption?: string;
}

interface GraphMediaListResponse {
  data: GraphMediaResumo[];
  paging?: GraphPaging;
}

interface GraphErroResponseInstagram {
  error: { message: string; type: string; code: number; fbtrace_id?: string };
}

export type TipoDeItemInstagram = 'comentario' | 'resposta';

export interface ItemNovoInstagram {
  idOrigem: string;
  tipo: TipoDeItemInstagram;
  idDaMidia: string;
  idDoPai: string;
  clienteNome: string;
  clienteHandle: string;
  mensagem: string;
  dataHora: string;
  curtidas: number;
}

export interface EstadoDeCaptacaoInstagram {
  midiasConhecidas: Set<string>;
  comentariosConhecidos: Set<string>;
  ultimoFilhoConhecidoPorContainer: Map<string, string>;
}

export function criarEstadoVazioInstagram(): EstadoDeCaptacaoInstagram {
  return {
    midiasConhecidas: new Set(),
    comentariosConhecidos: new Set(),
    ultimoFilhoConhecidoPorContainer: new Map(),
  };
}

export class ErroPermissaoInstagramAPI extends Error {
  constructor(mensagemOriginal: string) {
    super(
      `A Meta recusou a consulta ao Instagram por permissão insuficiente: "${mensagemOriginal}". `
      + 'Confirme as 3 permissões (instagram_business_basic, instagram_business_manage_comments, '
      + 'instagram_business_manage_messages) no token gerado para @velo_tax.',
    );
    this.name = 'ErroPermissaoInstagramAPI';
  }
}

function graphInstagramBase(): string {
  return `https://graph.instagram.com/${env.graphApiVersionInstagram}`;
}

const TAMANHO_DE_PAGINA = 100;

/** Ver mesma constante em facebookCaptacao.service — mesma trava de segurança. */
const MAX_PAGINAS_POR_CONTAINER_POR_CICLO = 3;

async function chamarGraphInstagramAPI<T>(url: URL): Promise<T> {
  const resposta = await fetch(url.toString());
  const corpo = (await resposta.json()) as T | GraphErroResponseInstagram;

  if (!resposta.ok || (corpo as GraphErroResponseInstagram).error) {
    const mensagemErro = (corpo as GraphErroResponseInstagram).error?.message ?? `HTTP ${resposta.status}`;
    throw new ErroPermissaoInstagramAPI(mensagemErro);
  }

  return corpo as T;
}

export async function listarTodasAsMidias(accessToken: string): Promise<GraphMediaResumo[]> {
  const todas: GraphMediaResumo[] = [];

  let url: URL | null = new URL(`${graphInstagramBase()}/me/media`);
  url.searchParams.set('fields', 'id,timestamp,caption');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', accessToken);

  while (url) {
    const corpo: GraphMediaListResponse = await chamarGraphInstagramAPI<GraphMediaListResponse>(url);
    todas.push(...corpo.data);
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  return todas;
}

export async function descobrirMidiasNovas(
  accessToken: string,
  estado: EstadoDeCaptacaoInstagram,
): Promise<GraphMediaResumo[]> {
  const novas: GraphMediaResumo[] = [];

  let url: URL | null = new URL(`${graphInstagramBase()}/me/media`);
  url.searchParams.set('fields', 'id,timestamp,caption');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', accessToken);

  paginacao: while (url) {
    const corpo: GraphMediaListResponse = await chamarGraphInstagramAPI<GraphMediaListResponse>(url);
    for (const midia of corpo.data) {
      if (estado.midiasConhecidas.has(midia.id)) break paginacao;
      novas.push(midia);
    }
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  return novas;
}

export async function buscarNovosComentariosDaMidia(
  midiaId: string,
  accessToken: string,
  ultimoConhecidoId: string | undefined,
): Promise<GraphComentarioInstagram[]> {
  const novos: GraphComentarioInstagram[] = [];

  let url: URL | null = new URL(`${graphInstagramBase()}/${midiaId}/comments`);
  url.searchParams.set('fields', 'id,text,username,timestamp,like_count');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', accessToken);

  let paginasVisitadas = 0;
  paginacao: while (url) {
    const corpo: GraphFilhosResponseInstagram = await chamarGraphInstagramAPI<GraphFilhosResponseInstagram>(url);
    for (const item of corpo.data) {
      if (item.id === ultimoConhecidoId) break paginacao;
      novos.push(item);
    }
    paginasVisitadas += 1;
    if (paginasVisitadas >= MAX_PAGINAS_POR_CONTAINER_POR_CICLO) break;
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  // A API do Instagram, ao contrário da do Facebook, não garante ordem cronológica —
  // a ordenação por `timestamp` é feita no cliente, não confiando na ordem devolvida.
  novos.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return novos;
}

/** Edge PRÓPRIO (`/replies`), diferente do `/comments` reaproveitado no Facebook. */
export async function buscarNovasRespostasDoComentario(
  comentarioId: string,
  accessToken: string,
  ultimoConhecidoId: string | undefined,
): Promise<GraphComentarioInstagram[]> {
  const novas: GraphComentarioInstagram[] = [];

  let url: URL | null = new URL(`${graphInstagramBase()}/${comentarioId}/replies`);
  url.searchParams.set('fields', 'id,text,username,timestamp,like_count');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', accessToken);

  let paginasVisitadas = 0;
  paginacao: while (url) {
    const corpo: GraphFilhosResponseInstagram = await chamarGraphInstagramAPI<GraphFilhosResponseInstagram>(url);
    for (const item of corpo.data) {
      if (item.id === ultimoConhecidoId) break paginacao;
      novas.push(item);
    }
    paginasVisitadas += 1;
    if (paginasVisitadas >= MAX_PAGINAS_POR_CONTAINER_POR_CICLO) break;
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  novas.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return novas;
}

export async function executarCicloDeCaptacaoInstagram(
  accessToken: string,
  estado: EstadoDeCaptacaoInstagram,
): Promise<{ itensNovos: ItemNovoInstagram[]; estadoAtualizado: EstadoDeCaptacaoInstagram }> {
  const itensNovos: ItemNovoInstagram[] = [];

  const midiasNovas = await descobrirMidiasNovas(accessToken, estado);
  for (const midia of midiasNovas) {
    estado.midiasConhecidas.add(midia.id);
  }

  const comentariosNovosNesteCiclo: { comentario: GraphComentarioInstagram; idDaMidia: string }[] = [];

  for (const midiaId of estado.midiasConhecidas) {
    const ultimoConhecido = estado.ultimoFilhoConhecidoPorContainer.get(midiaId);
    const novosComentarios = await buscarNovosComentariosDaMidia(midiaId, accessToken, ultimoConhecido);
    if (novosComentarios.length === 0) continue;

    for (const c of novosComentarios) {
      estado.comentariosConhecidos.add(c.id);
      comentariosNovosNesteCiclo.push({ comentario: c, idDaMidia: midiaId });
      itensNovos.push({
        idOrigem: c.id,
        tipo: 'comentario',
        idDaMidia: midiaId,
        idDoPai: midiaId,
        clienteNome: c.username ?? c.from?.username ?? 'Desconhecido',
        clienteHandle: c.from?.id ?? '',
        mensagem: c.text ?? '',
        dataHora: c.timestamp,
        curtidas: c.like_count ?? 0,
      });
    }

    estado.ultimoFilhoConhecidoPorContainer.set(midiaId, novosComentarios[0].id);
  }

  for (const comentarioId of estado.comentariosConhecidos) {
    const idDaMidiaDeOrigem = comentariosNovosNesteCiclo.find((x) => x.comentario.id === comentarioId)?.idDaMidia ?? '';
    const ultimoConhecido = estado.ultimoFilhoConhecidoPorContainer.get(comentarioId);
    const novasRespostas = await buscarNovasRespostasDoComentario(comentarioId, accessToken, ultimoConhecido);
    if (novasRespostas.length === 0) continue;

    for (const r of novasRespostas) {
      itensNovos.push({
        idOrigem: r.id,
        tipo: 'resposta',
        idDaMidia: idDaMidiaDeOrigem,
        idDoPai: comentarioId,
        clienteNome: r.username ?? r.from?.username ?? 'Desconhecido',
        clienteHandle: r.from?.id ?? '',
        mensagem: r.text ?? '',
        dataHora: r.timestamp,
        curtidas: r.like_count ?? 0,
      });
    }

    estado.ultimoFilhoConhecidoPorContainer.set(comentarioId, novasRespostas[0].id);
  }

  itensNovos.sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());

  return { itensNovos, estadoAtualizado: estado };
}

export async function sincronizarTodasAsMidias(accessToken: string): Promise<EstadoDeCaptacaoInstagram> {
  const estado = criarEstadoVazioInstagram();

  const todasAsMidias = await listarTodasAsMidias(accessToken);
  for (const midia of todasAsMidias) {
    estado.midiasConhecidas.add(midia.id);
  }

  return estado;
}

export function normalizarDeInstagram(item: ItemNovoInstagram): ComentarioParaClassificar {
  return {
    idOrigem: item.idOrigem,
    canal: 'instagram',
    nomeCliente: item.clienteNome,
    mensagem: item.mensagem,
    dataHora: item.dataHora,
    linkOriginal: `https://instagram.com/p/${item.idDaMidia}`,
  };
}
