/**
 * ConsultaOverviewSummary v1.0.1 — CPF completo formatado
 * VERSION: v1.0.1 | DATE: 2026-07-31
 */
import React from 'react';
import {
  formatAccountStatus,
  formatConsultaCpf,
  formatConsultaDateTime,
  getOverviewProductFlags,
} from '../../../services/desk/consultaFormatters';

export default function ConsultaOverviewSummary({ overview, cpfFormatted, contactName, onSelectFlag }) {
  const data = overview?.data;
  const isNotFound = overview?.status === 'customer_not_found' || !data;
  const cpfLabel = cpfFormatted || formatConsultaCpf(data?.cpf) || '—';

  if (isNotFound) {
    return (
      <section className="crm-consultas__summary" aria-label="Resumo do cliente">
        <div className="crm-consultas__empty crm-consultas__empty--inline">
          <i className="ti ti-user-search" aria-hidden="true" />
          <p>Nenhum cadastro Velotax encontrado para {contactName || 'este cliente'}.</p>
          {cpfFormatted ? (
            <p className="crm-consultas__empty-hint">CPF consultado: {cpfLabel}</p>
          ) : null}
        </div>
      </section>
    );
  }

  const flags = getOverviewProductFlags(data.products);

  return (
    <section className="crm-consultas__summary" aria-label="Resumo do cliente">
      <div className="crm-consultas__summary-grid">
        <div className="crm-consultas__summary-card">
          <strong>Nome</strong>
          <span>{data.name || contactName || '—'}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>CPF</strong>
          <span>{cpfLabel}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>Conta</strong>
          <span>{formatAccountStatus(data.accountStatus)}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>Cadastro</strong>
          <span>{formatConsultaDateTime(data.createdAt)}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>E-mail</strong>
          <span>{data.email || '—'}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>Telefone</strong>
          <span>{data.phone || '—'}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>Origem</strong>
          <span>{data.origin || '—'}</span>
        </div>
        <div className="crm-consultas__summary-card">
          <strong>Nascimento</strong>
          <span>{data.birthDate || '—'}</span>
        </div>
      </div>

      <div className="crm-consultas__flags" aria-label="Produtos vinculados">
        {flags.map((flag) => (
          <button
            type="button"
            key={flag.key}
            className={'crm-consultas__flag' + (flag.active ? ' is-active' : '')}
            onClick={() => onSelectFlag?.(flag)}
          >
            {flag.label}
          </button>
        ))}
      </div>
    </section>
  );
}
