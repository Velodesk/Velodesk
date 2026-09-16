/**
 * FuncoesAgentesAccordion v1.3.0 — coluna "Recebe ticket?" (override da roleta por pessoa)
 * VERSION: v1.3.0 | DATE: 2026-09-16
 */
import React, { useMemo, useState } from 'react';
import { formatAtuacaoLabels } from '../../../services/desk/atuacaoVision';

export default function FuncoesAgentesAccordion({
  open,
  onToggle,
  agentes,
  canEditRoleta = false,
  onToggleRoleta,
  togglingEmail,
}) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return agentes || [];
    return (agentes || []).filter((a) => (
      String(a.colaboradorNome || '').toLowerCase().includes(term)
      || String(a.email || '').toLowerCase().includes(term)
      || formatAtuacaoLabels(a.atuacao).toLowerCase().includes(term)
      || String(a.funcaoNome || '').toLowerCase().includes(term)
    ));
  }, [agentes, search]);

  return (
    <div className="fp-accordion">
      <button
        type="button"
        className={'fp-accordion__header' + (open ? ' is-open' : '')}
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="fp-accordion__title">
          Agentes
          {(agentes || []).length > 0 ? (
            <span className="fp-accordion__count">{agentes.length}</span>
          ) : null}
        </span>
        <i className={'ti ti-chevron-' + (open ? 'up' : 'down')} aria-hidden="true" />
      </button>
      {open ? (
        <div className="fp-accordion__panel fp-agentes-panel">
          {(agentes || []).length === 0 ? (
            <div className="fp-agentes-empty">
              <p>
                Nenhum colaborador com acesso Desk encontrado no VeloHub
                (empresa Velotax, acessos.Desk).
              </p>
            </div>
          ) : (
            <>
              <label className="fp-agentes-search">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar agente…"
                  aria-label="Buscar agentes"
                />
              </label>
              <div className="fp-agentes-table-wrap">
                <table className="config-table fp-agentes-table">
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>E-mail</th>
                      <th>Atuação (cargo)</th>
                      <th>Função</th>
                      <th>Nível</th>
                      <th>Recebe ticket?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => (
                      <tr key={a.email}>
                        <td>
                          <strong>{a.colaboradorNome || a.email}</strong>
                          {a.afastado ? (
                            <span className="fp-agentes-badge">Afastado</span>
                          ) : null}
                        </td>
                        <td>{a.email || '—'}</td>
                        <td>{formatAtuacaoLabels(a.atuacao)}</td>
                        <td>{a.funcaoNome || a.funcaoSlug || '—'}</td>
                        <td>
                          {a.nivel != null ? (
                            <span className="fp-badge">Nível {a.nivel}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <label
                            className="wf-config-toggle"
                            aria-label={`Recebe ticket automaticamente: ${a.colaboradorNome || a.email}`}
                            title={
                              a.override != null
                                ? `Override manual (${a.override ? 'ativo' : 'inativo'})${a.motivo ? ` — ${a.motivo}` : ''}`
                                : 'Sem override — segue a atuação do cadastro'
                            }
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(a.elegivelFinal)}
                              disabled={!canEditRoleta || togglingEmail === a.email}
                              onChange={(e) => onToggleRoleta?.(a, e.target.checked)}
                            />
                            <span className="wf-config-toggle__track" aria-hidden="true">
                              <span className="wf-config-toggle__thumb" />
                            </span>
                          </label>
                          {a.override != null ? (
                            <span className="fp-agentes-badge">manual</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (agentes || []).length > 0 ? (
                <p className="fp-agentes-no-match">Nenhum agente corresponde à busca.</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
