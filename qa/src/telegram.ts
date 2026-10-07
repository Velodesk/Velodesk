/**
 * telegram v2.0.0 — notificação curta da rodada de QA pro Telegram (gestão)
 *
 * Formato pensado para quem recebe a mensagem (gestão), não para quem vai investigar — o
 * detalhe técnico ("Esperado"/"Encontrado") continua só no Excel e no painel Sentinela
 * (QA_PAINEL_URL), atrás do botão "Ver detalhes". Ver mockup-notificacao-qa-velodesk_3.html.
 */
import 'dotenv/config';
import { cfg } from './config';
import type { Resultado, Metrica } from './resultado';
import type { Area } from './catalogo';
import type { CasoAnterior } from './estadoSentinela';

/** Telegram recusa mensagem acima de 4096 caracteres; fica com folga para o cabeçalho e o rodapé. */
const LIMITE_MENSAGEM = 3500;

/** Nome mais curto/comercial para a área, só nesta notificação — o resto do sistema (Excel,
 * painel) continua usando o nome original do catálogo (ver catalogo.ts). */
const AREA_LABEL: Partial<Record<Area, string>> = {
  'Envios de e-mail': 'E-mails automáticos',
};

function rotuloArea(area: Area): string {
  return AREA_LABEL[area] ?? area;
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

export interface EnvioTelegramOpts {
  /** Mostra o botão inline "🔎 Ver detalhes" apontando para QA_PAINEL_URL. */
  comBotaoDetalhes?: boolean;
}

export async function enviarRelatorioTelegram(mensagem: string, opts: EnvioTelegramOpts = {}): Promise<void> {
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
      inline_keyboard: [[{ text: '🔎 Ver detalhes', url: cfg.painelUrl }]],
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

function montarMensagemFalha(agora: Date, novas: Resultado[]): string {
  const { texto, ocorrencias } = montarBlocoPorArea(novas);
  return (
    `🔴 <b>QA Velodesk · Falha encontrada</b>\n` +
    `Rodada ${formatarDataHora(agora)}\n\n` +
    `${ocorrencias} ocorrência${ocorrencias === 1 ? '' : 's'}:\n\n` +
    `${texto}\n\n` +
    `✅ Suporte já acionado.`
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

function areasVerificadasLabel(resultados: Resultado[]): string {
  const vistas: string[] = [];
  for (const r of resultados) {
    const label = rotuloArea(r.caso.area);
    if (!vistas.includes(label)) vistas.push(label);
  }
  if (vistas.length <= 3) return vistas.join(', ');
  return `${vistas.slice(0, 2).join(', ')} e demais verificações`;
}

function montarMensagemTudoCerto(agora: Date, resultados: Resultado[]): string {
  return (
    `🟢 <b>QA Velodesk · Tudo certo</b>\n` +
    `Rodada ${formatarDataHora(agora)}\n\n` +
    `Nenhuma falha encontrada hoje.\n` +
    `${escapeHtml(areasVerificadasLabel(resultados))}: ok.`
  );
}

export interface MensagemRodada {
  texto: string;
  comBotaoDetalhes: boolean;
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
    return { texto: montarMensagemFalha(agora, novas), comBotaoDetalhes: true };
  }
  if (resolvidas.length) {
    return { texto: montarMensagemResolvido(agora, resolvidas), comBotaoDetalhes: false };
  }
  if (jaConhecidas.length || metricasAtencao.length || parciais.length) {
    return {
      texto: montarMensagemAtencao(agora, [...jaConhecidas, ...parciais], metricasAtencao),
      comBotaoDetalhes: true,
    };
  }
  return { texto: montarMensagemTudoCerto(agora, resultados), comBotaoDetalhes: false };
}
