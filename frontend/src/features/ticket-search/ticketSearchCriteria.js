/**
 * Catálogo e normalização de critérios da Busca de Tickets
 * VERSION: v1.0.0 | DATE: 2026-08-04
 */

export const SEARCH_FIELD_CATALOG = [
  { value: 'protocolo', label: 'Protocolo', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'titulo', label: 'Título', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'cpf', label: 'CPF', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'clienteNome', label: 'Nome do cliente', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'email', label: 'E-mail', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'telefone', label: 'Telefone', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'status', label: 'Status', input: 'multi', operators: ['equals', 'not_empty'] },
  { value: 'tipoChamado', label: 'Tipo de chamado', input: 'tabulacao', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'produto', label: 'Produto', input: 'tabulacao', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'motivo', label: 'Motivo', input: 'tabulacao', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'detalhe', label: 'Detalhe', input: 'tabulacao', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'responsavel', label: 'Responsável', input: 'text', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'atribuido', label: 'Atribuído', input: 'atribuido', operators: ['equals', 'not_empty'] },
  { value: 'canal', label: 'Canal', input: 'tabulacao', operators: ['equals', 'contains', 'not_empty'] },
  { value: 'prioridade', label: 'Prioridade', input: 'multi', operators: ['equals', 'not_empty'] },
  { value: 'sla', label: 'SLA', input: 'multi', operators: ['equals'] },
  { value: 'workflow', label: 'Workflow', input: 'multi', operators: ['equals'] },
  { value: 'pendingDecision', label: 'Decisão pendente', input: 'multi', operators: ['equals', 'not_empty'] },
  { value: 'createdAt', label: 'Data de criação', input: 'date', operators: ['gte', 'lte', 'between', 'equals'] },
  { value: 'updatedAt', label: 'Data de atualização', input: 'date', operators: ['gte', 'lte', 'between', 'equals'] },
  { value: 'id', label: 'ID do ticket', input: 'text', operators: ['equals'] },
];

export const OPERATOR_LABELS = {
  equals: 'Igual a',
  contains: 'Contém',
  not_empty: 'Não vazio',
  gte: 'A partir de',
  lte: 'Até',
  between: 'Entre',
};

export const STATUS_OPTIONS = [
  { value: 'novo', label: 'Novo' },
  { value: 'em-andamento', label: 'Em andamento' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'resolvido', label: 'Resolvido' },
  { value: 'fechado', label: 'Fechado' },
  { value: 'cancelado', label: 'Cancelado' },
];

const toOptions = (values) => [
  ...new Set(values.map((v) => String(v ?? '').trim()).filter(Boolean)),
].map((value) => ({ value, label: value }));

/**
 * Opções dos campos de tabulação lidas direto da configuração (sem fallback fixo).
 * Inclui itens inativos: tickets antigos continuam gravados com esses valores e precisam ser buscáveis.
 */
export function searchTipoOptions(config) {
  return toOptions(config?.opcoes?.tipoChamado || []);
}

export function searchCanalOptions(config) {
  return toOptions(config?.opcoes?.canalContato || []);
}

export function searchProdutoOptions(config) {
  return toOptions((config?.produtos || []).map((p) => p.produto));
}

function produtosEscopo(config, produtos) {
  const wanted = new Set((produtos || []).map((p) => String(p).trim()).filter(Boolean));
  const all = config?.produtos || [];
  const scoped = wanted.size ? all.filter((p) => wanted.has(String(p.produto || '').trim())) : all;
  return scoped.length ? scoped : all;
}

export function searchMotivoOptions(config, produtos) {
  return toOptions(
    produtosEscopo(config, produtos).flatMap((p) => (p.motivos || []).map((m) => m.motivo)),
  );
}

export function searchDetalheOptions(config, produtos, motivos) {
  const wanted = new Set((motivos || []).map((m) => String(m).trim()).filter(Boolean));
  const motivosList = produtosEscopo(config, produtos).flatMap((p) => p.motivos || []);
  const scoped = wanted.size
    ? motivosList.filter((m) => wanted.has(String(m.motivo || '').trim()))
    : motivosList;
  return toOptions((scoped.length ? scoped : motivosList).flatMap((m) => (m.detalhes || []).map((d) => d.detalhe)));
}

export const PRIORIDADE_OPTIONS = [
  { value: 'media', label: 'Média' },
  { value: 'alta', label: 'Alta' },
  { value: 'critica', label: 'Crítica' },
];

export const SLA_OPTIONS = [
  { value: 'ok', label: 'OK' },
  { value: 'warning', label: 'Atenção' },
  { value: 'critical', label: 'Crítico' },
];

export const WORKFLOW_OPTIONS = [
  { value: 'ativo', label: 'Ativo' },
  { value: 'inativo', label: 'Inativo' },
];

export const PENDING_DECISION_OPTIONS = [
  { value: 'approve', label: 'Aprovar' },
  { value: 'reject', label: 'Rejeitar' },
];

export const ATRIBUIDO_SHORTCUTS = [
  { value: '__me__', label: 'Eu (agente logado)' },
  { value: '__empty__', label: 'Vazio (sem atribuído)' },
];

export function getFieldDef(campo) {
  return SEARCH_FIELD_CATALOG.find((f) => f.value === campo) || SEARCH_FIELD_CATALOG[0];
}

export function criterioValores(row) {
  if (!row) return [];
  if (Array.isArray(row.valores)) {
    return row.valores.map((v) => String(v).trim()).filter(Boolean);
  }
  const single = String(row.valor ?? '').trim();
  return single ? [single] : [];
}

export function patchValores(row, valores) {
  const list = (valores || []).map((v) => String(v).trim()).filter(Boolean);
  return { ...row, valores: list, valor: list[0] || '' };
}

export function createEmptyCriterio() {
  return {
    campo: 'protocolo',
    operador: 'contains',
    valor: '',
    valores: [],
  };
}

export function normalizeCriterioRow(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const campo = String(raw.campo || '').trim();
  if (!campo) return null;
  const def = getFieldDef(campo);
  const valores = criterioValores(raw);
  let operador = String(raw.operador || 'equals').trim() || 'equals';
  if (!def.operators.includes(operador)) {
    operador = def.operators[0] || 'equals';
  }
  return {
    campo: def.value,
    operador,
    valores,
    valor: valores[0] || '',
  };
}

export function isCriterioRowValid(row) {
  const normalized = normalizeCriterioRow(row);
  if (!normalized) return false;
  if (normalized.operador === 'not_empty') return true;
  if (normalized.operador === 'between') {
    return normalized.valores.length >= 2;
  }
  return normalized.valores.length > 0;
}

/**
 * Serialização final para a API, resolvendo atalhos de atribuído.
 * @param {Array} criterios
 * @param {string} agentName nome do agente logado (para __me__)
 */
export function buildApiCriterios(criterios, agentName = '') {
  const list = (Array.isArray(criterios) ? criterios : [])
    .map((row) => normalizeCriterioRow(row))
    .filter((row) => isCriterioRowValid(row));

  return list.map((row) => {
    if (row.campo === 'atribuido') {
      const v = row.valores[0] || '';
      if (v === '__empty__') {
        return { campo: 'atribuido', operador: 'equals', valores: [''], valor: '' };
      }
      if (v === '__me__') {
        const me = String(agentName || '').trim();
        return {
          campo: 'atribuido',
          operador: 'contains',
          valores: me ? [me] : ['__no_agent__'],
          valor: me || '__no_agent__',
        };
      }
    }
    return {
      campo: row.campo,
      operador: row.operador,
      valores: row.valores,
      valor: row.valor,
    };
  });
}
