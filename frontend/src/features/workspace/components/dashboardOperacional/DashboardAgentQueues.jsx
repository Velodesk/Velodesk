/**
 * DashboardAgentQueues v2.0.0 — 3 cards (Novos / Em Andamento / Pendentes) + linha extra
 * com Resolvidos e Sem Resposta >2h, logo abaixo do KPI strip.
 *
 * Cada card de status mostra: contador grande, "mais antigo" (data + protocolo), "sem
 * responsável" (destaque quando > 0) e tabela com todos os tickets daquele status.
 */
import React, { useMemo, useState } from 'react';

function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(iso) {
  const d = parseIso(iso);
  if (!d) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysAgo(iso) {
  const d = parseIso(iso);
  if (!d) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

function relativeDaysLabel(iso) {
  const n = daysAgo(iso);
  if (n == null) return '';
  if (n === 0) return 'hoje';
  if (n === 1) return 'há 1 dia';
  return `há ${n} dias`;
}

function daysBadge(iso) {
  const n = daysAgo(iso);
  if (n == null) return '';
  if (n === 0) return 'hoje';
  return `${n}d`;
}

function fmtMinutes(min) {
  if (!Number.isFinite(min)) return '—';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function StatusCard({ tone, title, group, onOpenTicket }) {
  const total = group?.total ?? 0;
  const semResponsavel = group?.semResponsavel ?? 0;
  const tickets = group?.tickets ?? [];
  const oldest = group?.oldest;
  const [filterSemResp, setFilterSemResp] = useState(false);

  const visibleTickets = useMemo(
    () => (filterSemResp ? tickets.filter((t) => !t.responsavel) : tickets),
    [filterSemResp, tickets],
  );

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const text = visibleTickets.map((t) => `#${t.protocolo || t.id.slice(-6)}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore clipboard failures */
    }
  };

  return (
    <article className={`dashop-sq dashop-sq--${tone}`}>
      <div className="dashop-sq__header">
        <h3 className="dashop-sq__title">{title}</h3>
        <div className="dashop-sq__count">{total}</div>
        <div className="dashop-sq__subtitle">tickets abertos neste status</div>
      </div>

      <div className="dashop-sq__mini-row">
        <div className="dashop-sq__mini">
          <span className="dashop-sq__mini-label">Mais antigo</span>
          {oldest ? (
            <>
              <strong className="dashop-sq__mini-value">{fmtDate(oldest.createdAtIso)}</strong>
              <span className="dashop-sq__mini-sub">
                {relativeDaysLabel(oldest.createdAtIso)} · #{oldest.protocolo || oldest.id.slice(-6)}
              </span>
            </>
          ) : (
            <>
              <strong className="dashop-sq__mini-value dashop-sq__mini-value--empty">—</strong>
              <span className="dashop-sq__mini-sub">sem tickets</span>
            </>
          )}
        </div>
        <button
          type="button"
          className={
            'dashop-sq__mini dashop-sq__mini--btn'
            + (semResponsavel > 0 ? ' is-active' : '')
            + (filterSemResp ? ' is-filtered' : '')
          }
          onClick={() => semResponsavel > 0 && setFilterSemResp((v) => !v)}
          disabled={semResponsavel === 0}
        >
          <span className="dashop-sq__mini-label">Sem responsável</span>
          <strong
            className={
              'dashop-sq__mini-value '
              + (semResponsavel > 0 ? 'dashop-sq__mini-value--alert' : 'dashop-sq__mini-value--ok')
            }
          >
            {semResponsavel}
          </strong>
          <span className="dashop-sq__mini-sub">
            {semResponsavel === 0
              ? 'todos atribuídos'
              : filterSemResp
                ? 'filtrando — clique p/ limpar'
                : 'clique para filtrar'}
          </span>
        </button>
      </div>

      <div className="dashop-sq__table-head">
        <span>
          {filterSemResp ? 'SEM RESPONSÁVEL' : 'TODOS'} · {visibleTickets.length} TICKET
          {visibleTickets.length === 1 ? '' : 'S'}
        </span>
        <button
          type="button"
          className="dashop-sq__copy"
          onClick={handleCopy}
          disabled={visibleTickets.length === 0}
        >
          <i className="ti ti-copy" aria-hidden="true" />
          {copied ? ' Copiado!' : ' Copiar números'}
        </button>
      </div>

      <div className="dashop-sq__table-wrap">
        {visibleTickets.length === 0 ? (
          <p className="dashop-sq__empty">
            {filterSemResp ? 'Nada sem responsável.' : 'Nenhum ticket neste status.'}
          </p>
        ) : (
          <table className="dashop-sq__table">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Aberto em</th>
                <th>Canal</th>
                <th>Responsável</th>
              </tr>
            </thead>
            <tbody>
              {visibleTickets.map((t) => {
                const n = daysAgo(t.createdAtIso) ?? 0;
                return (
                  <tr key={t.id}>
                    <td>
                      <button
                        type="button"
                        className="dashop-sq__ticket-link"
                        onClick={() => onOpenTicket?.(t.id)}
                      >
                        #{t.protocolo || t.id.slice(-6)}
                      </button>
                    </td>
                    <td>
                      <span className="dashop-sq__date">{fmtDate(t.createdAtIso)}</span>{' '}
                      <span className={'dashop-sq__days' + (n >= 7 ? ' is-old' : '')}>
                        {daysBadge(t.createdAtIso)}
                      </span>
                    </td>
                    <td>{t.canal || '—'}</td>
                    <td>
                      {t.responsavel ? (
                        <span className="dashop-sq__resp">{t.responsavel}</span>
                      ) : (
                        <span className="dashop-sq__badge-noresp">sem responsável</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </article>
  );
}

function ResolvidosCard({ data }) {
  const total = data?.total ?? 0;
  const byAgent = data?.byAgent ?? [];
  return (
    <article className="dashop-card dashop-sq-extra dashop-sq-extra--ok">
      <header className="dashop-card__head">
        <div className="dashop-card__head-left">
          <h3 className="dashop-card__title">Resolvidos</h3>
          <span className="dashop-card__meta">
            {total} · {data?.periodoLabel || 'No período'}
          </span>
        </div>
      </header>
      <div className="dashop-sq-extra__body">
        {byAgent.length === 0 ? (
          <p className="dashop-sq__empty">Nenhum resolvido no período.</p>
        ) : (
          <ul className="dashop-aq-list">
            {byAgent.map((row) => (
              <li key={row.key} className="dashop-aq-list__row">
                <span className="dashop-aq-list__name" title={row.name}>{row.name}</span>
                <span className="dashop-aq-list__count">{row.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function SemRespostaCard({ data, onOpenTicket }) {
  const total = data?.total ?? 0;
  const tickets = data?.tickets ?? [];
  const limit = data?.limitMinutes ?? 120;
  return (
    <article
      className={
        'dashop-card dashop-sq-extra dashop-sq-extra--alert'
        + (total > 0 ? ' is-active' : '')
      }
    >
      <header className="dashop-card__head">
        <div className="dashop-card__head-left">
          <h3 className="dashop-card__title">
            Sem resposta &gt; {Math.round(limit / 60)}h
          </h3>
          <span className="dashop-card__meta">
            {total} aguardando atendente · relógio do SLA do Desk
          </span>
        </div>
      </header>
      <div className="dashop-sq-extra__body">
        {tickets.length === 0 ? (
          <p className="dashop-sq__empty">Tudo em dia — ninguém passou de {Math.round(limit / 60)}h.</p>
        ) : (
          <ul className="dashop-aq-tickets">
            {tickets.map((t) => (
              <li key={t.id} className="dashop-aq-tickets__row">
                <button
                  type="button"
                  className="dashop-aq-tickets__btn"
                  onClick={() => onOpenTicket?.(t.id)}
                  title={t.subject || t.protocolo}
                >
                  <span className="dashop-aq-tickets__protocolo">
                    #{t.protocolo || t.id.slice(-6)}
                  </span>
                  <span className="dashop-aq-tickets__subject">
                    {t.subject || '(sem assunto)'}
                  </span>
                  <span className="dashop-aq-tickets__meta">
                    {t.responsavel || 'Sem responsável'}
                    {t.canal ? ` · ${t.canal}` : ''}
                  </span>
                </button>
                <span className="dashop-aq-tickets__wait">
                  {fmtMinutes(t.waitingMinutes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

export default function DashboardAgentQueues({ data, onOpenTicket }) {
  if (!data) return null;
  const { novos, andamento, pendentes, resolvidos, semResposta2h } = data;
  return (
    <>
      <section className="dashop-sq-strip" aria-label="Filas por status">
        <StatusCard tone="novos" title="Novos" group={novos} onOpenTicket={onOpenTicket} />
        <StatusCard tone="andamento" title="Em Andamento" group={andamento} onOpenTicket={onOpenTicket} />
        <StatusCard tone="pendentes" title="Pendentes" group={pendentes} onOpenTicket={onOpenTicket} />
      </section>
      <section className="dashop-sq-extras" aria-label="Resolvidos e sem resposta">
        <ResolvidosCard data={resolvidos} />
        <SemRespostaCard data={semResposta2h} onOpenTicket={onOpenTicket} />
      </section>
    </>
  );
}
