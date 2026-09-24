/**
 * LegadoOctaDetailPage — detalhe de um ticket legado do Octadesk: conversa
 * (mensagens públicas vs anotações internas) + anexos PDF + painel de
 * tabulação somente-leitura reproduzindo o customField exatamente como veio.
 * Sem edição, sem continuar atendimento aqui — ver LegadoOctaListPage.
 */
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api, { legadoOctaApi } from '../../api/client';

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR');
}

// A rota de anexo exige Authorization Bearer (authMiddleware) — um <a href> simples não
// carrega o token. Baixa via axios (que já injeta o header) e abre o blob numa aba nova.
async function openAttachment(url, filename) {
  try {
    // `api` já tem baseURL '/api' — a URL guardada no ticket já vem com esse prefixo.
    const path = url.startsWith('/api/') ? url.slice(4) : url;
    const res = await api.get(path, { responseType: 'blob' });
    const blobUrl = URL.createObjectURL(res.data);
    window.open(blobUrl, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (err) {
    // eslint-disable-next-line no-alert
    alert(`Não foi possível abrir "${filename}": ${err?.response?.data?.message || err.message}`);
  }
}

export default function LegadoOctaDetailPage() {
  const { number } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    legadoOctaApi.get(number)
      .then((data) => { if (!cancelled) setTicket(data); })
      .catch((err) => {
        if (!cancelled) setError(err?.response?.data?.message || 'Falha ao carregar o ticket legado.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [number]);

  if (loading) return <div style={{ padding: 24 }}>Carregando…</div>;
  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>{error}</div>;
  if (!ticket) return null;

  const customFieldEntries = Object.entries(ticket.customField || {});

  return (
    <div style={{ padding: 24, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Link to="/legado-octa/tickets" style={{ display: 'inline-block', marginBottom: 12 }}>
          &larr; Voltar à busca
        </Link>
        <h2 style={{ marginBottom: 4 }}>{ticket.summary || 'Ticket sem assunto'}</h2>
        <div style={{ color: '#666', marginBottom: 4 }}>
          Protocolo Octadesk: {ticket.protocoloExibicao} — Somente consulta
        </div>
        <div style={{ color: '#666', marginBottom: 20 }}>
          {ticket.requesterName || '—'} ({ticket.requesterMail || '—'})
        </div>

        <div className="legado-octa-conversa">
          {(ticket.interactions || []).map((interaction, idx) => (
            <div
              key={idx}
              style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 8,
                background: '#fafafa',
                border: '1px solid #eee',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#888' }}>
                <span>{interaction.personName || interaction.personEmail || 'Autor desconhecido'}</span>
                <span>{formatDateTime(interaction.dateCreation)}</span>
              </div>

              {(interaction.comments || []).map((comment, cIdx) => (
                <div
                  key={cIdx}
                  style={{
                    marginTop: 8,
                    padding: 8,
                    borderRadius: 6,
                    background: comment.isPublic ? '#e8f0ff' : '#fff4e0',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: comment.isPublic ? '#1634FF' : '#a56800', marginBottom: 4 }}>
                    {comment.isPublic ? 'MENSAGEM PÚBLICA' : 'ANOTAÇÃO INTERNA'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{comment.content}</div>
                </div>
              ))}

              {(interaction.attachments || []).length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {interaction.attachments.map((att, aIdx) => (
                    <button
                      key={aIdx}
                      type="button"
                      onClick={() => openAttachment(att.url, att.name)}
                      style={{
                        fontSize: 13, textDecoration: 'underline', background: 'none',
                        border: 'none', padding: 0, cursor: 'pointer', color: '#1634FF',
                      }}
                    >
                      📎 {att.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {(!ticket.interactions || ticket.interactions.length === 0) && (
            <div style={{ color: '#666' }}>Nenhuma interação registrada neste ticket.</div>
          )}
        </div>
      </div>

      <div style={{ width: 320, flexShrink: 0 }}>
        <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 16 }}>
          <h4 style={{ marginTop: 0, marginBottom: 12 }}>Tabulação (Octadesk)</h4>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
            Somente leitura — campos exatamente como registrados no Octadesk.
          </div>
          <dl style={{ margin: 0 }}>
            <dt style={{ fontSize: 12, color: '#888' }}>Categoria de assunto</dt>
            <dd style={{ marginBottom: 8 }}>{ticket.topicGroupName || '—'}</dd>
            <dt style={{ fontSize: 12, color: '#888' }}>Assunto</dt>
            <dd style={{ marginBottom: 8 }}>{ticket.topicName || '—'}</dd>
            <dt style={{ fontSize: 12, color: '#888' }}>CPF do titular</dt>
            <dd style={{ marginBottom: 8 }}>{ticket.requesterCpf || '—'}</dd>
            {customFieldEntries.map(([key, value]) => (
              <React.Fragment key={key}>
                <dt style={{ fontSize: 12, color: '#888' }}>{key}</dt>
                <dd style={{ marginBottom: 8, wordBreak: 'break-word' }}>{String(value)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
