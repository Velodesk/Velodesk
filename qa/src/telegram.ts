/**
 * telegram v2.2.0 — notificação curta da rodada de QA pro Telegram (gestão)
 *
 * Formato pensado para quem recebe a mensagem (gestão), não para quem vai investigar — o
 * detalhe técnico (percentuais, canais, protocolos, "esperado/encontrado") continua só no Excel
 * e no painel Sentinela (QA_PAINEL_URL), atrás do botão "Ver no Sentinela". 🔴 Falha e 🟢 Tudo
 * certo viraram um placar objetivo por área (ver montarMensagemFalha/montarMensagemTudoCerto e
 * mockup-notificacao-qa-v2-objetiva.html, Opção B) — no máximo ~10 linhas, sem número
 * secundário/percentual/protocolo na frase de cada área, só a contagem entre parênteses. 🟡
 * Atenção e 🟢 Resolvido ainda usam o formato anterior, mais detalhado (ver
 * montarMensagemAtencao/montarMensagemResolvido) — não fizeram parte deste pedido.
 *
 * Em rodada de vigilância (QA_MODO_EXECUCAO=vigilancia, a cada 30 min em horário comercial),
 * enviarRelatorioTelegram suprime o envio quando o tipo decidido é 'resolvido' ou 'tudo-certo'
 * — só 🔴 Falha e 🟡 Atenção saem fora do horário das rodadas oficiais (ver EnvioTelegramOpts).
 */
import 'dotenv/config';
import { cfg, type ModoExecucao } from './config';
import type { Resultado, Metrica } from './resultado';
import type { Area } from './catalogo';
import type { CasoAnterior } from './estadoSentinela';

/** Telegram recusa mensagem acima de 4096 caracteres; fica com folga para o cabeçalho e o rodapé.
 * Só usado por montarMensagemAtencao (formato antigo, por ocorrência) — o placar por área
 * (montarMensagemFalha) é curto o bastante (no máximo ~10 linhas) pra nunca precisar cortar. */
const LIMITE_MENSAGEM = 3500;

/** Nome mais curto/comercial para a área, só nesta notificação — o resto do sistema (Excel,
 * painel) continua usando o nome original do catálogo (ver catalogo.ts). */
const AREA_LABEL: Partial<Record<Area, string>> = {
  'Envios de e-mail': 'E-mails automáticos',
};

function rotuloArea(area: Area): string {
  return AREA_LABEL[area] ?? area;
}

/** Emoji + rótulo curto por área, só pro placar de 🔴 Falha (ver montarPlacarPorArea) — mais
 * enxuto que AREA_LABEL, que é usado no formato antigo (por ocorrência) do 🟡 Atenção. */
const AREA_PLACAR: Record<Area, { emoji: string; label: string }> = {
  'Saúde do sistema': { emoji: '🩺', label: 'Saúde' },
  'Tickets novos': { emoji: '🆕', label: 'Tickets novos' },
  'Mensagens e respostas': { emoji: '💬', label: 'Mensagens' },
  Finalização: { emoji: '⚙️', label: 'Finalização' },
  Mesclas: { emoji: '🔀', label: 'Mesclas' },
  'Envios de e-mail': { emoji: '📧', label: 'E-mails' },
  CSAT: { emoji: '⭐', label: 'CSAT' },
  Erros: { emoji: '🚨', label: 'Erros' },
  'Telas (navegador)': { emoji: '🖥️', label: 'Telas' },
};

/** "dd/mm hh:mm" — mais curto que formatarDataHora (que usa "dd/mm às hh:mm"), só pro placar. */
function formatarDataHoraCurta(d: Date): string {
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: cfg.timezone, day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: cfg.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${data} ${hora}`;
}

function escapeHtml(texto: unknown): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatarDataHora(d: Date): string {
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: cfg.timezone, day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', {
    timeZone: cfg.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${data} às ${hora}`;
}

/** Qual das 4 variantes a rodada decidiu mandar — ver montarMensagemResumo. */
export type TipoMensagemRodada = 'falha' | 'resolvido' | 'atencao' | 'tudo-certo';

