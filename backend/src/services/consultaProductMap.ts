/** consultaProductMap v1.0.0 — tabulação Desk → slug Customer Data API */
export const CONSULTA_PRODUCT_SLUGS = [
  'emprestimo-pessoal',
  'antecipacao-salario',
  'antecipacao-irpf',
  'clube-velotax',
  'calculadora',
  'credito-trabalhador',
  'seguros',
  'pagarme',
  'starkbank',
] as const;

export type ConsultaProductSlug = (typeof CONSULTA_PRODUCT_SLUGS)[number];

export const CONSULTA_PRODUCT_LABELS: Record<ConsultaProductSlug, string> = {
  'emprestimo-pessoal': 'Empréstimo Pessoal',
  'antecipacao-salario': 'Antecipação de Salário',
  'antecipacao-irpf': 'Antecipação IRPF',
  'clube-velotax': 'Clube Velotax',
  calculadora: 'Calculadora',
  'credito-trabalhador': 'Crédito do Trabalhador',
  seguros: 'Seguros',
  pagarme: 'Pagar.me',
  starkbank: 'StarkBank',
};

const TABULACAO_TO_SLUG: Array<{ match: RegExp; slug: ConsultaProductSlug }> = [
  { match: /empr[eé]stimo/i, slug: 'emprestimo-pessoal' },
  { match: /antecipa[cç][aã]o.{0,12}sal[aá]rio|sal[aá]rio/i, slug: 'antecipacao-salario' },
  { match: /irpf|imposto.{0,12}renda|antecipa[cç][aã]o.{0,12}ir/i, slug: 'antecipacao-irpf' },
  { match: /clube|cupom|vibes/i, slug: 'clube-velotax' },
  { match: /calculadora/i, slug: 'calculadora' },
  { match: /cr[eé]dito.{0,12}trabalhador|consignado/i, slug: 'credito-trabalhador' },
  { match: /seguro/i, slug: 'seguros' },
];

const SLUG_TO_API_PATH: Record<ConsultaProductSlug, string> = {
  'emprestimo-pessoal': '/v1/products/emprestimo-pessoal',
  'antecipacao-salario': '/v1/products/antecipacao-salario',
  'antecipacao-irpf': '/v1/products/antecipacao-irpf',
  'clube-velotax': '/v1/products/clube-velotax',
  calculadora: '/v1/products/calculadora',
  'credito-trabalhador': '/v1/products/credito-trabalhador',
  seguros: '/v1/products/seguros',
  pagarme: '/v1/payments/pagarme',
  starkbank: '/v1/payments/starkbank',
};

const SLUG_TO_OVERVIEW_FLAG: Record<ConsultaProductSlug, (products: Record<string, boolean>) => boolean> = {
  'emprestimo-pessoal': (p) => Boolean(p.emprestimoPessoal),
  'antecipacao-salario': (p) => Boolean(p.antecipacaoSalario),
  'antecipacao-irpf': (p) => Boolean(p.irpf2024 || p.irpf2025 || p.irpf2026),
  'clube-velotax': (p) => Boolean(p.clubeVelotax),
  calculadora: (p) => Boolean(p.calculadora),
  'credito-trabalhador': (p) => Boolean(p.creditoTrabalhador),
  seguros: (p) => Boolean(p.seguros),
  // Pagar.me/StarkBank não têm flag no overview (consultam a provedora, não o cadastro) —
  // sempre pré-carregados (ver ALWAYS_PREFETCH_SLUGS), este mapa nunca é consultado para eles.
  pagarme: () => false,
  starkbank: () => false,
};

/**
 * Produtos sem flag no overview cuja única forma de aparecer no workspace de Consultas
 * é vir junto no fetch inicial (não há mais carregamento sob demanda na UI).
 */
const ALWAYS_PREFETCH_SLUGS: ReadonlySet<ConsultaProductSlug> = new Set(['pagarme', 'starkbank']);

export function isConsultaProductSlug(value: string): value is ConsultaProductSlug {
  return (CONSULTA_PRODUCT_SLUGS as readonly string[]).includes(value);
}

export function mapTabulacaoProdutoToSlug(produto: unknown): ConsultaProductSlug | null {
  const text = String(produto ?? '').trim();
  if (!text) return null;
  for (const entry of TABULACAO_TO_SLUG) {
    if (entry.match.test(text)) return entry.slug;
  }
  return null;
}

export function getProductApiPath(slug: ConsultaProductSlug): string {
  return SLUG_TO_API_PATH[slug];
}

export function shouldPrefetchProduct(
  slug: ConsultaProductSlug,
  products: Record<string, boolean> | null | undefined,
  ticketProductSlug: ConsultaProductSlug | null,
): boolean {
  if (ticketProductSlug === slug) return true;
  if (ALWAYS_PREFETCH_SLUGS.has(slug)) return true;
  if (!products) return false;
  return SLUG_TO_OVERVIEW_FLAG[slug](products);
}

export function listPendingExpandSlugs(
  prefetched: Set<ConsultaProductSlug>,
): ConsultaProductSlug[] {
  return CONSULTA_PRODUCT_SLUGS.filter((slug) => !prefetched.has(slug));
}

/** Produtos contratados (flags true) a partir do bloco `products` do overview da Customer Data API. */
export function extractContractedProductSlugs(
  products: Record<string, boolean> | null | undefined,
): ConsultaProductSlug[] {
  if (!products) return [];
  return CONSULTA_PRODUCT_SLUGS.filter((slug) => SLUG_TO_OVERVIEW_FLAG[slug](products));
}
