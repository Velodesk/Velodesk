/**
 * ClientTicketHistoryModal — histórico Mongo por CPF + mesclagem multi-seleção
 * VERSION: v2.2.0 | DATE: 2026-08-18
 * — histórico via by-cpf inclui chamados_n1 + chamados_reclamacoes
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ticketSearchApi } from '../../../api/client';
import {
  getClientAnalise,
  getClientContactFields,
  getClientProducts,
  getTicketProtocolLabel,
  getTicketStatusBadgeMeta,
  getTicketStatusLabel,
  getTicketTitle,
  isClientIdentifiedForHistory,
  isTicketTerminalStatus,
  normalizeCpf,
} from '../../../services/desk/utils';
import { getClient360WorkflowIconMeta } from '../../../services/workflow/workflowTeamQueues';
import FusaoFundidoBadge from './FusaoFundidoBadge';
import { formatDateBr } from '../../../utils/dateTimeBr';

function formatTableDate(iso) {
  return formatDateBr(iso);
}

function ticketIdOf(t) {
  return String(t?.id || t?._id || '');
}

function TicketRows({
  tickets,
  mergeEnabled,
  selectedIds,
  onToggle,
  onRowClick,
  merging,
}) {
  if (!tickets.length) {
    return (
      <tr>
        <td colSpan={mergeEnabled ? 6 : 5} className="client360-empty-cell">
          Nenhum ticket nesta seção.
        </td>
      </tr>
    );
  }

  return tickets.map((t) => {
    const ticketId = ticketIdOf(t);
    const workflowIcon = getClient360WorkflowIconMeta(t);
    const isSelected = selectedIds.has(ticketId);
    return (
      <tr
        key={ticketId}
        className={
          'client360-row--clickable'
          + (isSelected ? ' client360-row--merge-selected' : '')
        }
        onClick={() => onRowClick(ticketId)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onRowClick(ticketId)}
      >
        {mergeEnabled ? (
          <td
            className="client360-table__td-check"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              className="client360-merge-check"
              checked={isSelected}
              disabled={merging}
              onChange={() => onToggle(ticketId)}
              aria-label={`Selecionar #${getTicketProtocolLabel(t) || ticketId} para mesclagem`}
            />
          </td>
        ) : null}
        <td>
          <span className="client360-ticket-cell">
            #{getTicketProtocolLabel(t) || t.id || ticketId}
            {workflowIcon ? (
              <span
                className={`client360-workflow-icon client360-workflow-icon--${workflowIcon.modifier}`}
                title={workflowIcon.title}
                aria-label={workflowIcon.title}
              >
                <i className={`ti ${workflowIcon.icon}`} aria-hidden="true" />
              </span>
            ) : null}
            <FusaoFundidoBadge fusao={t.fusao} />
          </span>
        </td>
        <td>{getTicketTitle(t)}</td>
        <td>{t.lateralForm?.canal || t.channel || t.source || '—'}</td>
        <td>{getTicketStatusLabel(t.status)}</td>
        <td>{formatTableDate(t.updatedAt || t.createdAt)}</td>
      </tr>
    );
  });
}

export default function ClientTicketHistoryModal({
  open,
  onClose,
  ticket,
  client,
  onSelectTicket,
  sourceTicketId,
  onFundirTickets,
  merging = false,
  enableSimilarSubject = false,
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activePickId, setActivePickId] = useState('');
  // null = checagem não rodou/indisponível (não afirma nada); [] = rodou e não achou nada.
  const [similarMatches, setSimilarMatches] = useState(null);
  const [similarLoading, setSimilarLoading] = useState(false);

  const contact = useMemo(
    () => (ticket ? getClientContactFields(ticket, client) : { cpf: '', name: '' }),
    [ticket, client],
  );

  const cpfDigits = normalizeCpf(
    ticket?.lateralForm?.clienteCpf
    || ticket?.lateralForm?.cpf
    || ticket?.clientCPF
    || client?.cpf
    || contact.cpf
    || '',
  );
  const clientIdentified = isClientIdentifiedForHistory(cpfDigits);
  const mergeEnabled = clientIdentified && Boolean(onFundirTickets);

  const refreshList = useCallback(async () => {
    if (!clientIdentified || !cpfDigits) {
      setTickets([]);
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const data = await ticketSearchApi.byCpf(cpfDigits);
      setTickets(Array.isArray(data?.tickets) ? data.tickets : []);
    } catch (err) {
      setTickets([]);
      setLoadError(err?.response?.data?.message || err?.message || 'Erro ao carregar histórico');
    } finally {
      setLoading(false);
    }
  }, [clientIdentified, cpfDigits]);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setConfirmOpen(false);
      setActivePickId('');
      setTickets([]);
      setLoadError('');
      setSimilarMatches(null);
      setSimilarLoading(false);
      return undefined;
    }
    void refreshList();
    return undefined;
  }, [open, refreshList]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (confirmOpen) setConfirmOpen(false);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, confirmOpen]);

  // IA compara o assunto do ticket atual com o histórico do cliente — só roda no contexto de
  // casos especiais (RA/Bacen/Procon/Consumidor.Gov). Reseta a cada nova lista de tickets (ex.:
  // depois de uma fusão) pra nunca mostrar um resultado velho enquanto o novo ainda carrega.
  useEffect(() => {
    setSimilarMatches(null);
    setSimilarLoading(false);

    if (!enableSimilarSubject || !clientIdentified || !tickets.length) return undefined;

    const currentSubject = getTicketTitle(ticket);
    if (!currentSubject || currentSubject === 'Sem assunto') return undefined;

    const currentId = ticketIdOf(ticket) || String(sourceTicketId || '');
    const candidates = tickets
      .filter((t) => ticketIdOf(t) !== currentId)
      .filter((t) => getTicketTitle(t) !== 'Sem assunto')
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, 20)
      .map((t) => ({ id: ticketIdOf(t), title: getTicketTitle(t) }));

    if (!candidates.length) return undefined;

    let cancelled = false;
    setSimilarLoading(true);
    ticketSearchApi.similarSubject({
      currentSubject,
      candidates,
      ticketId: currentId || undefined,
      protocolo: ticket?.chamadoProtocolo || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        const byId = new Map(tickets.map((t) => [ticketIdOf(t), t]));
        const resolved = (data?.matches || [])
          .map((m) => ({ ticket: byId.get(String(m.id)), motivo: m.motivo }))
          .filter((m) => Boolean(m.ticket));
        setSimilarMatches(resolved);
      })
      .catch(() => {
        // fail-soft: mantém null — nunca afirma "nenhuma reclamação semelhante" sem ter checado.
      })
      .finally(() => {
        if (!cancelled) setSimilarLoading(false);
      });

    return () => { cancelled = true; };
  }, [tickets, enableSimilarSubject, clientIdentified, ticket, sourceTicketId]);

  const { openTickets, closedTickets } = useMemo(() => {
    const openList = [];
    const closedList = [];
    tickets.forEach((t) => {
      if (isTicketTerminalStatus(t)) closedList.push(t);
      else openList.push(t);
    });
    return { openTickets: openList, closedTickets: closedList };
  }, [tickets]);

  const selectedTickets = useMemo(
    () => tickets.filter((t) => selectedIds.has(ticketIdOf(t))),
    [tickets, selectedIds],
  );

  if (!open || !ticket) return null;

  const products = getClientProducts(ticket, client);
  const situacao = client?.situacao || (clientIdentified ? '—' : 'Informe o CPF no formulário lateral');
  const risco = client?.risco || '—';
  const analise = getClientAnalise(client);
  const displayName = contact.name && contact.name !== 'Cliente' ? contact.name : 'Cliente não identificado';

  const handleRowClick = (ticketId) => {
    onClose();
    if (onSelectTicket) onSelectTicket(ticketId);
  };

  const handleToggle = (ticketId) => {
    if (merging) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const handleMergeClick = () => {
    if (selectedIds.size < 2 || merging || !onFundirTickets) return;
    const preferred = sourceTicketId && selectedIds.has(String(sourceTicketId))
      ? String(sourceTicketId)
      : selectedTickets.find((t) => !isTicketTerminalStatus(t));
    setActivePickId(preferred ? ticketIdOf(preferred) : ticketIdOf(selectedTickets[0]));
    setConfirmOpen(true);
  };

  const handleConfirmFundir = async () => {
    if (!activePickId || selectedIds.size < 2 || !onFundirTickets) return;
    const inactiveIds = [...selectedIds].filter((id) => id !== activePickId);
    await onFundirTickets({
      activeId: activePickId,
      inactiveIds,
      cpf: cpfDigits,
    });
    setConfirmOpen(false);
    setSelectedIds(new Set());
    await refreshList();
  };

  const renderTable = (sectionTickets, title) => (
    <div className="client360-section" key={title}>
      <h6 className="client360-section-subtitle">
        {title}
        {' '}
        ({sectionTickets.length})
      </h6>
      <div className="client360-table-wrap">
        <table className="client360-table">
          <thead>
            <tr>
              {mergeEnabled ? <th className="client360-table__th-check" aria-label="Mesclar" /> : null}
              <th>Ticket</th>
              <th>Assunto</th>
              <th>Canal</th>
              <th>Status</th>
              <th>Data</th>
            </tr>
          </thead>
          <tbody>
            <TicketRows
              tickets={sectionTickets}
              mergeEnabled={mergeEnabled}
              selectedIds={selectedIds}
              onToggle={handleToggle}
              onRowClick={handleRowClick}
              merging={merging}
            />
          </tbody>
        </table>
      </div>
    </div>
  );

  return createPortal(
    <div
      id="ecosystemModal"
      className="modal"
      style={{ display: 'flex', zIndex: 9000 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !confirmOpen) onClose();
      }}
      role="presentation"
    >
      <div className="modal-content modal-content--wide" role="dialog" aria-modal="true" aria-labelledby="clientHistoryTitle">
        <div className="modal-header">
          <h3 id="clientHistoryTitle">Cliente — {displayName}</h3>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Fechar">
            <i className="fas fa-times" />
          </button>
        </div>
        <div className="modal-body">
          <div className="client360-profile">
            <div className="client360-grid">
              <div className="client360-card">
                <strong>CPF</strong>
                <span>{contact.cpf || '—'}</span>
              </div>
              <div className="client360-card">
                <strong>Situação</strong>
                <span>{situacao}</span>
              </div>
              <div className="client360-card client360-risk">
                <strong>Risco</strong>
                <span>{risco}</span>
              </div>
            </div>
            {clientIdentified ? (
              enableSimilarSubject ? (
                <div className="client360-similar">
                  <h6 className="client360-similar__title">
                    <i className="fas fa-brain" /> Assunto Semelhante
                  </h6>
                  {similarLoading ? (
                    <p className="client360-similar__empty">Buscando reclamações semelhantes…</p>
                  ) : similarMatches === null ? null : similarMatches.length === 0 ? (
                    <p className="client360-similar__empty">Nenhuma reclamação semelhante encontrada.</p>
                  ) : (
                    <ul className="client360-similar__list">
                      {similarMatches.map(({ ticket: t, motivo }) => (
                        <li
                          key={ticketIdOf(t)}
                          className="client360-similar__item"
                          onClick={() => handleRowClick(ticketIdOf(t))}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && handleRowClick(ticketIdOf(t))}
                        >
                          <span className="client360-similar__canal-badge">
                            {t.lateralForm?.canal || t.channel || t.source || '—'}
                          </span>
                          <span className="client360-similar__subject">{getTicketTitle(t)}</span>
                          {motivo ? <span className="client360-similar__motivo">{motivo}</span> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <>
                  <p><strong>Produtos:</strong> {products.length ? products.join(', ') : '—'}</p>
                  <p className="client360-analise"><i className="fas fa-brain" /> {analise}</p>
                </>
              )
            ) : null}
            <h5 className="client360-section-title">
              {clientIdentified
                ? `Tickets do cliente (${tickets.length})`
                : 'Histórico de atendimentos'}
            </h5>
            {!clientIdentified ? (
              <p className="client360-empty" role="status">
                Identifique o cliente informando o <strong>CPF</strong> no cadastro lateral
                {' '}(ícone de lápis no painel superior) para consultar o histórico de chamados.
              </p>
            ) : loading ? (
              <p className="client360-empty" role="status">Carregando histórico…</p>
            ) : loadError ? (
              <p className="client360-empty" role="alert">{loadError}</p>
            ) : tickets.length === 0 ? (
              <p className="client360-empty" role="status">
                Nenhum ticket encontrado para este CPF.
              </p>
            ) : (
              <>
                {mergeEnabled ? (
                  <p className="client360-merge-hint">
                    Selecione dois ou mais tickets e clique em Mesclar. Em seguida escolha qual permanece Ativo.
                  </p>
                ) : null}
                {renderTable(openTickets, 'Em aberto')}
                {renderTable(closedTickets, 'Fechados')}
              </>
            )}
          </div>
        </div>
        <div className="modal-footer client360-modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={merging}>
            Fechar
          </button>
          {mergeEnabled ? (
            <button
              type="button"
              className="btn-primary"
              onClick={handleMergeClick}
              disabled={selectedIds.size < 2 || merging}
            >
              {merging ? 'Mesclando…' : 'Mesclar'}
            </button>
          ) : null}
        </div>
      </div>

      {confirmOpen ? (
        <div
          className="modal client360-fusao-confirm"
          style={{ display: 'flex', zIndex: 9100 }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !merging) setConfirmOpen(false);
          }}
          role="presentation"
        >
          <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="fusaoConfirmTitle">
            <div className="modal-header">
              <h3 id="fusaoConfirmTitle">Confirmar mesclagem</h3>
              <button
                type="button"
                className="close-btn"
                onClick={() => !merging && setConfirmOpen(false)}
                aria-label="Fechar"
              >
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="modal-body">
              <p className="client360-merge-hint">
                Escolha o ticket que permanecerá Ativo.
              </p>
              <div className="client360-fusao-pick-table-wrap">
                <table className="client360-fusao-pick-table">
                  <thead>
                    <tr>
                      <th className="client360-fusao-pick-table__th-radio" aria-label="Ativo" />
                      <th>Ticket</th>
                      <th>Assunto</th>
                      <th>Status</th>
                      <th>Workflow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedTickets.map((t) => {
                      const id = ticketIdOf(t);
                      const terminal = isTicketTerminalStatus(t);
                      const statusMeta = getTicketStatusBadgeMeta(t);
                      const workflowIcon = getClient360WorkflowIconMeta(t);
                      return (
                        <tr
                          key={id}
                          className={
                            'client360-fusao-pick-row'
                            + (activePickId === id ? ' is-selected' : '')
                            + (terminal ? ' is-disabled' : '')
                          }
                          onClick={() => {
                            if (!merging && !terminal) setActivePickId(id);
                          }}
                        >
                          <td className="client360-fusao-pick-table__td-radio">
                            <input
                              type="radio"
                              name="fusao-ativo"
                              checked={activePickId === id}
                              disabled={merging || terminal}
                              onChange={() => setActivePickId(id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Definir #${getTicketProtocolLabel(t) || id} como ativo`}
                            />
                          </td>
                          <td>
                            <span className="client360-ticket-cell">
                              #{getTicketProtocolLabel(t) || id}
                              {terminal ? (
                                <span className="client360-fusao-pick-hint">Não pode ser o ativo</span>
                              ) : null}
                            </span>
                          </td>
                          <td title={getTicketTitle(t)}>{getTicketTitle(t)}</td>
                          <td>
                            <span className={`client360-status-badge client360-status-badge--${statusMeta.cls}`}>
                              {statusMeta.label}
                            </span>
                          </td>
                          <td>
                            {workflowIcon ? (
                              <span
                                className={`client360-workflow-badge client360-workflow-badge--${workflowIcon.modifier}`}
                                title={workflowIcon.title}
                              >
                                <i className={`ti ${workflowIcon.icon}`} aria-hidden="true" />
                                Workflow
                              </span>
                            ) : (
                              <span className="client360-fusao-pick-empty">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={merging}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleConfirmFundir()}
                disabled={
                  merging
                  || !activePickId
                  || selectedTickets.find((t) => ticketIdOf(t) === activePickId && isTicketTerminalStatus(t))
                }
              >
                {merging ? 'Mesclando…' : 'Confirmar mesclagem'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
