/**
 * LegadoOctaWhatsappListPage — lista/busca do histórico de WhatsApp (somente consulta).
 */
import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { legadoOctaApi } from '../../api/client';

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export default function LegadoOctaWhatsappListPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);

  const pageSize = 25;

  const runSearch = useCallback(async (targetPage = 1) => {
    const raw = query.trim();
    if (!raw) return;
    setLoading(true);
    setError('');
    try {
      const digits = raw.replace(/\D/g, '');
      const params = { page: targetPage, pageSize };
      if (digits.length === 11) {
        params.cpf = digits;
      } else if (digits.length >= 10) {
        params.phone = digits;
      } else {
        params.protocolo = raw;
      }
      const data = await legadoOctaApi.listWhatsapp(params);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(targetPage);
      setSearched(true);
    } catch (err) {
      setError(err?.response?.data?.message || 'Falha ao buscar conversas de WhatsApp.');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleSubmit = (evt) => {
    evt.preventDefault();
    runSearch(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 4 }}>Legado Octa — WhatsApp</h2>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Histórico de conversas de WhatsApp do Octadesk — arquivo somente para consulta.
      </p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por CPF, telefone ou protocolo (ex.: WA00000001)"
          style={{ flex: 1, padding: '10px 12px', border: '1px solid #ccc', borderRadius: 6 }}
        />
        <button type="submit" disabled={loading || !query.trim()} style={{ padding: '10px 20px' }}>
          {loading ? 'Buscando…' : 'Buscar'}
        </button>
      </form>

      {error && <div style={{ color: '#c0392b', marginBottom: 16 }}>{error}</div>}

      {searched && !loading && items.length === 0 && !error && (
        <div style={{ color: '#666' }}>Nenhuma conversa encontrada para essa busca.</div>
      )}

      {items.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #eee' }}>
                <th style={{ padding: 8 }}>Protocolo</th>
                <th style={{ padding: 8 }}>Cliente</th>
                <th style={{ padding: 8 }}>Telefone</th>
                <th style={{ padding: 8 }}>Última mensagem</th>
              </tr>
            </thead>
            <tbody>
              {items.map((w) => (
                <tr
                  key={w.octadeskRoomId}
                  onClick={() => navigate(w.octadeskRoomId)}
                  style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                >
                  <td style={{ padding: 8 }}>{w.protocoloExibicao}</td>
                  <td style={{ padding: 8 }}>{w.clientName || '—'}</td>
                  <td style={{ padding: 8 }}>{w.clientPhone || '—'}</td>
                  <td style={{ padding: 8 }}>{formatDate(w.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 16 }}>
            <button type="button" disabled={page <= 1 || loading} onClick={() => runSearch(page - 1)}>
              Anterior
            </button>
            <span>Página {page} de {totalPages}</span>
            <button type="button" disabled={page >= totalPages || loading} onClick={() => runSearch(page + 1)}>
              Próxima
            </button>
          </div>
        </>
      )}
    </div>
  );
}
