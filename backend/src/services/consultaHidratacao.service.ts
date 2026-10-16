/**
 * consultaHidratacao.service v1.0.0 — dados reais da conta do cliente para os agentes de IA
 * VERSION: v1.0.0 | DATE: 2026-10-07
 *
 * O agente identifica o produto pela mensagem (ou pela tabulação que ele mesmo classificou), este
 * serviço consulta SÓ aquele produto na Customer Data API (mesma consulta que o atendente faz ao clicar
 * no produto) e devolve um bloco de texto enxuto para o prompt.
 *
 * Privacidade: o CPF nunca sai daqui; nada de cadastro (nome, e-mail, telefone, endereço), identificadores
 * internos ou dados bancários. Contratos/parcelas/elegibilidade usam allowlist; demais produtos passam por
 * um filtro de campos escalares com denylist. O resultado é limitado em tamanho.
 */
import { resolveConsultaContext, ConsultaCpfError } from './consultaCpfResolver.service';
import { isHidratacaoEnabled } from './agents/autonomyRules.service';
import { fetchProductSnapshot, isCustomerDataApiConfigured } from './customerDataApi.service';
import {
  CONSULTA_PRODUCT_LABELS,
  mapTabulacaoProdutoToSlug,
  type ConsultaProductSlug,
} from './consultaProductMap';

export type HidratacaoStatus = 'ok' | 'sem_dados' | 'indisponivel';

export interface HidratacaoResult {
  slug: ConsultaProductSlug;
  status: HidratacaoStatus;
  /** Texto pronto para o prompt (vazio quando indisponível). */
  bloco: string;
  motivo?: string;
}

const TIMEOUT_MS = 8000;
const MAX_BLOCK_CHARS = 3500;
const MAX_CONTRACTS = 5;
const MAX_INSTALLMENTS = 12;
const MAX_ITEMS_GENERIC = 5;

const INSTALLMENT_DETAIL_RE = /parcel|pagament|boleto|quita|venc|atras|cobran|desembols|deposit|valor/i;

/** Campos que nunca vão para o prompt, em qualquer produto. */
const DENY_KEY_RE = /(cpf|e-?mail|phone|telefone|celular|address|endereco|birth|nasc|token|secret|pix|iban|password|senha|document|cartao|card|bank|banco|agenc|account|requestid|fullname)/i;
const DENY_EXACT_KEYS = new Set(['name', 'nome', 'customername', 'clientname', 'employername', 'id', '_id']);

const SAFE_NAME_KEYS = new Set(['planname', 'productname', 'couponname', 'packagename', 'insurancename', 'productlabel']);

function isDeniedKey(key: string): boolean {
  const k = key.toLowerCase();
  if (/(name|nome)$/.test(k) && !SAFE_NAME_KEYS.has(k)) return true;
  return DENY_EXACT_KEYS.has(k) || /id$/.test(k) || DENY_KEY_RE.test(k);
}

export function slugFromTabulacaoProduto(produto: unknown): ConsultaProductSlug | null {
  return mapTabulacaoProdutoToSlug(produto);
}

// ───────────────────────────── formatação ─────────────────────────────

