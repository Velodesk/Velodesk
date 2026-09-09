/**
 * RaRelatedTicketsCard — Agente 5: tickets do histórico do CPF relacionados à reclamação atual
 */
import React, { useEffect, useRef, useState } from 'react';
import { reclamacoesApi } from '../../../api/client';
import { patchReclamacao } from '../../../services/especiais/reclameAquiStore';

const CRITERIO_LABELS = {
  mesmo_contrato_operacao: 'Mesmo contrato/operação',
  recorrencia_nao_resolvida: 'Recorrência não resolvida',
  similaridade_semantica: 'Mesmo assunto',
  mesmo_motivo_categoria: 'Mesma categoria',
};

// Reprocessamento é assíncrono (fire-and-forget no backend) — poll leve e limitado até o
// status sair de "pendente"/ausente, sem infra de websocket/fila no projeto.
const POLL_DELAYS_MS = [5000, 8000, 12000];

export default function RaRelatedTicketsCard({ raItem, onSaved }) {
  const analise = raItem?.analiseRelacionados;
  const status = analise?.status;
  const [pollAttempt, setPollAttempt] = useState(0);
  const raIdRef = useRef(raItem?.id);

  useEffect(() => {
    raIdRef.current = raItem?.id;
    setPollAttempt(0);
  }, [raItem?.id]);

  useEffect(() => {
    if (!raItem?.id || status || pollAttempt >= POLL_DELAYS_MS.length) return undefined;

    const timer = setTimeout(async () => {
      if (raIdRef.current !== raItem.id) return;
      try {
        const updated = await reclamacoesApi.get('reclame-aqui', raItem.id);
        const merged = { ...raItem, ...updated };
        patchReclamacao(merged);
        onSaved?.(merged);
      } catch {
        // fail-soft: próxima janela tenta de novo
      } finally {
        setPollAttempt((n) => n + 1);
      }
    }, POLL_DELAYS_MS[pollAttempt]);

    return () => clearTimeout(timer);
  }, [raItem, status, pollAttempt, onSaved]);

  if (!raItem) return null;

  if (!status || status === 'pendente') {
    return (
      <section className="ra-ticket__side-card ra-related-tickets">
        <h2>TICKETS RELACIONADOS</h2>
        <p className="ra-related-tickets__hint">Analisando histórico do cliente…</p>
      </section>
    );
  }

  if (!analise.tickets?.length) return null;

  return (
    <section className="ra-ticket__side-card ra-related-tickets">
      <h2>TICKETS RELACIONADOS</h2>
      {analise.resumoExecutivo ? (
        <p className="ra-related-tickets__summary">{analise.resumoExecutivo}</p>
      ) : null}
      <ul className="ra-related-tickets__list">
        {analise.tickets.map((t) => (
          <li key={t.chamadoId} className="ra-related-tickets__item">
            <div className="ra-related-tickets__item-head">
              <span className="ra-related-tickets__protocolo">
                #{t.chamadoProtocolo || t.chamadoId}
              </span>
              <span className="ra-related-tickets__score">{t.scoreSimilaridade}%</span>
            </div>
            {t.criterios?.length ? (
              <div className="ra-related-tickets__criterios">
                {t.criterios.map((c) => (
                  <span key={c} className="ra-related-tickets__chip">
                    {CRITERIO_LABELS[c] || c}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="ra-related-tickets__motivo">{t.motivo}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
