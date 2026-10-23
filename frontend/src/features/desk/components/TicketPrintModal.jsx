/**
 * TicketPrintModal v1.1.0 — filtros do extrato do ticket (padrão Octadesk), Desk e casos especiais.
 * Ao confirmar, abre o extrato numa nova aba pronto para Ctrl+P → Salvar como PDF.
 * "Eventos" (detalhamento das interações) e "Informações de SLA" ficam visíveis como Fase 2, desabilitados.
 */
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_TICKET_PRINT_OPTIONS, openTicketExtract } from '../../../services/desk/ticketPrint';
import { getTicketProtocolLabel } from '../../../services/desk/utils';

const FILTERS = [
  { id: 'publicas', label: 'Resposta Pública', swatch: 'publica' },
  { id: 'internas', label: 'Notas', swatch: 'interna' },
  { id: 'automaticas', label: 'Ações automáticas', swatch: 'automatica' },
  { id: 'whatsapp', label: 'Conversa WhatsApp', swatch: 'whatsapp' },
];

const EXTRAS = [
  { id: 'detalhamento', label: 'Eventos' },
  { id: 'sla', label: 'Informações de SLA (prazos)' },
];

export default function TicketPrintModal({ open, ticket, onClose }) {
  const [filters, setFilters] = useState(DEFAULT_TICKET_PRINT_OPTIONS);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (open) {
      setFilters(DEFAULT_TICKET_PRINT_OPTIONS);
      setBlocked(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const anySelected = FILTERS.some((f) => filters[f.id]);
  // Rascunho ainda não tem protocolo — o extrato é gerado no servidor a partir do ticket salvo.
  const protocol = getTicketProtocolLabel(ticket);

  const handlePrint = () => {
    if (!anySelected || !protocol) return;
    if (!openTicketExtract(protocol, filters)) {
      setBlocked(true);
      return;
    }
    onClose?.();
  };

  return createPortal(
    <div
      className="ticket-print-modal__backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="ticket-print-modal" role="dialog" aria-modal="true" aria-labelledby="ticketPrintModalTitle">
        <header className="ticket-print-modal__head">
          <h2 id="ticketPrintModalTitle">Imprimir ticket</h2>
          {protocol ? <span className="ticket-print-modal__protocol">#{protocol}</span> : null}
        </header>

        <section className="ticket-print-modal__group" aria-labelledby="ticketPrintFiltrar">
          <h3 id="ticketPrintFiltrar">Filtrar por</h3>
          {FILTERS.map((f) => (
            <label key={f.id} className="ticket-print-modal__option" htmlFor={`ticketPrint-${f.id}`}>
              <input
                id={`ticketPrint-${f.id}`}
                type="checkbox"
                checked={Boolean(filters[f.id])}
                onChange={(event) => setFilters((prev) => ({ ...prev, [f.id]: event.target.checked }))}
              />
              <span>{f.label}</span>
              <span className={'ticket-print-modal__swatch ticket-print-modal__swatch--' + f.swatch} aria-hidden="true" />
            </label>
          ))}
        </section>

        <section className="ticket-print-modal__group" aria-labelledby="ticketPrintExtras">
          <h3 id="ticketPrintExtras">Exibir informações adicionais</h3>
          {EXTRAS.map((extra) => (
            <label key={extra.id} className="ticket-print-modal__option is-disabled" htmlFor={`ticketPrint-${extra.id}`}>
              <input id={`ticketPrint-${extra.id}`} type="checkbox" disabled />
              <span>{extra.label}</span>
              <span className="ticket-print-modal__phase">Fase 2</span>
            </label>
          ))}
        </section>

        <footer className="ticket-print-modal__foot">
          {!protocol ? (
            <p className="ticket-print-modal__hint">Salve o ticket antes de gerar o extrato.</p>
          ) : null}
          {protocol && !anySelected ? (
            <p className="ticket-print-modal__hint">Marque ao menos um tipo de registro.</p>
          ) : null}
          {blocked ? (
            <p className="ticket-print-modal__hint" role="alert">
              O navegador bloqueou a nova aba. Permita pop-ups para o VeloDesk e clique em Imprimir de novo.
            </p>
          ) : null}
          <button type="button" className="ticket-print-modal__btn ticket-print-modal__btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="ticket-print-modal__btn ticket-print-modal__btn--primary"
            onClick={handlePrint}
            disabled={!anySelected || !protocol}
          >
            Imprimir
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
