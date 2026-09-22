/**
 * DeskConsultasPanel v2.1.1 — rascunho usa CPF do painel sem exigir Mongo
 * VERSION: v2.1.1 | DATE: 2026-08-03 | AUTHOR: VeloHub Development Team
 */
import React from 'react';
import useCustomerConsulta from '../../../hooks/useCustomerConsulta';
import { getClientContactFields } from '../../../services/desk/utils';
import ConsultaOverviewSummary from './ConsultaOverviewSummary';
import ConsultaProductWorkspace from './ConsultaProductWorkspace';

export default function DeskConsultasPanel({ ticket, client, active = false }) {
  const contact = getClientContactFields(ticket, client);
  const {
    state,
    data,
    error,
    refreshing,
    reload,
  } = useCustomerConsulta({ ticket, client, active });

  const ticketKey = String(ticket?.id || ticket?._id || ticket?.protocolo || '');

  const requestId = data?.overview?.requestId
    || (data?.products && Object.values(data.products).find((item) => item?.requestId)?.requestId)
    || '';

  return (
    <div className="crm-consultas" id="deskConsultasPanel" aria-label="Consultas do cliente">
      <header className="crm-consultas__header">
        <div>
          <div className="crm-consultas__title-row">
            <h2 className="crm-consultas__title">Consultas</h2>
            <button
              type="button"
              className={'crm-icon-btn crm-consultas__refresh' + (refreshing ? ' is-refreshing' : '')}
              onClick={() => reload()}
              title="Atualizar consultas"
              aria-label="Atualizar consultas"
              disabled={refreshing || state === 'loading'}
            >
              <i className="ti ti-refresh" aria-hidden="true" />
            </button>
          </div>
          <p className="crm-consultas__subtitle">
            Relação comercial Velotax de {contact.name || 'cliente'}
            {data?.cpfFormatted ? ` · CPF ${data.cpfFormatted}` : (contact.cpf ? ` · CPF ${contact.cpf}` : '')}
          </p>
        </div>
      </header>

      {!active ? (
        <div className="crm-consultas__empty">
          <i className="ti ti-click" aria-hidden="true" />
          <p>Abra esta aba para consultar os dados do cliente.</p>
        </div>
      ) : null}

      {active && state === 'loading' ? (
        <div className="crm-consultas__empty">
          <i className="ti ti-loader-2 crm-consultas__spin" aria-hidden="true" />
          <p>Consultando dados do cliente…</p>
        </div>
      ) : null}

      {active && state === 'missing_cpf' ? (
        <div className="crm-consultas__empty crm-consultas__empty--blocked">
          <i className="ti ti-id" aria-hidden="true" />
          <p>{error?.message || 'Informe o CPF no cadastro do cliente para consultar.'}</p>
          <p className="crm-consultas__empty-hint">
            Preencha o CPF no painel do cliente e salve, depois atualize a consulta.
          </p>
        </div>
      ) : null}

      {active && state === 'ticket_not_found' ? (
        <div className="crm-consultas__empty crm-consultas__empty--blocked">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <p>{error?.message || 'Ticket não encontrado.'}</p>
          <p className="crm-consultas__empty-hint">
            Salve o ticket (rascunho) ou atualize a página e tente novamente.
          </p>
          <button type="button" className="velo-btn velo-btn--secondary velo-btn--sm" onClick={() => reload()}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {active && state === 'error' ? (
        <div className="crm-consultas__empty crm-consultas__empty--blocked">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <p>{error?.message || 'Não foi possível carregar as consultas.'}</p>
          {error?.type !== 'not_configured' ? (
            <button type="button" className="velo-btn velo-btn--secondary velo-btn--sm" onClick={() => reload()}>
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      {active && state === 'loaded' && data ? (
        <>
          <ConsultaOverviewSummary
            overview={data.overview}
            cpfFormatted={data.cpfFormatted || contact.cpf}
            contactName={contact.name}
          />

          <ConsultaProductWorkspace
            key={ticketKey}
            data={data}
          />

          {data.errors?.length ? (
            <p className="crm-consultas__analise" role="status">
              <i className="ti ti-info-circle" aria-hidden="true" />
              Alguns produtos não puderam ser carregados. Atualize a consulta para tentar novamente.
            </p>
          ) : null}

          {requestId ? (
            <p className="crm-consultas__request-id" aria-label="Identificador de correlação">
              Ref. consulta: {requestId}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