export interface EnvioTelegramOpts {
  /** Mostra o botão inline "🔎 Ver no Sentinela" apontando para QA_PAINEL_URL. */
  comBotaoDetalhes?: boolean;
  /** Tipo de mensagem decidido por montarMensagemResumo — junto com `modoExecucao`,
   * decide se o envio é suprimido (ver comentário mais abaixo). */
  tipo?: TipoMensagemRodada;
  /**
   * Modo da rodada atual. Em 'vigilancia' (rodada extra de 30 em 30 min, só
   * leitura), o Telegram só é efetivamente enviado quando há achado real —
   * 🔴 Falha ou 🟡 Atenção. 🟢 Resolvido e 🟢 Tudo certo ficam em silêncio
   * total: essas boas notícias continuam só saindo nas rodadas oficiais
   * (07h/17h), pra não virar ruído a cada 30 minutos. Em 'oficial' (padrão,
   * quando omitido) o comportamento é sempre o de antes: as 4 variantes saem.
   */
  modoExecucao?: ModoExecucao;
}

export async function enviarRelatorioTelegram(mensagem: string, opts: EnvioTelegramOpts = {}): Promise<void> {
  if (opts.modoExecucao === 'vigilancia' && opts.tipo && opts.tipo !== 'falha' && opts.tipo !== 'atencao') {
    console.log(`[qa] rodada de vigilância sem achado (tipo "${opts.tipo}") — envio ao Telegram suprimido de propósito.`);
    return;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados — pulando envio.');
    return;
  }

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text: mensagem,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (opts.comBotaoDetalhes && cfg.painelUrl) {
    body.reply_markup = {
      inline_keyboard: [[{ text: '🔎 Ver no Sentinela', url: cfg.painelUrl }]],
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const erro = await res.text();
      console.error('[Telegram] Falha ao enviar mensagem:', res.status, erro);
    }
  } catch (err) {
    // Nunca deixar o erro de Telegram derrubar a rodada de testes
    console.error('[Telegram] Erro ao chamar API do Telegram:', err);
  }
}

/** Uma linha (um achado) dentro do bloco de uma área, já com os textos prontos para render. */
interface LinhaAchado {
  areaLabel: string;
  item: string;
  resumo: string;
  canais?: string[];
  impacto: number;
}

/** Explode um Resultado em 1+ linhas — usa `ocorrencias` quando o caso detalha por item (ex.:
 * E09, um modelo de e-mail por ocorrência); senão cai numa linha genérica com a observação. */
function linhasDoResultado(r: Resultado): LinhaAchado[] {
  const areaLabel = rotuloArea(r.caso.area);
  if (r.ocorrencias?.length) {
    return r.ocorrencias.map((o) => ({
      areaLabel,
      item: o.item,
      resumo: o.resumo,
      canais: o.canais,
      impacto: o.impacto,
    }));
  }
  // Observação pode ter várias linhas (listarAchados) — a notificação da gestão fica só com a
  // primeira, o resto é exatamente o detalhe técnico que vai para o painel/Excel.
  const primeiraLinha = r.observacao.split('\n')[0].replace(/^\d+\.\s*/, '');
  return [{ areaLabel, item: r.caso.funcionalidade, resumo: primeiraLinha, impacto: 1 }];
}

function renderLinha(l: LinhaAchado): string {
  const canaisTxt = l.canais?.length ? ` (${l.canais.map((c) => escapeHtml(c)).join(', ')})` : '';
  return `▪ <b>${escapeHtml(l.item)}:</b> ${escapeHtml(l.resumo)}${canaisTxt}`;
}

function somaImpacto(linhas: LinhaAchado[]): number {
  return linhas.reduce((s, l) => s + l.impacto, 0);
}

/**
 * Agrupa por área (maior impacto primeiro), ordena as linhas dentro de cada área (idem) e
 * corta em ~LIMITE_MENSAGEM caracteres, terminando com "+N outras, ver detalhes" quando preciso.
 */
