/**
 * workflowConfigData v3.0.0 — bifurcação real: rota.passos[] aninhado substitui
 * proximoPassoId; buildPassoOptions/buildIncomingRotaBadges removidos (não fazem
 * mais sentido — a árvore é a própria representação visual da bifurcação)
 * VERSION: v3.0.0 | DATE: 2026-09-10
 */
import {
  normalizeRequisicaoConfig,
  slugifyRequisicaoLabel,
  createRequisicaoCampoClientKey,
} from '../../../services/workflow/workflowRequisicao';

export const TRIGGER_PATH_FIELDS = [
  { key: 'produto', label: 'Produto', placeholder: 'Ex.: Produto X' },
  { key: 'tipo', label: 'Tipo', placeholder: 'Ex.: Solicitação' },
  { key: 'motivo', label: 'Motivo', placeholder: 'Ex.: Reembolso' },
  { key: 'detalhe', label: 'Detalhe', placeholder: 'Ex.: Dentro dos 7 dias' },
];

export const CRITERIO_FONTES = [
  { value: 'tabulacao', label: 'Tabulação' },
  { value: 'integracao', label: 'Integração (API)' },
  { value: 'grupo_responsabilidade', label: 'Grupo de responsabilidade' },
];

export const CRITERIO_CAMPOS = [
  { value: 'tipoChamado', label: 'Tipo de chamado' },
  { value: 'produto', label: 'Produto' },
  { value: 'motivo', label: 'Motivo' },
  { value: 'detalhe', label: 'Detalhe' },
  { value: 'responsavel', label: 'Responsável' },
  { value: 'atribuido', label: 'Atribuído' },
];

/** Campos obtidos via API externa (informações do cliente / pagamento) */
export const CRITERIO_CAMPOS_INTEGRACAO = [
  { value: 'statusPagamento', label: 'Status de pagamento' },
  { value: 'dataContratacao', label: 'Prazo desde contratação' },
  { value: 'statusContrato', label: 'Status do contrato' },
];

/** Opções do gatilho — critério único (tabulação + integração) */
export const GATILHO_CRITERIO_OPCOES = [
  { fonte: 'tabulacao', campo: 'tipoChamado', label: 'Tipo de chamado' },
  { fonte: 'tabulacao', campo: 'produto', label: 'Produto' },
  { fonte: 'tabulacao', campo: 'motivo', label: 'Motivo' },
  { fonte: 'tabulacao', campo: 'detalhe', label: 'Detalhe' },
  { fonte: 'tabulacao', campo: 'canal', label: 'Canal' },
  { fonte: 'integracao', campo: 'statusPagamento', label: 'Status de pagamento' },
  { fonte: 'integracao', campo: 'dataContratacao', label: 'Prazo desde contratação' },
  { fonte: 'integracao', campo: 'statusContrato', label: 'Status do contrato' },
];

export const STATUS_PAGAMENTO_VALORES = [
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'cancelado', label: 'Cancelado' },
  { value: 'estornado', label: 'Estornado' },
  { value: 'processando', label: 'Processando' },
];

export const DATA_CONTRATACAO_VALORES = [
  { value: 'dentro_7_dias', label: 'Dentro de 7 dias' },
  { value: 'fora_7_dias', label: 'Fora de 7 dias' },
];

export const STATUS_CONTRATO_VALORES = [
  { value: 'em_vigencia', label: 'Em vigência' },
  { value: 'quebra_contratual', label: 'Quebra contratual' },
  { value: 'quitado', label: 'Quitado' },
  { value: 'elegivel', label: 'Elegível' },
  { value: 'inelegivel', label: 'Inelegível' },
];

export function getIntegracaoValoresForCampo(campo) {
  switch (campo) {
    case 'statusPagamento':
      return STATUS_PAGAMENTO_VALORES;
    case 'dataContratacao':
      return DATA_CONTRATACAO_VALORES;
    case 'statusContrato':
      return STATUS_CONTRATO_VALORES;
    default:
      return [];
  }
}

export function criterioOptionKey(fonte, campo) {
  return `${fonte || 'tabulacao'}:${campo || ''}`;
}

export function parseCriterioOptionKey(key) {
  const [fonte, ...rest] = String(key || '').split(':');
  return { fonte: fonte || 'tabulacao', campo: rest.join(':') };
}

