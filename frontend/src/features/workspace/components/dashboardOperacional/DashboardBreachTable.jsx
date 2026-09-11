/**
 * DashboardBreachTable v1.0.0 — tickets em atraso de SLA (ativos).
 *
 * Fonte: `escalated.groups[sla-critico].entries` do supervisor360. Cada entry vem com
 * `slaRemaining` (minutos, pode ser negativo = já venceu), `channel` inferido e o dto
 * pronto de listagem. Ordenamos aqui por menor slaRemaining (mais crítico primeiro).
 *
 * Não mostra coluna Prioridade (schema não tem — Fase 2).
 */
import React, { useMemo } from 'react';

function fmtRemaining(min) {
  if (min == null) return '—';
  const n = Math.round(min);
  if (n < 0) {
    const abs = Math.abs(n);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return h > 0 ? `−${h}h${String(m).padStart(2, '0')}` : `−${m}min`;
  }
  const h = Math.floor(n / 60);
  const m = n % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

function channelLabel(channel) {
  if (!channel) return '—';
  const map = { whatsapp: 'WhatsApp', email: 'E-mail', instagram: 'Instagram', chat: 'Chat', portal: 'Portal' };
  return map[String(channel).toLowerCase()] ?? channel;
}

function slaTone(min) {
  if (min == null) return 'is-muted';
  if (min < 0) return 'is-crit';
  if (min <= 30) return 'is-warn';
  return 'is-ok';
}

export default function DashboardBreachTable({ tickets = [], onOpenTicket }) {
  const sorted = useMemo(() => {
    return [...tickets].sort((a, b) => (a.slaRemaining ?? 0) - (b.slaRemaining ?? 0));
  }, [tickets]);

  return (
    <article className="dashop-card">
      <header className="dashop-card__head">
        <h3 className="dashop-card__title">Tickets em atraso de SLA</h3>
        <span className="dashop-card__meta">{sorted.length} tickets</span>
      </header>
      {sorted.length === 0 ? (
        <p className="dashop-card__empty">Nenhum ticket em atraso agora. 🎉</p>
      ) : (
        <div className="dashop-table-wrap">
          <table className="dashop-table">
            <thead>
              <tr>
                <th>Cliente / assunto</th>
                <th>Canal</th>
                <th>Responsável</th>
                <th style={{ textAlign: 'right' }}>Vence em</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((ticket) => (
                <tr
                  key={ticket.id}
                  className="dashop-table__row is-clickable"
                  onClick={() => onOpenTicket?.(ticket.id)}
                >
                  <td>
                    <div className="dashop-ticket-title">{ticket.subject || ticket.title || 'Ticket'}</div>
                    <div className="dashop-ticket-meta">{ticket.protocol || ticket.protocolo || ticket.id}</div>
                  </td>
                  <td>{channelLabel(ticket.channel)}</td>
                  <td>{ticket.responsibleAgent || ticket.responsavel || '—'}</td>
                  <td className={'dashop-num ' + slaTone(ticket.slaRemaining)} style={{ textAlign: 'right' }}>
                    {fmtRemaining(ticket.slaRemaining)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