function montarBlocoPorArea(resultados: Resultado[]): { texto: string; ocorrencias: number } {
  const linhas = resultados.flatMap(linhasDoResultado);
  const totalOcorrencias = linhas.length;

  const porArea = new Map<string, LinhaAchado[]>();
  for (const l of linhas) {
    const arr = porArea.get(l.areaLabel) ?? [];
    arr.push(l);
    porArea.set(l.areaLabel, arr);
  }

  const areas = [...porArea.entries()]
    .map(([area, ls]) => ({ area, linhas: ls.slice().sort((a, b) => b.impacto - a.impacto) }))
    .sort((a, b) => somaImpacto(b.linhas) - somaImpacto(a.linhas));

  const blocos: string[] = [];
  let tamanho = 0;
  let omitidas = 0;
  let truncando = false;

  for (const { area, linhas: ls } of areas) {
    if (truncando) {
      omitidas += ls.length;
      continue;
    }
    const header = `<b>${escapeHtml(area)}</b> — ${ls.length} ocorrência${ls.length === 1 ? '' : 's'}:`;
    const linhasIncluidas: string[] = [];
    for (const l of ls) {
      const linhaTxt = renderLinha(l);
      const custoProjetado =
        tamanho + header.length + [...linhasIncluidas, linhaTxt].join('\n').length + 2;
      if (custoProjetado > LIMITE_MENSAGEM) {
        truncando = true;
        omitidas += 1;
        continue;
      }
      linhasIncluidas.push(linhaTxt);
    }
    if (linhasIncluidas.length) {
      const blocoTxt = `${header}\n${linhasIncluidas.join('\n')}`;
      blocos.push(blocoTxt);
      tamanho += blocoTxt.length + 2;
    }
  }

  let texto = blocos.join('\n\n');
  if (omitidas > 0) {
    texto += `\n\n+${omitidas} outra(s), ver detalhes`;
  }
  return { texto, ocorrencias: totalOcorrencias };
}

/** Uma linha do placar: área + quantas ocorrências (ocorrencias[] quando o caso detalha por
 * item, senão 1 por resultado) + frase objetiva (resumoCurto do(s) caso(s) daquela área,
 * deduplicada — ver CasoCatalogo.resumoCurto em catalogo.ts). */
interface LinhaPlacar {
  area: Area;
  n: number;
  frase: string;
}

function montarPlacarPorArea(resultados: Resultado[]): LinhaPlacar[] {
  // Conta ocorrências de verdade (uma por item de `ocorrencias`, ex.: um modelo de e-mail em
  // E09) — EXCETO quando o caso tem `ocorrenciasPorRegistro: true` (ex.: X07, uma ocorrência
  // por ticket parado): nesse caso sempre conta como 1, senão "Erros" viraria "(28)" em vez de
  // "(1)" com 28 tickets parados — a granularidade por registro é só pro Excel/painel.
  const porArea = new Map<Area, { n: number; frases: string[] }>();
  for (const r of resultados) {
    const n = r.caso.ocorrenciasPorRegistro ? 1 : r.ocorrencias?.length || 1;
    const entry = porArea.get(r.caso.area) ?? { n: 0, frases: [] };
    entry.n += n;
    const frase = r.caso.resumoCurto ?? r.caso.funcionalidade;
    if (!entry.frases.includes(frase)) entry.frases.push(frase);
    porArea.set(r.caso.area, entry);
  }
  return [...porArea.entries()]
    .map(([area, { n, frases }]) => ({ area, n, frase: frases.join('; ') }))
    .sort((a, b) => b.n - a.n);
}

/**
 * Placar objetivo por área (Opção B do mockup v2) — "📧 E-mails (4): atrasos e e-mails que não
 * saíram". Só a contagem entre parênteses e uma frase curta por área, sem percentual, canal,
 * protocolo ou explicação — isso continua só no Excel e no painel Sentinela (botão "Ver no
 * Sentinela"). No máximo ~10 linhas (1 cabeçalho + 1 por área, tipicamente 1-9 áreas).
 */
function montarMensagemFalha(agora: Date, novas: Resultado[], totalAnalisados: number): string {
  const placar = montarPlacarPorArea(novas);
  const total = placar.reduce((s, l) => s + l.n, 0);
  const linhas = placar.map(({ area, n, frase }) => {
    const info = AREA_PLACAR[area];
    return `${info.emoji} <b>${escapeHtml(info.label)} (${n}):</b> ${escapeHtml(frase)}`;
  });
  return (
    `🔴 <b>QA Velodesk</b> · ${formatarDataHoraCurta(agora)}\n` +
    `De ${totalAnalisados} somente <b>${total} falha${total === 1 ? '' : 's'}</b> encontrada${total === 1 ? '' : 's'}\n\n` +
    linhas.join('\n')
  );
}

function montarMensagemAtencao(agora: Date, pendentes: Resultado[], metricas: Metrica[]): string {
  const partes: string[] = [];

  if (pendentes.length) {
    const { texto } = montarBlocoPorArea(pendentes);
    partes.push(`<b>Ainda em aberto (já conhecido, sem mudança):</b>\n${texto}`);
  }

  if (metricas.length) {
    const linhasMetricas = metricas
      .map((m) => `▪ ${escapeHtml(m.nome)}: ${escapeHtml(String(m.valor))}`)
      .join('\n');
    partes.push(`<b>Métricas fora do normal:</b>\n${linhasMetricas}`);
  }

  return (
    `🟡 <b>QA Velodesk · Atenção</b>\n` +
    `Rodada ${formatarDataHora(agora)}\n\n` +
    `${partes.join('\n\n')}\n\n` +
    `Sem ação urgente. Em acompanhamento.`
  );
}

