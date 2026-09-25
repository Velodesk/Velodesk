/** facebookCaptacao.service v1.0.0 — captação de comentários/respostas do Facebook (cobertura total)
 *
 * Requisito: enxergar comentário NOVO em QUALQUER post da Página — não só nos mais
 * recentes — e também RESPOSTAS novas a comentários já existentes, mesmo em comentários
 * antigos que antes não tinham resposta nenhuma. Cobertura total em dois níveis:
 *
 *   Post → comentários (com ou sem resposta) → respostas de cada comentário
 *
 * A Graph API expõe o mesmo tipo de endpoint tanto para um post quanto para um
 * comentário: `GET /{id}/comments` — um comentário é, pra API, só mais um "container"
 * que pode ter filhos (as respostas), exatamente como um post é um container que tem
 * filhos (os comentários). Por isso a mesma função genérica (`buscarNovosFilhosDe`)
 * serve para os dois níveis.
 *
 * Cobertura total via polling significa revisitar todo post e todo comentário
 * conhecido a cada ciclo (não existe webhook de "tudo que mudou" sem App Review). O
 * truque para isso não virar uma enxurrada de chamadas: se nada mudou desde a última
 * vez, a checagem custa 1 chamada rápida (compara só o item mais recente); só pagina
 * mais fundo quando há novidade de verdade.
 *
 * PRIORIDADE: o mais novo da Página sempre vence. Sem cursor conhecido (ex.: logo
 * após o processo reiniciar), `buscarNovosFilhosDe` não desce o histórico inteiro de
 * um post só — isso tomaria o ciclo inteiro e atrasaria comentário novo de OUTRO post.
 * Por isso existe `MAX_PAGINAS_POR_CONTAINER_POR_CICLO`, e por isso o resultado final
 * do ciclo (`itensNovos`) é reordenado por `dataHora` antes de ser devolvido: comentário
 * mais recente entra pra fila de classificação primeiro, não importa se o post-pai é
 * antigo ou recente. Aceita-se, em troca, que — só no cenário de cursor perdido (reinício
 * do processo) — um comentário muito antigo, além da janela de páginas do ciclo, fique
 * pra trás: o cursor daquele container avança até o item mais novo já visto, então essa
 * lacuna antiga não é revisitada depois. É a troca deliberada: newest-first sempre, em
 * vez de garantir cobertura eterna de comentário antigo enterrado.
 *
 * Pré-requisito: Usuário do Sistema "Velodesk - Leitura", com a Página e o App
 * "Velodesk" atribuídos, e um token com as 4 permissões: pages_show_list,
 * pages_read_engagement, pages_read_user_content, pages_manage_engagement.
 */
import { env } from '../../../config/env';
import type { ComentarioParaClassificar } from '../redesSociaisComentario.service';

interface GraphAutor {
  id: string;
  name: string;
}

interface GraphComentario {
  id: string;
  message?: string;
  from?: GraphAutor;
  created_time: string;
  like_count?: number;
  comment_count?: number;
}

interface GraphPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
  previous?: string;
}

interface GraphFilhosResponse {
  data: GraphComentario[];
  paging?: GraphPaging;
}

interface GraphPostResumo {
  id: string;
  created_time?: string;
}

interface GraphFeedResponse {
  data: GraphPostResumo[];
  paging?: GraphPaging;
}

interface GraphPaginaDoUsuarioDoSistema {
  id: string;
  name: string;
  access_token: string;
}

interface GraphErroResponse {
  error: { message: string; type: string; code: number; fbtrace_id?: string };
}

export type TipoDeItemFacebook = 'comentario' | 'resposta';

export interface ItemNovoFacebook {
  idOrigem: string;
  tipo: TipoDeItemFacebook;
  idDoPost: string;
  idDoPai: string;
  clienteNome: string;
  clienteHandle: string;
  mensagem: string;
  dataHora: string;
  curtidas: number;
}

/** Estado persistido em memória entre ciclos (ver services/redesSociais/orquestrador.service.ts). */
export interface EstadoDeCaptacaoFacebook {
  postsConhecidos: Set<string>;
  comentariosConhecidos: Set<string>;
  ultimoFilhoConhecidoPorContainer: Map<string, string>;
}

export function criarEstadoVazioFacebook(): EstadoDeCaptacaoFacebook {
  return {
    postsConhecidos: new Set(),
    comentariosConhecidos: new Set(),
    ultimoFilhoConhecidoPorContainer: new Map(),
  };
}

