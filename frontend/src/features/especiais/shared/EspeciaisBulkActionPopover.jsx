/**
 * EspeciaisBulkActionPopover — versão do BulkActionPopover do Desk (src/features/desk/
 * components/BulkActionPopover.jsx) pros 4 canais de casos especiais (Reclame Aqui, Bacen,
 * Procon, Consumidor.Gov). Não reaproveita o componente do Desk porque os itens selecionados
 * aqui são documentos de `chamados_reclamacoes` (reclamacoesApi.patch), não tickets de
 * `chamados` (ticketsApi.update) — coleções e endpoints diferentes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { useNotifications } from '../../../context/NotificationContext';
import { reclamacoesApi } from '../../../api/client';
import { CHANNEL_CONFIG } from './especiaisTicketCommitService';
import { RA_STATUS_LABELS } from '../../../services/especiais/reclameAquiData';
import { BC_STATUS_LABELS } from '../../../services/especiais/bacenData';
import { PC_STATUS_LABELS } from '../../../services/especiais/proconData';
import { CG_STATUS_LABELS } from '../../../services/especiais/consumidorGovData';

const STATUS_LABELS_BY_CHANNEL = {
  ra: RA_STATUS_LABELS,
  bc: BC_STATUS_LABELS,
  pc: PC_STATUS_LABELS,
  gov: CG_STATUS_LABELS,
};

const ACTION_OPTIONS = [
  { value: 'status', label: 'Salvar o item com status' },
  { value: 'agente', label: 'Associar item a um agente' },
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

function itemLabel(item, id) {
  if (!item) return `#${id}`;
  const protocolo = item.protocoloRa || item.protocoloBc || item.protocoloPc || item.protocoloGov
    || item.idReclamacaoRa || item.idDemanda || '';
  const nome = item.consumidor || item.demandante || '';
  if (nome && protocolo) return `${nome} (${protocolo})`;
  return nome || protocolo || `#${id}`;
}

export default function EspeciaisBulkActionPopover({ open, onClose, anchorRef, channelId, selectedIds, items, onApplied }) {
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

  const config = CHANNEL_CONFIG[channelId] || CHANNEL_CONFIG.ra;
  const statusLabels = STATUS_LABELS_BY_CHANNEL[channelId] || RA_STATUS_LABELS;
  const statusOptions = Object.entries(statusLabels).map(([value, label]) => ({ value, label }));

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
    if (type === 'status') return statusOptions;
    if (type === 'agente') return agentOptions.map((value) => ({ value, label: value }));
    return null;
  };

  const handleMarkDone = async (action) => {
    const ids = Array.from(selectedIds || []);
    if (!ids.length) {
      showNotification('Selecione ao menos um item na tabela antes de concluir a ação.', 'warning');
      return;
    }

    setApplyingId(action.id);
    try {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const original = (items || []).find((it) => String(it.id) === String(id));
          const payload = action.type === 'status'
            ? { statusCanal: action.value }
            : { responsavel: action.value };
          const persisted = await reclamacoesApi.patch(config.orgao, id, payload);
          if (original) {
            const patch = action.type === 'status'
              ? { [config.statusField]: action.value }
              : { responsavel: action.value };
            config.patchItem({ ...original, ...(persisted || {}), ...patch });
          }
          return id;
        }),
      );
      const failures = [];
      results.forEach((result, index) => {
        if (result.status !== 'rejected') return;
        const id = ids[index];
        const original = (items || []).find((it) => String(it.id) === String(id));
        failures.push({
          id,
          label: itemLabel(original, id),
          message: result.reason?.response?.data?.message || result.reason?.message || 'Falha desconhecida',
        });
      });
      const ok = results.length - failures.length;

      if (ok && !failures.length) {
        showNotification(`${ok} item(ns) atualizado(s) com sucesso.`, 'success');
      } else if (ok && failures.length) {
        showNotification(`${ok} item(ns) atualizado(s); ${failures.length} falharam.`, 'warning');
      } else {
        showNotification('Não foi possível aplicar a ação em nenhum item selecionado.', 'error');
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
          <ul className="bulk-action-popover__failures" aria-label="Itens que falharam">
            {action.failures.map((f) => (
              <li key={f.id}>
                <strong>{f.label}</strong> — {f.message}
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
