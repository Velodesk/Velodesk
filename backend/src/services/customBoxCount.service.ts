/**
 * customBoxCount.service v1.0.0 — traduz criterios[] de caixa personalizada (desk_agent_boxes)
 * pra um filtro Mongo real, pra contar (countDocuments, sem limite) em vez de usar o tamanho
 * da lista de tickets carregada em cache no frontend (que é limitada por performance).
 * Espelha a lógica de frontend/src/services/desk/customQueueBoxCriteria.js — mesmos tipos de
 * critério, mesma semântica de AND entre linhas / OR dentro de valores[].
 */
import { meusChamadosAgentScopeFilter } from './chamado.mapper';

export interface CustomBoxCriterio {
  tipo: string;
  campo?: string;
  operador?: string;
  valor?: string;
  valores?: string[];
}

const TAB_FIELDS = new Set(['tipoChamado', 'tipo', 'produto', 'motivo', 'detalhe']);

const STATUS_ALIASES: Record<string, string[]> = {
  'em-andamento': ['em-aberto', 'em-andamento'],
  'em-aberto': ['em-aberto', 'em-andamento'],
  pendente: ['pendente', 'em-espera'],
  resolvido: ['resolvido'],
  resolvidos: ['resolvido'],
  fechado: ['fechado', 'cancelado'],
  cancelado: ['cancelado', 'fechado'],
  novo: ['novo'],
};

function criterioValores(c: CustomBoxCriterio): string[] {
  if (Array.isArray(c.valores) && c.valores.length) {
    return c.valores.map((v) => String(v).trim()).filter(Boolean);
  }
  const single = String(c.valor ?? '').trim();
  return single ? [single] : [];
}

function lastTabFieldExpr(campo: string) {
  const key = campo === 'tipo' ? 'tipoChamado' : campo;
  return {
    $toLower: {
      $ifNull: [{ $arrayElemAt: [`$tabulacao.${key}`, -1] }, ''],
    },
  };
}

function tabulacaoFilter(criterio: CustomBoxCriterio): Record<string, unknown> | null {
  const campo = String(criterio.campo || '').trim();
  if (!TAB_FIELDS.has(campo)) return null;
  const valores = criterioValores(criterio).map((v) => v.toLowerCase());
  if (!valores.length) return { _id: { $exists: false } };

  const expr = lastTabFieldExpr(campo);
  const operador = String(criterio.operador || 'equals').trim();

  if (operador === 'not_empty') {
    return { $expr: { $ne: [expr, ''] } };
  }
  if (operador === 'contains') {
    return {
      $expr: {
        $or: valores.map((v) => ({ $gt: [{ $indexOfCP: [expr, v] }, -1] })),
      },
    };
  }
  return { $expr: { $in: [expr, valores] } };
}

function statusFilter(criterio: CustomBoxCriterio): Record<string, unknown> | null {
  const valores = criterioValores(criterio).map((v) => v.trim().toLowerCase());
  if (!valores.length) return { _id: { $exists: false } };
  const expanded = new Set<string>();
  valores.forEach((v) => (STATUS_ALIASES[v] || [v]).forEach((s) => expanded.add(s)));
  return {
    $expr: { $in: [{ $arrayElemAt: ['$registro.status', -1] }, [...expanded]] },
  };
}

function workflowFilter(criterio: CustomBoxCriterio): Record<string, unknown> | null {
  const valores = criterioValores(criterio).map((v) => v.trim().toLowerCase());
  const wantsAtivo = valores.includes('ativo');
  const wantsInativo = valores.includes('inativo');
  if (wantsAtivo && wantsInativo) return {};
  if (wantsAtivo) return { 'workflow.active': true };
  if (wantsInativo) return { $or: [{ 'workflow.active': { $ne: true } }, { workflow: { $exists: false } }] };
  return { _id: { $exists: false } };
}

/**
 * Espelha ensureTicketSlaFields (frontend/src/services/desk/utils.js:972-983) — hoje `priority`
 * não é persistido no schema (ChamadoN1), então o cálculo real sempre cai no ramo padrão:
 * 24h corridas desde a criação do ticket, crítico ao zerar, atenção nos últimos 60min.
 * Se `priority` for persistido no futuro, esta função precisa ser atualizada junto.
 */
function slaToneExpr() {
  const elapsedMin = { $divide: [{ $subtract: ['$$NOW', '$createdAt'] }, 60000] };
  return {
    $switch: {
      branches: [
        { case: { $gte: [elapsedMin, 1440] }, then: 'critical' },
        { case: { $gte: [elapsedMin, 1380] }, then: 'warning' },
      ],
      default: 'ok',
    },
  };
}

function slaFilter(criterio: CustomBoxCriterio): Record<string, unknown> | null {
  const valores = criterioValores(criterio)
    .map((v) => v.trim().toLowerCase())
    .map((v) => (v === 'attention' ? 'warning' : v));
  if (!valores.length) return { _id: { $exists: false } };
  return { $expr: { $in: [slaToneExpr(), valores] } };
}

function atribuidoFilter(
  criterio: CustomBoxCriterio,
  responsavelCandidates: string[],
): Record<string, unknown> | null {
  const valor = criterioValores(criterio)[0] || '';
  if (valor === '__me__') return meusChamadosAgentScopeFilter(responsavelCandidates);
  if (valor === '__empty__') {
    return {
      $expr: {
        $eq: [{ $toLower: { $ifNull: [{ $arrayElemAt: ['$tabulacao.atribuido', -1] }, ''] } }, ''],
      },
    };
  }
  if (!valor) return { _id: { $exists: false } };
  return {
    $expr: {
      $eq: [
        { $toLower: { $ifNull: [{ $arrayElemAt: ['$tabulacao.atribuido', -1] }, ''] } },
        valor.toLowerCase(),
      ],
    },
  };
}

/**
 * Traduz os critérios de uma caixa personalizada pra um filtro Mongo real. Todos os tipos hoje
 * usados (tabulacao/status/atribuido/workflow/sla) têm tradução exata. `unsupported` só é
 * populado se um tipo desconhecido aparecer (ex.: critério legado/futuro) — nesse caso a
 * contagem não é confiável e o chamador deve avisar em vez de fingir precisão.
 */
export function buildCustomBoxCountFilter(
  criterios: CustomBoxCriterio[],
  responsavelCandidates: string[],
): { filter: Record<string, unknown>; unsupported: string[] } {
  const list = Array.isArray(criterios) ? criterios : [];
  const clauses: Record<string, unknown>[] = [];
  const unsupported: string[] = [];

  for (const criterio of list) {
    const tipo = String(criterio.tipo || '').trim().toLowerCase();
    let clause: Record<string, unknown> | null = null;

    if (tipo === 'tabulacao') clause = tabulacaoFilter(criterio);
    else if (tipo === 'status') clause = statusFilter(criterio);
    else if (tipo === 'workflow') clause = workflowFilter(criterio);
    else if (tipo === 'atribuido') clause = atribuidoFilter(criterio, responsavelCandidates);
    else if (tipo === 'sla') clause = slaFilter(criterio);
    else unsupported.push(tipo || 'desconhecido');

    if (clause) clauses.push(clause);
  }

  if (!clauses.length) {
    return { filter: { _id: { $exists: false } }, unsupported };
  }
  return { filter: clauses.length === 1 ? clauses[0] : { $and: clauses }, unsupported };
}