export class ErroPermissaoGraphAPI extends Error {
  constructor(mensagemOriginal: string) {
    super(
      `A Meta recusou a consulta por permissão insuficiente: "${mensagemOriginal}". `
      + 'Confirme as 4 permissões (pages_show_list, pages_read_engagement, '
      + 'pages_read_user_content, pages_manage_engagement) no token do Usuário do Sistema.',
    );
    this.name = 'ErroPermissaoGraphAPI';
  }
}

export class PaginaNaoEncontradaError extends Error {
  constructor(pageId: string) {
    super(
      `A Página com id "${pageId}" não apareceu em /me/accounts para este Usuário do `
      + 'Sistema. Confirme, no Business Manager, que a Página e o app "Velodesk" estão '
      + 'atribuídos ao mesmo Usuário do Sistema.',
    );
    this.name = 'PaginaNaoEncontradaError';
  }
}

function graphApiBase(): string {
  return `https://graph.facebook.com/${env.graphApiVersion}`;
}

const TAMANHO_DE_PAGINA = 100;

/** Trava de segurança: sem essa trava, um post antigo sem cursor conhecido faria
 * `buscarNovosFilhosDe` paginar até o comentário mais antigo dele antes de liberar o
 * ciclo pro próximo container — atrasando comentário de verdade novo de outro post. */
const MAX_PAGINAS_POR_CONTAINER_POR_CICLO = 3;

async function chamarGraphAPI<T>(url: URL): Promise<T> {
  const resposta = await fetch(url.toString());
  const corpo = (await resposta.json()) as T | GraphErroResponse;

  if (!resposta.ok || (corpo as GraphErroResponse).error) {
    const mensagemErro = (corpo as GraphErroResponse).error?.message ?? `HTTP ${resposta.status}`;
    throw new ErroPermissaoGraphAPI(mensagemErro);
  }

  return corpo as T;
}

