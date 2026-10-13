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
import { usePermissions } from '../../../context/PermissionContext';
import { useTabulation } from '../../../context/TabulationContext';
import { getAgentName } from '../../../services/clientDb';
import { ticketsApi } from '../../../api/client';
import { findTicketEntry } from '../../../services/ticketsStorage';
import { getTicketProtocolLabel, getTicketResponsible, isRealTicketId } from '../../../services/desk/utils';

// Mesmo limite do backend (permission.service.ts: MIN_NIVEL_ATRIBUIR_A_OUTROS) — nível de
// "Suporte" em Central de configurações → Funções e Permissões. Isso é só pra não oferecer
// uma opção que o backend vai recusar; a trava de verdade é lá.
const MIN_NIVEL_ATRIBUIR_A_OUTROS = 3;

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

const EMPTY_ACTION = { type: '', value: '', tipo: '', produto: '', motivo: '', detalhe: '', done: false, failures: [] };

/**
 * Resolvido em massa exige tabulação completa (tipo/produto/motivo/detalhe) igual ao resolver
 * um ticket por vez — sem isto o backend (assertTabulacaoForStatus) rejeita cada ticket com
 * "Preencha a tabulação", e a Ação em massa só reportava a falha depois de já ter tentado
 * salvar. "Tipo" fica de fora do produto/motivo/detalhe porque não é hierárquico — é escolhido
 * direto da lista de tipos de chamado (ver getTipoChamadoOptions).
 */
