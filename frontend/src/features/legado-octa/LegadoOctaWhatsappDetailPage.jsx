/**
 * LegadoOctaWhatsappDetailPage — timeline de uma conversa de WhatsApp legada.
 * Sem tabulação (não existe no dado de origem) — só o conteúdo e quem falou.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { legadoOctaApi } from '../../api/client';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR');
}

// O conteúdo bruto do Octadesk vem com marcação HTML (<p>, <br>, etc.) em boa parte das
// mensagens — sem editor rico aqui, então converte pra texto simples preservando quebras de linha.
function plainTextContent(html) {
  const withBreaks = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  const div = document.createElement('div');
  div.innerHTML = withBreaks;
  return (div.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export default function LegadoOctaWhatsappDetailPage() {
  const { id } = useParams();
  const [conversa, setConversa] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    legadoOctaApi.getWhatsapp(id)
      .then((data) => { if (!cancelled) setConversa(data); })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || 'Falha ao carregar a conversa.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div style={{ padding: 24 }}>Carregando…</div>;
  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>{error}</div>;
  if (!conversa) return null;

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto' }}>
      <Link to="/legado-octa/whatsapp" style={{ display: 'inline-block', marginBottom: 12 }}>
        &larr; Voltar à busca
      </Link>
      <h2 style={{ marginBottom: 4 }}>{conversa.clientName || conversa.clientPhone || 'Contato desconhecido'}</h2>
      <div style={{ color: '#666', marginBottom: 20 }}>
        Protocolo: {conversa.protocoloExibicao} — {conversa.clientPhone} — Somente consulta
      </div>

      <div>
        {(conversa.messages || []).map((m, idx) => (
          <div
            key={idx}
            style={{
              display: 'flex',
              justifyContent: m.isAgent ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: '70%',
                padding: '8px 12px',
                borderRadius: 10,
                background: m.isAgent ? '#dcf8c6' : '#f1f0f0',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 2 }}>
                {m.authorName || (m.isAgent ? 'Atendimento' : 'Cliente')}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{plainTextContent(m.content)}</div>
              <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 4 }}>
                {formatDateTime(m.dateCreation)}
              </div>
            </div>
          </div>
        ))}
        {(!conversa.messages || conversa.messages.length === 0) && (
          <div style={{ color: '#666' }}>Nenhuma mensagem registrada nesta conversa.</div>
        )}
      </div>
    </div>
  );
}
