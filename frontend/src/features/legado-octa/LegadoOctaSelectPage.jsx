/**
 * LegadoOctaSelectPage — raiz do módulo Legado Octa: dois cards (Tickets / WhatsApp)
 * + busca combinada por CPF/telefone/protocolo nos dois ramos.
 */
import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { legadoOctaApi } from '../../api/client';

const BRANCHES = [
  { id: 'tickets', label: 'Tickets', icon: 'ti-ticket', desc: 'Histórico de tickets do Octadesk' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'ti-brand-whatsapp', desc: 'Histórico de conversas de WhatsApp do Octadesk' },
];

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export default function LegadoOctaSelectPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const runSearch = useCallback(async (evt) => {
    evt.preventDefault();
    const raw = query.trim();
    if (!raw) return;
    setLoading(true);
    setError('');
    try {
      const data = await legadoOctaApi.searchAll(raw);
      setResults(data);
    } catch (err) {
      setError(err?.response?.data?.message || 'Falha ao buscar no Legado Octa.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const hasResults = results && ((results.tickets?.length || 0) + (results.whatsapp?.length || 0) > 0);

  return (
    <div className="especiais-channel-select" style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <header className="especiais-page__header">
        <span className="especiais-page__eyebrow">Legado Octa</span>
        <h2 className="especiais-page__title">Histórico Octadesk</h2>
        <p className="especiais-page__subtitle">
          Arquivo somente para consulta — tickets e conversas de WhatsApp do CRM anterior.
        </p>
      </header>

      <form onSubmit={runSearch} style={{ display: 'flex', gap: 8, margin: '20px 0' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por CPF, telefone ou protocolo (todos os ramos)"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button type="submit" disabled={loading || !query.trim()} style={{ padding: '10px 20px' }}>
          {loading ? 'Buscando…' : 'Buscar em tudo'}
        </button>
      </form>

      {error && <div style={{ color: '#c0392b', marginBottom: 16 }}>{error}</div>}

      {results && !hasResults && !loading && (
        <div style={{ color: '#666', marginBottom: 16 }}>Nenhuma ocorrência encontrada.</div>
      )}

      {hasResults && (
        <div style={{ marginBottom: 24 }}>
          {results.tickets?.map((t) => (
            <div
              key={t.octadeskNumber}
              onClick={() => navigate(`tickets/ticket/${t.octadeskNumber}`)}
              style={{ padding: 10, borderBottom: '1px solid #eee', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#1634FF' }}>TICKET</span>
              <span>{t.protocoloExibicao}</span>
              <span style={{ color: '#666' }}>{t.summary}</span>
              <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>{formatDate(t.openDate)}</span>
            </div>
          ))}
          {results.whatsapp?.map((w) => (
            <div
              key={w.octadeskRoomId}
              onClick={() => navigate(`whatsapp/${w.octadeskRoomId}`)}
              style={{ padding: 10, borderBottom: '1px solid #eee', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center' }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#25D366' }}>WHATSAPP</span>
              <span>{w.protocoloExibicao}</span>
              <span style={{ color: '#666' }}>{w.clientName || w.clientPhone}</span>
              <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>{formatDate(w.lastMessageAt)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="especiais-channel-grid">
        {BRANCHES.map((b) => (
          <button
            key={b.id}
            type="button"
            className="especiais-channel-card"
            onClick={() => navigate(b.id)}
          >
            <span className="especiais-channel-card__icon">
              <i className={`ti ${b.icon}`} aria-hidden="true" />
            </span>
            <span className="especiais-channel-card__label">{b.label}</span>
            <span className="especiais-channel-card__desc">{b.desc}</span>
            <span className="especiais-channel-card__cta">
              Entrar
              <i className="ti ti-arrow-right" aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
