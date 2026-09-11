/** workflowMatcher v1.7.0 — evaluateCriterios agrupa por fonte+campo: E entre campos, OU dentro do mesmo campo */
import { GRUPO_TO_FUNCAO_MAP } from '../config/funcaoPermissaoDefaults';
import type { IWorkflowCriterio } from '../models/WorkflowDefinicao';
import type { IChamadoN1 } from '../models/ChamadoN1';
import { isProconChamado, readTabulacaoSnapshot } from './chamado.mapper';
import { normalizeFuncao } from '../utils/normalizeFuncao';

function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function readTabulationField(
  fields: Record<string, string>,
  campo: string,
): string {
  const map: Record<string, string> = {
    tipochamado: fields.tipoChamado || fields.tipo || '',
    tipo: fields.tipoChamado || fields.tipo || '',
    produto: fields.produto || '',
    motivo: fields.motivo || '',
    detalhe: fields.detalhe || '',
    canal: fields.canal || '',
    responsavel: fields.responsavel || '',
    atribuido: fields.atribuido || '',
  };
  return map[normalize(campo).replace(/_/g, '')] ?? fields[campo] ?? '';
}

function readIntegracaoField(
  fields: Record<string, string>,
  campo: string,
): string {
  const map: Record<string, string> = {
    statuspagamento: fields.statusPagamento || '',
    datacontratacao: fields.dataContratacao || '',
    statuscontrato: fields.statusContrato || '',
  };
  return map[normalize(campo).replace(/_/g, '')] ?? fields[campo] ?? '';
}

function evaluateOperator(actual: string, operador: string, valor: string): boolean {
  const haystack = normalize(actual);
  const needle = normalize(valor);

  switch (operador) {
    case 'equals':
      return haystack === needle;
    case 'contains':
      return needle ? haystack.includes(needle) : false;
    case 'not_empty':
      return haystack.length > 0;
    case 'in': {
      const options = String(valor || '')
        .split(',')
        .map((item) => normalize(item))
        .filter(Boolean);
      return options.some((item) => haystack.includes(item) || haystack === item);
    }
    default:
      return false;
  }
}

function evaluateOneCriterio(
  criterio: IWorkflowCriterio,
  fields: Record<string, string>,
): boolean {
  if (criterio.fonte === 'integracao') {
    const actual = readIntegracaoField(fields, criterio.campo);
    return evaluateOperator(actual, criterio.operador, criterio.valor);
  }
  const actual = readTabulationField(fields, criterio.campo);
  return evaluateOperator(actual, criterio.operador, criterio.valor);
}

function criterioGroupKey(criterio: IWorkflowCriterio): string {
  return `${criterio.fonte || 'tabulacao'}:${criterio.campo || ''}`;
}

/**
 * Critérios de campos diferentes entram com E; múltiplos critérios do MESMO
 * campo (mesma fonte+campo, ex.: dois critérios "produto") entram com OU —
 * mesmo padrão do módulo de e-mails de saída (lá expresso como um único
 * critério com `valores: []`; aqui, como vários critérios agrupados por
 * fonte+campo na hora de avaliar, sem mudar o formato salvo).
 */
export function evaluateCriterios(
  criterios: IWorkflowCriterio[],
  fields: Record<string, string>,
): boolean {
  if (!criterios?.length) return true;

  const groups = new Map<string, IWorkflowCriterio[]>();
  criterios.forEach((criterio) => {
    const key = criterioGroupKey(criterio);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(criterio);
  });

  return [...groups.values()].every(
    (group) => group.some((criterio) => evaluateOneCriterio(criterio, fields)),
  );
}

/** Gatilho sem critérios nunca ativa o workflow */
export function evaluateGatilhoCriterios(
  criterios: IWorkflowCriterio[],
  fields: Record<string, string>,
): boolean {
  if (!criterios?.length) return false;
  return evaluateCriterios(criterios, fields);
}

