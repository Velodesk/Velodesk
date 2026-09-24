/** orquestrador.service v1.0.0 — ciclo completo de Redes Sociais: captação
 * (Facebook/Instagram/Google Play) → classificação por IA → armazenamento.
 *
 * Chamado pelo job (jobs/redesSociaisCaptacao.job.ts) a cada
 * env.redesSociaisPollIntervalMs. Um canal falhando (ex.: token expirado) não impede
 * os outros de rodar — cada erro é isolado e logado.
 *
 * Estado da captação (posts/mídias/comentários já conhecidos, e o cursor de cada
 * container) é cacheado em memória durante a vida do processo, mas persistido no Mongo
 * a cada ciclo (ver redesSociaisCaptacaoEstado.service) — um reinício do processo
 * (deploy, cold start do Cloud Run) retoma de onde parou, em vez de refazer a
 * sincronização inicial do zero. O índice único de `idOrigem` em RedesSociaisComentario
 * segue como rede de segurança extra: mesmo que o cursor persistido fique desatualizado
 * por algum motivo, nada é duplicado nem reclassificado (ver idsJaExistentes em
 * redesSociaisComentario.service).
 *
 * AVISO SOBRE O PRIMEIRO CICLO DE VERDADE (sem estado nenhum no Mongo ainda): a
 * sincronização inicial só marca quais posts/mídias já existem — não marca quais
 * comentários já existem. No PRIMEIRO ciclo após ela, todo comentário/resposta já
 * existente em todo post/mídia é tratado como "novo" e classificado de uma vez (garante
 * cobertura total desde o dia 1). Isso pode tornar o primeiro ciclo mais lento e usar
 * mais chamadas de IA que os seguintes — mas só acontece uma vez, não a cada restart.
 */
import { env } from '../../config/env';
import {
  criarEstadoVazioFacebook,
  executarCicloDeCaptacaoFacebook,
  sincronizarTodosOsPostsFacebook,
  normalizarDeFacebook,
  type EstadoDeCaptacaoFacebook,
} from './captacao/facebookCaptacao.service';
import {
  criarEstadoVazioInstagram,
  executarCicloDeCaptacaoInstagram,
  sincronizarTodasAsMidias,
  normalizarDeInstagram,
  type EstadoDeCaptacaoInstagram,
} from './captacao/instagramCaptacao.service';
import {
  buscarComentariosNovosGooglePlay,
  type ContaDeServicoGoogle,
} from './captacao/googlePlayCaptacao.service';
import {
  carregarEstadoFacebook,
  salvarEstadoFacebook,
  carregarEstadoInstagram,
  salvarEstadoInstagram,
} from './redesSociaisCaptacaoEstado.service';
import { classificarComentario } from './classificacaoComentario.service';
import {
  idsJaExistentes,
  salvarComentarioClassificado,
  type ComentarioParaClassificar,
} from './redesSociaisComentario.service';

export interface ResultadoDoProcessamento {
  processados: number;
  jaExistentes: number;
  falhas: { idOrigem: string; erro: string }[];
}

/** Classifica e grava cada comentário novo; pula silenciosamente o que já existe
 * (idempotente por idOrigem). Uma falha de classificação isolada não interrompe o
 * restante do lote — fica registrada em `falhas` pra investigar depois. */
export async function processarNovosComentarios(
  comentarios: ComentarioParaClassificar[],
): Promise<ResultadoDoProcessamento> {
  const resultado: ResultadoDoProcessamento = { processados: 0, jaExistentes: 0, falhas: [] };
  if (!comentarios.length) return resultado;

  const jaExistentes = await idsJaExistentes(comentarios.map((c) => c.idOrigem));
  const novos = comentarios.filter((c) => !jaExistentes.has(c.idOrigem));
  resultado.jaExistentes = comentarios.length - novos.length;

  for (const comentario of novos) {
    try {
      const classificacao = await classificarComentario(comentario);
      if (!classificacao) {
        resultado.falhas.push({ idOrigem: comentario.idOrigem, erro: 'Classificação por IA indisponível ou inválida' });
        continue;
      }

      await salvarComentarioClassificado({ ...comentario, ...classificacao });
      resultado.processados += 1;
    } catch (err) {
      resultado.falhas.push({ idOrigem: comentario.idOrigem, erro: (err as Error).message });
    }
  }

  return resultado;
}

function logarResultado(origem: string, resultado: ResultadoDoProcessamento): void {
  console.info(
    `[redes-sociais] [${origem}] ${resultado.processados} classificados, `
    + `${resultado.jaExistentes} já existentes, ${resultado.falhas.length} falhas.`,
  );
  for (const falha of resultado.falhas) {
    console.warn(`[redes-sociais] [${origem}] falha ao classificar ${falha.idOrigem}: ${falha.erro}`);
  }
}

