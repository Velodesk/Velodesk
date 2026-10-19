/**
 * autonomyGate.util v2.0.0 — régua do ENVIO DIRETO (congelado nesta fase; liberação futura)
 * VERSION: v2.0.0 | DATE: 2026-10-19
 *
 * Sem humano no meio, o envio direto exige: auditor aprovou (aprovar_auto), nota ≥ mínimo, confiança alta,
 * todos os critérios verdadeiros, não-Reclamação e concordância de tabulação entre Agente 1 e Auditor.
 * A fila de aprovação humana NÃO usa esta régua: lá o critério é só a nota mínima do auditor.
 */
import type { AuditoriaResult, ConfidenceLevel, TicketAiTabulationResult } from './agentTypes';

export interface StrictGateInput {
  audit: AuditoriaResult;
  confidence?: ConfidenceLevel;
  tabulacao: TicketAiTabulationResult;
  minAuditScore: number;
}

export interface StrictGateResult {
  ok: boolean;
  reason?: string;
}

function sameTab(a: TicketAiTabulationResult, b: TicketAiTabulationResult): boolean {
  const n = (v?: string) => String(v || '').trim().toLowerCase();
  return n(a.produto) === n(b.produto) && n(a.motivo) === n(b.motivo) && n(a.detalhe) === n(b.detalhe);
}

export function evaluateStrictGate(input: StrictGateInput): StrictGateResult {
  const { audit, confidence, tabulacao, minAuditScore } = input;

  if (!audit.success || !audit.aprovado || audit.decisao !== 'aprovar_auto') {
    return { ok: false, reason: 'Auditor não aprovou para envio autônomo' };
  }
  if ((audit.score ?? 0) < minAuditScore) {
    return { ok: false, reason: `Nota do auditor ${audit.score ?? 0} abaixo de ${minAuditScore}` };
  }
  if (confidence !== 'alta') {
    return { ok: false, reason: 'Confiança do Agente de Resposta não é alta' };
  }
  if (!audit.criteriosAvaliados) {
    return { ok: false, reason: 'Auditor não devolveu os critérios avaliados' };
  }
  const reprovados = Object.entries(audit.criteriosAvaliados).filter(([, v]) => v !== true).map(([k]) => k);
  if (reprovados.length) {
    return { ok: false, reason: `Critérios do auditor não atendidos: ${reprovados.join(', ')}` };
  }
  if (String(tabulacao.tipo || '').trim().toLowerCase() === 'reclamação') {
    return { ok: false, reason: 'Reclamação não é respondida automaticamente' };
  }
  if (!audit.tabulacaoSugerida || !sameTab(audit.tabulacaoSugerida, tabulacao)) {
    return { ok: false, reason: 'Tabulação do auditor diverge da do Agente de Resposta' };
  }
  return { ok: true };
}