export async function obterTokenDaPagina(systemUserToken: string, pageId: string): Promise<string> {
  const url = new URL(`${graphApiBase()}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('access_token', systemUserToken);

  const corpo = await chamarGraphAPI<{ data: GraphPaginaDoUsuarioDoSistema[] }>(url);
  const pagina = corpo.data.find((p) => p.id === pageId);
  if (!pagina) throw new PaginaNaoEncontradaError(pageId);

  return pagina.access_token;
}

export async function listarTodosOsPosts(pageId: string, pageAccessToken: string): Promise<GraphPostResumo[]> {
  const todos: GraphPostResumo[] = [];

  let url: URL | null = new URL(`${graphApiBase()}/${pageId}/feed`);
  url.searchParams.set('fields', 'id,created_time');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', pageAccessToken);

  while (url) {
    const corpo: GraphFeedResponse = await chamarGraphAPI<GraphFeedResponse>(url);
    todos.push(...corpo.data);
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  return todos;
}

/** Versão "leve" para uso em cada ciclo: para de paginar assim que encontra um post já conhecido. */
export async function descobrirPostsNovos(
  pageId: string,
  pageAccessToken: string,
  estado: EstadoDeCaptacaoFacebook,
): Promise<GraphPostResumo[]> {
  const novos: GraphPostResumo[] = [];

  let url: URL | null = new URL(`${graphApiBase()}/${pageId}/feed`);
  url.searchParams.set('fields', 'id,created_time');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', pageAccessToken);

  paginacao: while (url) {
    const corpo: GraphFeedResponse = await chamarGraphAPI<GraphFeedResponse>(url);
    for (const post of corpo.data) {
      if (estado.postsConhecidos.has(post.id)) break paginacao;
      novos.push(post);
    }
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  return novos;
}

/**
 * Genérica: `GET /{containerId}/comments` funciona tanto para um post (devolve os
 * comentários) quanto para um comentário (devolve as respostas) — por isso a mesma
 * função cobre os dois níveis. Busca do mais recente pro mais antigo e para assim que
 * encontra o último item já conhecido daquele container.
 */
export async function buscarNovosFilhosDe(
  containerId: string,
  pageAccessToken: string,
  ultimoConhecidoId: string | undefined,
): Promise<GraphComentario[]> {
  const novos: GraphComentario[] = [];

  let url: URL | null = new URL(`${graphApiBase()}/${containerId}/comments`);
  url.searchParams.set('fields', 'id,message,from,created_time,like_count,comment_count');
  url.searchParams.set('order', 'reverse_chronological');
  url.searchParams.set('limit', String(TAMANHO_DE_PAGINA));
  url.searchParams.set('access_token', pageAccessToken);

  let paginasVisitadas = 0;
  paginacao: while (url) {
    const corpo: GraphFilhosResponse = await chamarGraphAPI<GraphFilhosResponse>(url);
    for (const item of corpo.data) {
      if (item.id === ultimoConhecidoId) break paginacao;
      novos.push(item);
    }
    paginasVisitadas += 1;
    if (paginasVisitadas >= MAX_PAGINAS_POR_CONTAINER_POR_CICLO) break;
    url = corpo.paging?.next ? new URL(corpo.paging.next) : null;
  }

  return novos;
}

/** Roda um ciclo completo: posts novos → comentários novos de todo post conhecido →
 * respostas novas de todo comentário conhecido. `estado` é mutado e devolvido. */
export async function executarCicloDeCaptacaoFacebook(
  systemUserToken: string,
  pageId: string,
  estado: EstadoDeCaptacaoFacebook,
): Promise<{ itensNovos: ItemNovoFacebook[]; estadoAtualizado: EstadoDeCaptacaoFacebook }> {
  const pageAccessToken = await obterTokenDaPagina(systemUserToken, pageId);
  const itensNovos: ItemNovoFacebook[] = [];

  const postsNovos = await descobrirPostsNovos(pageId, pageAccessToken, estado);
  for (const post of postsNovos) {
    estado.postsConhecidos.add(post.id);
  }

  const comentariosNovosNesteCiclo: { comentario: GraphComentario; idDoPost: string }[] = [];

  for (const postId of estado.postsConhecidos) {
    const ultimoConhecido = estado.ultimoFilhoConhecidoPorContainer.get(postId);
    const novosComentarios = await buscarNovosFilhosDe(postId, pageAccessToken, ultimoConhecido);
    if (novosComentarios.length === 0) continue;

    for (const c of novosComentarios) {
      estado.comentariosConhecidos.add(c.id);
      comentariosNovosNesteCiclo.push({ comentario: c, idDoPost: postId });
      itensNovos.push({
        idOrigem: c.id,
        tipo: 'comentario',
        idDoPost: postId,
        idDoPai: postId,
        clienteNome: c.from?.name ?? 'Desconhecido',
        clienteHandle: c.from?.id ?? '',
        mensagem: c.message ?? '',
        dataHora: c.created_time,
        curtidas: c.like_count ?? 0,
      });
    }

    estado.ultimoFilhoConhecidoPorContainer.set(postId, novosComentarios[0].id);
  }

  for (const comentarioId of estado.comentariosConhecidos) {
    const idDoPostDeOrigem = comentariosNovosNesteCiclo.find((x) => x.comentario.id === comentarioId)?.idDoPost ?? '';
    const ultimoConhecido = estado.ultimoFilhoConhecidoPorContainer.get(comentarioId);
    const novasRespostas = await buscarNovosFilhosDe(comentarioId, pageAccessToken, ultimoConhecido);
    if (novasRespostas.length === 0) continue;

    for (const r of novasRespostas) {
      itensNovos.push({
        idOrigem: r.id,
        tipo: 'resposta',
        idDoPost: idDoPostDeOrigem,
        idDoPai: comentarioId,
        clienteNome: r.from?.name ?? 'Desconhecido',
        clienteHandle: r.from?.id ?? '',
        mensagem: r.message ?? '',
        dataHora: r.created_time,
        curtidas: r.like_count ?? 0,
      });
    }

    estado.ultimoFilhoConhecidoPorContainer.set(comentarioId, novasRespostas[0].id);
  }

  // Comentário mais novo primeiro, independente de qual post/comentário é o pai —
  // garante que a fila de classificação prioriza o que aconteceu por último na Página.
  itensNovos.sort((a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime());

  return { itensNovos, estadoAtualizado: estado };
}

/** Carga inicial — roda uma vez, popula `postsConhecidos` com todo o histórico
 * existente (as respostas de cada comentário são cobertas no primeiro
 * `executarCicloDeCaptacaoFacebook` chamado logo em seguida). */
export async function sincronizarTodosOsPostsFacebook(
  systemUserToken: string,
  pageId: string,
): Promise<EstadoDeCaptacaoFacebook> {
  const pageAccessToken = await obterTokenDaPagina(systemUserToken, pageId);
  const estado = criarEstadoVazioFacebook();

  const todosOsPosts = await listarTodosOsPosts(pageId, pageAccessToken);
  for (const post of todosOsPosts) {
    estado.postsConhecidos.add(post.id);
  }

  return estado;
}

export function normalizarDeFacebook(item: ItemNovoFacebook): ComentarioParaClassificar {
  return {
    idOrigem: item.idOrigem,
    canal: 'facebook',
    nomeCliente: item.clienteNome,
    mensagem: item.mensagem,
    dataHora: item.dataHora,
    linkOriginal: `https://facebook.com/${item.idDoPost}`,
  };
}