let estadoFacebook: EstadoDeCaptacaoFacebook | null = null;
let estadoInstagram: EstadoDeCaptacaoInstagram | null = null;

async function rodarCicloFacebook(): Promise<void> {
  const { fbSystemUserToken: token, fbPageId: pageId } = env;
  if (!token || !pageId) {
    console.info('[redes-sociais] [Facebook] FB_SYSTEM_USER_TOKEN/FB_PAGE_ID não configurados — pulando.');
    return;
  }

  if (!estadoFacebook) {
    estadoFacebook = await carregarEstadoFacebook();
    if (estadoFacebook) {
      console.info(
        `[redes-sociais] [Facebook] estado restaurado do Mongo: ${estadoFacebook.postsConhecidos.size} posts, `
        + `${estadoFacebook.comentariosConhecidos.size} comentários conhecidos.`,
      );
    } else {
      console.info('[redes-sociais] [Facebook] sem estado salvo — sincronizando lista de posts…');
      estadoFacebook = await sincronizarTodosOsPostsFacebook(token, pageId);
      console.info(`[redes-sociais] [Facebook] sincronização inicial: ${estadoFacebook.postsConhecidos.size} posts conhecidos.`);
    }
  }

  const { itensNovos, estadoAtualizado } = await executarCicloDeCaptacaoFacebook(token, pageId, estadoFacebook);
  estadoFacebook = estadoAtualizado;
  await salvarEstadoFacebook(estadoFacebook);
  if (!itensNovos.length) return;

  const resultado = await processarNovosComentarios(itensNovos.map(normalizarDeFacebook));
  logarResultado('Facebook', resultado);
}

async function rodarCicloInstagram(): Promise<void> {
  const { instagramAccessToken: token } = env;
  if (!token) {
    console.info('[redes-sociais] [Instagram] INSTAGRAM_ACCESS_TOKEN não configurado — pulando.');
    return;
  }

  if (!estadoInstagram) {
    estadoInstagram = await carregarEstadoInstagram();
    if (estadoInstagram) {
      console.info(
        `[redes-sociais] [Instagram] estado restaurado do Mongo: ${estadoInstagram.midiasConhecidas.size} mídias, `
        + `${estadoInstagram.comentariosConhecidos.size} comentários conhecidos.`,
      );
    } else {
      console.info('[redes-sociais] [Instagram] sem estado salvo — sincronizando lista de mídias…');
      estadoInstagram = await sincronizarTodasAsMidias(token);
      console.info(`[redes-sociais] [Instagram] sincronização inicial: ${estadoInstagram.midiasConhecidas.size} mídias conhecidas.`);
    }
  }

  const { itensNovos, estadoAtualizado } = await executarCicloDeCaptacaoInstagram(token, estadoInstagram);
  estadoInstagram = estadoAtualizado;
  await salvarEstadoInstagram(estadoInstagram);
  if (!itensNovos.length) return;

  const resultado = await processarNovosComentarios(itensNovos.map(normalizarDeInstagram));
  logarResultado('Instagram', resultado);
}

async function rodarCicloGooglePlay(): Promise<void> {
  const { googleServiceAccountJson: json, googlePlayPackageName: packageName } = env;
  if (!json || !packageName) {
    console.info('[redes-sociais] [Google Play] GOOGLE_SERVICE_ACCOUNT_JSON/GOOGLE_PLAY_PACKAGE_NAME não configurados — pulando.');
    return;
  }

  const contaDeServico = JSON.parse(json) as ContaDeServicoGoogle;
  const comentarios = await buscarComentariosNovosGooglePlay(contaDeServico, packageName);
  if (!comentarios.length) return;

  const resultado = await processarNovosComentarios(comentarios);
  logarResultado('Google Play', resultado);
}

/** Roda um ciclo completo: Facebook, Instagram e Google Play em sequência — cada canal
 * com erro isolado (não impede os demais). Chamar a cada env.redesSociaisPollIntervalMs. */
export async function rodarCicloRedesSociais(): Promise<void> {
  await rodarCicloFacebook().catch((err) => console.error('[redes-sociais] [Facebook] erro no ciclo:', (err as Error).message));
  await rodarCicloInstagram().catch((err) => console.error('[redes-sociais] [Instagram] erro no ciclo:', (err as Error).message));
  await rodarCicloGooglePlay().catch((err) => console.error('[redes-sociais] [Google Play] erro no ciclo:', (err as Error).message));
}