export function findGatilhoCriterioLabel(fonte, campo) {
  const match = GATILHO_CRITERIO_OPCOES.find((o) => o.fonte === fonte && o.campo === campo);
  if (match) return match.label;
  const tab = CRITERIO_CAMPOS.find((c) => c.value === campo);
  if (tab) return tab.label;
  const integ = CRITERIO_CAMPOS_INTEGRACAO.find((c) => c.value === campo);
  return integ?.label || campo;
}

/** Produto/motivo definidos em outros critérios do gatilho (cascata tabulação) */
export function resolveGatilhoCascadeContext(criterios = []) {
  const list = criterios || [];
  const isTabulacao = (c) => !c?.fonte || c.fonte === 'tabulacao';
  const produtoRow = list.find((c) => isTabulacao(c) && c.campo === 'produto' && String(c.valor || '').trim());
  const motivoRow = list.find((c) => isTabulacao(c) && c.campo === 'motivo' && String(c.valor || '').trim());
  return {
    produto: String(produtoRow?.valor || '').trim(),
    motivo: String(motivoRow?.valor || '').trim(),
  };
}

export function formatCriterioValorLabel(fonte, campo, valor) {
  if (!valor) return '*';
  if (fonte === 'integracao') {
    const options = getIntegracaoValoresForCampo(campo);
    return options.find((o) => o.value === valor)?.label || valor;
  }
  return valor;
}

export const CRITERIO_OPERADORES = [
  { value: 'equals', label: 'Igual a' },
  { value: 'contains', label: 'Contém' },
  { value: 'not_empty', label: 'Não vazio' },
  { value: 'in', label: 'Está em (CSV)' },
];

export const SISTEMA_MODOS = [
  { value: 'acao_sistema', label: 'Ação de sistema' },
  { value: 'resposta_cliente', label: 'Resposta ao cliente' },
  { value: 'call_to_action', label: 'Call to action' },
];

export const RESPOSTA_CONTEUDO_MODOS = [
  { value: 'ia', label: 'Inteligência Artificial' },
  { value: 'email_padrao', label: 'E-mail padrão' },
];

export const WEBHOOK_TIPOS = [
  { value: 'interno', label: 'Interno (catálogo VeloDesk)' },
  { value: 'externo', label: 'Externo (URL)' },
];

export const CTA_ALVOS = [
  { value: 'responsavel', label: 'Responsável do ticket' },
  { value: 'atribuido', label: 'Atribuído atual' },
  { value: 'grupo', label: 'Grupo de responsabilidade' },
];

export function resolveStepIcon(acaoTipo) {
  switch (acaoTipo) {
    case 'aprovacao':
      return 'ti-circle-check';
    case 'automatica':
      return 'ti-bolt';
    case 'manual':
    default:
      return 'ti-hand-click';
  }
}

export const ATRIBUICAO_TIPOS = [
  { value: 'funcao', label: 'Atuação' },
  { value: 'colaborador', label: 'Colaborador' },
  { value: 'responsavel_ticket', label: 'Responsável do ticket' },
];

export const FUNCAO_ATRIBUICAO_OPCOES = [
  { value: 'atendimento', label: 'Atendimento' },
  { value: 'n2', label: 'N2' },
  { value: 'suporte', label: 'Suporte' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'produtos', label: 'Produto' },
  { value: 'reclame-aqui', label: 'Reclame Aqui' },
  { value: 'bacen', label: 'Bacen' },
  { value: 'procon', label: 'Procon' },
  { value: 'consumidor-gov', label: 'Consumidor .GOV' },
  { value: 'gestao', label: 'Gestão' },
];

