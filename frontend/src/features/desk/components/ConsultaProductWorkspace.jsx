/**
 * ConsultaProductWorkspace v1.0.0 — sidebar de produtos ativos + detalhe (métricas, linha do tempo, resumo)
 * VERSION: v1.0.0 | DATE: 2026-09-22
 */
import React, { useMemo, useState } from 'react';
import {
  CONSULTA_PRODUCT_LABELS,
  CONSULTA_PRODUCT_SLUGS,
  CONSULTA_STATUS_TONE,
  classifyConsultaStatusLabel,
  formatConsultaDate,
  formatConsultaDateTime,
  formatConsultaMoney,
  getOverviewProductFlags,
  pickPrimaryContract,
  summarizeConsultaProduct,
} from '../../../services/desk/consultaFormatters';
import { ICON_BY_STATE, StatusChip } from './ConsultaStatusChip';

function buildEpAsView(data) {
  const contracts = Array.isArray(data?.contracts) ? data.contracts : [];
  if (!contracts.length) return null;

  const contract = pickPrimaryContract(contracts);
  const installments = Array.isArray(contract.installments) ? contract.installments : [];
  const paidCount = installments.filter((item) => String(item.status).toLowerCase() === 'paid').length;
  const statusLabel = contract.contractStatusLabel || contract.contractStatus || '—';
  const statusTone = CONSULTA_STATUS_TONE[classifyConsultaStatusLabel(statusLabel)] || 'gray';

  const metrics = [
    { key: 'principal', label: 'Valor antecipado', value: formatConsultaMoney(contract.principal) },
    {
      key: 'next',
      label: 'Próxima parcela',
      value: contract.nextInstallment
        ? formatConsultaDate(contract.nextInstallment.dueDate)
        : (installments.length ? 'Quitado' : '—'),
    },
    {
      key: 'installments',
      label: 'Parcelas pagas',
      value: installments.length ? `${paidCount} de ${installments.length}` : '—',
    },
    { key: 'disbursed', label: 'Contratação', value: formatConsultaDate(contract.disbursedAt) },
  ];

  const timeline = [];
  if (contract.nextInstallment) {
    timeline.push({
      id: 'next',
      dateLabel: formatConsultaDate(contract.nextInstallment.dueDate),
      sortValue: new Date(contract.nextInstallment.dueDate || 0).getTime(),
      label: `Próxima parcela prevista · ${formatConsultaMoney(contract.nextInstallment.amountDue)}`,
      tone: 'upcoming',
    });
  }
  installments
    .filter((item) => String(item.status).toLowerCase() === 'paid')
    .forEach((item) => {
      timeline.push({
        id: `paid-${item.number}`,
        dateLabel: formatConsultaDate(item.dueDate),
        sortValue: new Date(item.dueDate || 0).getTime(),
        label: `Parcela ${item.number} paga · ${formatConsultaMoney(item.amountDue)}`,
        tone: 'paid',
      });
    });
  if (contract.disbursedAt) {
    timeline.push({
      id: 'contract',
      dateLabel: formatConsultaDate(contract.disbursedAt),
      sortValue: new Date(contract.disbursedAt).getTime(),
      label: `Antecipação contratada · ${formatConsultaMoney(contract.principal)}`,
      tone: 'contract',
    });
  }
  timeline.sort((a, b) => b.sortValue - a.sortValue);

  return {
    statusLabel,
    statusTone,
    metrics,
    timeline,
    note: contracts.length > 1 ? `+${contracts.length - 1} outro(s) contrato(s) não exibido(s)` : '',
  };
}

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

function buildProductView(slug, entry) {
  if (!entry?.loaded || !entry?.data) return null;
  if (slug === 'emprestimo-pessoal' || slug === 'antecipacao-salario') return buildEpAsView(entry.data);
  if (slug === 'antecipacao-irpf') return buildIrpfView(entry.data);
  if (slug === 'clube-velotax') return buildClubeView(entry.data);
  return null;
}

function ProductDetail({ slug, entry, isTicketProduct }) {
  const view = useMemo(() => buildProductView(slug, entry), [slug, entry]);

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
            <span>{metric.value}</span>
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

export default function ConsultaProductWorkspace({ data }) {
  const [manualSlug, setManualSlug] = useState(null);
  const [semRelacaoOpen, setSemRelacaoOpen] = useState(false);

  const activeEntries = useMemo(() => (
    CONSULTA_PRODUCT_SLUGS
      .map((slug) => {
        const entry = data?.products?.[slug];
        return { slug, entry, summary: summarizeConsultaProduct(slug, entry) };
      })
      .filter(({ summary }) => summary.iconState !== 'none')
  ), [data]);

  const inactiveFlags = useMemo(
    () => getOverviewProductFlags(data?.overview?.data?.products).filter((flag) => !flag.active),
    [data],
  );

  const defaultSlug = activeEntries.find((item) => item.slug === data?.ticketProductSlug)?.slug
    || activeEntries[0]?.slug
    || null;
  const selectedSlug = activeEntries.some((item) => item.slug === manualSlug) ? manualSlug : defaultSlug;
  const selected = activeEntries.find((item) => item.slug === selectedSlug) || null;

  return (
    <div className="crm-consultas-workspace">
      <aside className="crm-consultas-workspace__sidebar">
        <div>
          <h3 className="crm-consultas__section-title">Produtos ativos ({activeEntries.length})</h3>
          {activeEntries.length ? (
            <ul className="crm-consultas-nav">
              {activeEntries.map(({ slug, entry, summary }) => {
                const isTicketProduct = data?.ticketProductSlug === slug;
                const meta = [summary.titleExtra, summary.subtitle].filter(Boolean).join(' · ');
                return (
                  <li key={slug}>
                    <button
                      type="button"
                      className={'crm-consultas-nav-item' + (slug === selectedSlug ? ' is-active' : '')}
                      onClick={() => setManualSlug(slug)}
                      aria-pressed={slug === selectedSlug}
                    >
                      <span className="crm-consultas-nav-item__row">
                        <span className="crm-consultas-nav-item__title">
                          <span className={`crm-consultas-product__icon crm-consultas-product__icon--${summary.iconState}`} aria-hidden="true">
                            <i className={'ti ' + (ICON_BY_STATE[summary.iconState] || ICON_BY_STATE.none)} />
                          </span>
                          {CONSULTA_PRODUCT_LABELS[slug] || slug}
                          {isTicketProduct ? <span className="crm-consultas-product__badge">Ticket</span> : null}
                        </span>
                      </span>
                      <span className="crm-consultas-nav-item__meta">{meta || '—'}</span>
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
                <span className="crm-consultas__flag" key={flag.key}>{flag.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="crm-consultas-workspace__main" aria-label="Detalhe do produto selecionado">
        {selected ? (
          <ProductDetail
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
