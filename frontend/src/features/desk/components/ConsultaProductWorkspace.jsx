/**
 * ConsultaProductWorkspace v2.0.0 — sidebar de produtos ativos + detalhe genérico com
 * seleção de contrato (Empréstimo Pessoal/Antecipação de Salário); IRPF/Clube Velotax
 * continuam no formato simples (métricas + linha do tempo), sem estrutura de contratos/
 * parcelas na API real.
 * VERSION: v2.0.0 | DATE: 2026-09-24
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  CONSULTA_PRODUCT_LABELS,
  CONSULTA_PRODUCT_SLUGS,
  CONSULTA_STATUS_TONE,
  classifyConsultaStatusLabel,
  formatConsultaDate,
  formatConsultaDateTime,
  formatConsultaMoney,
  formatConsultaTime,
  formatInstallmentStatus,
  getInstallmentStatusTone,
  getOverviewProductFlags,
  summarizeConsultaProduct,
} from '../../../services/desk/consultaFormatters';
import { ICON_BY_STATE, StatusChip } from './ConsultaStatusChip';

const CONTRACT_PRODUCT_SLUGS = ['emprestimo-pessoal', 'antecipacao-salario'];
const ROTULO_VALOR_BY_SLUG = {
  'emprestimo-pessoal': 'Valor contratado',
  'antecipacao-salario': 'Valor antecipado',
};

const PAYMENT_METHOD_LABEL = { PAGARME: 'Pagar.me' };
function formatPaymentMethod(raw) {
  if (!raw) return '';
  const key = String(raw).trim().toUpperCase();
  return PAYMENT_METHOD_LABEL[key] || raw;
}

const ELIGIBILITY_REASON_LABEL = {
  not_available: 'Crédito não disponível no momento',
};

const ELIGIBILITY_PRODUCT_PHRASE = {
  'emprestimo-pessoal': 'um novo empréstimo pessoal',
  'antecipacao-salario': 'uma nova antecipação de salário',
};

function buildEligibilidade(eligibility, slug) {
  if (!eligibility) return null;
  const disponivel = Boolean(eligibility.available);
  const mensagem = ELIGIBILITY_REASON_LABEL[eligibility.reasonCode]
    || (disponivel ? 'Crédito disponível' : 'Crédito não disponível no momento');
  const productPhrase = ELIGIBILITY_PRODUCT_PHRASE[slug] || 'um novo crédito';

  return {
    disponivel,
    badgeLabel: disponivel ? 'Disponível' : 'Indisponível',
    mensagem,
    detalhe: disponivel
      ? `Cliente pode contratar ${productPhrase} agora.`
      : `Cliente não pode contratar ${productPhrase} agora.`,
    expiraEmLabel: eligibility.expiresAt ? `Nova checagem em ${formatConsultaDate(eligibility.expiresAt)}` : '',
  };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;
  const diffMs = target.setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / 86400000);
}

/** "Em dia" | "Atrasada" | "Paga" (via formatInstallmentStatus) — nunca lança, sempre retorna algo exibível. */
function normalizeParcela(raw) {
  return {
    numero: raw?.number ?? null,
    vencimento: raw?.dueDate ?? null,
    valorDevido: raw?.amountDue ?? null,
    pago: Boolean(raw?.paid),
    valorPago: raw?.amountPaid ?? null,
    pagoEm: raw?.paidAt ?? null,
    formaPagamento: raw?.paymentType ?? null,
    situacao: formatInstallmentStatus(raw?.status),
    situacaoTone: getInstallmentStatusTone(raw?.status),
  };
}

/** "vigencia" (em aberto) | "quitado" | "atrasado" — deriva de label + fallback pelas parcelas. */
function classifyContractStatusKind(label, parcelas) {
  const text = String(label ?? '').toLowerCase();
  if (/quita/.test(text)) return 'quitado';
  if (parcelas.length && parcelas.every((p) => p.pago)) return 'quitado';
  if (/atras/.test(text)) return 'atrasado';
  if (parcelas.some((p) => p.situacao === 'Atrasada')) return 'atrasado';
  return 'vigencia';
}