function fmtDate(value: unknown): string {
  const s = String(value ?? '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function fmtMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return `R$ ${n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

function isScalar(v: unknown): v is string | number | boolean {
  return ['string', 'number', 'boolean'].includes(typeof v);
}

function scalarText(key: string, v: string | number | boolean): string {
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  const k = key.toLowerCase();
  if (typeof v === 'string' && /date|at$|expires|due/.test(k)) return fmtDate(v);
  if (typeof v === 'number' && /amount|principal|fee|valor|balance|saldo|margem|price/.test(k)) return fmtMoney(v);
  return String(v);
}

function pickScalars(obj: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (isDeniedKey(key) || !isScalar(value) || value === '') continue;
    out.push(`${key}: ${scalarText(key, value)}`);
  }
  return out;
}

function formatInstallments(list: unknown[], detail: boolean): string[] {
  const items = list.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  const paid = items.filter((i) => i.paid === true || String(i.status).toLowerCase() === 'paid').length;
  const lines = [`   parcelas pagas: ${paid}/${items.length}`];
  if (detail) {
    for (const i of items.slice(0, MAX_INSTALLMENTS)) {
      lines.push(
        `   - parcela ${i.number ?? '?'}: vence ${fmtDate(i.dueDate)}, valor ${fmtMoney(i.amountDue)}, `
        + `${i.paid ? `paga${i.paidAt ? ` em ${fmtDate(i.paidAt)}` : ''}` : `status ${i.status ?? 'em aberto'}`}`,
      );
    }
  }
  return lines;
}

function formatContracts(contracts: unknown[], detail: boolean): string[] {
  const rows = contracts.filter((c): c is Record<string, unknown> => !!c && typeof c === 'object');
  const sorted = [...rows].sort(
    (a, b) => new Date(String(b.disbursedAt || 0)).getTime() - new Date(String(a.disbursedAt || 0)).getTime(),
  );
  const lines: string[] = [`Contratos encontrados: ${rows.length}`];
  sorted.slice(0, MAX_CONTRACTS).forEach((c, idx) => {
    const status = [c.contractStatusLabel, c.contractStatus].filter(Boolean).join(' / ');
    const provider = [c.providerStatusLabel, c.providerStatus].filter(Boolean).join(' / ');
    lines.push(
      `${idx + 1}. contrato ${c.contractNumber ?? 's/n'} — status: ${status || 'n/d'}`
      + (provider ? ` | situação no provedor: ${provider}` : '')
      + (c.principal != null ? ` | principal: ${fmtMoney(c.principal)}` : '')
      + (c.totalAmountDue != null ? ` | total devido: ${fmtMoney(c.totalAmountDue)}` : '')
      + (c.disbursedAt ? ` | desembolso: ${fmtDate(c.disbursedAt)}` : '')
      + (typeof c.hasInsurance === 'boolean' ? ` | seguro: ${c.hasInsurance ? 'sim' : 'não'}` : ''),
    );
    const next = c.nextInstallment as Record<string, unknown> | undefined;
    if (next && typeof next === 'object') {
      lines.push(`   próxima parcela: nº ${next.number ?? '?'} em ${fmtDate(next.dueDate)}, valor ${fmtMoney(next.amountDue)}`);
    }
    if (Array.isArray(c.installments) && c.installments.length) {
      lines.push(...formatInstallments(c.installments, detail));
    }
  });
  if (rows.length > MAX_CONTRACTS) lines.push(`(+${rows.length - MAX_CONTRACTS} contratos mais antigos omitidos)`);
  return lines;
}

function formatEligibility(data: Record<string, unknown>): string[] {
  const key = Object.keys(data).find((k) => /eligib/i.test(k));
  const el = key ? data[key] : undefined;
  if (!el || typeof el !== 'object') return [];
  const picked = pickScalars(el as Record<string, unknown>);
  return picked.length ? [`Elegibilidade para nova contratação: ${picked.join('; ')}`] : [];
}

function formatGeneric(data: Record<string, unknown>, depth = 0): string[] {
  const lines = pickScalars(data);
  if (depth >= 2) return lines;
  for (const [key, value] of Object.entries(data)) {
    if (isDeniedKey(key)) continue;
    if (Array.isArray(value) && value.length) {
      lines.push(`${key} (${value.length}):`);
      value.slice(0, MAX_ITEMS_GENERIC).forEach((item, i) => {
        if (item && typeof item === 'object') {
          lines.push(`  ${i + 1}. ${pickScalars(item as Record<string, unknown>).join(' | ')}`);
        } else if (isScalar(item)) {
          lines.push(`  ${i + 1}. ${String(item)}`);
        }
      });
    } else if (value && typeof value === 'object') {
      const sub = formatGeneric(value as Record<string, unknown>, depth + 1);
      if (sub.length) lines.push(`${key}:`, ...sub.map((l) => `  ${l}`));
    }
  }
  return lines;
}

const CONTRACT_SLUGS: ReadonlySet<ConsultaProductSlug> = new Set([
  'emprestimo-pessoal', 'antecipacao-salario', 'credito-trabalhador', 'seguros',
]);

export function formatProductForPrompt(
  slug: ConsultaProductSlug,
  data: unknown,
  motivo?: string,
  contextText?: string,
): string {
  if (!data || typeof data !== 'object') return '';
  const obj = data as Record<string, unknown>;
  const detail = INSTALLMENT_DETAIL_RE.test(`${motivo || ''} ${contextText || ''}`);

  let lines: string[];
  if (CONTRACT_SLUGS.has(slug) && Array.isArray(obj.contracts)) {
    lines = [...formatContracts(obj.contracts, detail), ...formatEligibility(obj)];
    const margem = obj.margem;
    if (margem && typeof margem === 'object') {
      const m = pickScalars(margem as Record<string, unknown>);
      if (m.length) lines.push(`Margem: ${m.join('; ')}`);
    }
  } else {
    lines = [...formatGeneric(obj), ...formatEligibility(obj)];
  }

  const text = lines.filter(Boolean).join('\n');
  return text.length > MAX_BLOCK_CHARS ? `${text.slice(0, MAX_BLOCK_CHARS)}\n(…dados truncados)` : text;
}

// ───────────────────────────── consulta ─────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`hidratação excedeu ${ms}ms`)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * Consulta o produto do cliente do chamado. Nunca lança: falha vira `indisponivel`.
 * `sem_dados` = a API respondeu mas sem dados utilizáveis para o produto.
 */
export async function hydrateProductForTicket(params: {
  ticketId?: string;
  protocolo?: string;
  slug: ConsultaProductSlug;
  motivo?: string;
  contextText?: string;
}): Promise<HidratacaoResult> {
  const { slug } = params;
  const unavailable = (motivo: string): HidratacaoResult => ({ slug, status: 'indisponivel', bloco: '', motivo });

  if (!isCustomerDataApiConfigured()) return unavailable('api_nao_configurada');
  if (!params.ticketId && !params.protocolo) return unavailable('ticket_nao_identificado');

  try {
    const ctx = await resolveConsultaContext({ ticketId: params.ticketId, protocolo: params.protocolo });
    const snap = await withTimeout(fetchProductSnapshot(slug, ctx.cpf, ctx.protocolo), TIMEOUT_MS);

    if (!snap.ok) {
      return { slug, status: 'sem_dados', bloco: '', motivo: snap.status || 'resposta_sem_dados' };
    }
    const body = formatProductForPrompt(slug, snap.data, params.motivo, params.contextText);
    if (!body) return { slug, status: 'sem_dados', bloco: '', motivo: 'dados_vazios' };

    const bloco = `Produto consultado: ${CONSULTA_PRODUCT_LABELS[slug]} (consulta oficial em tempo real)\n${body}`;
    return { slug, status: 'ok', bloco };
  } catch (err) {
    if (err instanceof ConsultaCpfError) return unavailable(err.code);
    console.warn('[hidratacao] falha ao consultar produto (fail-soft):', slug, (err as Error)?.message);
    return unavailable('erro_consulta');
  }
}

/**
 * Para revisões (do atendente ou reprovação humana): reaproveita o produto já classificado.
 * Retorna o bloco do prompt, ou undefined quando a hidratação está desligada/indisponível.
 */
export async function hydrateForRevision(params: {
  ticketId?: string;
  protocolo?: string;
  produto?: string;
  motivo?: string;
}): Promise<string | undefined> {
  if (!(await isHidratacaoEnabled())) return undefined;
  const slug = mapTabulacaoProdutoToSlug(params.produto);
  if (!slug) return undefined;
  const hid = await hydrateProductForTicket({
    ticketId: params.ticketId,
    protocolo: params.protocolo,
    slug,
    motivo: params.motivo,
  });
  return hid.bloco || undefined;
}