/** Une fallback estático + funções Desk + atuações VeloHub (ex.: Produto). */
export function buildFuncaoAtribuicaoOpcoes(funcoesDesk = [], velohub = []) {
  const map = new Map();
  FUNCAO_ATRIBUICAO_OPCOES.forEach((item) => map.set(item.value, item));
  (funcoesDesk || []).forEach((f) => {
    const slug = String(f?.slug || '').trim();
    if (!slug) return;
    map.set(slug, { value: slug, label: String(f.nome || slug).trim() || slug });
  });
  (velohub || []).forEach((v) => {
    const slug = String(v?.funcaoSlug || '').trim();
    if (!slug) return;
    const label = String(v.funcao || map.get(slug)?.label || slug).trim() || slug;
    map.set(slug, { value: slug, label });
  });
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export const ATRIBUICAO_SISTEMA = { value: 'sistema', label: 'Sistema (automático)' };

/** Preferência acao.automatica; fallback legado atribuicao.sistema */
export function resolveAutomaticaConfig(passo) {
  if (!passo) return null;
  const isAutomatica = passo.acao?.tipo === 'automatica' || passo.atribuicao?.tipo === 'sistema';
  if (!isAutomatica) return null;
  if (passo.acao?.automatica?.modo) return passo.acao.automatica;
  if (passo.atribuicao?.sistema?.modo) return passo.atribuicao.sistema;
  return null;
}

export const ACAO_TIPOS = [
  { value: 'manual', label: 'Manual' },
  { value: 'aprovacao', label: 'Aprovação' },
  { value: 'automatica', label: 'Automática' },
];

export const ROTA_VARIAVEIS = [
  { value: 'approve', label: 'Aprovar' },
  { value: 'reject', label: 'Reprovar' },
  { value: 'request_info', label: 'Pedir informação' },
  { value: 'concluir', label: 'Concluir' },
];

/**
 * Variáveis que sempre existem numa etapa de aprovação, mas não aparecem na
 * UI de configuração (sem card, sem linha na tabela). "Pedir informação" tem
 * função fixa e não avança etapa — não precisa ser configurável.
 */
export const HIDDEN_ROTA_VARIAVEIS = ['request_info'];

const HIDDEN_ROTA_DEFAULTS = {
  request_info: 'Pedir informação',
};

/**
 * Garante que a lista de rotas de uma etapa de aprovação sempre tenha uma rota
 * "approve" e uma "reject" (os dois cards obrigatórios do editor) e as
 * variáveis ocultas (request_info), preservando valores já existentes.
 * Bifurcação real: cada rota tem sua própria sub-lista `passos[]` (em vez de
 * um ponteiro `proximoPassoId` pra outro lugar de uma lista compartilhada).
 */
export function normalizeRotas(rotas = []) {
  const list = Array.isArray(rotas) ? rotas : [];
  const result = [...list];
  if (!result.some((r) => r.variavel === 'approve')) {
    result.unshift({ variavel: 'approve', rotulo: 'Aprovar', statusTicket: null, passos: [] });
  }
  if (!result.some((r) => r.variavel === 'reject')) {
    const approveIdx = result.findIndex((r) => r.variavel === 'approve');
    result.splice(approveIdx + 1, 0, { variavel: 'reject', rotulo: 'Reprovar', statusTicket: null, passos: [] });
  }
  HIDDEN_ROTA_VARIAVEIS.forEach((variavel) => {
    if (!result.some((r) => r.variavel === variavel)) {
      result.push({ variavel, rotulo: HIDDEN_ROTA_DEFAULTS[variavel] || variavel, statusTicket: null, passos: [] });
    }
  });
  return result.map((rota) => ({ ...rota, passos: rota.passos || [] }));
}

export function formatTriggerPath(gatilho) {
  const criterios = gatilho?.criterios || [];
  if (!criterios.length) return '—';
  return criterios
    .map((c) => {
      const label = findGatilhoCriterioLabel(c.fonte, c.campo);
      if (c.operador === 'not_empty') return `${label} ≠∅`;
      const val = formatCriterioValorLabel(c.fonte, c.campo, c.valor);
      const op = c.operador === 'contains' ? ' ∋ ' : ' = ';
      return `${label}${op}${val}`;
    })
    .join(' · ');
}

export function stepHasApprovalFromPasso(passo) {
  return passo?.acao?.tipo === 'aprovacao';
}

export function computeWorkflowStats(workflows) {
  const list = workflows || [];
  return {
    total: list.length,
    ativos: list.filter((wf) => wf.ativo !== false).length,
    inativos: list.filter((wf) => wf.ativo === false).length,
    etapas: list.reduce((sum, wf) => sum + (wf.passos?.length || 0), 0),
    comAprovacao: list.filter((wf) => (wf.passos || []).some((p) => stepHasApprovalFromPasso(p.passo))).length,
    tabulacao: list.filter((wf) => wf.gatilho?.tipo === 'tabulacao').length,
  };
}

export function generatePassoEnvelopeId() {
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  let rand = '';
  while (rand.length < 16) {
    rand += Math.floor(Math.random() * 16).toString(16);
  }
  return ts + rand;
}

export function sortPassosEnvelopes(passos = []) {
  return [...passos].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

export function normalizePassosOrdem(passos = []) {
  return sortPassosEnvelopes(passos).map((envelope, index) => ({
    ...envelope,
    ordem: index,
  }));
}

export function getPassoEnvelopeKey(envelope, index = 0) {
  if (envelope?._id) return String(envelope._id);
  return `step-${index}`;
}

export function findPassoEnvelopeIndex(passos = [], envelope) {
  if (!envelope) return -1;
  if (envelope._id) {
    const byId = passos.findIndex((item) => String(item._id) === String(envelope._id));
    if (byId >= 0) return byId;
  }
  return passos.indexOf(envelope);
}

export function normalizeGatilho(gatilho) {
  return {
    tipo: gatilho?.tipo || 'tabulacao',
    criterios: Array.isArray(gatilho?.criterios) ? gatilho.criterios : [],
  };
}

export function createEmptyGatilhoCriterio() {
  return { fonte: 'tabulacao', campo: '', operador: 'equals', valor: '' };
}

export function createEmptyPassoEnvelope(ordem = 0) {
  return {
    _id: generatePassoEnvelopeId(),
    ordem,
    passo: {
      nome: 'Nova etapa',
      descricao: '',
      slaHoras: null,
      atribuicao: { tipo: 'funcao', funcaoSlug: 'atendimento', grupoSlug: '', colaborador: '' },
      acao: { tipo: 'manual', rotas: [] },
    },
  };
}

export function createEmptyRequisicaoCampo(gatilho, existingCampos = []) {
  const existingIds = (existingCampos || []).map((c) => c.id);
  const id = slugifyRequisicaoLabel('', gatilho, existingIds);
  return {
    _clientKey: createRequisicaoCampoClientKey(),
    id,
    label: '',
    tipo: 'text',
    obrigatorio: false,
    ordem: existingCampos.length,
    opcoes: [],
    ajuda: '',
  };
}

export function normalizeRequisicao(requisicao, gatilho) {
  return normalizeRequisicaoConfig(requisicao, gatilho);
}

export function createEmptyWorkflowDocument() {
  return {
    slug: '',
    titulo: 'Novo workflow',
    descricao: '',
    ordem: 0,
    ativo: true,
    gatilho: {
      tipo: 'tabulacao',
      criterios: [],
    },
    requisicao: { campos: [] },
    passos: [
      createEmptyPassoEnvelope(0),
    ],
    passoInicialId: null,
  };
}

export function createWorkflowSlug(title) {
  return String(title || 'workflow')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `workflow-${Date.now()}`;
}

export function criteriosToTriggerPath(criterios = []) {
  const map = Object.fromEntries(criterios.map((c) => [c.campo, c.valor]));
  return {
    type: 'tabulation',
    path: [
      map.produto || '',
      map.tipoChamado || map.tipo || '',
      map.motivo || '',
      map.detalhe || '',
    ],
    description: '',
    criterios,
  };
}

export function triggerPathToCriterios(trigger) {
  if (trigger?.criterios?.length) return trigger.criterios;
  const path = trigger?.path || [];
  return [
    { fonte: 'tabulacao', campo: 'produto', operador: 'contains', valor: path[0] || '' },
    { fonte: 'tabulacao', campo: 'tipoChamado', operador: 'equals', valor: path[1] || '' },
    { fonte: 'tabulacao', campo: 'motivo', operador: 'contains', valor: path[2] || '' },
    { fonte: 'tabulacao', campo: 'detalhe', operador: 'contains', valor: path[3] || '' },
  ];
}

export function passosToDisplaySteps(passos = []) {
  const ordered = normalizePassosOrdem(passos);
  return ordered.map((envelope, index) => {
      const cfg = envelope.passo || {};
      const badges = [];
      if (cfg.atribuicao?.grupoSlug) badges.push({ label: `Grupo: ${cfg.atribuicao.grupoSlug}`, tone: 'neutral' });
      if (cfg.slaHoras) badges.push({ label: `SLA: ${cfg.slaHoras}h`, tone: 'sla' });
      if (cfg.acao?.tipo === 'aprovacao') badges.push({ label: 'Ação: Aprovar / Reprovar', tone: 'neutral' });
      return {
        id: getPassoEnvelopeKey(envelope, index),
        title: cfg.nome,
        description: cfg.descricao,
        icon: resolveStepIcon(cfg.acao?.tipo),
        iconTone: cfg.acao?.tipo === 'aprovacao' ? 'approval' : 'start',
        badges,
        envelope,
      };
    });
}