function normalizeContrato(raw, sequencia, totalContratos) {
  const parcelas = (Array.isArray(raw?.installments) ? raw.installments : [])
    .map(normalizeParcela)
    .sort((a, b) => Number(a.numero) - Number(b.numero));

  const statusLabel = raw?.contractStatusLabel || raw?.contractStatus || '—';
  const statusKind = classifyContractStatusKind(statusLabel, parcelas);

  const valorContratado = Number(raw?.principal) || 0;
  const valorTotalDevido = Number(raw?.totalAmountDue) || 0;
  const totalPago = parcelas.reduce((sum, p) => sum + (Number(p.valorPago) || 0), 0);
  const encargos = valorTotalDevido - valorContratado;

  const pagas = parcelas.filter((p) => p.pago);
  const ultimoPagamento = pagas
    .slice()
    .sort((a, b) => new Date(b.pagoEm || b.vencimento || 0) - new Date(a.pagoEm || a.vencimento || 0))[0] || null;

  const proximaParcelaRaw = statusKind !== 'quitado'
    ? (raw?.nextInstallment || parcelas.find((p) => !p.pago) || null)
    : null;
  const proximaParcelaDias = proximaParcelaRaw ? daysUntil(proximaParcelaRaw.dueDate ?? proximaParcelaRaw.vencimento) : null;

  return {
    id: raw?.contractNumber ? String(raw.contractNumber) : `contrato-${sequencia}`,
    sequencia,
    totalContratos,
    status: statusLabel,
    statusKind,
    valorContratado,
    valorTotalDevido,
    totalPago,
    seguro: Boolean(raw?.hasInsurance),
    encargos,
    dataPedido: raw?.disbursedAt ?? null,
    ccb: { numero: raw?.contractNumber ?? '', status: raw?.contractNumber ? 'Emitido' : '' },
    totalParcelas: parcelas.length,
    valorParcela: parcelas[0]?.valorDevido ?? null,
    parcelas,
    proximaParcela: proximaParcelaRaw ? {
      vencimento: proximaParcelaRaw.dueDate ?? proximaParcelaRaw.vencimento,
      valor: proximaParcelaRaw.amountDue ?? proximaParcelaRaw.valorDevido,
      dias: proximaParcelaDias,
      numero: proximaParcelaRaw.number ?? proximaParcelaRaw.numero,
    } : null,
    quitadoEm: ultimoPagamento ? { data: ultimoPagamento.pagoEm, formaPagamento: ultimoPagamento.formaPagamento } : null,
  };
}

const STATUS_KIND_LABEL = { vigencia: 'em vigência', quitado: 'quitado', atrasado: 'atrasado' };

