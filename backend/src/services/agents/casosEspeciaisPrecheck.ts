/**
 * casosEspeciaisPrecheck v1.1.0 — hint inbox dedicada (canalProvavel)
 * VERSION: v1.1.0 | DATE: 2026-08-07
 */
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { resolveFormalCaseSource } from '../ticketIaAdapter.service';
import { matchPriorityEmailRule } from '../mailRules.service';
import { detectPrioritySubjectMatch } from '../mailPrioritySubjectRules.service';
import type { CasoEspecialOrgao, CasoEspecialSignalResult } from './casosEspeciais.types';

// Gatilho do Agente 4 por palavra-chave vive inteiramente em Config > E-mail > Assuntos
// Prioritários (área=corpo, "contém") — a aba já escaneia o mesmo texto (assunto + corpo
// completo do ticket) e é editável sem deploy, então não duplicamos uma lista aqui.

const INSTITUTIONAL_DOMAIN_PATTERNS: Array<{ orgao: CasoEspecialOrgao; pattern: RegExp }> = [
  { orgao: 'reclame_aqui', pattern: /@([a-z0-9-]+\.)*reclameaqui\.com\.br$/i },
  { orgao: 'procon', pattern: /@([a-z0-9-]+\.)*procon\.[a-z.]{2,}$/i },
  { orgao: 'procon', pattern: /@procon\.[a-z.]{2,}$/i },
  { orgao: 'consumidor_gov', pattern: /@([a-z0-9-]+\.)*consumidor\.gov\.br$/i },
  { orgao: 'bacen', pattern: /@([a-z0-9-]+\.)*bcb\.gov\.br$/i },
  { orgao: 'bacen', pattern: /@([a-z0-9-]+\.)*bacen\.gov\.br$/i },
];

const FORMAL_SOURCE_TO_ORGAO: Record<string, CasoEspecialOrgao> = {
  'reclame-aqui': 'reclame_aqui',
  procon: 'procon',
  bacen: 'bacen',
  'consumidor-gov': 'consumidor_gov',
  'consumidor.gov': 'consumidor_gov',
};

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function orgaoFromFormalSource(source: string | null): CasoEspecialOrgao | null {
  if (!source) return null;
  return FORMAL_SOURCE_TO_ORGAO[source.toLowerCase()] ?? null;
}

function orgaoFromCanalLabel(canal: string): CasoEspecialOrgao | null {
  const normalized = canal.toLowerCase();
  if (normalized.includes('reclame')) return 'reclame_aqui';
  if (normalized.includes('procon')) return 'procon';
  if (normalized.includes('bacen') || normalized.includes('banco central')) return 'bacen';
  if (normalized.includes('consumidor')) return 'consumidor_gov';
  return null;
}

function extractCorpo(chamado: IChamadoN1): string {
  return (chamado.registro ?? [])
    .map((reg) => String(reg.mensagemPublica ?? ''))
    .filter(Boolean)
    .join('\n');
}

function extractEmailFrom(chamado: IChamadoN1): string {
  for (const reg of chamado.registro ?? []) {
    const meta = reg.metadados && typeof reg.metadados === 'object' ? reg.metadados : {};
    const from = normalizeEmail((meta as Record<string, unknown>).emailFrom);
    if (from) return from;
  }
  return '';
}

function detectInstitutionalSender(email: string): { matched: boolean; orgao: CasoEspecialOrgao | null } {
  if (!email.includes('@')) return { matched: false, orgao: null };
  for (const { orgao, pattern } of INSTITUTIONAL_DOMAIN_PATTERNS) {
    if (pattern.test(email)) return { matched: true, orgao };
  }
  return { matched: false, orgao: null };
}

function readCanalProvavelHint(chamado: IChamadoN1): string | null {
  for (const reg of chamado.registro ?? []) {
    const meta = reg.metadados && typeof reg.metadados === 'object' ? reg.metadados : {};
    const hint = String((meta as Record<string, unknown>).canalProvavel ?? '').trim();
    if (hint) return hint;
  }
  return null;
}

export function detectCasoEspecialSignal(chamado: IChamadoN1): CasoEspecialSignalResult {
  const signals: string[] = [];
  let origemProvavel: CasoEspecialOrgao | null = null;

  const canalProvavel = readCanalProvavelHint(chamado);
  if (canalProvavel) {
    signals.push(`inbox_dedicada:${canalProvavel}`);
    origemProvavel = origemProvavel || orgaoFromFormalSource(canalProvavel);
  }

  const formalSource = resolveFormalCaseSource(chamado);
  if (formalSource) {
    signals.push(`canal_formal:${formalSource}`);
    origemProvavel = orgaoFromFormalSource(formalSource);
  }

  const emailFrom = extractEmailFrom(chamado);
  const institutional = detectInstitutionalSender(emailFrom);
  if (institutional.matched) {
    signals.push(`remetente_institucional:${emailFrom}`);
    origemProvavel = origemProvavel || institutional.orgao;
  }

  // Remetente cadastrado na lista de prioritários (Config > E-mail > Prioritários):
  // tratado como sinal institucional confirmado, mesmo sem bater com os domínios fixos
  // acima — a curadoria manual da lista já atesta a origem oficial do remetente. Se a
  // regra tiver órgão definido, o Agente 4 pula direto pro fast-path (caso_formal_real);
  // sem órgão, ainda dispara o Agente 4, mas a classificação (LLM) decide o órgão.
  const priorityRule = matchPriorityEmailRule(emailFrom);
  const prioritySenderWithOrgao = priorityRule.matched && Boolean(priorityRule.orgao);
  if (priorityRule.matched) {
    signals.push(`remetente_prioritario:${emailFrom}`);
    if (priorityRule.orgao) origemProvavel = origemProvavel || (priorityRule.orgao as CasoEspecialOrgao);
  }

  // Assunto/corpo cadastrado em Config > E-mail > Assuntos Prioritários (igual a / contém):
  // mesmo tratamento do remetente prioritário — sinal confirmado, dispara o Agente 4 direto;
  // fast-path só quando a regra também tiver órgão definido.
  const subjectMatch = detectPrioritySubjectMatch(String(chamado.chamadoTitulo ?? ''), extractCorpo(chamado));
  const subjectMatchWithOrgao = Boolean(subjectMatch.matched && subjectMatch.rule?.orgao);
  if (subjectMatch.matched && subjectMatch.rule) {
    signals.push(`assunto_prioritario:${subjectMatch.rule.area}:${subjectMatch.rule.value}`);
    if (subjectMatch.rule.orgao) origemProvavel = origemProvavel || (subjectMatch.rule.orgao as CasoEspecialOrgao);
  }

  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1] ?? chamado.tabulacao?.[0];
  const canalOrgao = orgaoFromCanalLabel(String(tab?.tipoChamado ?? ''));
  const canalFromMeta = orgaoFromCanalLabel(String((tab as { canal?: string } | undefined)?.canal ?? ''));
  if (canalOrgao || canalFromMeta) {
    signals.push('tabulacao_canal_especial');
    origemProvavel = origemProvavel || canalOrgao || canalFromMeta;
  }

  const triggered = signals.length > 0;
  const fastPathReal = Boolean(
    prioritySenderWithOrgao
    || subjectMatchWithOrgao
    || (formalSource
      && (institutional.matched || signals.some((s) => s.startsWith('canal_formal:')))),
  );

  return {
    triggered,
    signals: [...new Set(signals)],
    origemProvavel,
    fastPathReal,
    institutionalSender: institutional.matched || prioritySenderWithOrgao || subjectMatchWithOrgao,
  };
}
