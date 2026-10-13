/**
 * agentFeedback.service v1.1.0 — persistência de feedback para aprendizado
 * VERSION: v1.1.0 | DATE: 2026-10-02 — `reprovacao_operador` entra nos exemplos do prompt
 */
import { AgentFeedback } from '../../models/AgentFeedback';
import type { TicketAiTabulationResult } from './agentTypes';

export interface SaveFeedbackParams {
  ticketId?: string;
  protocolo?: string;
  agentOrigem: 'atendimento' | 'auditoria';
  tipoEvento: 'revisao_automatica' | 'revisao_solicitada' | 'bloqueio_critico' | 'envio_autonomo' | 'reprovacao_operador';
  scoreAntes?: number;
  scoreDepois?: number;
  violacoes?: string[];
  inputOperador?: string;
  respostaAntes?: string;
  respostaDepois?: string;
  tabulacao?: TicketAiTabulationResult;
}

export async function saveAgentFeedback(params: SaveFeedbackParams): Promise<boolean> {
  try {
    await AgentFeedback.create({
      ticketId: params.ticketId,
      protocolo: params.protocolo,
      agentOrigem: params.agentOrigem,
      tipoEvento: params.tipoEvento,
      scoreAntes: params.scoreAntes,
      scoreDepois: params.scoreDepois,
      violacoes: params.violacoes || [],
      inputOperador: params.inputOperador,
      respostaAntes: params.respostaAntes,
      respostaDepois: params.respostaDepois,
      tabulacao: params.tabulacao,
      produto: params.tabulacao?.produto,
      motivo: params.tabulacao?.motivo,
    });
    return true;
  } catch (err) {
    console.warn('[agent-feedback] falha ao persistir:', (err as Error).message);
    return false;
  }
}

export async function getFeedbackExamplesForPrompt(
  produto?: string,
  motivo?: string,
  limit = 3,
): Promise<string> {
  try {
    const filter: Record<string, unknown> = {
      tipoEvento: { $in: ['revisao_automatica', 'revisao_solicitada', 'reprovacao_operador'] },
    };
    if (produto?.trim()) filter.produto = produto.trim();
    if (motivo?.trim()) filter.motivo = motivo.trim();

    const items = await AgentFeedback.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    if (!items.length) return '';

    return items.map((item, idx) => {
      const lines = [
        `### Exemplo ${idx + 1}`,
        `Violações: ${(item.violacoes || []).join('; ') || 'n/a'}`,
      ];
      if (item.inputOperador) lines.push(`Input operador: ${item.inputOperador}`);
      if (item.respostaAntes) lines.push(`Antes: ${String(item.respostaAntes).slice(0, 400)}`);
      if (item.respostaDepois) lines.push(`Depois: ${String(item.respostaDepois).slice(0, 400)}`);
      return lines.join('\n');
    }).join('\n\n');
  } catch (err) {
    console.warn('[agent-feedback] falha ao carregar exemplos:', (err as Error).message);
    return '';
  }
}

export async function listAgentFeedback(limit = 50, skip = 0) {
  return AgentFeedback.find()
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
}

export async function exportAgentFeedbackCsv(): Promise<string> {
  const items = await AgentFeedback.find().sort({ createdAt: -1 }).limit(5000).lean();
  const header = 'createdAt,protocolo,tipoEvento,scoreAntes,scoreDepois,produto,motivo,violacoes,inputOperador';
  const rows = items.map((item) => [
    item.createdAt?.toISOString?.() || '',
    item.protocolo || '',
    item.tipoEvento,
    item.scoreAntes ?? '',
    item.scoreDepois ?? '',
    item.produto || '',
    item.motivo || '',
    (item.violacoes || []).join('|'),
    (item.inputOperador || '').replace(/"/g, '""'),
  ].map((v) => `"${String(v)}"`).join(','));
  return [header, ...rows].join('\n');
}