function buildSubtitle(contratos) {
  const total = contratos.length;
  if (total === 1) return `1 contrato · ${STATUS_KIND_LABEL[contratos[0].statusKind]}`;
  const counts = { vigencia: 0, quitado: 0, atrasado: 0 };
  contratos.forEach((c) => { counts[c.statusKind] = (counts[c.statusKind] || 0) + 1; });
  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${STATUS_KIND_LABEL[kind]}`);
  return `${total} contratos · ${parts.join(' · ')}`;
}

function buildHistorico(contratos) {
  const quitados = contratos.filter((c) => c.statusKind === 'quitado').length;
  const totalPago = contratos.reduce((sum, c) => sum + c.totalPago, 0);
  const datasPedido = contratos.map((c) => c.dataPedido).filter(Boolean).map((d) => new Date(d).getTime());
  const primeiroPedido = datasPedido.length ? new Date(Math.min(...datasPedido)).toISOString() : null;

  return {
    totalContratos: contratos.length,
    quitados,
    totalPagoLabel: formatConsultaMoney(totalPago),
    primeiroPedidoLabel: primeiroPedido ? formatConsultaDate(primeiroPedido) : '—',
  };
}

function pickDefaultContratoId(contratos) {
  const aberto = contratos.find((c) => c.statusKind === 'vigencia' || c.statusKind === 'atrasado');
  return (aberto || contratos[0])?.id ?? null;
}

/** Converte a resposta bruta (contracts[]) num Produto normalizado — único ponto específico por produto. */
function normalizeContractProduct(data, slug) {
  const rawContracts = Array.isArray(data?.contracts) ? data.contracts : [];
  if (!rawContracts.length) return null;

  const total = rawContracts.length;
  const chronological = rawContracts
    .slice()
    .sort((a, b) => new Date(a.disbursedAt || 0) - new Date(b.disbursedAt || 0));
  const bySequencia = chronological.map((raw, idx) => normalizeContrato(raw, idx + 1, total));
  // exibição: mais recente primeiro
  const contratos = bySequencia.slice().sort((a, b) => new Date(b.dataPedido || 0) - new Date(a.dataPedido || 0));

  return {
    id: slug,
    nome: CONSULTA_PRODUCT_LABELS[slug] || slug,
    rotuloValor: ROTULO_VALOR_BY_SLUG[slug] || 'Valor contratado',
    elegibilidade: buildEligibilidade(data?.eligibility, slug),
    contratos,
    subtitle: buildSubtitle(contratos),
    historico: buildHistorico(contratos),
  };
}

function buildContractNavMeta(produto) {
  const total = produto.contratos.length;
  const countLabel = `${total} contrato${total > 1 ? 's' : ''}`;
  const proximo = produto.contratos
    .map((c) => c.proximaParcela)
    .filter(Boolean)
    .sort((a, b) => new Date(a.vencimento || 0) - new Date(b.vencimento || 0))[0];
  if (proximo) return `${countLabel} · próx. parcela ${formatConsultaDate(proximo.vencimento)}`;
  if (produto.contratos.every((c) => c.statusKind === 'quitado')) return `${countLabel} · quitado`;
  return countLabel;
}

// ---------------------------------------------------------------------------
// ContractTabs
// ---------------------------------------------------------------------------

const STATUS_KIND_DOT = { vigencia: '#F59E0B', quitado: '#16A34A', atrasado: '#dc3545' };

function ContractTabs({ contratos, selectedId, onSelect }) {
  if (contratos.length < 2) return null;
  return (
    <div className="crm-consultas-detail__contract-tabs" role="tablist" aria-label="Contratos do produto">
      {contratos.map((c) => (
        <button
          key={c.id}
          type="button"
          role="tab"
          aria-selected={c.id === selectedId}
          className={'crm-consultas-detail__contract-tab' + (c.id === selectedId ? ' is-active' : '')}
          onClick={() => onSelect(c.id)}
        >
          <span
            className="crm-consultas-detail__contract-tab-dot"
            style={{ background: STATUS_KIND_DOT[c.statusKind] }}
            aria-hidden="true"
          />
          Contrato {c.sequencia} de {c.totalContratos} · {c.status}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContractProductDetail — detalhe genérico (Empréstimo Pessoal / Antecipação de Salário)
// ---------------------------------------------------------------------------

function ContractProductDetail({ produto, selectedContractId, onSelectContract, isTicketProduct }) {
  useEffect(() => {
    const exists = produto.contratos.some((c) => c.id === selectedContractId);
    if (!exists) onSelectContract(pickDefaultContratoId(produto.contratos));
  }, [produto, selectedContractId, onSelectContract]);

  const contrato = produto.contratos.find((c) => c.id === selectedContractId) || produto.contratos[0];
  if (!contrato) return null;

  const badgeTone = contrato.statusKind === 'quitado' ? 'green' : contrato.statusKind === 'atrasado' ? 'red' : 'amber';

  const metrics = [
    {
      key: 'valor',
      label: produto.rotuloValor,
      value: formatConsultaMoney(contrato.valorContratado),
      sub: contrato.dataPedido ? `Pedido em ${formatConsultaDate(contrato.dataPedido)}` : '',
    },
    {
      key: 'total',
      label: 'Valor total devido',
      value: formatConsultaMoney(contrato.valorTotalDevido),
      sub: contrato.totalParcelas ? `${contrato.totalParcelas}x de ${formatConsultaMoney(contrato.valorParcela)}` : '',
    },
    {
      key: 'pagas',
      label: 'Parcelas pagas',
      value: contrato.totalParcelas ? `${contrato.parcelas.filter((p) => p.pago).length} de ${contrato.totalParcelas}` : '—',
      sub: `${formatConsultaMoney(contrato.totalPago)} pago`,
    },
    contrato.statusKind === 'quitado'
      ? {
        key: 'quitado',
        label: 'Quitado em',
        value: contrato.quitadoEm?.data ? formatConsultaDate(contrato.quitadoEm.data) : '—',
        sub: contrato.quitadoEm?.data
          ? `às ${formatConsultaTime(contrato.quitadoEm.data)}${contrato.quitadoEm.formaPagamento ? ` · via ${formatPaymentMethod(contrato.quitadoEm.formaPagamento)}` : ''}`
          : '',
        highlightTone: 'green',
      }
      : {
        key: 'proxima',
        label: 'Próxima parcela',
        value: contrato.proximaParcela ? formatConsultaDate(contrato.proximaParcela.vencimento) : '—',
        sub: contrato.proximaParcela
          ? `${formatConsultaMoney(contrato.proximaParcela.valor)}${contrato.proximaParcela.dias != null ? (
            contrato.proximaParcela.dias >= 0
              ? ` · em ${contrato.proximaParcela.dias} dias`
              : ` · atrasada há ${Math.abs(contrato.proximaParcela.dias)} dia(s)`
          ) : ''}`
          : '',
        highlightTone: 'amber',
      },
  ];

  const progressPct = contrato.valorTotalDevido > 0
    ? Math.round((contrato.totalPago / contrato.valorTotalDevido) * 100)
    : 0;

  const contractInfo = [
    { key: 'pedido', label: 'Data do pedido', value: contrato.dataPedido ? formatConsultaDate(contrato.dataPedido) : '—' },
    { key: 'ccb', label: 'CCB', value: contrato.ccb.numero ? `${contrato.ccb.status} · nº ${contrato.ccb.numero}` : '—' },
    { key: 'status', label: 'Status do contrato', value: contrato.status || '—' },
    {
      key: 'parcelas',
      label: 'Total de parcelas',
      value: contrato.totalParcelas ? `${contrato.totalParcelas}x de ${formatConsultaMoney(contrato.valorParcela)}` : '—',
    },
    { key: 'seguro', label: 'Seguro', value: contrato.seguro ? 'Contratado' : 'Sem seguro' },
    { key: 'encargos', label: 'Encargos', value: formatConsultaMoney(contrato.encargos) },
  ];

  return (
    <div className="crm-consultas-detail">
      <div className="crm-consultas-detail__header">
        <div>
          <p className="crm-consultas-detail__eyebrow">Produto ativo</p>
          <h3 className="crm-consultas-detail__title">
            {produto.nome}
            {isTicketProduct ? <span className="crm-consultas-product__badge">Produto do ticket</span> : null}
          </h3>
          <p className="crm-consultas-detail__subtitle">{produto.subtitle}</p>
        </div>
        <StatusChip label={contrato.status} tone={badgeTone} />
      </div>

      <ContractTabs contratos={produto.contratos} selectedId={contrato.id} onSelect={onSelectContract} />

      <div className="crm-consultas-detail__metrics">
        {metrics.map((metric) => (
          <div
            className={'crm-consultas-detail__metric' + (metric.highlightTone ? ` crm-consultas-detail__metric--${metric.highlightTone}` : '')}
            key={metric.key}
          >
            <strong>{metric.label}</strong>
            <span className="crm-consultas-detail__metric-value">{metric.value}</span>
            {metric.sub ? <span className="crm-consultas-detail__metric-sub">{metric.sub}</span> : null}
          </div>
        ))}
      </div>

      <div className="crm-consultas-detail__progress">
        <div className="crm-consultas-detail__progress-head">
          <span>Progresso de pagamento</span>
          <strong>{formatConsultaMoney(contrato.totalPago)} de {formatConsultaMoney(contrato.valorTotalDevido)} ({progressPct}%)</strong>
        </div>
        <div className="crm-consultas-detail__progress-track">
          <div
            className="crm-consultas-detail__progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
          />
        </div>
      </div>

      <div className="crm-consultas-detail__info-grid">
        <div className="crm-consultas-detail__info-card">
          <h4 className="crm-consultas-detail__info-card-title">
            Dados do contrato · Contrato {contrato.sequencia} de {contrato.totalContratos}
          </h4>
          <div className="crm-consultas-detail__info-rows">
            {contractInfo.map((row) => (
              <div className="crm-consultas-detail__info-row" key={row.key}>
                <strong>{row.label}</strong>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="crm-consultas-detail__info-col-right">
          <div className="crm-consultas-detail__info-card">
            <h4 className="crm-consultas-detail__info-card-title">Histórico no produto</h4>
            <div className="crm-consultas-detail__info-rows crm-consultas-detail__info-rows--2col">
              <div className="crm-consultas-detail__info-row">
                <strong>Contratos</strong>
                <span>{produto.historico.totalContratos}</span>
              </div>
              <div className="crm-consultas-detail__info-row">
                <strong>Quitados</strong>
                <span>{produto.historico.quitados}</span>
              </div>
              <div className="crm-consultas-detail__info-row">
                <strong>Total já pago</strong>
                <span>{produto.historico.totalPagoLabel}</span>
              </div>
              <div className="crm-consultas-detail__info-row">
                <strong>Primeiro pedido</strong>
                <span>{produto.historico.primeiroPedidoLabel}</span>
              </div>
            </div>
          </div>

          {produto.elegibilidade ? (
            <div
              className={'crm-consultas-detail__eligibility'
                + (produto.elegibilidade.disponivel ? ' crm-consultas-detail__eligibility--available' : ' crm-consultas-detail__eligibility--unavailable')}
            >
              <div className="crm-consultas-detail__eligibility-head">
                <h4 className="crm-consultas-detail__info-card-title">Elegibilidade</h4>
                <span className={`crm-consultas-product__status-pill crm-consultas-product__status-pill--${produto.elegibilidade.disponivel ? 'green' : 'red'}`}>
                  {produto.elegibilidade.badgeLabel}
                </span>
              </div>
              <p className="crm-consultas-detail__eligibility-message">{produto.elegibilidade.mensagem}</p>
              <p className="crm-consultas-detail__eligibility-detail">{produto.elegibilidade.detalhe}</p>
              {produto.elegibilidade.expiraEmLabel ? (
                <p className="crm-consultas-detail__eligibility-expires">{produto.elegibilidade.expiraEmLabel}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div>
        <h4 className="crm-consultas__section-title">
          Parcelas · Contrato {contrato.sequencia} de {contrato.totalContratos}
        </h4>
        <div className="crm-consultas-detail__table-wrap">
          <table className="crm-consultas-detail__table">
            <thead>
              <tr>
                <th>Parcela</th>
                <th>Vencimento</th>
                <th>Valor devido</th>
                <th>Situação</th>
                <th>Valor pago</th>
                <th>Pago em</th>
                <th>Forma de pagamento</th>
              </tr>
            </thead>
            <tbody>
              {contrato.parcelas.map((parcela) => {
                const isProxima = contrato.proximaParcela && parcela.numero === contrato.proximaParcela.numero;
                return (
                  <tr key={parcela.numero} className={isProxima ? 'crm-consultas-detail__table-row--next' : ''}>
                    <td>{parcela.numero}/{contrato.totalParcelas}</td>
                    <td>{parcela.vencimento ? formatConsultaDate(parcela.vencimento) : '—'}</td>
                    <td>{formatConsultaMoney(parcela.valorDevido)}</td>
                    <td>
                      {parcela.situacaoTone ? (
                        <span className={`crm-consultas-product__status-pill crm-consultas-product__status-pill--${parcela.situacaoTone}`}>
                          {parcela.situacao}
                        </span>
                      ) : parcela.situacao}
                    </td>
                    <td>{parcela.pago ? formatConsultaMoney(parcela.valorPago) : '—'}</td>
                    <td>{parcela.pago && parcela.pagoEm ? formatConsultaDateTime(parcela.pagoEm) : '—'}</td>
                    <td>{parcela.pago && parcela.formaPagamento ? formatPaymentMethod(parcela.formaPagamento) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Views legadas (IRPF / Clube Velotax) — sem estrutura real de contratos/parcelas
// ---------------------------------------------------------------------------

function buildIrpfView(data) {
  const years = Array.isArray(data?.years) ? data.years : [];
  if (!years.length) return null;

  const sorted = years.slice().sort((a, b) => Number(b.year) - Number(a.year));
  const primary = sorted[0];
  const situation = data?.situation;
  const statusLabel = primary.statusLabel || primary.status || '—';
  const statusTone = CONSULTA_STATUS_TONE[classifyConsultaStatusLabel(statusLabel)] || 'gray';

  const metrics = [
    { key: 'year', label: 'Ano referência', value: String(primary.year || '—') },
    {
      key: 'amount',
      label: 'Valor antecipado',
      value: primary.anticipatedAmount ? formatConsultaMoney(primary.anticipatedAmount) : '—',
    },
    {
      key: 'pix',
      label: 'PIX Velobank',
      value: situation ? (situation.pixLinkedVelobank ? 'Vinculado' : 'Não vinculado') : '—',
    },
    {
      key: 'withdrawal',
      label: 'Retirada',
      value: situation ? (situation.pixWithdrawalAllowed ? 'Liberada' : 'Bloqueada') : '—',
    },
  ];

  const timeline = sorted.map((yearItem) => {
    const yearStatus = yearItem.statusLabel || yearItem.status || '—';
    return {
      id: `year-${yearItem.year}`,
      dateLabel: String(yearItem.year),
      sortValue: Number(yearItem.year) || 0,
      label: `IRPF ${yearItem.year} · ${yearStatus}${yearItem.anticipatedAmount ? ` · ${formatConsultaMoney(yearItem.anticipatedAmount)}` : ''}`,
      tone: classifyConsultaStatusLabel(yearStatus) === 'done' ? 'paid' : 'upcoming',
    };
  });

  return { statusLabel, statusTone, metrics, timeline, note: '' };
}

function buildClubeView(data) {
  const totalCoupons = Number(data?.totalCoupons) || 0;
  if (!totalCoupons) return null;

  const coupons = (Array.isArray(data?.recentCoupons) ? data.recentCoupons : [])
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const latest = coupons[0];

  const metrics = [
    { key: 'total', label: 'Total de cupons', value: String(totalCoupons) },
    { key: 'recent', label: 'Cupons recentes', value: String(coupons.length) },
    { key: 'lastDate', label: 'Último cupom', value: latest ? formatConsultaDateTime(latest.createdAt) : '—' },
    { key: 'lastVibes', label: 'Vibes no último', value: latest ? formatConsultaMoney(latest.vibes) : '—' },
  ];

  const timeline = coupons.map((coupon, index) => ({
    id: `coupon-${index}`,
    dateLabel: formatConsultaDateTime(coupon.createdAt),
    sortValue: new Date(coupon.createdAt || 0).getTime(),
    label: `${formatConsultaMoney(coupon.vibes)} vibes`,
    tone: 'paid',
  }));

  return { statusLabel: 'Disponível', statusTone: 'green', metrics, timeline, note: '' };
}

function buildLegacyProductView(slug, entry) {
  if (!entry?.loaded || !entry?.data) return null;
  if (slug === 'antecipacao-irpf') return buildIrpfView(entry.data);
  if (slug === 'clube-velotax') return buildClubeView(entry.data);
  return null;
}

function LegacyProductDetail({ slug, entry, isTicketProduct }) {
  const view = useMemo(() => buildLegacyProductView(slug, entry), [slug, entry]);

  if (!view) {
    return (
      <div className="crm-consultas__empty crm-consultas__empty--inline">
        <i className="ti ti-info-circle" aria-hidden="true" />
        <p>Sem detalhes suficientes para exibir este produto.</p>
      </div>
    );
  }

  return (
    <div className="crm-consultas-detail">
      <div className="crm-consultas-detail__header">
        <div>
          <p className="crm-consultas-detail__eyebrow">Produto ativo</p>
          <h3 className="crm-consultas-detail__title">
            {CONSULTA_PRODUCT_LABELS[slug] || slug}
            {isTicketProduct ? <span className="crm-consultas-product__badge">Produto do ticket</span> : null}
          </h3>
          {view.note ? <p className="crm-consultas-detail__note">{view.note}</p> : null}
        </div>
        <StatusChip label={view.statusLabel} tone={view.statusTone} />
      </div>

      <div className="crm-consultas-detail__metrics">
        {view.metrics.map((metric) => (
          <div className="crm-consultas-detail__metric" key={metric.key}>
            <strong>{metric.label}</strong>
            <span className="crm-consultas-detail__metric-value">{metric.value}</span>
          </div>
        ))}
      </div>

      {view.timeline.length ? (
        <>
          <h4 className="crm-consultas__section-title">Linha do tempo</h4>
          <ul className="crm-consultas-detail__timeline">
            {view.timeline.map((item) => (
              <li
                key={item.id}
                className={`crm-consultas-detail__timeline-item crm-consultas-detail__timeline-item--${item.tone}`}
              >
                <span className="crm-consultas-detail__timeline-dot" aria-hidden="true" />
                <span className="crm-consultas-detail__timeline-date">{item.dateLabel}</span>
                <p className="crm-consultas-detail__timeline-label">{item.label}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace — sidebar (produtos ativos / sem relação) + detalhe
// ---------------------------------------------------------------------------

function isContractSlug(slug) {
  return CONTRACT_PRODUCT_SLUGS.includes(slug);
}

export default function ConsultaProductWorkspace({ data }) {
  const [manualSlug, setManualSlug] = useState(null);
  const [manualInactiveKey, setManualInactiveKey] = useState(null);
  const [semRelacaoOpen, setSemRelacaoOpen] = useState(false);
  const [selectedContractByProduct, setSelectedContractByProduct] = useState({});

  const activeEntries = useMemo(() => (
    CONSULTA_PRODUCT_SLUGS
      .map((slug) => {
        const entry = data?.products?.[slug];
        if (isContractSlug(slug)) {
          const produto = entry?.loaded ? normalizeContractProduct(entry.data, slug) : null;
          if (!produto) return null;
          const abertos = produto.contratos.some((c) => c.statusKind !== 'quitado');
          return {
            slug,
            entry,
            produto,
            iconState: abertos ? 'pending' : 'done',
            navMeta: buildContractNavMeta(produto),
          };
        }
        const summary = summarizeConsultaProduct(slug, entry);
        if (summary.iconState === 'none') return null;
        return {
          slug,
          entry,
          summary,
          iconState: summary.iconState,
          navMeta: [summary.titleExtra, summary.subtitle].filter(Boolean).join(' · '),
        };
      })
      .filter(Boolean)
  ), [data]);

  const inactiveFlags = useMemo(
    () => getOverviewProductFlags(data?.overview?.data?.products).filter((flag) => !flag.active),
    [data],
  );

  const selectedInactive = manualInactiveKey
    ? inactiveFlags.find((flag) => flag.key === manualInactiveKey) || null
    : null;

  const defaultSlug = activeEntries.find((item) => item.slug === data?.ticketProductSlug)?.slug
    || activeEntries[0]?.slug
    || null;
  const selectedSlug = !selectedInactive && activeEntries.some((item) => item.slug === manualSlug)
    ? manualSlug
    : (!selectedInactive ? defaultSlug : null);
  const selected = activeEntries.find((item) => item.slug === selectedSlug) || null;

  const handleSelectActive = (slug) => {
    setManualInactiveKey(null);
    setManualSlug(slug);
  };

  const handleSelectInactive = (key) => {
    setManualInactiveKey(key);
  };

  const handleSelectContract = (slug) => (contractId) => {
    setSelectedContractByProduct((prev) => ({ ...prev, [slug]: contractId }));
  };

  return (
    <div className="crm-consultas-workspace">
      <aside className="crm-consultas-workspace__sidebar">
        <div>
          <h3 className="crm-consultas__section-title">Produtos ativos ({activeEntries.length})</h3>
          {activeEntries.length ? (
            <ul className="crm-consultas-nav">
              {activeEntries.map(({ slug, iconState, navMeta }) => {
                const isTicketProduct = data?.ticketProductSlug === slug;
                return (
                  <li key={slug}>
                    <button
                      type="button"
                      className={'crm-consultas-nav-item' + (slug === selectedSlug ? ' is-active' : '')}
                      onClick={() => handleSelectActive(slug)}
                      aria-pressed={slug === selectedSlug}
                    >
                      <span className="crm-consultas-nav-item__row">
                        <span className="crm-consultas-nav-item__title">
                          <span className={`crm-consultas-product__icon crm-consultas-product__icon--${iconState}`} aria-hidden="true">
                            <i className={'ti ' + (ICON_BY_STATE[iconState] || ICON_BY_STATE.none)} />
                          </span>
                          {CONSULTA_PRODUCT_LABELS[slug] || slug}
                          {isTicketProduct ? <span className="crm-consultas-product__badge">Ticket</span> : null}
                        </span>
                      </span>
                      <span className="crm-consultas-nav-item__meta">{navMeta || '—'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="crm-consultas__empty crm-consultas__empty--inline">
              <i className="ti ti-package-off" aria-hidden="true" />
              <p>Nenhum produto ativo encontrado.</p>
            </div>
          )}
        </div>

        <div className="crm-consultas-workspace__semrelacao">
          <button
            type="button"
            className="crm-consultas-workspace__semrelacao-toggle"
            onClick={() => setSemRelacaoOpen((prev) => !prev)}
            aria-expanded={semRelacaoOpen}
          >
            <span>Sem relação ({inactiveFlags.length})</span>
            <span>{semRelacaoOpen ? 'Recolher' : 'Expandir'}</span>
          </button>
          {semRelacaoOpen ? (
            <div className="crm-consultas__flags">
              {inactiveFlags.map((flag) => (
                <button
                  type="button"
                  key={flag.key}
                  className={'crm-consultas__flag' + (flag.key === manualInactiveKey ? ' is-active' : '')}
                  onClick={() => handleSelectInactive(flag.key)}
                  aria-pressed={flag.key === manualInactiveKey}
                >
                  {flag.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="crm-consultas-workspace__main" aria-label="Detalhe do produto selecionado">
        {selectedInactive ? (
          <div className="crm-consultas__empty crm-consultas__empty--inline">
            <i className="ti ti-package-off" aria-hidden="true" />
            <p>Cliente não possui <strong>{selectedInactive.label}</strong>.</p>
          </div>
        ) : selected && isContractSlug(selected.slug) ? (
          <ContractProductDetail
            produto={selected.produto}
            selectedContractId={selectedContractByProduct[selected.slug] ?? null}
            onSelectContract={handleSelectContract(selected.slug)}
            isTicketProduct={data?.ticketProductSlug === selected.slug}
          />
        ) : selected ? (
          <LegacyProductDetail
            slug={selected.slug}
            entry={selected.entry}
            isTicketProduct={data?.ticketProductSlug === selected.slug}
          />
        ) : (
          <div className="crm-consultas__empty crm-consultas__empty--inline">
            <i className="ti ti-click" aria-hidden="true" />
            <p>Selecione um produto ativo para ver os detalhes.</p>
          </div>
        )}
      </section>
    </div>
  );
}
