/**
 * limpeza v1.0.0 — encerra os tickets criados pela rodada
 *
 * Motivo: ticket de QA resolvido continua elegível à pesquisa de satisfação e
 * aparece nas contagens de gestão. Fechando, ele sai das filas e das rotinas.
 * Só toca em ticket criado pela própria rodada.
 */
import { cfg } from './config';
import type { Contexto } from './contexto';
import { exigirTicketDeQa } from './db';

export interface ResultadoLimpeza {
  fechados: number;
  falhas: string[];
}

export async function limparTicketsDaRodada(ctx: Contexto): Promise<ResultadoLimpeza> {
  const resultado: ResultadoLimpeza = { fechados: 0, falhas: [] };
  if (!ctx.podeEscrever) return resultado;

  for (const ticket of ctx.criados) {
    if (!ticket.id) continue;
    try {
      if (ctx.temBanco) await exigirTicketDeQa(ticket.id);
      const r = await ctx.api.commit(ticket.id, {
        status: 'fechado',
        author: ctx.nomeAtendente || cfg.responsavel,
        internalText: `Encerrado pelo agente de QA — rodada ${ctx.runId}.`,
        lateralForm: {
          ...(ctx.tabulacao ?? {}),
          responsavel: ctx.nomeAtendente || cfg.responsavel,
        },
      });
      if (r.status === 200) resultado.fechados += 1;
      else resultado.falhas.push(`${ticket.protocolo}: status ${r.status} — ${r.body?.message ?? ''}`);
    } catch (err) {
      resultado.falhas.push(`${ticket.protocolo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return resultado;
}