function montarMensagemResolvido(agora: Date, resolvidas: string[]): string {
  const lista = resolvidas.map((o) => `• ${escapeHtml(o)}`).join('\n');
  const plural = resolvidas.length === 1 ? '' : 's';
  return (
    `🟢 <b>QA Velodesk · Resolvido</b>\n` +
    `Rodada ${formatarDataHora(agora)}\n\n` +
    `${resolvidas.length === 1 ? 'O problema' : `Os ${resolvidas.length} problemas`} abaixo foi${plural} corrigido${plural}:\n` +
    `${lista}\n\n` +
    `Nenhuma falha aberta no momento.`
  );
}

function montarMensagemTudoCerto(agora: Date): string {
  return `🟢 <b>QA Velodesk</b> · ${formatarDataHoraCurta(agora)}\nTudo certo, nenhuma falha.`;
}

export interface MensagemRodada {
  texto: string;
  comBotaoDetalhes: boolean;
  /** Qual das 4 variantes foi escolhida — usado por enviarRelatorioTelegram para decidir a
   * supressão em modo vigilância (ver EnvioTelegramOpts.modoExecucao). */
  tipo: TipoMensagemRodada;
}

/**
 * "Falha" = situacao 'Nao' — registrar() (resultado.ts) já rebatiza falha em caso conhecido
 * pelo time para 'Falha conhecida' antes de chegar aqui, então um 'Nao' que sobra é sempre
 * regressão não mapeada.
 *
 * `anterior` é o retrato da rodada passada (ver lerEstadoAnteriorMongo). Com ele, separa o que
 * já foi notificado e continua idêntico (não repete alarme 🔴 por um problema conhecido que não
 * mudou — vira 🟡 Atenção, não silêncio) do que é genuinamente novo ou mudou (🔴) e do que foi
 * corrigido desde então (🟢 Resolvido). Sem `anterior` (primeira rodada, ou Mongo fora), trata
 * tudo como novo — comportamento de antes.
 *
 * Prioridade quando mais de uma condição se aplica na mesma rodada: falha nova > resolvido >
 * atenção > tudo certo — sempre exatamente uma mensagem por rodada (ver run.ts).
 */
export function montarMensagemResumo(
  resultados: Resultado[],
  metricas: Metrica[],
  anterior?: Map<string, CasoAnterior> | null,
): MensagemRodada {
  const agora = new Date();
  const falhas = resultados.filter((r) => r.situacao === 'Nao');

  const eraFalhaIgual = (f: Resultado) => {
    const antes = anterior?.get(f.caso.id);
    return Boolean(antes && antes.situacao === 'Nao' && antes.observacao === f.observacao);
  };
  const novas = falhas.filter((f) => !eraFalhaIgual(f));
  const jaConhecidas = falhas.filter(eraFalhaIgual);
  const resolvidas = anterior
    ? [...anterior.entries()]
        .filter(([, antes]) => antes.situacao === 'Nao')
        .filter(([id]) => !falhas.some((f) => f.caso.id === id))
        .map(([id]) => resultados.find((r) => r.caso.id === id)?.caso.funcionalidade ?? id)
    : [];
  const metricasAtencao = metricas.filter((m) => m.situacao !== 'Normal');
  const parciais = resultados.filter((r) => r.situacao === 'Parcial');

  if (novas.length) {
    return { texto: montarMensagemFalha(agora, novas, resultados.length), comBotaoDetalhes: true, tipo: 'falha' };
  }
  if (resolvidas.length) {
    return { texto: montarMensagemResolvido(agora, resolvidas), comBotaoDetalhes: false, tipo: 'resolvido' };
  }
  if (jaConhecidas.length || metricasAtencao.length || parciais.length) {
    return {
      texto: montarMensagemAtencao(agora, [...jaConhecidas, ...parciais], metricasAtencao),
      comBotaoDetalhes: true,
      tipo: 'atencao',
    };
  }
  return { texto: montarMensagemTudoCerto(agora), comBotaoDetalhes: false, tipo: 'tudo-certo' };
}
