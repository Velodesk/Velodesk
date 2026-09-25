/**
 * consultaFormatters v1.1.0 — datas em America/Sao_Paulo; date-only sem shift de dia
 * VERSION: v1.1.0 | DATE: 2026-08-18
 */
import { isDraftTicket } from '../../api/adapters/ticketAdapter';
import { formatDateBr, formatDateTimeBr, formatTimeBr } from '../../utils/dateTimeBr';

export const CONSULTA_PRODUCT_SLUGS = [
  'emprestimo-pessoal',
  'antecipacao-salario',
  'antecipacao-irpf',
  'clube-velotax',
];

export const CONSULTA_PRODUCT_LABELS = {
  'emprestimo-pessoal': 'Empréstimo Pessoal',
  'antecipacao-salario': 'Antecipação de Salário',
  'antecipacao-irpf': 'Antecipação IRPF',
  'clube-velotax': 'Clube Velotax',
};

/** Espelha backend/src/services/consultaProductMap.ts (TABULACAO_TO_SLUG) — manter em sincronia. */
const TABULACAO_TO_SLUG = [
  { match: /empr[eé]stimo/i, slug: 'emprestimo-pessoal' },
  { match: /antecipa[cç][aã]o.{0,12}sal[aá]rio|sal[aá]rio/i, slug: 'antecipacao-salario' },
  { match: /irpf|imposto.{0,12}renda|antecipa[cç][aã]o.{0,12}ir/i, slug: 'antecipacao-irpf' },
  { match: /clube|cupom|vibes/i, slug: 'clube-velotax' },
];

export function mapTabulacaoProdutoToSlug(produto) {
  const text = String(produto ?? '').trim();
  if (!text) return null;
  const entry = TABULACAO_TO_SLUG.find(({ match }) => match.test(text));
  return entry ? entry.slug : null;
}

export function formatConsultaCpf(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) return digits || '';
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

