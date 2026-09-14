/**
 * DeskRightPanel v1.15.0 — CE: motivo do órgão para RA/Procon/Bacen/C.Gov
 * VERSION: v1.15.0 | DATE: 2026-08-21
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DEFAULT_TIPO, hasApplyableTabulation, isCasosEspeciaisCanal, isTabulationComplete, mergeRightFieldsWithDefaults, parseTabulationDisplay, resolveOrgaoMotivoCategoria, sanitizeResponsavel } from '../../../services/tabulationConfig';
import { useTabulation } from '../../../context/TabulationContext';
import { tabulationApi } from '../../../api/client';
import { DeskStatusCommitButton } from './DeskComposePanel';
import ProcessosPopover from './ProcessosPopover';
import { DESK_THERMOMETER_UI_ENABLED } from '../../../services/desk/constants';
import { isTicketInWorkflow, isTicketWorkflowActive } from '../../../services/desk/utils';
import { resolveComunicacaoResumo, ticketHasComunicacaoWorkflow } from '../../../services/workflow/workflowDecisionHandlers';
import { useDeskColaboradores } from '../../../hooks/useDeskColaboradores';
import { formatResponsavelForDisplay } from '../../../services/desk/responsavelDisplay';
import DeskRightPanelServiceStatus from './DeskRightPanelServiceStatus';

const CANAL_OPTIONS_FALLBACK = ['WhatsApp', 'Telefone', 'E-mail', 'Portal'];
const TIPO_OPTIONS_FALLBACK = ['Reclamação', 'Solicitação', 'Dúvida', 'Informação'];

function SelectField({ id, label, fieldKey, value, options, readonly, onFieldChange, showPlaceholder = false, optionItems = null }) {
  return (
    <div className="rp-field" key={id}>
      <label htmlFor={id}>{label}</label>
      {readonly ? (
        <input type="text" id={id} readOnly value={value || ''} />
      ) : (
        <select id={id} value={value || ''} onChange={(e) => onFieldChange(fieldKey, e.target.value)}>
          {showPlaceholder && <option value="">Selecionar</option>}
          {optionItems
            ? optionItems.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)
            : (options || []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
        </select>
      )}
    </div>
  );
}

export default function DeskRightPanel({
  ticket,
  client,
  queueId,
  rightFields,
  sendStatus,
  onFieldChange,
  onApplyTabulation,
  onAssumeTicket,
  assumingTicket = false,
  showAssumeTicket = false,
  onStartWorkflow,
  startingWorkflow = false,
  canStartWorkflow = false,
  canInitiateWorkflow = false,
  onReplyWorkflowRequest,
  replyWorkflowBusy = false,
  onCommitStatus,
  onOpenChat,
  onCloseChat,
  waChatOpen,
  sendDisabled = false,
  sendMenuDisabledReason = '',
  isSendStatusOptionDisabled = null,
  iaTabulationDisplay = '',
  iaTabulation = null,
  iaTabulationFonte = 'atendimento',
  iaTabulationLoading = false,
  iaWaitingMessage = '',
  iaHasSuggestion = false,
  iaHasTabulationSuggestion = false,
  iaShowSection = false,
  iaAuditScore = null,
  tabulationReadonly = false,
  ticketReadOnly = false,
}) {
  const { loading, config, getMotivos, getDetalhes, getProdutoNames, getTipoChamadoOptions, getCanalContatoOptions } = useTabulation();
  useDeskColaboradores();
  const [processosOpen, setProcessosOpen] = useState(false);

  const tipoOptions = getTipoChamadoOptions();
  const canalOptions = getCanalContatoOptions();

  const thermo = client?.termometro ?? 38;
  const thermoLabel = client?.termometroLabel || (thermo >= 55 ? 'Crítico' : thermo >= 45 ? 'Atenção' : 'Estável');
  const thermoColor = thermo >= 55 ? '#FCC200' : thermo >= 45 ? '#FCC200' : '#15A237';

  const produtoOptions = getProdutoNames();

  const effectiveRightFields = useMemo(
    () => mergeRightFieldsWithDefaults(rightFields, ticket, () => ''),
    [rightFields, ticket],
  );

  const responsavelDisplay = useMemo(() => {
    const raw = sanitizeResponsavel(rightFields.responsavel)
      || sanitizeResponsavel(ticket?.responsibleAgent)
      || sanitizeResponsavel(ticket?.lateralForm?.responsavel);
    return formatResponsavelForDisplay(raw);
  }, [rightFields.responsavel, ticket?.responsibleAgent, ticket?.lateralForm?.responsavel]);

  const canalValue = String(effectiveRightFields.canal || '').toLowerCase();
  const skipTreeMotivo = isCasosEspeciaisCanal(canalValue);
  const orgaoMotivoCategoria = resolveOrgaoMotivoCategoria(canalValue);
  const [orgaoMotivos, setOrgaoMotivos] = useState([]);

  useEffect(() => {
    if (!skipTreeMotivo || !orgaoMotivoCategoria) {
      setOrgaoMotivos([]);
      return undefined;
    }
    let cancelled = false;
    tabulationApi.getOpcoes(orgaoMotivoCategoria, false)
      .then((doc) => {
        if (cancelled) return;
        const list = (doc?.opcoes || [])
          .filter((item) => item.ativo !== false)
          .map((item) => item.valor)
          .filter(Boolean);
        setOrgaoMotivos(list);
      })
      .catch(() => {
        if (!cancelled) setOrgaoMotivos([]);
      });
    return () => { cancelled = true; };
  }, [skipTreeMotivo, orgaoMotivoCategoria]);

  const treeMotivoOptions = effectiveRightFields.produto ? getMotivos(effectiveRightFields.produto) : [];
  const motivoOptions = skipTreeMotivo ? orgaoMotivos : treeMotivoOptions;
  const detalheOptions = !skipTreeMotivo && effectiveRightFields.produto && effectiveRightFields.motivo
    ? getDetalhes(effectiveRightFields.produto, effectiveRightFields.motivo)
    : [];
  const showMotivo = skipTreeMotivo || (Boolean(effectiveRightFields.produto) && motivoOptions.length > 0);

  const tabulationComplete = isTabulationComplete(effectiveRightFields, config);
  const showIaTabulationPanel = !tabulationComplete && iaShowSection;

  const tabulationText = iaTabulationLoading
    ? (iaWaitingMessage || 'Gerando sugestão com base nos POPs…')
    : iaHasTabulationSuggestion
      ? (iaTabulationDisplay || 'Tabulação sugerida')
      : (iaWaitingMessage || 'Aguardando sugestão de tabulação…');

  const parsedTabulation = parseTabulationDisplay(iaTabulationDisplay);
  const canApplyTabulation = !iaTabulationLoading && (
    iaHasTabulationSuggestion
    || hasApplyableTabulation(iaTabulation)
    || hasApplyableTabulation(parsedTabulation)
  );
  const inWorkflow = isTicketWorkflowActive(ticket);
  const showThermoUi = DESK_THERMOMETER_UI_ENABLED;
  const showStartWorkflow = canStartWorkflow && canInitiateWorkflow && !isTicketWorkflowActive(ticket) && !ticketReadOnly;
  const showReplyWorkflow = inWorkflow && ticketHasComunicacaoWorkflow(ticket) && typeof onReplyWorkflowRequest === 'function';
  // Última mensagem enviada pelo time de workflow ("WF:") = ainda não respondida pelo agente responsável.
  const hasUnreadWorkflowMessage = showReplyWorkflow && resolveComunicacaoResumo(ticket)?.ultimaOrigem === 'workflow';

  return (
    <aside className="crm-right-panel" id="crmRightPanel">
      <div className="crm-right-panel__scroll">
        {showThermoUi ? (
        <section className="rp-section">
          <div className="rp-section__header">
            <div className="rp-section__label">Termômetro do cliente</div>
          </div>
          <div className="thermo-score" id="thermoScore" style={{ color: thermoColor }}>{thermo}</div>
          <div className="thermo-bar"><div className="thermo-fill" id="thermoFill" style={{ width: thermo + '%', background: thermoColor }} /></div>
          <div className="thermo-label" id="thermoLabel" style={{ color: thermoColor }}>{thermoLabel}</div>
        </section>
        ) : null}

        <section className="rp-section">
          <div className="rp-section__label">Classificação</div>
          {loading && (
            <p className="rp-field-hint">Carregando opções de tabulação…</p>
          )}
          <SelectField
            id="selCanal"
            label="Canal"
            fieldKey="canal"
            value={effectiveRightFields.canal}
            options={canalOptions.length ? canalOptions : CANAL_OPTIONS_FALLBACK}
            readonly={tabulationReadonly}
            onFieldChange={onFieldChange}
          />
          <SelectField
            id="selTipo"
            label="Tipo"
            fieldKey="tipo"
            value={effectiveRightFields.tipo || DEFAULT_TIPO}
            options={tipoOptions.length ? tipoOptions : TIPO_OPTIONS_FALLBACK}
            readonly={tabulationReadonly}
            onFieldChange={onFieldChange}
          />
          <SelectField
            id="selProduto"
            label="Produto"
            fieldKey="produto"
            value={effectiveRightFields.produto}
            options={produtoOptions}
            showPlaceholder
            readonly={tabulationReadonly}
            onFieldChange={onFieldChange}
          />
          {showMotivo ? (
            <SelectField
              id="selMotivo"
              label="Motivo"
              fieldKey="motivo"
              value={effectiveRightFields.motivo}
              options={
                effectiveRightFields.motivo && !motivoOptions.includes(effectiveRightFields.motivo)
                  ? [effectiveRightFields.motivo, ...motivoOptions]
                  : motivoOptions
              }
              showPlaceholder
              readonly={tabulationReadonly}
              onFieldChange={onFieldChange}
            />
          ) : null}
          {effectiveRightFields.motivo && detalheOptions.length > 0 && !skipTreeMotivo && (
            <SelectField
              id="selDetalhe"
              label="Detalhe"
              fieldKey="detalhe"
              value={effectiveRightFields.detalhe}
              options={detalheOptions}
              showPlaceholder
              readonly={tabulationReadonly}
              onFieldChange={onFieldChange}
            />
          )}
          <SelectField
            id="selResponsavel"
            label="Responsável"
            fieldKey="responsavel"
            value={responsavelDisplay}
            readonly
            onFieldChange={onFieldChange}
          />
          {showAssumeTicket ? (
            <button
              type="button"
              className="rp-assume-ticket-link"
              id="btnAssumeTicket"
              disabled={assumingTicket}
              onClick={onAssumeTicket}
            >
              {assumingTicket ? 'Assumindo…' : 'Assumir Ticket'}
            </button>
          ) : null}

          {showIaTabulationPanel ? (
            <div className={'ia-tabulation' + (iaTabulationLoading ? ' ia-tabulation--loading' : '')}>
              <div className="ia-tabulation__label">
                SUGESTÃO
                {iaTabulationFonte === 'auditoria' && iaHasTabulationSuggestion && !iaTabulationLoading && (
                  <span className="ia-tabulation__fonte"> · Tabulação (Auditoria)</span>
                )}
                {typeof iaAuditScore === 'number' && iaHasSuggestion && !iaTabulationLoading && (
                  <span className="ia-tabulation__compliance"> · Conformidade {iaAuditScore}%</span>
                )}
              </div>
              <div className="ia-tabulation__text" id="iaTabulationText">{tabulationText}</div>
              <div className="ia-tabulation__actions">
                <button
                  type="button"
                  className="ia-tabulation__btn ia-tabulation__btn--apply"
                  id="btnApplyTabulation"
                  disabled={!canApplyTabulation}
                  onClick={onApplyTabulation}
                >
                  Aplicar tabulação
                </button>
              </div>
            </div>
          ) : null}

          <div className="rp-tabulation-actions">
            <button
              type="button"
              className={'container-secondary rp-tabulation-actions__btn rp-tabulation-actions__btn--processos' + (processosOpen ? ' is-active' : '')}
              id="btnOpenProcessos"
              aria-expanded={processosOpen}
              aria-haspopup="dialog"
              aria-controls="processosDrawer"
              onClick={() => setProcessosOpen((open) => !open)}
            >
              Processos
            </button>
            {showStartWorkflow ? (
              <button
                type="button"
                className={'container-secondary rp-tabulation-actions__btn rp-tabulation-actions__btn--start-workflow' + (startingWorkflow ? ' is-active' : '')}
                id="btnStartWorkflow"
                disabled={startingWorkflow}
                onClick={onStartWorkflow}
              >
                {startingWorkflow ? 'Iniciando…' : 'Iniciar Workflow'}
              </button>
            ) : null}
            {showReplyWorkflow ? (
              <button
                type="button"
                className={
                  'container-secondary rp-tabulation-actions__btn rp-tabulation-actions__btn--reply-wf'
                  + (replyWorkflowBusy ? ' is-active' : '')
                  + (hasUnreadWorkflowMessage ? ' is-unread' : '')
                }
                id="btnReplyWorkflowRequest"
                disabled={replyWorkflowBusy}
                onClick={onReplyWorkflowRequest}
              >
                {hasUnreadWorkflowMessage ? (
                  <span className="rp-tabulation-actions__unread-dot" aria-hidden="true" />
                ) : null}
                Responder Solicitação
                {hasUnreadWorkflowMessage ? (
                  <span className="sr-only"> (nova mensagem do workflow aguardando resposta)</span>
                ) : null}
              </button>
            ) : null}
          </div>
          <ProcessosPopover
            open={processosOpen}
            onClose={() => setProcessosOpen(false)}
            tabulacaoProduto={effectiveRightFields.produto}
            tabulacaoMotivo={effectiveRightFields.motivo}
          />
        </section>

        <DeskRightPanelServiceStatus />
      </div>
      <div className="crm-right-panel__footer">
        <button
          type="button"
          className={'rp-footer-btn rp-footer-btn--secondary' + (waChatOpen ? ' is-active' : '')}
          id="btnOpenChat"
          onClick={waChatOpen ? onCloseChat : onOpenChat}
          disabled={ticketReadOnly && !waChatOpen}
          title={ticketReadOnly && !waChatOpen ? 'Ticket fechado — conversa somente leitura' : undefined}
        >
          <i className="ti ti-message-circle" />
          {waChatOpen ? 'Fechar conversa' : 'Abrir conversa'}
        </button>
        <DeskStatusCommitButton
          sendStatus={sendStatus}
          onCommitStatus={onCommitStatus}
          variant="panel"
          disabled={sendDisabled || ticketReadOnly}
          menuDisabledReason={sendMenuDisabledReason}
          isOptionDisabled={isSendStatusOptionDisabled}
        />
      </div>
    </aside>
  );
}