export function buildTabulationFieldsFromTicket(ticket: {
  tabulacao?: Array<Record<string, string>>;
  lateralForm?: Record<string, unknown>;
  channel?: string;
}): Record<string, string> {
  const tab = ticket.tabulacao?.[0] || {};
  const lf = ticket.lateralForm || {};
  const metadados = (lf.metadados && typeof lf.metadados === 'object' ? lf.metadados : {}) as Record<string, unknown>;
  const integracao = (lf.integracao && typeof lf.integracao === 'object'
    ? lf.integracao
    : metadados.integracao && typeof metadados.integracao === 'object'
      ? metadados.integracao
      : {}) as Record<string, unknown>;
  return {
    tipoChamado: String(lf.tipoChamado ?? lf.classificacaoTipo ?? tab.tipoChamado ?? ''),
    tipo: String(lf.tipoChamado ?? lf.classificacaoTipo ?? tab.tipoChamado ?? ''),
    produto: String(lf.produto ?? tab.produto ?? ''),
    motivo: String(lf.motivo ?? tab.motivo ?? ''),
    detalhe: String(lf.detalhe ?? tab.detalhe ?? ''),
    canal: String(lf.canal ?? tab.canal ?? ticket.channel ?? ''),
    responsavel: String(lf.responsavel ?? tab.responsavel ?? ''),
    atribuido: String(lf.atribuido ?? tab.atribuido ?? ''),
    statusPagamento: String(integracao.statusPagamento ?? lf.statusPagamento ?? ''),
    dataContratacao: String(integracao.dataContratacao ?? integracao.dataContratacaoFaixa ?? lf.dataContratacao ?? ''),
    statusContrato: String(integracao.statusContrato ?? lf.statusContrato ?? ''),
  };
}

export function resolveCanalFromChamado(chamado: IChamadoN1): string {
  if (isProconChamado(chamado)) return 'Procon';
  for (const reg of chamado.registro ?? []) {
    const meta = (reg.metadados && typeof reg.metadados === 'object' ? reg.metadados : {}) as Record<string, unknown>;
    const source = String(meta.source ?? meta.channel ?? '').trim().toLowerCase();
    if (source.includes('reclame')) return 'Reclame Aqui';
    if (source.includes('procon')) return 'Procon';
    if (source === 'email-inbound') return 'E-mail';
  }
  return '';
}

export function buildWorkflowTicketContextFromChamado(chamado: IChamadoN1): {
  tabulacao: Array<Record<string, string>>;
  lateralForm?: Record<string, unknown>;
  channel?: string;
} {
  const tab = readTabulacaoSnapshot(chamado.tabulacao?.[0]);
  const canal = resolveCanalFromChamado(chamado);
  return {
    tabulacao: [tab as unknown as Record<string, string>],
    ...(canal ? { lateralForm: { canal }, channel: canal } : {}),
  };
}

export function buildTabulationFieldsFromChamado(chamado: IChamadoN1): Record<string, string> {
  return buildTabulationFieldsFromTicket(buildWorkflowTicketContextFromChamado(chamado));
}

export function resolveAtribuidoForPasso(
  atribuicao: { tipo: string; grupoSlug?: string; funcaoSlug?: string; colaborador?: string },
  fields: Record<string, string>,
): string {
  switch (atribuicao.tipo) {
    case 'colaborador':
      return String(atribuicao.colaborador || '').trim();
    case 'funcao':
      return atribuicao.funcaoSlug ? `funcao:${normalizeFuncao(atribuicao.funcaoSlug)}` : '';
    case 'grupo':
      if (atribuicao.grupoSlug) {
        const mapped = GRUPO_TO_FUNCAO_MAP[atribuicao.grupoSlug.toLowerCase()] || atribuicao.grupoSlug;
        return `funcao:${normalizeFuncao(mapped)}`;
      }
      return '';
    case 'responsavel_ticket':
      return String(fields.responsavel || '').trim();
    default:
      return '';
  }
}