function resolveTabulacaoState(action, getMotivos, getDetalhes) {
  const tipoOk = Boolean(action.tipo);
  const produtoOk = Boolean(action.produto);
  const motivoOptions = produtoOk ? getMotivos(action.produto) : [];
  const motivoOk = motivoOptions.length === 0 || Boolean(action.motivo);
  const detalheOptions = produtoOk && action.motivo ? getDetalhes(action.produto, action.motivo) : [];
  const detalheOk = detalheOptions.length === 0 || Boolean(action.detalhe);
  return {
    motivoOptions,
    detalheOptions,
    complete: tipoOk && produtoOk && motivoOk && detalheOk,
  };
}

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
  const [actions, setActions] = useState([{ id: 1, ...EMPTY_ACTION }]);
  const [applyingId, setApplyingId] = useState(null);
  const popRef = useRef(null);
  const style = useAnchoredPosition(open, anchorRef);
  const { agentOptions, loading: loadingAgents } = useDeskColaboradores();
  const { showNotification } = useNotifications();
  const { permissions } = usePermissions();
  const { getProdutoNames, getMotivos, getDetalhes, getTipoChamadoOptions } = useTabulation();
  const produtoOptions = getProdutoNames();
  const tipoOptions = getTipoChamadoOptions();
  // Enquanto as permissões ainda não carregaram, assume o nível mais baixo (falha fechado —
  // não oferece "atribuir a outro agente" antes de saber se a pessoa realmente pode).
  const canAssignToOthers = (permissions?.nivel ?? 0) >= MIN_NIVEL_ATRIBUIR_A_OUTROS;
  const ownAgentName = getAgentName();
  const realSelectedIds = Array.from(selectedTicketIds || []).filter(isRealTicketId);

  // "Salvar o ticket com status" em massa só pode mexer em ticket já atribuído a quem está
  // fazendo a ação — ninguém finaliza/move o status de ticket de outra pessoa por aqui. Ticket
  // sem responsável real não entra nessa trava (pode ser assumido normalmente). Mesmo corte de
  // nível da outra trava (canAssignToOthers): Suporte/Gestão não é limitado a si mesmo.
  const normalizeNome = (v) => String(v || '').trim().toLowerCase();
  const ticketsDeOutroResponsavel = canAssignToOthers ? [] : realSelectedIds
    .map((id) => ({ id, ticket: findTicketEntry(id)?.ticket }))
    .filter(({ ticket }) => {
      const resp = getTicketResponsible(ticket);
      return resp !== '—' && normalizeNome(resp) !== normalizeNome(ownAgentName);
    })
    .map(({ id, ticket }) => ({
      id,
      protocol: getTicketProtocolLabel(ticket) || `#${id}`,
      responsavel: getTicketResponsible(ticket),
    }));

  useEffect(() => {
    if (!open) {
      setActions([{ id: 1, ...EMPTY_ACTION }]);
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
    setActions((prev) => prev.map((action) => (
      action.id === id ? { ...action, type, value: '', tipo: '', produto: '', motivo: '', detalhe: '' } : action
    )));
  };

  const handleValueChange = (id, value) => {
    setActions((prev) => prev.map((action) => (
      action.id === id ? { ...action, value, produto: '', motivo: '', detalhe: '' } : action
    )));
  };

  const handleTabulacaoFieldChange = (id, field, value) => {
    setActions((prev) => prev.map((action) => {
      if (action.id !== id) return action;
      if (field === 'tipo') return { ...action, tipo: value };
      if (field === 'produto') return { ...action, produto: value, motivo: '', detalhe: '' };
      if (field === 'motivo') return { ...action, motivo: value, detalhe: '' };
      return { ...action, detalhe: value };
    }));
  };

  const handleAddAction = () => {
    setActions((prev) => [
      ...prev,
      { id: (prev[prev.length - 1]?.id || 0) + 1, ...EMPTY_ACTION },
    ]);
  };

  const secondOptionsFor = (type) => {
    if (type === 'status') return STATUS_OPTIONS;
    if (type === 'agente') {
      // Atendimento (nível < Suporte) só pode atribuir em massa pra si mesmo — a lista fica
      // restrita ao próprio nome. Gestão/Suporte continuam vendo todo mundo.
      if (!canAssignToOthers) {
        return ownAgentName ? [{ value: ownAgentName, label: ownAgentName }] : [];
      }
      return agentOptions.map((value) => ({ value, label: value }));
    }
    return null;
  };

  const handleMarkDone = async (action) => {
    const selecionados = Array.from(selectedTicketIds || []);
    // Checkbox já vem desabilitado pra rascunho/Legado Octa (ver DeskTicketList/DeskMyTicketsTable),
    // mas filtra de novo aqui — defesa extra contra qualquer outra origem de seleção.
    const ticketIds = selecionados.filter(isRealTicketId);
    const ignorados = selecionados.length - ticketIds.length;
    if (!ticketIds.length) {
      showNotification('Selecione ao menos um ticket na fila antes de concluir a ação.', 'warning');
      return;
    }
    if (ignorados > 0) {
      showNotification(
        `${ignorados} item(ns) selecionado(s) não é/são ticket(s) do Desk e foi/foram ignorado(s).`,
        'warning',
      );
    }

    setApplyingId(action.id);
    try {
      const payload = action.type === 'status'
        ? {
          status: action.value,
          ...(action.value === 'resolvidos' ? {
            lateralForm: {
              tipoChamado: action.tipo,
              produto: action.produto,
              ...(action.motivo ? { motivo: action.motivo } : {}),
              ...(action.detalhe ? { detalhe: action.detalhe } : {}),
            },
          } : {}),
        }
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
        // Agrupa por mensagem — vários tickets falhando pelo mesmo motivo viram uma linha só
        // ("#A, #B, #C — motivo"), em vez de repetir o motivo inteiro por ticket.
        const failureGroups = [];
        (action.failures || []).forEach((f) => {
          const grupo = failureGroups.find((g) => g.message === f.message);
          if (grupo) grupo.protocols.push(f.protocol);
          else failureGroups.push({ message: f.message, protocols: [f.protocol] });
        });
        const failuresBlock = failureGroups.length ? (
          <ul className="bulk-action-popover__failures" aria-label="Tickets que falharam">
            {failureGroups.map((g) => (
              <li key={g.message}>
                <strong>{g.protocols.map((p) => `#${p}`).join(', ')}</strong> — {g.message}
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
        const isResolvendo = action.type === 'status' && action.value === 'resolvidos';
        const tabState = isResolvendo ? resolveTabulacaoState(action, getMotivos, getDetalhes) : null;
        const bloqueadoPorOutroResponsavel = action.type === 'status' && ticketsDeOutroResponsavel.length > 0;
        const canFinish = action.type && action.value && (!isResolvendo || tabState.complete);

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

              {isResolvendo ? (
                <div className="bulk-action-popover__tabulacao">
                  <span className="bulk-action-popover__tab-hint">
                    Tabulação aplicada a todos os tickets selecionados:
                  </span>
                  <select
                    className="bulk-action-popover__select"
                    value={action.tipo}
                    disabled={applying}
                    onChange={(e) => handleTabulacaoFieldChange(action.id, 'tipo', e.target.value)}
                  >
                    <option value="">Selecionar tipo</option>
                    {tipoOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>

                  <select
                    className="bulk-action-popover__select"
                    value={action.produto}
                    disabled={applying}
                    onChange={(e) => handleTabulacaoFieldChange(action.id, 'produto', e.target.value)}
                  >
                    <option value="">Selecionar produto</option>
                    {produtoOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>

                  {action.produto && tabState.motivoOptions.length > 0 ? (
                    <select
                      className="bulk-action-popover__select"
                      value={action.motivo}
                      disabled={applying}
                      onChange={(e) => handleTabulacaoFieldChange(action.id, 'motivo', e.target.value)}
                    >
                      <option value="">Selecionar motivo</option>
                      {tabState.motivoOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : null}

                  {action.motivo && tabState.detalheOptions.length > 0 ? (
                    <select
                      className="bulk-action-popover__select"
                      value={action.detalhe}
                      disabled={applying}
                      onChange={(e) => handleTabulacaoFieldChange(action.id, 'detalhe', e.target.value)}
                    >
                      <option value="">Selecionar detalhe</option>
                      {tabState.detalheOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              ) : null}

              {canFinish ? (
                <button
                  type="button"
                  className={'bulk-action-popover__done' + (bloqueadoPorOutroResponsavel ? ' bulk-action-popover__done--blocked' : '')}
                  disabled={applying}
                  aria-disabled={bloqueadoPorOutroResponsavel}
                  onClick={() => {
                    if (bloqueadoPorOutroResponsavel) {
                      showNotification('Você só pode salvar status de tickets atribuídos a você.', 'error');
                      return;
                    }
                    handleMarkDone(action);
                  }}
                >
                  <i className={applying ? 'ti ti-loader-2 bulk-action-popover__spin' : 'ti ti-check'} aria-hidden="true" />
                  {applying ? 'Aplicando…' : 'Feito'}
                </button>
              ) : null}
              {bloqueadoPorOutroResponsavel ? (
                <ul className="bulk-action-popover__failures" aria-label="Tickets que não são seus" role="alert">
                  <li>
                    <strong>{ticketsDeOutroResponsavel.map((t) => `#${t.protocol}`).join(', ')}</strong> — não é/são seu(s); só é possível salvar status de tickets atribuídos a você.
                  </li>
                </ul>
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
