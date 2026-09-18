/**
 * telegram v1.1.0 — envio de relatório/alerta da rodada de QA pro Telegram
 */
import 'dotenv/config';
import type { Resultado } from './resultado';

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
 * "Falha nova" = situacao 'Nao' — registrar() (resultado.ts) já rebatiza falha em caso
 * conhecido pelo time para 'Falha conhecida' antes de chegar aqui, então um 'Nao' que
 * sobra é sempre regressão não mapeada.
 */
export function montarMensagemResumo(resultados: Resultado[]): string {
  const total = resultados.length;
  const falhasNovas = resultados.filter((r) => r.situacao === 'Nao');

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  // Caso 1: tudo certo — mensagem tranquilizadora, sem alarde
  if (falhasNovas.length === 0) {
    return (
      `✅ <b>QA Velodesk — Rodada ${agora}</b>\n\n` +
      `Teste realizado e tudo dentro do esperado.\n\n` +
      `Total de verificações: ${total}`
    );
  }

  // Caso 2: há falha nova — detalha ponto a ponto
  let msg = `🔴 <b>QA Velodesk — Rodada ${agora}</b>\n\n`;
  msg += `Foram identificados ${falhasNovas.length} ponto(s) fora do esperado nesta rodada:\n\n`;

  falhasNovas.forEach((f, i) => {
    msg += `<b>${i + 1}. ${f.caso.area} — ${f.caso.objetivo}</b>\n`;
    msg += `Esperado: ${f.caso.esperado}\n`;
    msg += `Encontrado: ${f.observacao}\n\n`;
  });

  msg += `Encaminhado para a equipe de suporte para as devidas correções.`;

  return msg;
}
