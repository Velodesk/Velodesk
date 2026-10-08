/**
 * Página Busca de Tickets — filtros dinâmicos + resultados
 * VERSION: v1.2.0 | DATE: 2026-10-06
 * — switch "Incluir Legado Octa" liberado também para quem tem acesso à Busca de Tickets (agente)
 */
import React, { useCallback, useState } from 'react';
import * as XLSX from 'xlsx';
import { Navigate, useNavigate } from 'react-router-dom';
import { useProfile } from '../../context/ProfileContext';
import { useNotifications } from '../../context/NotificationContext';
import { getAgentName } from '../../services/clientDb';
import TicketSearchCriteriaEditor from './TicketSearchCriteriaEditor';
import { searchTicketsApi } from './ticketSearchApi';
import {
  buildApiCriterios,
  createEmptyCriterio,
  isCriterioRowValid,
} from './ticketSearchCriteria';
import { formatDateTimeBr } from '../../utils/dateTimeBr';

function formatDate(value) {
  return formatDateTimeBr(value);
}

function resolveOpenPath(profileId, ticketId) {
  if (profileId === 'workflow') {
    return `/workflow?ticket=${encodeURIComponent(ticketId)}`;
  }
  return `/tickets?desk=v2&ticket=${encodeURIComponent(ticketId)}`;
}

export default function TicketSearchView() {
  const { isNavAllowed, profileId } = useProfile();
  const { showNotification } = useNotifications();
  const navigate = useNavigate();

  const [criterios, setCriterios] = useState(() => [createEmptyCriterio()]);
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [total, setTotal] = useState(0);

  const [incluirLegadoOcta, setIncluirLegadoOcta] = useState(false);

  const navAllowed = isNavAllowed('busca-tickets');
  const legadoAllowed = isNavAllowed('legado-octa') || navAllowed;

  const handleSearch = useCallback(async (event) => {
    event?.preventDefault?.();
    const valid = (criterios || []).filter((row) => isCriterioRowValid(row));
    if (!valid.length) {
      showNotification?.('Informe ao menos um filtro com valor.', 'warning');
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const apiCriterios = buildApiCriterios(valid, getAgentName());
      const data = await searchTicketsApi({
        criterios: apiCriterios,
        limit: 100,
        incluirLegadoOcta: legadoAllowed && incluirLegadoOcta,
      });
      const list = Array.isArray(data?.tickets) ? data.tickets : [];
      setTickets(list);
      setTotal(Number(data?.total) || list.length);
      if (data?.legadoOcta?.aviso) {
        showNotification?.(data.legadoOcta.aviso, 'warning');
      }
      if (!list.length) {
        showNotification?.('Nenhum ticket encontrado com esses filtros.', 'info');
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Erro ao buscar tickets';
      setTickets([]);
      setTotal(0);
      showNotification?.(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [criterios, incluirLegadoOcta, legadoAllowed, showNotification]);

  const handleExport = useCallback(() => {
    if (!tickets.length) return;
    const rows = tickets.map((ticket) => ({
      Protocolo: ticket.chamadoProtocolo || '—',
      Título: ticket.title || ticket.chamadoTitulo || '—',
      Cliente: ticket.clientName || ticket.lateralForm?.clienteNome || '—',
      CPF: ticket.clientCPF || ticket.lateralForm?.cpf || '—',
      Status: ticket.status || '—',
      Responsável: ticket.responsibleAgent || ticket.lateralForm?.responsavel || '—',
      Atualizado: formatDate(ticket.updatedAt),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tickets');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `busca-tickets-${stamp}.xlsx`);
  }, [tickets]);

  const handleClear = useCallback(() => {
    setCriterios([createEmptyCriterio()]);
    setTickets([]);
    setTotal(0);
    setSearched(false);
  }, []);

  const handleOpenTicket = useCallback((ticket) => {
    if (ticket?.legadoPath) {
      navigate(`/legado-octa/${ticket.legadoPath}`);
      return;
    }
    const ticketId = String(ticket?._id || ticket?.id || '').trim();
    if (!ticketId) return;
    navigate(resolveOpenPath(profileId, ticketId));
  }, [navigate, profileId]);

  if (!navAllowed) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <div id="busca-tickets" className="page ticket-search-page eco-page active">
      <div className="eco-page-inner ticket-search-layout">
        <form onSubmit={handleSearch}>
          <header className="ticket-search-header">
            <div>
              <h1 className="ticket-search-header__title">Busca de Tickets</h1>
            </div>
            <div className="ticket-search-header__actions">
              <button
                type="button"
                className="btn-secondary ticket-search-header__export-btn"
                onClick={handleExport}
                disabled={loading || !tickets.length}
                title="Exportar os tickets listados para uma planilha Excel"
              >
                <i className="ti ti-download" aria-hidden="true" /> Exportar
              </button>
              <button type="button" className="btn-secondary" onClick={handleClear} disabled={loading}>
                Limpar
              </button>
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Buscando…' : 'Buscar'}
              </button>
            </div>
          </header>

          <section className="ticket-search-panel" aria-label="Filtros de busca">
            <TicketSearchCriteriaEditor
              criterios={criterios}
              onChange={setCriterios}
              showLegadoToggle={legadoAllowed}
              incluirLegadoOcta={incluirLegadoOcta}
              onIncluirLegadoOctaChange={setIncluirLegadoOcta}
            />
          </section>
        </form>

        <section className="ticket-search-results" aria-label="Resultados da busca">
          <div className="ticket-search-results__head">
            <h2 className="ticket-search-results__title">Resultados</h2>
            {searched && !loading ? (
              <span className="ticket-search-results__count">
                {total} ticket{total === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          {loading ? (
            <p className="ticket-search-results__empty">Buscando tickets…</p>
          ) : !searched ? (
            <p className="ticket-search-results__empty">
              Defina os filtros e clique em Buscar.
            </p>
          ) : tickets.length === 0 ? (
            <p className="ticket-search-results__empty">
              Nenhum ticket encontrado.
            </p>
          ) : (
            <div className="ticket-search-table-wrap">
              <table className="ticket-search-table">
                <thead>
                  <tr>
                    <th>Protocolo</th>
                    <th>Título</th>
                    <th>Cliente</th>
                    <th>CPF</th>
                    <th>Status</th>
                    <th>Responsável</th>
                    <th>Atualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((ticket) => {
                    const id = ticket._id || ticket.id;
                    return (
                      <tr
                        key={id}
                        className="ticket-search-table__row"
                        onClick={() => handleOpenTicket(ticket)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleOpenTicket(ticket);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Abrir ticket ${ticket.chamadoProtocolo || id}`}
                      >
                        <td>
                          {ticket.chamadoProtocolo || '—'}
                          {ticket.legadoPath ? <span className="ticket-search-table__legado-tag"> · Legado</span> : null}
                        </td>
                        <td title={ticket.title || ticket.chamadoTitulo || ''}>
                          {ticket.title || ticket.chamadoTitulo || '—'}
                        </td>
                        <td>{ticket.clientName || ticket.lateralForm?.clienteNome || '—'}</td>
                        <td>{ticket.clientCPF || ticket.lateralForm?.cpf || '—'}</td>
                        <td>{ticket.status || '—'}</td>
                        <td>{ticket.responsibleAgent || ticket.lateralForm?.responsavel || '—'}</td>
                        <td>{formatDate(ticket.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
