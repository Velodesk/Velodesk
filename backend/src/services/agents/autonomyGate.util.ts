/**
 * autonomyGate.util v1.0.0 — régua estrita do caminho autônomo (determinística, sem nova chamada à LLM)
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * Vale para fila de aprovação e envio direto: o auditor já aprovou (aprovar_auto) e, além disso,
 * exige-se nota ≥ minAuditScoreEstrito, confiança alta, todos os critérios verdadeiros,
 * nenhuma palavra crítica, não-Reclamação e concordância de tabulação entre Agente 1 e Auditor.
 */
import type { AuditoriaResult, ConfidenceLevel, TicketAiTabulationResult } from './agentTypes';

export interface StrictGateInput {
  audit: AuditoriaResult;
  confidence?: ConfidenceLevel;
  tabulacao: TicketAiTabulationResult;
  minAuditScoreEstrito: number;
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
  const { audit, confidence, tabulacao, minAuditScoreEstrito } = input;

  if (!audit.success || !audit.aprovado || audit.decisao !== 'aprovar_auto') {
    return { ok: false, reason: 'Auditor não aprovou para envio autônomo' };
  }
  if ((audit.score ?? 0) < minAuditScoreEstrito) {
    return { ok: false, reason: `Nota do auditor ${audit.score ?? 0} abaixo de ${minAuditScoreEstrito}` };
  }
  if (confidence !== 'alta') {
    return { ok: false, reason: 'Confiança do Agente de Resposta não é alta' };
  }
  const criterios = audit.criteriosAvaliados;
  if (!criterios) {
    return { ok: false, reason: 'Auditor não devolveu os critérios avaliados' };
  }
  const reprovados = Object.entries(criterios).filter(([, v]) => v !== true).map(([k]) => k);
  if (reprovados.length) {
    return { ok: false, reason: `Critérios do auditor não atendidos: ${reprovados.join(', ')}` };
  }
  if (audit.palavrasCriticasDetectadas?.length) {
    return { ok: false, reason: 'Palavras críticas detectadas' };
  }
  if (String(tabulacao.tipo || '').trim().toLowerCase() === 'reclamação') {
    return { ok: false, reason: 'Reclamação não é respondida automaticamente' };
  }
  if (!audit.tabulacaoSugerida || !sameTab(audit.tabulacaoSugerida, tabulacao)) {
    return { ok: false, reason: 'Tabulação do auditor diverge da do Agente de Resposta' };
  }
  return { ok: true };
}
