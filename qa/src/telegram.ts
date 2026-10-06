/**
 * telegram v1.1.0 — envio de relatório/alerta da rodada de QA pro Telegram
 */
import 'dotenv/config';
import type { Resultado } from './resultado';
import type { CasoAnterior } from './estadoSentinela';

export async function enviarRelatorioTelegram(mensagem: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID não configurados — pulando envio.');
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: mensagem,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
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

/**
 * "Falha" = situacao 'Nao' — registrar() (resultado.ts) já rebatiza falha em caso conhecido
 * pelo time para 'Falha conhecida' antes de chegar aqui, então um 'Nao' que sobra é sempre
 * regressão não mapeada.
 *
 * `anterior` é o retrato da rodada passada (ver lerEstadoAnteriorMongo). Com ele, separa o que
 * já foi notificado e continua idêntico (não teria porque alertar de novo todo dia) do que é
 * genuinamente novo ou mudou — e também avisa o que foi corrigido desde então. Sem `anterior`
 * (primeira rodada, ou Mongo fora), trata tudo como novo — comportamento de antes.
 */
export function montarMensagemResumo(resultados: Resultado[], anterior?: Map<string, CasoAnterior> | null): string {
  const total = resultados.length;
  const falhas = resultados.filter((r) => r.situacao === 'Nao');

  const eraFalhaIgual = (f: Resultado) => {
    const antes = anterior?.get(f.caso.id);
    return Boolean(antes && antes.situacao === 'Nao' && antes.observacao === f.observacao);
  };
  const novas = falhas.filter((f) => !eraFalhaIgual(f));
  const jaConhecidas = falhas.filter(eraFalhaIgual);
  const resolvidas = anterior
    ? [...anterior.entries()]
        .filter(([id, antes]) => antes.situacao === 'Nao')
        .filter(([id]) => !falhas.some((f) => f.caso.id === id))
        .map(([id]) => resultados.find((r) => r.caso.id === id)?.caso.objetivo ?? id)
    : [];

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  // Caso 1: nada novo nem pendente — mensagem tranquilizadora, sem alarde
  if (novas.length === 0 && jaConhecidas.length === 0) {
    let msg =
      `✅ <b>QA Velodesk — Rodada ${agora}</b>\n\n` +
      `Teste realizado e tudo dentro do esperado.\n\n` +
      `Total de verificações: ${total}`;
    if (resolvidas.length) {
      msg += `\n\n<b>Corrigido desde a última rodada:</b>\n` + resolvidas.map((o) => `• ${o}`).join('\n');
    }
    return msg;
  }

  // Caso 2: há falha nova/mudada — detalha ponto a ponto; falha repetida fica resumida
  let msg = `🔴 <b>QA Velodesk — Rodada ${agora}</b>\n\n`;

  if (novas.length) {
    msg += `Foram identificados ${novas.length} ponto(s) novo(s) ou que mudaram nesta rodada:\n\n`;
    novas.forEach((f, i) => {
      msg += `<b>${i + 1}. ${f.caso.area} — ${f.caso.objetivo}</b>\n`;
      msg += `Esperado: ${f.caso.esperado}\n`;
      msg += `Encontrado: ${f.observacao}\n\n`;
    });
  }

  if (jaConhecidas.length) {
    msg += `<b>Já notificado antes, ainda sem correção (${jaConhecidas.length}):</b>\n`;
    msg += jaConhecidas.map((f) => `• ${f.caso.area} — ${f.caso.objetivo}`).join('\n');
    msg += '\n\n';
  }

  if (resolvidas.length) {
    msg += `<b>Corrigido desde a última rodada:</b>\n` + resolvidas.map((o) => `• ${o}`).join('\n') + '\n\n';
  }

  msg += `Encaminhado para a equipe de suporte para as devidas correções.`;

  return msg;
}
