/**
 * BulkActionPopover — monta e dispara ações (status, atribuir agente) aplicadas em
 * massa aos tickets selecionados na fila (checkboxes de mesclagem reaproveitados).
 * "Feito" chama PUT /tickets/:id pra cada ticket selecionado — mesmo endpoint genérico
 * usado pelo Desk pra salvar status/responsável de um ticket por vez.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { useNotifications } from '../../../context/NotificationContext';
import { ticketsApi } from '../../../api/client';
import { findTicketEntry } from '../../../services/ticketsStorage';
import { getTicketProtocolLabel } from '../../../services/desk/utils';

const ACTION_OPTIONS = [
  { value: 'status', label: 'Salvar o ticket com status' },
  { value: 'agente', label: 'Associar ticket a um agente' },
];

const STATUS_OPTIONS = [
  { value: 'novos', label: 'Novo' },
  { value: 'em-andamento', label: 'Em andamento' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'resolvidos', label: 'Resolvido' },
  { value: 'cancelado', label: 'Cancelado' },
];

const POPOVER_WIDTH = 280;
const VIEWPORT_MARGIN = 12;

function useAnchoredPosition(open, anchorRef) {
  const [style, setStyle] = useState(null);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return undefined;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Ancorar pelo left do botão deixa o popover vazar pra fora da tela quando o botão
      // está perto da borda direita — trava entre a margem e o espaço que realmente sobra.
      const maxLeft = window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, maxLeft));
      setStyle({
        position: 'fixed',
        top: `${rect.bottom + 6}px`,
        left: `${left}px`,
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  return style;
}

export default function BulkActionPopover({ open, onClose, anchorRef, selectedTicketIds, onApplied }) {
  const [actions, setActions] = useState([{ id: 1, type: '', value: '', done: false, failures: [] }]);
  const [applyingId, setApplyingId] = useState(null);
  const popRef = useRef(null);
  const style = useAnchoredPosition(open, anchorRef);
  const { agentOptions, loading: loadingAgents } = useDeskColaboradores();
  const { showNotification } = useNotifications();

  useEffect(() => {
    if (!open) {
      setActions([{ id: 1, type: '', value: '', done: false, failures: [] }]);
      setApplyingId(null);
      return undefined;
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose?.(); };
    const onClickOutside = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose?.();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !style) return null;

  const handleTypeChange = (id, type) => {
    setActions((prev) => prev.map((action) => (action.id === id ? { ...action, type, value: '' } : action)));
  };

  const handleValueChange = (id, value) => {
    setActions((prev) => prev.map((action) => (action.id === id ? { ...action, value } : action)));
  };

  const handleAddAction = () => {
    setActions((prev) => [
      ...prev,
      { id: (prev[prev.length - 1]?.id || 0) + 1, type: '', value: '', done: false, failures: [] },
    ]);
  };

  const secondOptionsFor = (type) => {
    if (type === 'status') return STATUS_OPTIONS;
    if (type === 'agente') return agentOptions.map((value) => ({ value, label: value }));
    return null;
  };

  const handleMarkDone = async (action) => {
    const ticketIds = Array.from(selectedTicketIds || []);
    if (!ticketIds.length) {
      showNotification('Selecione ao menos um ticket na fila antes de concluir a ação.', 'warning');
      return;
    }

    setApplyingId(action.id);
    try {
      const payload = action.type === 'status'
        ? { status: action.value }
        : { responsibleAgent: action.value };
      const results = await Promise.allSettled(
        ticketIds.map((id) => ticketsApi.update(id, payload)),
      );
      const failures = [];
      results.forEach((result, index) => {
        if (result.status !== 'rejected') return;
        const id = ticketIds[index];
        const ticket = findTicketEntry(id)?.ticket;
        failures.push({
          id,
          protocol: getTicketProtocolLabel(ticket) || `#${id}`,
          message: result.reason?.response?.data?.message || result.reason?.message || 'Falha desconhecida',
        });
      });
      const ok = results.length - failures.length;

      if (ok && !failures.length) {
        showNotification(`${ok} ticket(s) atualizado(s) com sucesso.`, 'success');
      } else if (ok && failures.length) {
        showNotification(`${ok} ticket(s) atualizado(s); ${failures.length} falharam.`, 'warning');
      } else {
        showNotification('Não foi possível aplicar a ação em nenhum ticket selecionado.', 'error');
      }

      setActions((prev) => prev.map((a) => (
        a.id === action.id ? { ...a, done: ok > 0, failures } : a
      )));
      if (ok) onApplied?.();
    } finally {
      setApplyingId(null);
    }
  };

  return createPortal(
    <div ref={popRef} className="bulk-action-popover" style={style} role="dialog" aria-label="Atuação em massa">
      {actions.map((action) => {
        const failuresBlock = action.failures?.length ? (
          <ul className="bulk-action-popover__failures" aria-label="Tickets que falharam">
            {action.failures.map((f) => (
              <li key={f.id}>
                <strong>#{f.protocol}</strong> — {f.message}
              </li>
            ))}
          </ul>
        ) : null;

        if (action.done) {
          const typeLabel = ACTION_OPTIONS.find((opt) => opt.value === action.type)?.label || '';
          const valueLabel = secondOptionsFor(action.type)?.find((opt) => opt.value === action.value)?.label || action.value;
          return (
            <div key={action.id} className="bulk-action-popover__group">
              <div className="bulk-action-popover__row bulk-action-popover__row--done">
                <i className="ti ti-check" aria-hidden="true" />
                <span>{typeLabel}: <strong>{valueLabel}</strong></span>
              </div>
              {failuresBlock}
            </div>
          );
        }

        const secondOptions = secondOptionsFor(action.type);
        const secondPlaceholder = action.type === 'agente' && loadingAgents
          ? 'Carregando agentes…'
          : action.type === 'status'
            ? 'Selecionar status'
            : action.type === 'agente'
              ? 'Selecionar agente'
              : '';
        const applying = applyingId === action.id;

        return (
          <div key={action.id} className="bulk-action-popover__group">
            <div className="bulk-action-popover__row">
              <select
                className="bulk-action-popover__select"
                value={action.type}
                disabled={applying}
                onChange={(e) => handleTypeChange(action.id, e.target.value)}
              >
                <option value="">Selecionar ação</option>
                {ACTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              {secondOptions ? (
                <select
                  className="bulk-action-popover__select"
                  value={action.value}
                  disabled={applying || (action.type === 'agente' && loadingAgents)}
                  onChange={(e) => handleValueChange(action.id, e.target.value)}
                >
                  <option value="">{secondPlaceholder}</option>
                  {secondOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : null}

              {action.type && action.value ? (
                <button
                  type="button"
                  className="bulk-action-popover__done"
                  disabled={applying}
                  onClick={() => handleMarkDone(action)}
                >
                  <i className={applying ? 'ti ti-loader-2 bulk-action-popover__spin' : 'ti ti-check'} aria-hidden="true" />
                  {applying ? 'Aplicando…' : 'Feito'}
                </button>
              ) : null}
            </div>
            {failuresBlock}
          </div>
        );
      })}
      <button type="button" className="bulk-action-popover__add" onClick={handleAddAction}>
        <i className="ti ti-circle-plus" aria-hidden="true" />
        Adicionar ação
      </button>
    </div>,
    document.body,
  );
}