export function formatConsultaMoney(value) {
  if (value == null || value === '') return '—';
  const num = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatConsultaDate(value) {
  return formatDateBr(value);
}

export function formatConsultaDateTime(value) {
  return formatDateTimeBr(value);
}

export function formatConsultaTime(value) {
  return formatTimeBr(value);
}

export function formatAccountStatus(status) {
  const map = {
    active: 'Ativa',
    deleted: 'Excluída',
  };
  return map[status] || status || '—';
}

export function formatInstallmentStatus(status) {
  const map = {
    paid: 'Paga',
    on_time: 'Em dia',
    overdue: 'Atrasada',
    unknown: 'Indefinida',
  };
  return map[status] || status || '—';
}

/** Tom de cor para o status de uma parcela — null quando não há destaque (Em dia/Indefinida). */
export function getInstallmentStatusTone(status) {
  const key = String(status ?? '').toLowerCase();
  if (key === 'paid') return 'green';
  if (key === 'overdue') return 'red';
  return null;
}

export function getOverviewProductFlags(products) {
  if (!products || typeof products !== 'object') return [];
  return [
    { key: 'emprestimoPessoal', label: 'Empréstimo Pessoal', active: Boolean(products.emprestimoPessoal) },
    { key: 'antecipacaoSalario', label: 'Antecipação Salário', active: Boolean(products.antecipacaoSalario) },
    { key: 'irpf', label: 'Antecipação IRPF', active: Boolean(products.irpf2024 || products.irpf2025 || products.irpf2026) },
    { key: 'clubeVelotax', label: 'Clube Velotax', active: Boolean(products.clubeVelotax) },
    { key: 'seguros', label: 'Seguros', active: Boolean(products.seguros) },
    { key: 'segurosAtivos', label: 'Seguros ativos', active: Boolean(products.segurosAtivos) },
    { key: 'calculadora', label: 'Calculadora', active: Boolean(products.calculadora) },
    { key: 'creditoTrabalhador', label: 'Crédito trabalhador', active: Boolean(products.creditoTrabalhador) },
  ];
}

/** Tom visual (cor) por estado — mesmos tokens de .status-badge (velodesk-crm.css). */
export const CONSULTA_STATUS_TONE = {
  done: 'green',
  pending: 'amber',
  canceled: 'red',
  none: 'gray',
};

/** Classifica um label de status (ex.: "Quitado"/"Em vigência"/"Cancelado") num estado padronizado. */
export function classifyConsultaStatusLabel(label) {
  const text = String(label ?? '').toLowerCase();
  if (!text) return 'none';
  if (/quita/.test(text)) return 'done';
  if (/cancel/.test(text)) return 'canceled';
  return 'pending';
}

export function pickPrimaryContract(contracts) {
  if (!contracts.length) return null;
  const nonCanceled = contracts.filter(
    (c) => classifyConsultaStatusLabel(c.contractStatusLabel || c.contractStatus) !== 'canceled',
  );
  const pool = nonCanceled.length ? nonCanceled : contracts;
  return pool.slice().sort((a, b) => {
    const da = new Date(a.disbursedAt || 0).getTime();
    const db = new Date(b.disbursedAt || 0).getTime();
    return db - da;
  })[0];
}

function lastPaidInstallmentDate(contract) {
  const list = Array.isArray(contract.installments) ? contract.installments : [];
  const paid = list.filter((item) => String(item.status).toLowerCase() === 'paid');
  if (!paid.length) return contract.disbursedAt;
  return paid.slice().sort((a, b) => new Date(b.dueDate || 0) - new Date(a.dueDate || 0))[0].dueDate;
}

function summarizeEpAs(data) {
  const contracts = Array.isArray(data?.contracts) ? data.contracts : [];
  if (!contracts.length) {
    return { iconState: 'none', pillLabel: 'Sem dados', pillTone: 'gray', titleExtra: '', subtitle: 'nenhum contrato registrado' };
  }

  const primary = pickPrimaryContract(contracts);
  const iconState = classifyConsultaStatusLabel(primary.contractStatusLabel || primary.contractStatus);
  const pillTone = CONSULTA_STATUS_TONE[iconState] || 'gray';
  const pillLabel = primary.contractStatusLabel || primary.contractStatus || '—';
  const titleExtra = contracts.length === 1
    ? `${formatConsultaMoney(primary.principal)} antecipado`
    : `${contracts.length} contratos`;

  let subtitle = '';
  if (iconState === 'done') {
    subtitle = `quitado em ${formatConsultaDate(lastPaidInstallmentDate(primary))}`;
  } else if (iconState === 'pending' && primary.nextInstallment) {
    subtitle = `próxima parcela ${formatConsultaDate(primary.nextInstallment.dueDate)}`;
  } else if (iconState === 'canceled' && primary.disbursedAt) {
    subtitle = `desembolso ${formatConsultaDate(primary.disbursedAt)}`;
  }

  return { iconState, pillLabel, pillTone, titleExtra, subtitle };
}

function summarizeIrpf(data) {
  const years = Array.isArray(data?.years) ? data.years : [];
  if (!years.length) {
    return { iconState: 'none', pillLabel: 'Sem dados', pillTone: 'gray', titleExtra: '', subtitle: 'sem histórico IRPF' };
  }

  const sorted = years.slice().sort((a, b) => Number(b.year) - Number(a.year));
  const primary = sorted[0];
  const iconState = classifyConsultaStatusLabel(primary.statusLabel || primary.status);
  const pillTone = CONSULTA_STATUS_TONE[iconState] || 'gray';
  const pillLabel = `${primary.statusLabel || primary.status || '—'} ${primary.year}`.trim();

  const yearLabels = sorted.map((y) => y.year);
  const titleExtra = yearLabels.length <= 1
    ? String(yearLabels[0] || '')
    : `${yearLabels.slice(0, -1).join(', ')} e ${yearLabels[yearLabels.length - 1]}`;

  const pendingYears = sorted.filter((y) => classifyConsultaStatusLabel(y.statusLabel || y.status) !== 'done');
  let subtitle;
  if (!pendingYears.length) {
    subtitle = years.length === 2 ? 'ambos quitados' : 'todos quitados';
  } else {
    subtitle = pendingYears
      .map((y) => `${y.year} ${(y.statusLabel || y.status || '').toLowerCase()}`.trim())
      .join(' · ');
  }

  return { iconState, pillLabel, pillTone, titleExtra, subtitle };
}

function summarizeClube(data) {
  const totalCoupons = Number(data?.totalCoupons) || 0;
  if (!totalCoupons) {
    return { iconState: 'none', pillLabel: 'Sem dados', pillTone: 'gray', titleExtra: '', subtitle: 'sem cupons recentes' };
  }
  const coupons = Array.isArray(data?.recentCoupons) ? data.recentCoupons : [];
  return {
    iconState: 'done',
    pillLabel: 'Disponível',
    pillTone: 'green',
    titleExtra: `${totalCoupons} cupons`,
    subtitle: coupons.length ? `${coupons.length} cupons recentes` : '',
  };
}

/**
 * Resumo para a linha recolhida do accordion de Consultas: ícone de status,
 * pill colorida e texto curto — derivado do que já veio no fetch (sem chamada extra).
 * @param {string} slug
 * @param {{ loaded?: boolean, status?: string, data?: object }} [entry]
 */
export function summarizeConsultaProduct(slug, entry) {
  const noData = !entry?.loaded
    || entry.status === 'customer_not_found'
    || entry.status === 'product_not_found'
    || !entry.data;

  if (noData) {
    return { iconState: 'none', pillLabel: 'Sem dados', pillTone: 'gray', titleExtra: '', subtitle: 'sem dados disponíveis' };
  }

  if (slug === 'emprestimo-pessoal' || slug === 'antecipacao-salario') return summarizeEpAs(entry.data);
  if (slug === 'antecipacao-irpf') return summarizeIrpf(entry.data);
  if (slug === 'clube-velotax') return summarizeClube(entry.data);

  return { iconState: 'none', pillLabel: 'Sem dados', pillTone: 'gray', titleExtra: '', subtitle: '' };
}

export function getTicketRefFromTicket(ticket, client = null) {
  const ticketId = String(ticket?.id || ticket?._id || '').trim();
  const protocolo = String(
    ticket?.protocolo || ticket?.chamadoProtocolo || ticket?.lateralForm?.protocolo || '',
  ).trim();
  const lf = ticket?.lateralForm || {};
  const cpfRaw = lf.clienteCpf || lf.cpf || ticket?.clientCPF || client?.cpf || '';
  const cpf = String(cpfRaw || '').replace(/\D/g, '');
  const isDraft = isDraftTicket(ticket);
  const ticketProduct = String(lf.produto || ticket?.produto || '').trim() || undefined;

  return {
    ticketId: ticketId || undefined,
    protocolo: protocolo || undefined,
    cpf: cpf.length === 11 ? cpf : undefined,
    isDraft,
    ticketProduct,
  };
}
