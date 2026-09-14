/**
 * Desk CRM — raiz 5 colunas (layout referência)
 * VERSION: v3.44.2 | DATE: 2026-08-31
 * — handleCommitWithStatus/handleSendInternalNote: try/finally cobre toda a função,
 *   sem gap entre travar o lock (commitInProgressRef/sendInternalNoteInProgressRef) e o try;
 *   exceção antes do try deixava o lock preso pra sempre (todos os canais de envio) sem erro visível.
 * — handleCommitWithStatus (ticket não-rascunho): append otimista da mensagem pública em
 *   `prepared.messages` antes do patchTicket, para a thread local já refletir o agente como
 *   último remetente e suprimir a sugestão IA sem esperar o reload assíncrono do ticket.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  filterTickets,
  resolveDeskSearchEntries,
  resolveDeskSearchEntriesAsync,
  pickNextTicketFromEntries,
  resolveDeskWorkingEntries,
  countByQueue,
  getEntryTicketId,
  isDeskTableQueue,
  isMeusTicketsQueue,
  buildRegistroThread,
  buildWhatsAppConvMsgs,
  collapseWhatsAppThreadToBalloon,
  getWhatsAppDeskUiState,
  normalizeTicketForDeskV2,
  getAgentName,
  applySendStatus,
  normalizeCpf,
  isValidEmailFormat,
  isValidCpfDigits,
  getTicketProtocolLabel,
  isTicketInWorkflow,
  isTicketWorkflowActive,
  injectWorkflowSystemMessage,
  getWorkflowProgress,
  syncTicketWorkflowOnCommit,
  getTicketStatusBadgeMeta,
  isTicketReadOnly,
  isTerminalTicketStatusValue,
  getDeskSearchNotFoundMessage,
  getDeskSearchSuccessMessage,
  isFusaoAbsorvido,
  isClientIdentifiedForWorkflow,
  getTicketCpfDigits,
  toWhatsAppChatIdDigits,
} from '../../services/desk/utils';
import { fundirTickets } from '../../services/desk/ticketFusaoService';
import {
  applyPendingWorkflowStartToTicket,
  discardPendingWorkflowStart,
  flushPendingWorkflowOnSave,
  hasPendingWorkflowPersist,
  mergeApiTicketPreservingPendingWorkflow,
  resolveTicketSnapshotForWorkflowFlush,
} from '../../services/desk/pendingWorkflowStart';
import { wrapComposerOpeningForTicket } from '../../services/desk/clientMessageEnvelope';
import { subscribeToTicketEvents } from '../../services/desk/ticketEventsRealtime';
import {
  findTicketEntry,
  commitTicketViaApi,
  updateTicketInCache,
  loadTicketDetailFromApi,
  sendWhatsAppMessageViaApi,
  sendInternalNote,
  appendInternalNoteToCachedTicket,
} from '../../services/ticketsStorage';
import {
  isDraftTicket,
  persistDraftTicket,
  claimTicketResponsavelViaApi,
  setMergeProtectedTicketIds,
  discardDraftTicketFromCache,
} from '../../services/ticketsCache';
import { apiTicketToCockpit, cockpitTicketToApi } from '../../api/adapters/ticketAdapter';
import { lookupClient, upsertClientFromContact } from '../../services/clientDb';
import { clientsApi, colaboradoresApi, ticketsApi } from '../../api/client';
import { persistClienteContact, applyClienteDocToTicket, mapClienteDocToContact } from '../../api/adapters/clienteAdapter';
import {
  approveWorkflowDecision,
  rejectWorkflowDecision,
  requestWorkflowInfo,
} from '../../services/workflow/workflowDecisionHandlers';
import { useTickets } from '../../context/TicketsContext';
import { useNotifications } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { usePermissionsOptional } from '../../context/PermissionContext';
import {
  canAdvanceWorkflowStep,
  canActOnTicket,
  canInterruptWorkflow,
  canSendInternalNoteOnTicket,
  canSendPublicMessageOnTicket,
  hasPermission,
} from '../../services/permissions/permissionService';
import { ticketAssignedToCurrentAgent, readTicketResponsavel } from '../../services/desk/responsavelSegmentation';
import { getAllQueueStatuses, fetchAndHydrateCustomQueues } from '../../services/desk/customQueueBoxes';
import { refreshQueueCountsFromApi } from '../../services/desk/queueCounts';
import deskLog from '../../utils/deskDebugLog';
import CreateTicketPanel from './components/CreateTicketPanel';
import DeskQueuePanel from './components/DeskQueuePanel';
import DeskTicketList from './components/DeskTicketList';
import DeskResolvedTicketTable from './components/DeskResolvedTicketTable';
import DeskMyTicketsTable from './components/DeskMyTicketsTable';
import DeskTicketTabsBar from './components/DeskTicketTabsBar';
import DeskClientProfileBar from './components/DeskClientProfileBar';
import DeskTicketErrorBoundary from './components/DeskTicketErrorBoundary';
import ClientTicketHistoryModal from './components/ClientTicketHistoryModal';
import TicketFusaoStatusControls from './components/TicketFusaoStatusControls';
import DeskConversation from './components/DeskConversation';
import TicketWorkflowInfoRequestCallout from './components/TicketWorkflowInfoRequestCallout';
import { markWorkflowInfoRequestsReadForTicket, resolveWorkflowInfoRequest } from '../../services/workflow/workflowInfoNotifications';
import DeskWhatsAppChat from './components/DeskWhatsAppChat';
import DeskComposePanel from './components/DeskComposePanel';
import DeskInternalNotesPanel from './components/DeskInternalNotesPanel';
import DeskEventsPanel from './components/DeskEventsPanel';
import DeskConsultasPanel from './components/DeskConsultasPanel';
import DeskRightPanel from './components/DeskRightPanel';
import { applyCascadeFieldChange, applyTabulationSuggestion, buildDefaultRightFields, getMotivos, hasApplyableTabulation, isCasosEspeciaisCanal, isTabulationComplete, mergeRightFieldsWithDefaults, parseTabulationDisplay, sanitizeResponsavel, validateTabulationForSendStatus } from '../../services/tabulationConfig';
import { useTabulation } from '../../context/TabulationContext';
import { useWorkflowConfig } from '../../context/WorkflowConfigContext';
import { htmlToPlainText, htmlHasComposeContent, normalizeComposePlain } from '../../services/desk/composeRichEditor';
import { useTicketAiSuggestions } from '../../hooks/useTicketAiSuggestions';
import DeskAiRevisionModal from './components/DeskAiRevisionModal';
import { resolveAutomaticaConfig } from '../config/workflow/workflowConfigData';
import { resolveWorkflowForTicket } from '../../services/desk/workflowEngine';
import { getRuntimeWorkflows } from '../../services/desk/workflowRuntimeStore';
import { resolveRequisicaoCamposVisiveis } from '../../services/workflow/workflowRequisicao';
import { getAutoCloseOnSave } from '../../services/desk/agentDeskPreferences';
import { parseDeskQueueFromUrl, parseDeskMyTicketsSectionFromUrl, COMPOSE_AI_REVIEW_REQUIRED, getSendStatusOptions } from '../../services/desk/constants';
import { shouldViewAllDeskTickets } from '../../services/desk/responsavelSegmentation';
import { resolveSendCommitMenuState, isComposePublicReviewSatisfied } from '../../services/desk/sendCommitGates';
import { useProfile } from '../../context/ProfileContext';
import ProdutosForwardPopover from './components/ProdutosForwardPopover';
import WorkflowComunicacaoModal from '../workflow/components/WorkflowComunicacaoModal';
import { replyWorkflowComunicacao } from '../../services/workflow/workflowDecisionHandlers';
import deskPlatformTrace, { createPlatformTraceCounter } from '../../utils/deskPlatformTrace';
import { hasPublicThreadChanged, hasWhatsAppThreadChanged, hasPersistedInternalNotesChanged, buildPublicThreadFingerprint } from '../../services/desk/ticketThreadSync';
import { hasAtendimentoFuncao } from '../../services/desk/atuacaoVision';
import { attachmentScanStatusesChanged, ticketHasPendingAttachmentScan } from '../../services/desk/attachmentPreview';

/** Respostas de cliente chegam por e-mail a qualquer momento: a thread se atualiza sozinha */
const AUTO_REFRESH_DETAIL_MS = 15000;
const AUTO_REFRESH_ATTACHMENT_SCAN_MS = 3000;
const AUTO_REFRESH_WA_WAIT_MS = 5000;
const AUTO_REFRESH_WA_CHAT_MS = 3000;
const AUTO_REFRESH_QUEUES_MS = 60000;

const WORKFLOW_REQUIRES_CLIENT_MESSAGE = 'Identifique o cliente (CPF válido) antes de iniciar o workflow.';

function ticketNeedsDetailLoad(ticket) {
  if (!ticket) return true;
  if (ticket.listOnly === true) return true;
  // Detalhe já veio da API — mesmo sem mensagens (ticket novo / só status).
  // Recarregar nesse caso incrementava refreshKey em loop e brancava a tela.
  if (ticket._detailLoaded) return false;
  return true;
}

/**
 * Mescla a resposta LEVE do polling (view=light) sobre o ticket completo já carregado:
 * atualiza apenas as threads/histórico/status e PRESERVA os campos ricos do painel
 * (cadastro, workflow, Reclame Aqui/Procon, lateralForm, workflow pendente…), que a resposta
 * leve não recomputa. Spread de `prev` primeiro garante a preservação inclusive do pending workflow.
 */
function mergeThreadField(prevArr, lightArr) {
  const prevLen = prevArr?.length || 0;
  const lightLen = lightArr?.length || 0;
  if (lightLen > prevLen) return lightArr;
  if (lightLen === prevLen && lightLen > 0 && attachmentScanStatusesChanged(prevArr, lightArr)) {
    return lightArr;
  }
  if (prevLen > 0) return prevArr;
  return lightArr ?? prevArr;
}

function mergeLightWorkflow(prevWf, lightWf, prevTicket) {
  if (prevTicket?.workflow?.pendingPersist || prevTicket?._pendingWorkflowStart) {
    return prevWf;
  }
  if (!lightWf) return prevWf;
  if (!prevWf) return lightWf;
  return {
    ...prevWf,
    ...lightWf,
    requisicao: lightWf.requisicao || prevWf.requisicao,
  };
}

function ticketStatusWorkflowFingerprint(ticket) {
  const wf = ticket?.workflow || {};
  return [
    String(ticket?.status || ''),
    wf.active ? '1' : '0',
    String(wf.workflowStatus || ''),
    String(wf.step ?? ''),
    String(wf.completedAt || ''),
  ].join('|');
}

function mergeLightThreadIntoTicket(prev, light) {
  if (!light) return prev;
  return {
    ...prev,
    messages: mergeThreadField(prev.messages, light.messages),
    internalNotes: mergeThreadField(prev.internalNotes, light.internalNotes),
    registroHistorico: mergeThreadField(prev.registroHistorico, light.registroHistorico),
    status: light.status ?? prev.status,
    updatedAt: light.updatedAt ?? prev.updatedAt,
    queueEntryAt: light.queueEntryAt ?? prev.queueEntryAt,
    workflow: mergeLightWorkflow(prev.workflow, light.workflow, prev),
    _detailLoaded: true,
    listOnly: false,
  };
}

const agentDebugMsgCount = createPlatformTraceCounter();

function applyRightFieldsToTicket(t, rightFields) {
  const prevLf = t.lateralForm || {};
  const tipo = String(
    rightFields.tipo || prevLf.classificacaoTipo || prevLf.tipoChamado || 'Solicitação'
  ).trim() || 'Solicitação';
  const responsavel = sanitizeResponsavel(rightFields.responsavel)
    || sanitizeResponsavel(prevLf.responsavel);
  t.lateralForm = {
    ...prevLf,
    classificacaoTipo: tipo,
    tipoChamado: tipo,
    produto: rightFields.produto || prevLf.produto,
    motivo: rightFields.motivo || prevLf.motivo,
    detalhe: rightFields.detalhe || prevLf.detalhe,
    canal: rightFields.canal || prevLf.canal,
    responsavel,
    workflow: prevLf.workflow,
  };
  t.responsibleAgent = responsavel;
  t.channel = rightFields.canal;
  t.updatedAt = new Date().toISOString();
  return t;
}

function buildDefaultSessionFromTicket(ticket, config) {
  const lf = ticket.lateralForm || {};
  return {
    mainTab: 'conversa',
    composeMode: 'public',
    composeText: '',
    internalText: '',
    composeAttachments: [],
    composeReviewedPlain: '',
    sendStatus: 'em-andamento',
    rightFields: buildDefaultRightFields(config, ticket, getAgentName),
    waChatOpen: false,
  };
}

export default function DeskV2Root() {
  const {
    refreshKey,
    refreshTickets,
    refreshTicketsSilent,
    loading: ticketsLoading,
    openTabs,
    activeTabId,
    openTicket,
    closeTicketTab,
    replaceOpenTabId,
    setActiveTabId,
    patchTicket,
  } = useTickets();
  const { showNotification } = useNotifications();
  const { user } = useAuth();
  const { profileId } = useProfile();
  const permsCtx = usePermissionsOptional();
  const { config } = useTabulation();
  const { workflows: runtimeWorkflows } = useWorkflowConfig();
  const [searchParams, setSearchParams] = useSearchParams();

  const detailLoadRef = useRef(null);
  const [activeQueue, setActiveQueue] = useState(() => parseDeskQueueFromUrl(searchParams.get('queue')));
  const activeQueueRef = useRef(activeQueue);
  activeQueueRef.current = activeQueue;
  const lastUrlQueueRef = useRef(String(searchParams.get('queue') || '').trim());
  const [activeSort, setActiveSort] = useState('data');
  const [entrySortOldestFirst, setEntrySortOldestFirst] = useState(false);
  const [searchDraft, setSearchDraft] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [queueCollapsed, setQueueCollapsed] = useState(() => localStorage.getItem('velodeskCrmQueueCollapsed') === '1');
  const [listCollapsed, setListCollapsed] = useState(() => localStorage.getItem('velodeskCrmTicketListCollapsed') === '1');
  const [createOpen, setCreateOpen] = useState(false);
  const [mainTab, setMainTab] = useState('conversa');
  const [composeMode, setComposeMode] = useState('public');
  const [composeText, setComposeText] = useState('');
  const [internalText, setInternalText] = useState('');
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [composeReviewedPlain, setComposeReviewedPlain] = useState('');
  const [sendStatus, setSendStatus] = useState('em-andamento');
  const [rightFields, setRightFields] = useState({});
  const [waChatOpen, setWaChatOpen] = useState(false);
  // Ref para o ciclo de polling ler o estado atual sem reiniciar o efeito
  const waChatOpenRef = useRef(false);
  waChatOpenRef.current = waChatOpen;
  const [historyOpen, setHistoryOpen] = useState(false);
  const contactHydrateRef = useRef(new Set());
  const [hydratedClientByCpf, setHydratedClientByCpf] = useState({});
  const [mergeInProgress, setMergeInProgress] = useState(false);
  const [ticketCacheEpoch, setTicketCacheEpoch] = useState(0);
  const bumpTicketCacheView = useCallback(() => {
    setTicketCacheEpoch((value) => value + 1);
  }, []);
  const [aiRevisionOpen, setAiRevisionOpen] = useState(false);
  const [aiRevisionSubmitting, setAiRevisionSubmitting] = useState(false);
  const [queueStatuses, setQueueStatuses] = useState(() => getAllQueueStatuses());
  const suppressAutoSelectRef = useRef(true);
  const pendingAdvanceTicketIdRef = useRef(null);
  const [tableQueueBrowsing, setTableQueueBrowsing] = useState(false);
  const tabSessionsRef = useRef({});
  const prevActiveTabIdRef = useRef(null);
  const [colaboradorAtuacao, setColaboradorAtuacao] = useState([]);
  const [advancingWorkflow, setAdvancingWorkflow] = useState(false);
  const [cancelingWorkflow, setCancelingWorkflow] = useState(false);
  const [decidingWorkflow, setDecidingWorkflow] = useState(false);
  const [startingWorkflow, setStartingWorkflow] = useState(false);
  const [assumingTicket, setAssumingTicket] = useState(false);
  const [workflowStartModalOpen, setWorkflowStartModalOpen] = useState(false);
  const [comunicacaoModalOpen, setComunicacaoModalOpen] = useState(false);
  const [comunicacaoBusy, setComunicacaoBusy] = useState(false);
  const [workflowStartTemplate, setWorkflowStartTemplate] = useState(null);
  const pendingWorkflowTemplateRef = useRef(null);
  const commitInProgressRef = useRef(false);
  const sendInternalNoteInProgressRef = useRef(false);
  const waSendInProgressRef = useRef(false);
  const [waSendInProgress, setWaSendInProgress] = useState(false);
  const [sendInternalNoteBusy, setSendInternalNoteBusy] = useState(false);
  const openedTicketFromUrlRef = useRef(null);

  const syncUrlTicketParam = useCallback((ticketId) => {
    const id = ticketId ? String(ticketId).trim() : '';
    const queueId = activeQueueRef.current;
    lastUrlQueueRef.current = queueId;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('queue', queueId);
      if (id) next.set('ticket', id);
      else next.delete('ticket');
      return next;
    }, { replace: true });
    openedTicketFromUrlRef.current = id || null;
  }, [setSearchParams]);

  useEffect(() => {
    const fromUrl = String(searchParams.get('queue') || '').trim();
    if (!fromUrl) return;
    // Só reaplica fila quando ?queue= mudou — não quando só ?ticket= foi atualizado.
    if (fromUrl === lastUrlQueueRef.current) return;
    lastUrlQueueRef.current = fromUrl;
    const queue = parseDeskQueueFromUrl(fromUrl);
    suppressAutoSelectRef.current = true;
    setActiveQueue((current) => (current === queue ? current : queue));
    activeQueueRef.current = queue;
    // Só entra em modo lista quando a fila veio da URL sem ticket aberto.
    const ticketFromUrl = String(searchParams.get('ticket') || '').trim();
    if (!ticketFromUrl) {
      setTableQueueBrowsing(isDeskTableQueue(queue));
    }
  }, [searchParams]);

  useEffect(() => {
    const ticketId = String(searchParams.get('ticket') || '').trim();
    if (!ticketId) {
      openedTicketFromUrlRef.current = null;
      return undefined;
    }
    if (openedTicketFromUrlRef.current === ticketId) {
      return undefined;
    }

    let cancelled = false;
    (async () => {
      let entry = findTicketEntry(ticketId);
      if (!entry) {
        try {
          await loadTicketDetailFromApi(ticketId);
          entry = findTicketEntry(ticketId);
        } catch {
          if (!cancelled) {
            showNotification('Não foi possível abrir o ticket — recarregue a lista.', 'warning');
            setTableQueueBrowsing(isDeskTableQueue(activeQueueRef.current));
          }
          return;
        }
      }
      if (cancelled) return;
      if (!entry) {
        showNotification('Não foi possível abrir o ticket — recarregue a lista.', 'warning');
        setTableQueueBrowsing(isDeskTableQueue(activeQueueRef.current));
        return;
      }
      openedTicketFromUrlRef.current = ticketId;
      suppressAutoSelectRef.current = true;
      setTableQueueBrowsing(false);
      openTicket(ticketId);
    })();

    return () => { cancelled = true; };
  }, [searchParams, refreshKey, openTicket, showNotification]);

  useEffect(() => {
    if (!user?.email) {
      setColaboradorAtuacao([]);
      return undefined;
    }
    let cancelled = false;
    colaboradoresApi.byEmail(user.email)
      .then((data) => {
        if (!cancelled) setColaboradorAtuacao(data?.atuacao || []);
      })
      .catch(() => {
        if (!cancelled) setColaboradorAtuacao([]);
      });
    return () => { cancelled = true; };
  }, [user?.email]);

  const syncTicketViews = useCallback(async () => {
    await Promise.all([
      refreshTickets().catch(() => {}),
      refreshQueueCountsFromApi(user?.email).catch(() => {}),
    ]);
    await fetchAndHydrateCustomQueues().catch(() => {});
    setQueueStatuses(getAllQueueStatuses());
  }, [refreshTickets, user?.email]);

  const reload = useCallback(async () => {
    try {
      await syncTicketViews();
      showNotification('Tickets atualizados.', 'success');
    } catch {
      showNotification('Não foi possível atualizar os tickets.', 'error');
    }
  }, [syncTicketViews, showNotification]);

  const entries = resolveDeskWorkingEntries(activeQueue, appliedSearch, activeSort, entrySortOldestFirst);
  const isTableQueueView = isDeskTableQueue(activeQueue);
  const isResolvedQueue = activeQueue === 'resolvidos';
  const isMyTicketsQueue = isMeusTicketsQueue(activeQueue);
  const myTicketsExpandedSection = parseDeskMyTicketsSectionFromUrl(searchParams.get('section'));
  const entry = useMemo(() => {
    void ticketCacheEpoch;
    return activeTabId ? findTicketEntry(activeTabId) : null;
  }, [activeTabId, ticketCacheEpoch, refreshKey]);
  const ticket = entry?.ticket;
  const ticketReadOnly = isTicketReadOnly(ticket);
  const ticketStatus = getTicketStatusBadgeMeta(ticket, entry?.queueId || 'em-andamento');
  const ticketCpfDigits = ticket
    ? (getTicketCpfDigits(ticket) || normalizeCpf(ticket.lateralForm?.cpf || ticket.clientCPF))
    : '';
  const client = useMemo(() => {
    if (!ticket) return null;
    const fromHydrate = ticketCpfDigits ? hydratedClientByCpf[ticketCpfDigits] : null;
    if (fromHydrate) return fromHydrate;
    return lookupClient(ticketCpfDigits);
  }, [ticket, ticketCpfDigits, hydratedClientByCpf]);

  const persistTabSession = useCallback((ticketId) => {
    if (!ticketId) return;
    tabSessionsRef.current[String(ticketId)] = {
      mainTab,
      composeMode,
      composeText,
      internalText,
      composeAttachments,
      composeReviewedPlain,
      sendStatus,
      rightFields,
      waChatOpen,
    };
  }, [mainTab, composeMode, composeText, internalText, composeAttachments, composeReviewedPlain, sendStatus, rightFields, waChatOpen]);

  const persistComposeDraft = useCallback((patch) => {
    if (!activeTabId) return;
    const sessionKey = String(activeTabId);
    const session = tabSessionsRef.current[sessionKey] || {};
    tabSessionsRef.current[sessionKey] = { ...session, ...patch };
  }, [activeTabId]);

  const handleComposeTextChange = useCallback((html) => {
    setComposeText(html);
    persistComposeDraft({ composeText: html });
  }, [persistComposeDraft]);

  const handleComposeReviewed = useCallback((value) => {
    const plain = normalizeComposePlain(value);
    setComposeReviewedPlain(plain);
    persistComposeDraft({ composeReviewedPlain: plain });
  }, [persistComposeDraft]);

  const handleInternalTextChange = useCallback((html) => {
    setInternalText(html);
    persistComposeDraft({ internalText: html });
  }, [persistComposeDraft]);

  const handleComposeAttachmentsChange = useCallback((next) => {
    const items = Array.isArray(next) ? next : [];
    setComposeAttachments(items);
    persistComposeDraft({ composeAttachments: items });
  }, [persistComposeDraft]);

  const handleComposeModeChange = useCallback((mode) => {
    setComposeMode(mode);
    persistComposeDraft({ composeMode: mode });
  }, [persistComposeDraft]);

  const discardDraftTabIfNeeded = useCallback((ticketId) => {
    const id = String(ticketId || '').trim();
    if (!id) return;
    const ticketEntry = findTicketEntry(id);
    if (ticketEntry?.ticket && isDraftTicket(ticketEntry.ticket)) {
      discardDraftTicketFromCache(id, user?.email || '');
      void refreshTicketsSilent?.().catch(() => {});
    }
    delete tabSessionsRef.current[id];
  }, [user?.email, refreshTicketsSilent]);

  const restoreTabSession = useCallback((ticketId) => {
    const ticketEntry = findTicketEntry(ticketId);
    if (!ticketEntry) return;
    const t = ticketEntry.ticket;
    normalizeTicketForDeskV2(t);
    const defaults = buildDefaultSessionFromTicket(t, config);
    const saved = tabSessionsRef.current[String(ticketId)];
    const session = saved || defaults;
    const nextRightFields = mergeRightFieldsWithDefaults(
      saved?.rightFields ?? defaults.rightFields,
      t,
      getAgentName,
    );
    setMainTab(session.mainTab ?? defaults.mainTab);
    setComposeMode(session.composeMode ?? defaults.composeMode);
    setComposeText(session.composeText ?? defaults.composeText);
    setInternalText(session.internalText ?? defaults.internalText);
    setComposeAttachments(Array.isArray(session.composeAttachments) ? session.composeAttachments : defaults.composeAttachments);
    setComposeReviewedPlain(session.composeReviewedPlain ?? defaults.composeReviewedPlain ?? '');
    setSendStatus(session.sendStatus ?? defaults.sendStatus);
    setRightFields(nextRightFields);
    setWaChatOpen(session.waChatOpen ?? defaults.waChatOpen);
  }, [config]);

  const mergedRightFieldsForSend = useMemo(
    () => (ticket ? mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName) : rightFields),
    [rightFields, ticket],
  );
  const sendStatusOptionsForMenu = useMemo(() => {
    if (shouldViewAllDeskTickets(profileId)) return getSendStatusOptions('gestao');
    return getSendStatusOptions(profileId);
  }, [profileId]);
  const hasCanceladoSendOption = useMemo(
    () => sendStatusOptionsForMenu.some((opt) => opt.id === 'cancelado'),
    [sendStatusOptionsForMenu],
  );

  useEffect(() => {
    let cancelled = false;
    void fetchAndHydrateCustomQueues().then(() => {
      if (!cancelled) setQueueStatuses(getAllQueueStatuses());
    });
    return () => { cancelled = true; };
  }, [user?.email]);

  useEffect(() => {
    const openCreate = () => setCreateOpen(true);
    const closeCreate = () => setCreateOpen(false);
    const onRefreshTickets = () => { reload(); };
    const onWorkflowInfoChanged = () => { syncTicketViews(); };
    window.addEventListener('velodesk:quick-register', openCreate);
    window.addEventListener('velodesk:quick-register-close', closeCreate);
    window.addEventListener('velodesk:refresh-tickets', onRefreshTickets);
    window.addEventListener('velodesk:workflow-info-changed', onWorkflowInfoChanged);
    return () => {
      window.removeEventListener('velodesk:quick-register', openCreate);
      window.removeEventListener('velodesk:quick-register-close', closeCreate);
      window.removeEventListener('velodesk:refresh-tickets', onRefreshTickets);
      window.removeEventListener('velodesk:workflow-info-changed', onWorkflowInfoChanged);
    };
  }, [reload, syncTicketViews]);

  useEffect(() => {
    if (!ticket) return;
    markWorkflowInfoRequestsReadForTicket(ticket);
  }, [ticket?.id]);

  useEffect(() => {
    if (!activeTabId || isDraftTicket({ id: activeTabId })) {
      return undefined;
    }
    const entry = findTicketEntry(activeTabId);
    const current = entry?.ticket;
    if (!ticketNeedsDetailLoad(current)) {
      return undefined;
    }

    let cancelled = false;
    const ticketId = String(activeTabId);
    detailLoadRef.current = ticketId;

    loadTicketDetailFromApi(ticketId)
      .then((full) => {
        if (cancelled || detailLoadRef.current !== ticketId) return;
        const entry = findTicketEntry(ticketId);
        const merged = entry?.ticket
          ? mergeApiTicketPreservingPendingWorkflow(entry.ticket, full)
          : full;
        patchTicket(ticketId, merged);
        // Ticket aberto já com sessão WhatsApp ativa (cliente respondeu há menos de 24h): abre o
        // painel certo de cara, senão o agente compõe no compose de e-mail sem perceber que a
        // conversa é WhatsApp (mesmo risco do ticket 2609080001, agora na carga inicial).
        if (!waChatOpenRef.current && getWhatsAppDeskUiState(merged)?.composeEnabled) {
          setWaChatOpen(true);
        }
      })
      .catch(() => {
        if (!cancelled && detailLoadRef.current === ticketId) {
          showNotification('Não foi possível carregar o ticket completo.', 'warning');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTabId, patchTicket, showNotification]);

  // Hidratação do cadastro (b2c_cadastros) + painel superior — nunca PUT/claim no ticket.
  // Sempre roda (1 vez por ticket+CPF): cria/enriquece contato quando faltar e-mail/telefone,
  // e SEMPRE reconsulta produtosContratados (mesmo com contato já completo) para o badge
  // do painel superior refletir a contratação mais recente do cliente.
  useEffect(() => {
    if (!ticket) return undefined;

    const ticketId = String(ticket.id || ticket._id || '');
    if (!ticketId) return undefined;

    const cpf = normalizeCpf(
      ticket.lateralForm?.clienteCpf || ticket.lateralForm?.cpf || ticket.clientCPF,
    );
    if (!isValidCpfDigits(cpf)) return undefined;

    const dedupeKey = `${ticketId}:${cpf}`;
    if (contactHydrateRef.current.has(dedupeKey)) return undefined;

    let cancelled = false;
    contactHydrateRef.current.add(dedupeKey);

    const applyCadastroToPanel = (clienteDoc) => {
      if (cancelled || !clienteDoc) return null;
      const contact = mapClienteDocToContact(clienteDoc);
      if (!contact) return null;
      const panelClient = upsertClientFromContact(contact);
      setHydratedClientByCpf((prev) => ({
        ...prev,
        [cpf]: panelClient || contact,
      }));
      return contact;
    };

    (async () => {
      try {
        const localDoc = await clientsApi.getByCpf(cpf, { hydrateFromApi: 0 });
        applyCadastroToPanel(localDoc);
        if (cancelled) return;

        const enrichedDoc = await clientsApi.getByCpf(cpf, { hydrateFromApi: 1 });
        applyCadastroToPanel(enrichedDoc);
      } catch {
        /* 404 ou API indisponível — painel permanece como está; ticket intacto */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    ticket?.id,
    ticket?.clienteId,
    ticket?.clientCPF,
    ticket?.clientEmail,
    ticket?.clientPhone,
    ticket?.lateralForm?.clienteCpf,
    ticket?.lateralForm?.cpf,
    ticket?.lateralForm?.clienteEmail,
    ticket?.lateralForm?.clienteTelefone,
  ]);

  // Ticket aberto: recarrega o detalhe em ciclo curto para trazer resposta do cliente sem ação do agente
  useEffect(() => {
    if (!activeTabId || isDraftTicket({ id: activeTabId })) {
      return undefined;
    }

    const ticketId = String(activeTabId);
    let cancelled = false;
    let inFlight = false;
    let requestSeq = 0;

    const syncDetail = async () => {
      if (cancelled || inFlight) return;
      if (document.hidden) return;
      if (commitInProgressRef.current) return;
      inFlight = true;
      const seq = ++requestSeq;
      try {
        // O poll só cuida das threads: o detalhe completo (cadastro/workflow) é carregado uma vez
        // pelo efeito de detalhe. Enquanto não houver detalhe, deixa aquele efeito assumir.
        const preTicket = findTicketEntry(ticketId)?.ticket;
        if (!preTicket || ticketNeedsDetailLoad(preTicket)) return;

        const raw = await ticketsApi.getLight(ticketId);
        if (cancelled || seq !== requestSeq) return;
        const light = apiTicketToCockpit(raw);
        if (!light?.id && !light?._id) return;

        const prevEntry = findTicketEntry(ticketId);
        const prevTicket = prevEntry?.ticket;
        // Estado pode ter mudado durante a requisição; se perdeu o detalhe, não sobrescreve.
        if (!prevTicket || ticketNeedsDetailLoad(prevTicket)) return;

        const merged = mergeLightThreadIntoTicket(prevTicket, light);
        const threadChanged = hasPublicThreadChanged(prevTicket, merged);
        const waThreadChanged = hasWhatsAppThreadChanged(prevTicket, merged);
        const internalNotesChanged = hasPersistedInternalNotesChanged(prevTicket, merged);
        const attachmentScanChanged = attachmentScanStatusesChanged(prevTicket?.messages, merged?.messages)
          || attachmentScanStatusesChanged(prevTicket?.internalNotes, merged?.internalNotes);
        const statusOrWorkflowChanged = ticketStatusWorkflowFingerprint(prevTicket)
          !== ticketStatusWorkflowFingerprint(merged);

        if (threadChanged || waThreadChanged || internalNotesChanged) {
          const msgs = merged?.messages?.length ?? 0;
          const prevMsgs = prevTicket?.messages?.length;
          const last = merged?.messages?.[msgs - 1];
          deskPlatformTrace('auto-refresh', 'poll:msgs-mudou', {
            ticketId,
            de: prevMsgs ?? null,
            para: msgs,
            ultimaOrigem: last?.origin || last?.sender || null,
            waThreadChanged,
            patch: !cancelled && !commitInProgressRef.current,
          });
        }

        if (
          !cancelled
          && seq === requestSeq
          && !commitInProgressRef.current
          && (threadChanged || waThreadChanged || internalNotesChanged || statusOrWorkflowChanged || attachmentScanChanged)
        ) {
          patchTicket(ticketId, merged);
          // Cliente respondeu por WhatsApp com o compose padrão (e-mail) em tela: sem isso, o
          // agente compõe/usa sugestão no painel errado e o envio sai como e-mail em vez de
          // WhatsApp (o texto some no compose de e-mail, sem aviso — ver ticket 2609080001).
          if (waThreadChanged && !waChatOpenRef.current) {
            setWaChatOpen(true);
          }
        }
      } catch (err) {
        deskPlatformTrace('auto-refresh', 'poll:erro', { ticketId, message: String(err?.message || err) }, 'warn');
        /* rede instável não deve interromper o atendimento */
      } finally {
        inFlight = false;
      }
    };

    const resolvePollIntervalMs = () => {
      const current = findTicketEntry(ticketId)?.ticket;
      if (!current) return AUTO_REFRESH_DETAIL_MS;
      if (ticketHasPendingAttachmentScan(current)) return AUTO_REFRESH_ATTACHMENT_SCAN_MS;
      // Conversa WhatsApp em tela: ciclo mais curto para diálogo em tempo quase real
      if (waChatOpenRef.current) return AUTO_REFRESH_WA_CHAT_MS;
      const waState = getWhatsAppDeskUiState(current);
      if (waState?.awaitingClient || waState?.needsInitial) return AUTO_REFRESH_WA_WAIT_MS;
      // Sessão 24h aberta: cliente pode responder a qualquer momento
      if (waState?.mode === 'session') return AUTO_REFRESH_WA_WAIT_MS;
      return AUTO_REFRESH_DETAIL_MS;
    };

    void syncDetail();

    let timer = null;
    const schedulePoll = () => {
      timer = window.setTimeout(() => {
        void syncDetail().finally(() => {
          if (!cancelled) schedulePoll();
        });
      }, resolvePollIntervalMs());
    };
    schedulePoll();

    const onVisibilityChange = () => {
      if (!document.hidden) void syncDetail();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Realtime (opcional): ao receber um "ping" do ticket aberto, antecipa o refresh leve.
    // O timer acima segue como fallback confiável mesmo sem Realtime configurado.
    const unsubscribeTicketEvents = subscribeToTicketEvents((payload) => {
      if (cancelled) return;
      if (String(payload?.ticketId || '') !== ticketId) return;
      void syncDetail();
    });

    return () => {
      cancelled = true;
      requestSeq += 1;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribeTicketEvents();
    };
  }, [activeTabId, patchTicket]);

  // Abas abertas ficam protegidas contra wipe do GET /boxes durante refresh silencioso de filas.
  useEffect(() => {
    const ids = openTabs.map((tab) => tab.id).filter(Boolean);
    if (activeTabId && !ids.includes(activeTabId)) ids.push(activeTabId);
    setMergeProtectedTicketIds(ids);
  }, [openTabs, activeTabId]);

  // Ticket aberto na aba mas ausente das colunas (ex.: refresh de filas) — reidrata sem fechar a aba.
  useEffect(() => {
    if (!activeTabId || isDraftTicket({ id: activeTabId })) return undefined;
    if (findTicketEntry(activeTabId)) return undefined;

    let cancelled = false;
    void loadTicketDetailFromApi(activeTabId)
      .then((loaded) => {
        if (cancelled || !loaded) return;
        patchTicket(activeTabId, loaded);
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [activeTabId, refreshKey, patchTicket]);

  // Filas: ciclo longo e silencioso para novos tickets aparecerem sem recarregar a página
  useEffect(() => {
    let inFlight = false;

    const syncQueues = async () => {
      if (inFlight || document.hidden || commitInProgressRef.current) return;
      inFlight = true;
      try {
        await refreshTicketsSilent();
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(syncQueues, AUTO_REFRESH_QUEUES_MS);
    return () => window.clearInterval(timer);
  }, [refreshTicketsSilent]);

  useEffect(() => {
    if (pendingAdvanceTicketIdRef.current) return;
    if (tableQueueBrowsing) return;
    if (suppressAutoSelectRef.current && !activeTabId) return;
    if (openTabs.length === 0) return;
      if (activeTabId && findTicketEntry(activeTabId)) return;
      const last = openTabs[openTabs.length - 1];
      if (last) setActiveTabId(last.id);
  }, [activeTabId, refreshKey, entries.length, openTabs, setActiveTabId, tableQueueBrowsing]);

  useEffect(() => {
    const onGlobalTabClose = (event) => {
      const id = event?.detail?.id;
      if (!id) return;
      discardDraftTabIfNeeded(id);
    };
    window.addEventListener('velodesk:desk-tab-close', onGlobalTabClose);
    return () => window.removeEventListener('velodesk:desk-tab-close', onGlobalTabClose);
  }, [discardDraftTabIfNeeded]);

  useEffect(() => {
    if (!activeTabId) {
      prevActiveTabIdRef.current = null;
      return;
    }
    if (String(prevActiveTabIdRef.current) === String(activeTabId)) return;
    prevActiveTabIdRef.current = activeTabId;
    restoreTabSession(activeTabId);
  }, [activeTabId, restoreTabSession]);

  useEffect(() => {
    if (!activeTabId || !config?.produtos?.length) return;
    const entry = findTicketEntry(activeTabId);
    if (!entry) return;
    const lf = entry.ticket?.lateralForm || {};
    setRightFields((prev) => {
      if (!(lf.produto || '').trim()) {
        const defaults = buildDefaultRightFields(config, entry.ticket, getAgentName);
        const hasLocalTabulation = Boolean(prev.produto || prev.motivo || prev.detalhe);
        if (hasLocalTabulation) {
          return mergeRightFieldsWithDefaults(prev, entry.ticket, getAgentName);
        }
        if (
          prev.responsavel === defaults.responsavel
          && prev.canal === defaults.canal
          && prev.tipo === defaults.tipo
          && !prev.produto
          && !prev.motivo
          && !prev.detalhe
        ) {
          return prev;
        }
        return defaults;
      }
      const canal = prev.canal || lf.canal || entry.ticket?.channel || '';
      // CE: motivo vem da lista do órgão — não resetar se não estiver na árvore POP
      if (isCasosEspeciaisCanal(canal)) {
        return mergeRightFieldsWithDefaults(prev, entry.ticket, getAgentName);
      }
      if (prev.produto === lf.produto && getMotivos(config, prev.produto).includes(prev.motivo || '')) {
        return mergeRightFieldsWithDefaults(prev, entry.ticket, getAgentName);
      }
      return buildDefaultRightFields(config, entry.ticket, getAgentName);
    });
  }, [config, activeTabId]);

  const openMergedChildTicket = useCallback(async (childId) => {
    const id = String(childId || '').trim();
    if (!id) return;
    suppressAutoSelectRef.current = true;
    setTableQueueBrowsing(false);
    persistTabSession(activeTabId);
    let entry = findTicketEntry(id);
    if (!entry) {
      try {
        await loadTicketDetailFromApi(id);
        entry = findTicketEntry(id);
      } catch {
        showNotification('Não foi possível abrir o ticket mesclado.', 'warning');
        return;
      }
    }
    if (!entry) {
      showNotification('Não foi possível abrir o ticket mesclado.', 'warning');
      return;
    }
    syncUrlTicketParam(id);
    openTicket(id);
  }, [activeTabId, openTicket, persistTabSession, showNotification, syncUrlTicketParam]);

  const selectTicket = (id) => {
    deskLog.action('ticket → abrir', { ticketId: id, fila: activeQueueRef.current });
    suppressAutoSelectRef.current = true;
    setTableQueueBrowsing(false);
    persistTabSession(activeTabId);
    let entry = findTicketEntry(id);
    if (!entry) {
      void (async () => {
        try {
          await loadTicketDetailFromApi(id);
          entry = findTicketEntry(id);
          if (!entry) {
            showNotification('Não foi possível abrir o ticket — recarregue a lista.', 'warning');
            return;
          }
          selectTicket(id);
        } catch {
          showNotification('Não foi possível abrir o ticket — recarregue a lista.', 'warning');
        }
      })();
      return;
    }
    if (isFusaoAbsorvido(entry.ticket)) {
      const parentId = entry.ticket?.fusao?.parentId;
      if (parentId) {
        showNotification('Ticket mesclado — abrindo o chamado ativo.', 'info');
        const parentEntry = findTicketEntry(parentId);
        if (parentEntry) {
          syncUrlTicketParam(parentId);
          openTicket(parentId);
          return;
        }
        (async () => {
          try {
            await loadTicketDetailFromApi(parentId);
            syncUrlTicketParam(parentId);
            openTicket(parentId);
          } catch {
            showNotification('Não foi possível abrir o ticket ativo da mesclagem.', 'warning');
          }
        })();
        return;
      }
      showNotification('Este ticket foi mesclado e não está mais disponível na fila.', 'warning');
      return;
    }
    syncUrlTicketParam(id);
    openTicket(id);
  };

  const activateTicketTab = (id) => {
    if (String(id) === String(activeTabId)) return;
    setTableQueueBrowsing(false);
    persistTabSession(activeTabId);
    syncUrlTicketParam(id);
    setActiveTabId(id);
  };

  const closeTicketTabHandler = (id) => {
    if (String(id) === String(activeTabId)) {
      persistTabSession(activeTabId);
    }
    discardDraftTabIfNeeded(id);
    const isLastTab = openTabs.length === 1 && String(openTabs[0].id) === String(id);
    if (isLastTab) suppressAutoSelectRef.current = true;
    const remaining = openTabs.filter((tab) => String(tab.id) !== String(id));
    const nextActive = String(activeTabId) === String(id)
      ? (remaining.length ? remaining[remaining.length - 1].id : null)
      : activeTabId;
    closeTicketTab(id);
    syncUrlTicketParam(nextActive);
    if (remaining.length === 0 && isDeskTableQueue(activeQueue)) {
      setTableQueueBrowsing(true);
    }
  };

  const handleFundirTickets = useCallback(async ({ activeId, inactiveIds, cpf }) => {
    if (!activeId || mergeInProgress) return;
    setMergeInProgress(true);
    try {
      await fundirTickets({ activeId, inactiveIds, cpf });
      await syncTicketViews();
      setHistoryOpen(false);
      selectTicket(activeId);
      setMainTab('notas');
      (inactiveIds || []).forEach((id) => {
        if (openTabs.some((tab) => String(tab.id) === String(id))) {
          closeTicketTabHandler(id);
        }
      });
      showNotification('Mesclagem registrada com sucesso.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível mesclar os tickets.';
      showNotification(msg, 'error');
      throw err;
    } finally {
      setMergeInProgress(false);
    }
  }, [
    mergeInProgress,
    syncTicketViews,
    selectTicket,
    openTabs,
    closeTicketTabHandler,
    showNotification,
  ]);

  const advanceAfterSaveIfEnabled = useCallback((savedTicketId, plannedNextId, listAnchorId = savedTicketId, force = false) => {
    if ((!force && !getAutoCloseOnSave()) || !savedTicketId) return;

    let nextId = plannedNextId;
    if (!nextId) {
      const freshList = resolveDeskWorkingEntries(activeQueue, appliedSearch, activeSort, entrySortOldestFirst);
      nextId = pickNextTicketFromEntries(listAnchorId, freshList);
    }

    if (String(savedTicketId) === String(activeTabId)) {
      persistTabSession(activeTabId);
    }
    delete tabSessionsRef.current[String(savedTicketId)];

    const willOpenNext = nextId && String(nextId) !== String(savedTicketId);
    suppressAutoSelectRef.current = !willOpenNext;
    closeTicketTab(savedTicketId);
    syncUrlTicketParam(willOpenNext ? nextId : null);

    if (!willOpenNext) return;

    pendingAdvanceTicketIdRef.current = String(nextId);
    suppressAutoSelectRef.current = false;
    queueMicrotask(() => {
      setTableQueueBrowsing(false);
      openTicket(nextId);
      pendingAdvanceTicketIdRef.current = null;
    });
  }, [activeQueue, appliedSearch, activeSort, entrySortOldestFirst, openTicket, closeTicketTab, activeTabId, persistTabSession, syncUrlTicketParam]);

  const selectMainTab = (tab) => {
    persistTabSession(activeTabId);
    setMainTab(tab);
  };

  const selectQueue = (queueId) => {
    deskLog.action('fila → trocada', { de: activeQueueRef.current, para: queueId });
    suppressAutoSelectRef.current = true;
    setActiveQueue(queueId);
    activeQueueRef.current = queueId;
    lastUrlQueueRef.current = queueId;
    setSearchDraft('');
    setAppliedSearch('');
    localStorage.setItem('velodeskCrmTicketListCollapsed', '0');
    setListCollapsed(false);
    setTableQueueBrowsing(isDeskTableQueue(queueId));
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('queue', queueId);
      if (isDeskTableQueue(queueId)) {
        next.delete('ticket');
      }
      return next;
    }, { replace: true });
  };

  const handleSearchChange = useCallback((value) => {
    const next = String(value ?? '');
    setSearchDraft(next);
    const trimmed = next.trim();
    setAppliedSearch(trimmed);
    if (trimmed) {
      setTableQueueBrowsing(false);
    }
  }, []);

  const handleSearchSubmit = async () => {
    const q = searchDraft.trim();
    setAppliedSearch(q);

    if (!q) {
      showNotification('Busca limpa. Exibindo fila atual.', 'info');
      return;
    }

    let results = resolveDeskSearchEntries(q, activeSort, entrySortOldestFirst);
    if (!results.length) {
      try {
        results = await resolveDeskSearchEntriesAsync(q, activeSort, entrySortOldestFirst);
      } catch {
        results = [];
      }
    }
    if (!results.length) {
      showNotification(getDeskSearchNotFoundMessage(q), 'warning');
      return;
    }

    suppressAutoSelectRef.current = false;
    setTableQueueBrowsing(false);
    persistTabSession(activeTabId);
    openTicket(results[0].ticket.id);

    showNotification(getDeskSearchSuccessMessage(q, results.length), 'success');
  };

  const handleQueueCollapse = (collapsed) => {
    localStorage.setItem('velodeskCrmQueueCollapsed', collapsed ? '1' : '0');
    setQueueCollapsed(collapsed);
  };

  const handleListCollapse = (collapsed) => {
    localStorage.setItem('velodeskCrmTicketListCollapsed', collapsed ? '1' : '0');
    setListCollapsed(collapsed);
  };

  const handleCommitWithStatus = async (statusId) => {
    if (!ticket || !entry || commitInProgressRef.current) return null;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return null;
    }
    commitInProgressRef.current = true;
    let commitRollbackTicket = null;
    // status é lido no catch (log/rollback) — precisa viver fora do try para não virar
    // ReferenceError ali (const dentro do try não é visível no catch).
    let status;
    // Tudo a partir daqui roda dentro do try/catch/finally abaixo — qualquer exceção
    // (validação, montagem de payload, etc.) precisa exibir erro e liberar commitInProgressRef,
    // senão o envio trava silenciosamente em todos os canais (público, nota interna, WhatsApp
    // compartilham esse mesmo lock).
    try {
    status = statusId || sendStatus;
    const savedListTicketId = getEntryTicketId(entry);
    const workingListBeforeSave = resolveDeskWorkingEntries(activeQueue, appliedSearch, activeSort, entrySortOldestFirst);
    const plannedNextId = getAutoCloseOnSave()
      ? pickNextTicketFromEntries(savedListTicketId, workingListBeforeSave)
      : null;
    const messageHtml = String(composeText || '').trim();
    const internalNoteHtml = String(internalText || '').trim();
    const messageText = htmlToPlainText(messageHtml).trim();
    const attachmentUrls = (composeAttachments || [])
      .map((item) => String(item?.url || '').trim())
      .filter(Boolean);
    const hasPublicPayload = Boolean(messageText || attachmentUrls.length);
    const hasInternalPayload = htmlHasComposeContent(internalNoteHtml);
    const messagePayload = messageHtml || '';
    const internalNotePayload = internalNoteHtml || '';

    const deskPerms = permsCtx?.permissions;
    if (hasPublicPayload && !canSendPublicMessageOnTicket(ticket, deskPerms)) {
      showNotification('Sem permissão para enviar mensagem pública neste ticket.', 'warning');
      commitInProgressRef.current = false;
      return null;
    }
    if (hasInternalPayload && !canSendInternalNoteOnTicket(ticket, deskPerms)) {
      showNotification('Sem permissão para comentar neste ticket.', 'warning');
      commitInProgressRef.current = false;
      return null;
    }
    if (!hasPublicPayload && !hasInternalPayload && !canSendPublicMessageOnTicket(ticket, deskPerms)) {
      showNotification('Sem permissão para alterar tabulação ou status deste ticket.', 'warning');
      commitInProgressRef.current = false;
      return null;
    }

    const mergedFieldsForCommit = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    const sendStatusOptionsForGate = shouldViewAllDeskTickets(profileId)
      ? getSendStatusOptions('gestao')
      : getSendStatusOptions(profileId);
    const hasCanceladoOption = sendStatusOptionsForGate.some((opt) => opt.id === 'cancelado');
    const canceladoBypass = status === 'cancelado' && hasCanceladoOption;

    const tabulationCheck = validateTabulationForSendStatus(status, mergedFieldsForCommit, config);
    if (!tabulationCheck.ok && !canceladoBypass) {
      deskLog.warn('AÇÃO', 'commit → bloqueado (tabulação)', {
        ticketId: ticket.id,
        status,
        message: tabulationCheck.message,
      });
      showNotification(tabulationCheck.message, 'warning');
      commitInProgressRef.current = false;
      return null;
    }

    if (messageText) {
      if (
        COMPOSE_AI_REVIEW_REQUIRED
        && !canceladoBypass
        && !isComposePublicReviewSatisfied({
          composeHtml: messageHtml,
          composeReviewedPlain,
          iaRespostaSugerida: ticketAi.respostaSugerida,
          ticket,
          agentName: getAgentName(),
        })
      ) {
        setComposeMode('public');
        showNotification('Use o Revisor de Texto antes de enviar a resposta pública.', 'warning');
        commitInProgressRef.current = false;
        return null;
      }
    }

    deskLog.action('commit → início', {
      ticketId: ticket.id,
      status,
      hasPublic: hasPublicPayload,
      hasInternal: hasInternalPayload,
      attachments: attachmentUrls.length,
    });

      if (isDraftTicket(ticket)) {
        const draftId = String(ticket.id);
        const session = tabSessionsRef.current[draftId];
        let prepared = applyRightFieldsToTicket(
          { ...ticket },
          mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName),
        );
        syncTicketWorkflowOnCommit(prepared);
        applySendStatus({ ticket: prepared, boxId: entry.boxId }, status);
        const regKey = Date.now();
        const ts = new Date().toISOString();
        const author = getAgentName();
        if (hasPublicPayload) {
          if (!prepared.messages) prepared.messages = [];
          prepared.messages.push({
            id: `${regKey}-pub`,
            type: 'agent',
            fromClient: false,
            origin: 'agente',
            text: messagePayload,
            attachments: attachmentUrls,
            timestamp: ts,
            author,
          });
        }
        if (hasInternalPayload) {
          if (!prepared.internalNotes) prepared.internalNotes = [];
          prepared.internalNotes.push({
            id: `${regKey}-int`,
            type: 'internal',
            origin: 'agente',
            text: internalNotePayload,
            timestamp: ts,
            author,
          });
        }
        const persisted = await persistDraftTicket(prepared, {
          author: getAgentName(),
        });
        const newId = persisted.id || persisted._id;
        const draftFlushTicket = hasPendingWorkflowPersist(prepared)
          ? { ...prepared, id: newId, _id: newId }
          : null;
        if (draftFlushTicket) {
          const flushResult = await flushPendingWorkflowOnSave(
            newId,
            draftFlushTicket,
            {
              ticketsApi,
              apiTicketToCockpit,
              patchTicket,
              injectWorkflowSystemMessage,
            },
          );
          if (flushResult.error) {
            showNotification(
              flushResult.error?.response?.data?.message
                || 'Ticket salvo, mas falhou ao ativar o workflow.',
              'warning',
            );
          }
        }
        delete tabSessionsRef.current[draftId];
        if (session) {
          tabSessionsRef.current[String(newId)] = {
            ...session,
            sendStatus: status,
            composeText: hasPublicPayload ? '' : session.composeText,
            composeReviewedPlain: hasPublicPayload ? '' : session.composeReviewedPlain,
            internalText: hasInternalPayload ? '' : session.internalText,
            composeAttachments: hasPublicPayload ? [] : session.composeAttachments,
          };
        }
        replaceOpenTabId(draftId, newId, {
          title: persisted.title || ticket.title,
          clientName: persisted.clientName || ticket.clientName,
          ticketLabel: getTicketProtocolLabel(persisted) || 'Rascunho',
        });
        setSendStatus(status);
        if (hasPublicPayload) setComposeText('');
        if (hasPublicPayload) setComposeReviewedPlain('');
        if (hasInternalPayload) setInternalText('');
        if (hasPublicPayload) setComposeAttachments([]);
        showNotification(
          hasPublicPayload || hasInternalPayload ? 'Ticket enviado e salvo.' : 'Ticket salvo.',
          'success',
        );
        void syncTicketViews().catch(() => {});
        // Mesma regra do commit normal: só fecha/avança se o status salvo for terminal.
        if (!getAutoCloseOnSave() || !isTerminalTicketStatusValue(status)) {
          void loadTicketDetailFromApi(newId)
            .then((loaded) => { if (loaded) patchTicket(newId, loaded); })
            .catch(() => {});
        }
        if (isTerminalTicketStatusValue(status)) {
          advanceAfterSaveIfEnabled(newId, plannedNextId, draftId);
        }
        deskLog.action('commit → ok (rascunho)', { ticketId: newId, status });
        return newId;
      }

      const ticketBeforeMutate = findTicketEntry(ticket.id)?.ticket || ticket;
      commitRollbackTicket = ticketBeforeMutate;
      let prepared = applyRightFieldsToTicket(
        { ...ticket },
        mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName),
      );
      syncTicketWorkflowOnCommit(prepared);
      applySendStatus({ ticket: prepared, boxId: entry.boxId }, status);
      if (hasPublicPayload) {
        // Append otimista da mensagem pública recém-enviada — sem isso a thread local só
        // reflete o agente como último remetente após o reload assíncrono do ticket, e a
        // sugestão IA (que só deve rodar aguardando o cliente) continua ativa nesse intervalo.
        if (!prepared.messages) prepared.messages = [];
        prepared.messages.push({
          id: `optimistic-${Date.now()}`,
          type: 'agent',
          fromClient: false,
          origin: 'agente',
          text: messagePayload,
          attachments: attachmentUrls,
          timestamp: new Date().toISOString(),
          author: getAgentName(),
        });
      }
      patchTicket(ticket.id, {
        ...prepared,
        listOnly: false,
        _detailLoaded: Boolean(ticket._detailLoaded || ticketBeforeMutate._detailLoaded),
      });

      const ticketBeforeSave = findTicketEntry(ticket.id)?.ticket || prepared;
      const workflowFlushDeps = {
        ticketsApi,
        apiTicketToCockpit,
        patchTicket,
        injectWorkflowSystemMessage,
      };

      await commitTicketViaApi(ticket.id, {
        ...cockpitTicketToApi(prepared),
        text: hasPublicPayload ? messagePayload : '',
        internalText: hasInternalPayload ? internalNotePayload : '',
        author: getAgentName(),
        ...(attachmentUrls.length ? { attachments: attachmentUrls } : {}),
      });

      const entryAfterSave = findTicketEntry(ticket.id);
      const flushResult = await flushPendingWorkflowOnSave(
        ticket.id,
        resolveTicketSnapshotForWorkflowFlush(ticketBeforeSave, entryAfterSave?.ticket || ticket),
        workflowFlushDeps,
      );
      if (flushResult.error) {
        showNotification(
          flushResult.error?.response?.data?.message
            || 'Ticket salvo, mas falhou ao ativar o workflow.',
          'warning',
        );
      }

      setSendStatus(status);
      if (hasPublicPayload) setComposeText('');
      if (hasPublicPayload) setComposeReviewedPlain('');
      if (hasInternalPayload) setInternalText('');
      if (hasPublicPayload) setComposeAttachments([]);
      if (activeTabId) {
        const sessionKey = String(activeTabId);
        const session = tabSessionsRef.current[sessionKey];
        if (session) {
          tabSessionsRef.current[sessionKey] = {
            ...session,
            composeText: hasPublicPayload ? '' : session.composeText,
            composeReviewedPlain: hasPublicPayload ? '' : session.composeReviewedPlain,
            internalText: hasInternalPayload ? '' : session.internalText,
            composeAttachments: hasPublicPayload ? [] : session.composeAttachments,
          };
        }
      }
      showNotification(
        hasPublicPayload || hasInternalPayload ? 'Ticket enviado e salvo.' : 'Ticket salvo.',
        'success',
      );
      void syncTicketViews().catch(() => {});
      // "Fechar ao salvar" só faz sentido quando o status salvo realmente encerra o
      // atendimento (Resolvido/Cancelado/Fechado) — "Em andamento"/"Pendente" é o agente
      // seguindo no mesmo ticket, então a aba tem que continuar aberta mesmo com a
      // preferência ligada; só fecha se o agente clicar no × da aba.
      if (!getAutoCloseOnSave() || !isTerminalTicketStatusValue(status)) {
        void loadTicketDetailFromApi(ticket.id)
          .then((loaded) => { if (loaded) patchTicket(ticket.id, loaded); })
          .catch(() => {});
      }
      if (isTerminalTicketStatusValue(status)) {
        advanceAfterSaveIfEnabled(ticket.id, plannedNextId, savedListTicketId);
      }
      deskLog.action('commit → ok', { ticketId: ticket.id, status });
      return ticket.id;
    } catch (err) {
      if (commitRollbackTicket && ticket?.id) {
        patchTicket(ticket.id, commitRollbackTicket);
      }
      const msg = err?.response?.data?.message || err?.message || 'Erro ao salvar ticket.';
      deskLog.error('AÇÃO', 'commit → falhou', {
        ticketId: ticket?.id,
        status,
        message: msg,
        httpStatus: err?.response?.status,
      });
      showNotification(msg, 'error');
      return null;
    } finally {
      commitInProgressRef.current = false;
    }
  };

  const handleSendInternalNote = async () => {
    if (!ticket || !entry || sendInternalNoteInProgressRef.current || commitInProgressRef.current) return;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }

    const internalNoteHtml = String(internalText || '').trim();
    if (!htmlHasComposeContent(internalNoteHtml)) {
      showNotification('Digite uma anotação interna antes de enviar.', 'warning');
      return;
    }

    const deskPerms = permsCtx?.permissions;
    if (!canSendInternalNoteOnTicket(ticket, deskPerms)) {
      showNotification('Sem permissão para comentar neste ticket.', 'warning');
      return;
    }

    try {
      // Lock setado dentro do try — se algo aqui lançar, o finally abaixo ainda libera
      // sendInternalNoteInProgressRef, em vez de travar o canal de nota interna pro resto da sessão.
      sendInternalNoteInProgressRef.current = true;
      setSendInternalNoteBusy(true);

      const ticketId = String(ticket.id);
      const author = getAgentName();
      const clearComposeAfterSend = () => {
        setInternalText('');
        if (activeTabId) {
          const sessionKey = String(activeTabId);
          const session = tabSessionsRef.current[sessionKey];
          if (session) {
            tabSessionsRef.current[sessionKey] = {
              ...session,
              internalText: '',
            };
          }
        }
      };

      if (isDraftTicket(ticket)) {
        const appended = appendInternalNoteToCachedTicket(ticketId, {
          text: internalNoteHtml,
          author,
        });
        if (!appended) {
          showNotification('Não foi possível registrar a nota no rascunho.', 'error');
          return;
        }
        bumpTicketCacheView();
        clearComposeAfterSend();
        showNotification('Nota interna registrada.', 'success');
        return;
      }

      const updated = await sendInternalNote(ticketId, internalNoteHtml, author);
      bumpTicketCacheView();
      clearComposeAfterSend();
      if (!updated) {
        showNotification('Nota enviada, mas não foi possível atualizar a tela local.', 'warning');
        return;
      }
      showNotification('Nota interna enviada.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao enviar nota interna.';
      showNotification(msg, 'error');
    } finally {
      sendInternalNoteInProgressRef.current = false;
      setSendInternalNoteBusy(false);
    }
  };

  const resolveWhatsAppChatId = () => toWhatsAppChatIdDigits(
    client?.whatsappPhone
    || ticket?.lateralForm?.clienteTelefoneWhatsapp
    || (Array.isArray(ticket?.lateralForm?.clienteTelefone) ? ticket.lateralForm.clienteTelefone[0] : '')
    || ticket?.clientPhone
    || '',
  );

  const runWhatsAppSend = async ({ text, initialTemplate = false }) => {
    if (!ticket || !entry || waSendInProgressRef.current || commitInProgressRef.current) return;

    const waChatId = resolveWhatsAppChatId();
    if (!waChatId) {
      showNotification('Cadastre o telefone WhatsApp do cliente antes de enviar.', 'warning');
      return;
    }

    const attachmentUrls = (composeAttachments || [])
      .map((item) => String(item?.url || '').trim())
      .filter(Boolean);

    waSendInProgressRef.current = true;
    setWaSendInProgress(true);
    try {
      const result = await sendWhatsAppMessageViaApi(ticket.id, {
        text,
        initialTemplate,
        waChatId: waChatId || undefined,
        author: getAgentName(),
        attachments: attachmentUrls.length ? attachmentUrls : undefined,
      });

      if (result?.ticket) {
        patchTicket(ticket.id, result.ticket);
      }

      if (result?.twilio && !result.twilio.sent) {
        showNotification(
          result.twilio.reason || 'Mensagem salva no ticket, mas o Twilio não enviou ao celular.',
          'warning',
        );
      } else if (result?.twilio?.mode === 'template' || initialTemplate) {
        showNotification(
          'Mensagem inicial enviada via template. Aguarde a resposta do cliente.',
          'success',
        );
      } else if (result?.twilio?.sent) {
        showNotification('WhatsApp enviado.', 'success');
      }

      if (!initialTemplate) {
        setComposeText('');
        setComposeAttachments([]);
      }
      setWaChatOpen(true);
      if (activeTabId) {
        const sessionKey = String(activeTabId);
        const session = tabSessionsRef.current[sessionKey];
        if (session) {
          tabSessionsRef.current[sessionKey] = {
            ...session,
            composeText: initialTemplate ? session.composeText : '',
            composeAttachments: initialTemplate ? session.composeAttachments : [],
            waChatOpen: true,
          };
        }
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao enviar WhatsApp.';
      showNotification(msg, 'error');
    } finally {
      waSendInProgressRef.current = false;
      setWaSendInProgress(false);
    }
  };

  const handleSendWhatsAppMessage = async () => {
    if (!ticket || !entry || waSendInProgressRef.current || commitInProgressRef.current) return;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }
    if (isDraftTicket(ticket)) {
      showNotification(
        'Salve o ticket antes de enviar WhatsApp — rascunho só registra na tela, não envia ao celular.',
        'warning',
      );
      return;
    }

    const waUi = getWhatsAppDeskUiState(ticket);
    if (!waUi.composeEnabled) {
      showNotification('Envie a mensagem inicial ou aguarde a resposta do cliente.', 'warning');
      return;
    }

    const messageText = String(composeText || '').trim();
    const hasAttachments = (composeAttachments || []).length > 0;
    if (!messageText && !hasAttachments) return;

    await runWhatsAppSend({ text: messageText });
  };

  const handleSendWhatsAppInitial = async () => {
    if (!ticket || !entry || waSendInProgressRef.current || commitInProgressRef.current) return;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }
    if (isDraftTicket(ticket)) {
      showNotification('Salve o ticket antes de enviar WhatsApp.', 'warning');
      return;
    }
    await runWhatsAppSend({ initialTemplate: true });
  };

  const handleRequestWhatsAppAudioTranscription = async (messageSid) => {
    if (!ticket || !messageSid) return;
    try {
      const result = await ticketsApi.requestWhatsAppAudioTranscription(
        ticket.id || ticket._id,
        messageSid,
      );
      if (result?.ticket) {
        patchTicket(ticket.id, apiTicketToCockpit(result.ticket));
      }
      showNotification(
        result?.transcriptionStatus === 'completed'
          ? 'Este áudio já foi transcrito.'
          : 'Transcrição solicitada.',
        'success',
      );
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Não foi possível transcrever o áudio.';
      showNotification(message, 'error');
      throw err;
    }
  };

  const handleFieldChange = (key, value) => {
    if (ticketReadOnly) return;
    setRightFields((f) => {
      const next = applyCascadeFieldChange(f, key, value);
      if (activeTabId) {
        const sessionKey = String(activeTabId);
        tabSessionsRef.current[sessionKey] = {
          ...(tabSessionsRef.current[sessionKey] || {}),
          rightFields: next,
        };
      }
      return next;
    });
  };

  const handleAssumeTicket = useCallback(async () => {
    if (!ticket || assumingTicket) return;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não é possível assumir.', 'warning');
      return;
    }

    const perm = permsCtx?.permissions;
    if (
      !hasPermission(perm?.permissoes, 'tickets', 'atuar_responsavel')
      && !hasPermission(perm?.permissoes, 'tickets', 'atuar_sempre')
    ) {
      showNotification('Sem permissão para assumir tickets.', 'warning');
      return;
    }

    const agentName = getAgentName();
    if (!agentName || !sanitizeResponsavel(agentName)) {
      showNotification('Não foi possível identificar o agente logado.', 'warning');
      return;
    }

    const merged = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    const previewTicket = applyRightFieldsToTicket({ ...ticket }, merged);
    if (ticketAssignedToCurrentAgent(previewTicket)) {
      showNotification('Você já é o responsável deste ticket.', 'info');
      return;
    }

    const existingResponsavel = readTicketResponsavel(ticket);
    if (
      existingResponsavel
      && !ticketAssignedToCurrentAgent(ticket)
      && !hasPermission(perm?.permissoes, 'tickets', 'atuar_sempre')
    ) {
      showNotification('Este ticket já possui responsável atribuído.', 'warning');
      return;
    }

    setAssumingTicket(true);
    try {
      const next = { ...merged, responsavel: agentName };

      if (isDraftTicket(ticket)) {
        setRightFields(next);
        if (activeTabId) {
          const sessionKey = String(activeTabId);
          tabSessionsRef.current[sessionKey] = {
            ...(tabSessionsRef.current[sessionKey] || {}),
            rightFields: next,
          };
        }
        showNotification('Responsável definido. Salve o ticket para confirmar.', 'success');
        return;
      }

      const updated = await claimTicketResponsavelViaApi(ticket.id, agentName);
      if (!updated) {
        throw new Error('Não foi possível atualizar o ticket.');
      }

      const syncedFields = mergeRightFieldsWithDefaults(
        { ...next, responsavel: sanitizeResponsavel(updated.lateralForm?.responsavel || agentName) },
        updated,
        getAgentName,
      );
      setRightFields(syncedFields);
      if (activeTabId) {
        const sessionKey = String(activeTabId);
        tabSessionsRef.current[sessionKey] = {
          ...(tabSessionsRef.current[sessionKey] || {}),
          rightFields: syncedFields,
        };
      }
      patchTicket(ticket.id, updated);
      showNotification('Ticket assumido com sucesso.', 'success');
    } catch (err) {
      showNotification(
        err?.response?.data?.message || err?.message || 'Não foi possível assumir o ticket.',
        'error',
      );
    } finally {
      setAssumingTicket(false);
    }
  }, [
    activeTabId,
    assumingTicket,
    patchTicket,
    permsCtx?.permissions,
    rightFields,
    showNotification,
    ticket,
  ]);

  const showAssumeTicket = useMemo(() => {
    if (!ticket || ticketReadOnly || assumingTicket) return false;
    const perm = permsCtx?.permissions;
    if (
      !hasPermission(perm?.permissoes, 'tickets', 'atuar_responsavel')
      && !hasPermission(perm?.permissoes, 'tickets', 'atuar_sempre')
    ) {
      return false;
    }
    const merged = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    const preview = applyRightFieldsToTicket({ ...ticket }, merged);
    if (ticketAssignedToCurrentAgent(preview)) return false;

    const existingResponsavel = readTicketResponsavel(ticket);
    if (existingResponsavel && !hasPermission(perm?.permissoes, 'tickets', 'atuar_sempre')) {
      return false;
    }

    const status = String(ticket?.status || '').trim().toLowerCase();
    if (!existingResponsavel && status !== 'novo') return false;

    return true;
  }, [assumingTicket, permsCtx?.permissions, rightFields, ticket, ticketReadOnly]);

  const handleSaveContact = async (draft) => {
    if (!ticket) return;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      throw new Error('Ticket fechado');
    }

    const nome = String(draft?.name || '').trim();
    const emailList = Array.isArray(draft?.emails)
      ? draft.emails.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const phoneList = Array.isArray(draft?.phones)
      ? draft.phones.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const whatsappPhone = String(draft?.whatsappPhone || '').trim()
      || (phoneList.length === 1 ? phoneList[0] : '');
    const replyEmail = String(draft?.replyEmail || '').trim()
      || (emailList.length === 1 ? emailList[0] : '');
    const cpf = normalizeCpf(
      draft?.cpf || ticket.lateralForm?.cpf || ticket.lateralForm?.clienteCpf || ticket.clientCPF,
    );

    if (!nome) {
      showNotification('Informe o nome do cliente.', 'error');
      throw new Error('Nome obrigatório');
    }
    for (const email of emailList) {
      if (!isValidEmailFormat(email)) {
      showNotification('Informe um e-mail válido (ex.: nome@dominio.com).', 'error');
      throw new Error('E-mail inválido');
      }
    }
    if (phoneList.length > 1 && !whatsappPhone) {
      showNotification('Selecione qual telefone será usado no WhatsApp.', 'error');
      throw new Error('WhatsApp obrigatório');
    }
    if (emailList.length > 1 && !replyEmail) {
      showNotification('Selecione qual e-mail será usado para responder ao cliente.', 'error');
      throw new Error('E-mail de resposta obrigatório');
    }

    try {
      const clienteDoc = await persistClienteContact(clientsApi, {
        cpf,
        nome,
        emails: emailList,
        phones: phoneList,
        whatsappPhone,
        replyEmail,
        clienteId: draft?.clienteId || ticket.clienteId || ticket.lateralForm?.clienteId,
      });
      const clienteId = clienteDoc?._id || clienteDoc?.id || ticket.clienteId || ticket.lateralForm?.clienteId;

      const updated = await updateTicketInCache(ticket.id, (t) => {
        applyClienteDocToTicket(t, clienteDoc);
        t.clientName = nome;
        t.solicitante = nome;
        t.clientEmail = replyEmail || emailList[0] || '';
        t.clientPhone = whatsappPhone || phoneList[0] || '';
        if (clienteId) t.clienteId = clienteId;
        t.lateralForm = {
          ...t.lateralForm,
          cpf,
          clienteCpf: cpf,
          clienteNome: nome,
          clienteEmail: emailList,
          clienteEmailResposta: replyEmail,
          clienteTelefone: phoneList,
          clienteTelefoneWhatsapp: whatsappPhone,
          clienteId: clienteId || t.lateralForm?.clienteId,
        };
        t.updatedAt = new Date().toISOString();
        return t;
      });

      if (updated) {
        patchTicket(ticket.id, updated);
      }

      showNotification('Contato atualizado.', 'success');
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Erro ao salvar contato.';
      showNotification(msg, 'error');
      throw err;
    }
  };

  const handleOpenChat = () => {
    setMainTab('conversa');
    setComposeMode('public');
    setWaChatOpen(true);
  };

  const handleCreateSaved = (id) => {
    persistTabSession(activeTabId);
    delete tabSessionsRef.current[String(id)];
    prevActiveTabIdRef.current = null;
    suppressAutoSelectRef.current = true;
    setTableQueueBrowsing(false);
    setCreateOpen(false);
    openTicket(id);
    setActiveQueue('novos');
    activeQueueRef.current = 'novos';
    lastUrlQueueRef.current = 'novos';
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('queue', 'novos');
      next.set('ticket', String(id));
      return next;
    }, { replace: true });
    showNotification('Rascunho aberto — salve quando concluir o atendimento.', 'success');
  };

  const publicThreadFp = ticket ? buildPublicThreadFingerprint(ticket) : '';
  const convMsgs = useMemo(
    () => (ticket ? buildRegistroThread(ticket) : []),
    [ticket?.id, ticket?._id, publicThreadFp],
  );
  // Timeline exibe um balão único da conversa WhatsApp; IA continua lendo convMsgs completo
  const displayMsgs = collapseWhatsAppThreadToBalloon(convMsgs);
  const waConvMsgs = ticket ? buildWhatsAppConvMsgs(ticket) : [];
  const waUiState = ticket ? getWhatsAppDeskUiState(ticket) : null;
  const threadLen = convMsgs.length;
  const activeTicketId = ticket?.id ? String(ticket.id) : '';

  useEffect(() => {
    if (!activeTicketId) return;
    const prevThread = agentDebugMsgCount[`thread:${activeTicketId}`];
    if (prevThread === threadLen) return;
    agentDebugMsgCount[`thread:${activeTicketId}`] = threadLen;
    deskPlatformTrace('auto-refresh', 'render:thread-mudou', {
      ticketId: activeTicketId,
      msgsNaThread: threadLen,
      refreshKey,
    });
  }, [activeTicketId, threadLen, refreshKey]);

  const ticketAi = useTicketAiSuggestions(ticket, rightFields, convMsgs, internalText, ticketCacheEpoch);

  const sendCommitMenuState = useMemo(() => resolveSendCommitMenuState(
    sendStatusOptionsForMenu,
    hasCanceladoSendOption,
    {
      rightFields: mergedRightFieldsForSend,
      config,
      composeHtml: composeText,
      composeReviewedPlain,
      iaRespostaSugerida: ticketAi.respostaSugerida,
      ticket,
      agentName: getAgentName(),
    },
  ), [
    sendStatusOptionsForMenu,
    hasCanceladoSendOption,
    mergedRightFieldsForSend,
    config,
    composeText,
    composeReviewedPlain,
    ticketAi.respostaSugerida,
    ticket,
  ]);

  const handleApplyTabulation = useCallback(async () => {
    const merged = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);

    if (isTabulationComplete(merged, config, ticket, getAgentName)) {
      const synced = ['tipo', 'produto', 'motivo', 'detalhe', 'canal'].some(
        (key) => String(merged[key] || '') !== String(rightFields?.[key] || ''),
      );
      if (synced) setRightFields(merged);
      if (activeTabId) {
        const sessionKey = String(activeTabId);
        tabSessionsRef.current[sessionKey] = {
          ...(tabSessionsRef.current[sessionKey] || {}),
          rightFields: merged,
        };
      }
      showNotification('Tabulação já preenchida.', 'success');
      return;
    }

    const tab = ticketAi.tabulacao || parseTabulationDisplay(ticketAi.tabulacaoDisplay);
    if (!hasApplyableTabulation(tab)) {
      showNotification('Nenhuma tabulação sugerida disponível.', 'warning');
      return;
    }

    const next = applyTabulationSuggestion(merged, tab, config);
    const changed = ['tipo', 'produto', 'motivo', 'detalhe'].some(
      (key) => String(next[key] || '') !== String(merged[key] || ''),
    );

    if (!changed) {
      if (isTabulationComplete(next, config, ticket, getAgentName)) {
        setRightFields(next);
        if (activeTabId) {
          const sessionKey = String(activeTabId);
          tabSessionsRef.current[sessionKey] = {
            ...(tabSessionsRef.current[sessionKey] || {}),
            rightFields: next,
          };
        }
        showNotification('Tabulação já preenchida.', 'success');
        return;
      }
      showNotification(
        'Produto sugerido pela IA não foi encontrado na tabulação ativa. Verifique se o POP está indexado ou preencha manualmente.',
        'warning',
      );
      return;
    }

    setRightFields(next);

    if (activeTabId) {
      const sessionKey = String(activeTabId);
      tabSessionsRef.current[sessionKey] = {
        ...(tabSessionsRef.current[sessionKey] || {}),
        rightFields: next,
      };
    }

    if (ticket && !isDraftTicket(ticket)) {
      try {
        await updateTicketInCache(ticket.id, (t) => applyRightFieldsToTicket(t, next));
    syncTicketViews();
      } catch {
        showNotification('Tabulação aplicada nos campos, mas não foi possível salvar no ticket.', 'warning');
        return;
      }
    }

    showNotification('Tabulação sugerida pela IA aplicada nos campos.', 'success');
  }, [
    activeTabId,
    config,
    rightFields,
    showNotification,
    syncTicketViews,
    ticket,
    ticketAi.tabulacao,
    ticketAi.tabulacaoDisplay,
  ]);

  const workflowDefinitions = useMemo(
    () => (runtimeWorkflows?.length ? runtimeWorkflows : getRuntimeWorkflows()),
    [runtimeWorkflows],
  );

  const matchedWorkflowTemplate = useMemo(() => {
    if (!ticket || isDraftTicket(ticket) || isTicketWorkflowActive(ticket)) return null;
    if (!isClientIdentifiedForWorkflow(ticket, client)) return null;
    const fields = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    return resolveWorkflowForTicket(ticket, fields, workflowDefinitions);
  }, [ticket, rightFields, workflowDefinitions, client]);

  useEffect(() => {
    if (!ticket) return;
    const fields = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    const cpfDigits = getTicketCpfDigits(ticket, client);
    const template = resolveWorkflowForTicket(ticket, fields, workflowDefinitions);
    const blockers = [];
    if (isDraftTicket(ticket)) blockers.push('rascunho');
    if (isTicketWorkflowActive(ticket)) blockers.push('workflow_ativo');
    if (!isClientIdentifiedForWorkflow(ticket, client)) blockers.push('cpf_invalido_ou_ausente');
    if (!workflowDefinitions?.length) blockers.push('definicoes_workflow_vazias');
    if (!blockers.length && !template) blockers.push('tabulacao_sem_match');
    deskLog.workflow('Iniciar Workflow → gate', {
      ticketId: ticket.id,
      protocolo: getTicketProtocolLabel(ticket),
      podeMostrarBotao: Boolean(template) && blockers.length === 0,
      blockers,
      cpfDigits: cpfDigits || null,
      tabulacao: fields,
      workflowsCarregados: workflowDefinitions?.length ?? 0,
      templateId: template?.id || null,
    });
  }, [ticket, rightFields, workflowDefinitions, client]);

  const executeWorkflowStart = useCallback(async (payload) => {
    const template = pendingWorkflowTemplateRef.current || workflowStartTemplate;
    if (!ticket || !template || startingWorkflow || isTicketWorkflowActive(ticket)) return false;

    const requisicaoValores = payload?.valores ?? payload;
    const solicitacaoProdutos = payload?.solicitacaoProdutos ?? null;

    if (!isClientIdentifiedForWorkflow(ticket, client)) {
      showNotification(WORKFLOW_REQUIRES_CLIENT_MESSAGE, 'warning');
      return;
    }

    const fields = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    // Responsável permanece o dono — WF só muda atribuído no backend
    const preservedResponsavel = sanitizeResponsavel(ticket.lateralForm?.responsavel)
      || sanitizeResponsavel(ticket.responsibleAgent)
      || sanitizeResponsavel(fields.responsavel);
    if (preservedResponsavel) fields.responsavel = preservedResponsavel;

    setStartingWorkflow(true);
    try {
      const ticketId = ticket.id || ticket._id;

      // Persiste tabulação (sem pending WF) para o gatilho casar no backend
      const tabOnly = { ...(findTicketEntry(ticketId)?.ticket || ticket) };
      applyRightFieldsToTicket(tabOnly, fields);
      if (tabOnly.lateralForm?.workflow) {
        const nextLf = { ...tabOnly.lateralForm };
        delete nextLf.workflow;
        tabOnly.lateralForm = nextLf;
      }
      delete tabOnly._pendingWorkflowStart;
      if (tabOnly.workflow?.pendingPersist) {
        const wf = { ...tabOnly.workflow };
        delete wf.pendingPersist;
        delete wf.active;
        tabOnly.workflow = Object.keys(wf).length ? wf : undefined;
      }
      await updateTicketInCache(ticketId, () => tabOnly);

      // Um persist de WF: POST workflow/start
      const startBody = {
        definicaoSlug: template.id,
        ...(requisicaoValores && Object.keys(requisicaoValores).length
          ? { requisicao: { valores: requisicaoValores } }
          : {}),
        ...(solicitacaoProdutos && Object.keys(solicitacaoProdutos).length
          ? { solicitacaoProdutos }
          : {}),
      };
      const updated = await ticketsApi.startWorkflow(ticketId, startBody);
      const merged = normalizeTicketForDeskV2(apiTicketToCockpit(updated));
      merged.listOnly = false;
      merged._detailLoaded = true;
      // Garante responsável local se a API não trouxe (não troca dono)
      if (preservedResponsavel) {
        merged.responsibleAgent = preservedResponsavel;
        merged.lateralForm = {
          ...(merged.lateralForm || {}),
          responsavel: preservedResponsavel,
        };
      }
      injectWorkflowSystemMessage(merged, { title: template.title || 'Workflow' });
      patchTicket(ticketId, merged);
      bumpTicketCacheView();

      showNotification(`Workflow "${template.title}" iniciado.`, 'success');
      pendingWorkflowTemplateRef.current = null;
      setWorkflowStartTemplate(null);
      // Lista WK já vê active no cache — sync em background sem bloquear a UI
      void syncTicketViews();
      return true;
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Não foi possível iniciar o workflow.';
      showNotification(msg, 'error');
      return false;
    } finally {
      setStartingWorkflow(false);
    }
  }, [
    client,
    rightFields,
    showNotification,
    startingWorkflow,
    ticket,
    workflowStartTemplate,
    patchTicket,
    syncTicketViews,
    bumpTicketCacheView,
  ]);

  const handleOpenComunicacaoModal = useCallback(async () => {
    if (!ticket || comunicacaoBusy || !isTicketWorkflowActive(ticket)) return;
    setComunicacaoBusy(true);
    try {
      if (ticket.listOnly || !ticket._detailLoaded) {
        await loadTicketDetailFromApi(ticket.id || ticket._id);
        await syncTicketViews();
      }
      setComunicacaoModalOpen(true);
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível abrir a conversa.', 'error');
    } finally {
      setComunicacaoBusy(false);
    }
  }, [comunicacaoBusy, showNotification, syncTicketViews, ticket]);

  const handleSubmitComunicacao = useCallback(async (message) => {
    if (!ticket || comunicacaoBusy) return null;
    setComunicacaoBusy(true);
    try {
      const updated = await replyWorkflowComunicacao(ticket.id || ticket._id, message);
      resolveWorkflowInfoRequest(ticket);
      await syncTicketViews();
      showNotification('Resposta enviada ao time do workflow.', 'success');
      return updated;
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível enviar a resposta.', 'error');
      throw err;
    } finally {
      setComunicacaoBusy(false);
    }
  }, [comunicacaoBusy, showNotification, syncTicketViews, ticket]);

  const handleStartWorkflow = useCallback(() => {
    if (!ticket || isDraftTicket(ticket) || startingWorkflow || isTicketWorkflowActive(ticket)) return;
    if (isTicketReadOnly(ticket)) {
      showNotification('Ticket fechado — não aceita modificações.', 'warning');
      return;
    }

    if (!canActOnTicket(ticket, permsCtx?.permissions)) {
      showNotification('Sem permissão para iniciar workflow neste ticket.', 'warning');
      return;
    }

    if (!isClientIdentifiedForWorkflow(ticket, client)) {
      showNotification(WORKFLOW_REQUIRES_CLIENT_MESSAGE, 'warning');
      return;
    }

    const fields = mergeRightFieldsWithDefaults(rightFields, ticket, getAgentName);
    const template = resolveWorkflowForTicket(ticket, fields, workflowDefinitions);
    if (!template) {
      showNotification('Tabulação não compatível com nenhum workflow ativo.', 'warning');
      return;
    }

    pendingWorkflowTemplateRef.current = template;
    setWorkflowStartTemplate(template);

    const campos = resolveRequisicaoCamposVisiveis(template?.raw || template);
    if (!campos.length) {
      executeWorkflowStart();
      return;
    }

    setWorkflowStartModalOpen(true);
  }, [
    client,
    executeWorkflowStart,
    permsCtx?.permissions,
    workflowDefinitions,
    rightFields,
    showNotification,
    startingWorkflow,
    ticket,
  ]);

  const handleWorkflowStartModalSubmitted = useCallback(async (valores) => {
    const ok = await executeWorkflowStart(valores);
    if (ok) setWorkflowStartModalOpen(false);
  }, [executeWorkflowStart]);

  const handleWorkflowStartModalClose = useCallback(() => {
    setWorkflowStartModalOpen(false);
    pendingWorkflowTemplateRef.current = null;
    setWorkflowStartTemplate(null);
  }, []);

  const workflowProgress = ticket ? getWorkflowProgress(ticket) : null;
  const isAtendimentoAgent = hasAtendimentoFuncao(colaboradorAtuacao);
  const deskPermissions = permsCtx?.permissions;
  const canPublicCompose = ticket ? canSendPublicMessageOnTicket(ticket, deskPermissions) : false;
  const canInternalCompose = ticket ? canSendInternalNoteOnTicket(ticket, deskPermissions) : false;
  // Iniciar WF não reutiliza gate do compose público (revisor/canPublicCompose)
  const canInitiateWorkflow = ticket ? canActOnTicket(ticket, deskPermissions) : false;
  const workflowPublicLocked = ticketReadOnly || !canPublicCompose;
  const tabulationReadonly = ticketReadOnly || !canActOnTicket(ticket, deskPermissions);

  const canAdvanceWorkflow = (() => {
    if (ticket?.workflow?.pendingPersist) return false;
    if (!canAdvanceWorkflowStep(ticket, deskPermissions)) return false;
    if (!workflowProgress || workflowProgress.workflow?.status === 'completed') return false;
    const step = workflowProgress.activeStep;
    if (!step) return false;
    if (isAtendimentoAgent) {
      if (workflowProgress.externalTeamActive) return false;
      const stepTeam = step.team;
      if (stepTeam && !['n1', 'agent'].includes(stepTeam)) return false;
      const requisicaoValores = ticket?.workflow?.requisicao?.valores;
      const hasRequisicao = requisicaoValores && Object.keys(requisicaoValores).length > 0;
      if (
        hasRequisicao
        && step.acao?.tipo === 'manual'
        && ['n1', 'agent'].includes(stepTeam || 'n1')
      ) {
        return false;
      }
    }
    if (step.acao?.tipo === 'automatica' || step.atribuicao?.tipo === 'sistema') {
      const modo = resolveAutomaticaConfig(step)?.modo;
      return modo === 'call_to_action';
    }
    if (step.acao?.tipo === 'aprovacao') {
      return false;
    }
    return true;
  })();

  const canDecideWorkflow = Boolean(
    ticket
    && !ticket?.workflow?.pendingPersist
    && workflowProgress
    && workflowProgress.workflow?.status !== 'completed'
    && workflowProgress.activeStep?.acao?.tipo === 'aprovacao'
    && canAdvanceWorkflowStep(ticket, deskPermissions)
    && !ticketReadOnly,
  );

  const canManageWorkflow = useMemo(
    () => Boolean(ticket && isTicketWorkflowActive(ticket) && canInterruptWorkflow(permsCtx?.permissions)),
    [ticket, permsCtx?.permissions],
  );

  const handleAdvanceWorkflow = useCallback(async () => {
    if (!ticket || isDraftTicket(ticket) || advancingWorkflow) return;
    setAdvancingWorkflow(true);
    try {
      const updated = await ticketsApi.advanceWorkflow(ticket.id || ticket._id, {});
      await updateTicketInCache(ticket.id, () => normalizeTicketForDeskV2(updated));
      await syncTicketViews();
      showNotification('Workflow avançado.', 'success');
    } catch (err) {
      showNotification(
        err?.response?.data?.message || 'Não foi possível avançar o workflow.',
        'warning',
      );
    } finally {
      setAdvancingWorkflow(false);
    }
  }, [
    advancingWorkflow,
    showNotification,
    syncTicketViews,
    ticket,
  ]);

  const handleCancelWorkflow = useCallback(async () => {
    if (!ticket || isDraftTicket(ticket) || cancelingWorkflow) return;

    if (ticket.workflow?.pendingPersist || ticket._pendingWorkflowStart) {
      await updateTicketInCache(ticket.id, (t) => discardPendingWorkflowStart({ ...t }));
      showNotification('Workflow cancelado.', 'success');
      return;
    }

    setCancelingWorkflow(true);
    try {
      const updated = await ticketsApi.cancelWorkflow(ticket.id || ticket._id, {});
      await updateTicketInCache(ticket.id, () => normalizeTicketForDeskV2(updated));
      await syncTicketViews();
      showNotification('Workflow interrompido.', 'success');
    } catch (err) {
      showNotification(
        err?.response?.data?.message || 'Não foi possível interromper o workflow.',
        'warning',
      );
    } finally {
      setCancelingWorkflow(false);
    }
  }, [
    cancelingWorkflow,
    showNotification,
    syncTicketViews,
    ticket,
  ]);

  const handleApproveWorkflow = useCallback(async () => {
    if (!ticket || isDraftTicket(ticket) || decidingWorkflow) return;
    setDecidingWorkflow(true);
    try {
      await approveWorkflowDecision(ticket.id || ticket._id);
      await syncTicketViews();
      showNotification('Workflow aprovado.', 'success');
    } catch (err) {
      showNotification(
        err?.response?.data?.message || 'Não foi possível aprovar o workflow.',
        'warning',
      );
    } finally {
      setDecidingWorkflow(false);
    }
  }, [decidingWorkflow, showNotification, syncTicketViews, ticket]);

  const handleRejectWorkflow = useCallback(async () => {
    if (!ticket || isDraftTicket(ticket) || decidingWorkflow) return;
    setDecidingWorkflow(true);
    try {
      await rejectWorkflowDecision(ticket.id || ticket._id);
      await syncTicketViews();
      showNotification('Workflow reprovado.', 'success');
    } catch (err) {
      showNotification(
        err?.response?.data?.message || 'Não foi possível reprovar o workflow.',
        'warning',
      );
    } finally {
      setDecidingWorkflow(false);
    }
  }, [decidingWorkflow, showNotification, syncTicketViews, ticket]);

  const handleWorkflowRequestInfo = useCallback(async (message) => {
    if (!ticket || isDraftTicket(ticket)) return;
    try {
      await requestWorkflowInfo(ticket.id || ticket._id, message, 'workflow');
      await syncTicketViews();
      showNotification('Mensagem enviada ao responsável.', 'success');
    } catch (err) {
      showNotification(
        err?.response?.data?.message || 'Não foi possível enviar a mensagem.',
        'error',
      );
      throw err;
    }
  }, [showNotification, syncTicketViews, ticket]);

  useEffect(() => {
    if (workflowPublicLocked && composeMode === 'public') {
      setComposeMode('internal');
    }
  }, [workflowPublicLocked, composeMode]);

  const handleOpenAiRevision = useCallback(() => {
    setAiRevisionOpen(true);
  }, []);

  const handleCloseAiRevision = useCallback(() => {
    setAiRevisionOpen(false);
  }, []);

  const handleAiRevisionSubmit = useCallback(async (inputOperador) => {
    setAiRevisionSubmitting(true);
    try {
      const result = await ticketAi.requestRevision(inputOperador);
      if (result.success) {
        showNotification('Sugestão revisada pela IA.', 'success');
      } else if (result.error) {
        showNotification(result.error, 'warning');
      }
      return result;
    } finally {
      setAiRevisionSubmitting(false);
    }
  }, [ticketAi, showNotification]);

  const handleUseIaReply = useCallback((nucleo) => {
    const wrapped = wrapComposerOpeningForTicket({
      nucleo,
      ticket,
      agentName: getAgentName(),
    });
    setComposeText(wrapped);
    const reviewed = normalizeComposePlain(wrapped);
    setComposeReviewedPlain(reviewed);
    persistComposeDraft({ composeText: wrapped, composeReviewedPlain: reviewed });
  }, [ticket, persistComposeDraft]);

  const showTableQueueMain = isTableQueueView && tableQueueBrowsing && !createOpen;
  const showTicketMain = Boolean(ticket) && !showTableQueueMain;
  const showOpenTabsBar = openTabs.length > 0 && !createOpen && !showTableQueueMain;

  const handleTicketRenderCrash = useCallback(() => {
    const crashedId = activeTabId;
    setTableQueueBrowsing(isDeskTableQueue(activeQueueRef.current));
    if (crashedId) closeTicketTab(crashedId);
    syncUrlTicketParam('');
  }, [activeTabId, closeTicketTab, syncUrlTicketParam]);

  return (
    <div className={'app-shell' + (isTableQueueView ? ' app-shell--table-queue' : '')} id="deskAppShell">
      <DeskQueuePanel
        queueStatuses={queueStatuses}
        activeQueue={activeQueue}
        collapsed={queueCollapsed}
        onSelectQueue={selectQueue}
        onCollapse={() => handleQueueCollapse(true)}
        onExpand={() => handleQueueCollapse(false)}
        onCreateTicket={() => setCreateOpen(true)}
        refreshKey={refreshKey}
      />

      {!isTableQueueView ? (
      <DeskTicketList
        queueStatuses={queueStatuses}
        activeTicketId={activeTabId}
        activeSort={activeSort}
        entries={entries}
        searchActive={!!appliedSearch.trim()}
          searchQuery={searchDraft}
        collapsed={listCollapsed}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
        onSelectTicket={selectTicket}
        onSortChange={setActiveSort}
          entrySortOldestFirst={entrySortOldestFirst}
          onToggleEntrySort={() => setEntrySortOldestFirst((v) => !v)}
        onCollapse={() => handleListCollapse(true)}
        onExpand={() => handleListCollapse(false)}
        onReload={reload}
        refreshing={ticketsLoading}
          showSkeleton={ticketsLoading && entries.length === 0 && !appliedSearch.trim()}
      />
      ) : null}

      <main className={'crm-main-content' + (createOpen ? ' crm-main-content--create' : '') + (showTableQueueMain ? ' crm-main-content--table-queue' : '')} id="crmMainContent">
        {createOpen ? (
          <CreateTicketPanel
            onClose={() => setCreateOpen(false)}
            onSaved={handleCreateSaved}
          />
        ) : (
          <>
            {showOpenTabsBar ? (
            <DeskTicketTabsBar
              onSelectTab={activateTicketTab}
              onCloseTab={closeTicketTabHandler}
            />
            ) : null}
            {showTableQueueMain && isMyTicketsQueue ? (
              <DeskMyTicketsTable
                entries={entries}
                searchActive={!!appliedSearch.trim()}
                expandedSectionId={myTicketsExpandedSection}
                onSelectTicket={selectTicket}
                onReload={reload}
                refreshing={ticketsLoading}
              />
            ) : showTableQueueMain && isResolvedQueue ? (
              <DeskResolvedTicketTable
                entries={entries}
                searchActive={!!appliedSearch.trim()}
                displayTotal={countByQueue('resolvidos')}
                onSelectTicket={selectTicket}
                onReload={reload}
                refreshing={ticketsLoading}
              />
            ) : !showTicketMain ? (
              <div className="crm-empty-state" id="crmEmptyMain">Selecione um ticket na lista ao lado</div>
            ) : (
              <DeskTicketErrorBoundary
                resetKey={activeTabId}
                fallback={(
                  <div className="crm-empty-state" role="alert">
                    <p>Não foi possível abrir este ticket.</p>
                    <button type="button" className="queue-btn queue-btn--primary" onClick={handleTicketRenderCrash}>
                      Voltar à fila
                    </button>
                  </div>
                )}
              >
              <div className="crm-ticket-view desk-crm-ticket-scope">
            <DeskClientProfileBar
              ticket={ticket}
              client={client}
              onSaveContact={handleSaveContact}
              onOpenHistory={() => setHistoryOpen(true)}
              onAdvanceWorkflow={handleAdvanceWorkflow}
              onCancelWorkflow={handleCancelWorkflow}
              advancingWorkflow={advancingWorkflow}
              cancelingWorkflow={cancelingWorkflow}
              canAdvanceWorkflow={canAdvanceWorkflow && !ticketReadOnly}
              canManageWorkflow={canManageWorkflow && !ticketReadOnly}
              canDecideWorkflow={canDecideWorkflow}
              decidingWorkflow={decidingWorkflow}
              onApproveWorkflow={handleApproveWorkflow}
              onRejectWorkflow={handleRejectWorkflow}
              onWorkflowRequestInfo={handleWorkflowRequestInfo}
            />
            <nav className="tabs-top" aria-label="Navegação do ticket">
              <div className="tabs-top__tabs">
              <button
                type="button"
                className={'tab-btn' + (mainTab === 'conversa' ? ' is-active' : '')}
                onClick={() => selectMainTab('conversa')}
              >
                <i className="ti ti-message-2" /> Conversa
              </button>
              <button
                type="button"
                className={'tab-btn' + (mainTab === 'notas' ? ' is-active' : '')}
                onClick={() => selectMainTab('notas')}
              >
                <i className="ti ti-file-text" /> Notas
              </button>
                <button
                  type="button"
                  className={'tab-btn' + (mainTab === 'eventos' ? ' is-active' : '')}
                  onClick={() => selectMainTab('eventos')}
                >
                  <i className="ti ti-timeline" /> Eventos
                </button>
                <button
                  type="button"
                  className={'tab-btn' + (mainTab === 'consultas' ? ' is-active' : '')}
                  onClick={() => selectMainTab('consultas')}
                >
                  <i className="ti ti-search" /> Consultas
                </button>
              </div>
              <div className="tabs-top__status-group">
                <TicketFusaoStatusControls ticket={ticket} onOpenChild={openMergedChildTicket} />
                <span className={'status-badge tabs-top__status status-badge--' + ticketStatus.cls}>
                  {ticketStatus.label}
                </span>
              </div>
            </nav>
            <ClientTicketHistoryModal
              open={historyOpen}
              onClose={() => setHistoryOpen(false)}
              ticket={ticket}
              client={client}
              onSelectTicket={selectTicket}
              sourceTicketId={ticket?.id || ticket?._id}
              onFundirTickets={handleFundirTickets}
              merging={mergeInProgress}
            />
            <div className={'crm-conversation-wrap' + (waChatOpen ? ' crm-conversation-wrap--wa' : '')}>
              {mainTab === 'conversa' && waChatOpen ? (
                <div className="tab-panel is-active" data-panel="conversa">
                  <DeskWhatsAppChat
                    ticket={ticket}
                    client={client}
                    messages={waConvMsgs}
                    composeText={composeText}
                    onComposeTextChange={handleComposeTextChange}
                    composeAttachments={composeAttachments}
                    onComposeAttachmentsChange={handleComposeAttachmentsChange}
                    onUseIaReply={handleUseIaReply}
                    onSend={handleSendWhatsAppMessage}
                    onSendInitial={handleSendWhatsAppInitial}
                    onRequestAudioTranscription={handleRequestWhatsAppAudioTranscription}
                    waUiState={waUiState}
                    initialSendBusy={waSendInProgress}
                    sendBusy={waSendInProgress}
                    iaReply={ticketAi.respostaSugerida}
                    iaReplyLoading={ticketAi.loading}
                    iaWaitingMessage={ticketAi.waitingMessage}
                    iaShowBar={ticketAi.showIaBar}
                    iaHasSuggestion={ticketAi.hasSuggestion}
                  />
                </div>
              ) : (
                <div
                  className={
                    'tab-panel is-active'
                    + (mainTab === 'notas' ? ' tab-panel--notes' : '')
                    + (mainTab === 'eventos' ? ' tab-panel--eventos' : '')
                    + (mainTab === 'consultas' ? ' tab-panel--consultas' : '')
                  }
                  data-panel={mainTab}
                >
                  {mainTab === 'conversa' ? (
                    <>
                      <TicketWorkflowInfoRequestCallout ticket={ticket} />
                      <DeskConversation
                        ticket={ticket}
                        messages={displayMsgs}
                        onUseIaReply={handleUseIaReply}
                        iaReply={ticketAi.respostaSugerida}
                        iaReplyLoading={ticketAi.loading}
                        iaWaitingMessage={ticketAi.waitingMessage}
                        iaShowBar={ticketAi.showIaBar}
                        iaHasSuggestion={ticketAi.hasSuggestion}
                        iaError={ticketAi.error}
                        iaAuditScore={ticketAi.auditScore}
                        onRequestRevision={handleOpenAiRevision}
                        onOpenWhatsAppChat={() => setWaChatOpen(true)}
                      />
                      <DeskComposePanel
                        ticketId={ticket.id}
                        ticket={ticket}
                        variant="full"
                        composeMode={composeMode}
                        composeText={composeText}
                        internalText={internalText}
                        composeAttachments={composeAttachments}
                        onComposeAttachmentsChange={handleComposeAttachmentsChange}
                        onComposeModeChange={handleComposeModeChange}
                        onComposeTextChange={handleComposeTextChange}
                        onComposeReviewed={handleComposeReviewed}
                        onInternalTextChange={handleInternalTextChange}
                        workflowLocked={workflowPublicLocked}
                        internalComposeLocked={!canInternalCompose || ticketReadOnly}
                        workflowTeamLabel={workflowProgress?.awaitingTeamLabel}
                        ticketReadOnly={ticketReadOnly}
                        onSendInternalNote={canInternalCompose && !ticketReadOnly ? handleSendInternalNote : undefined}
                        sendInternalNoteBusy={sendInternalNoteBusy}
                      />
                    </>
                  ) : mainTab === 'notas' ? (
                    <DeskInternalNotesPanel
                      ticket={ticket}
                      client={client}
                    />
                  ) : mainTab === 'eventos' ? (
                    <DeskEventsPanel
                      ticket={ticket}
                      client={client}
                    />
                  ) : (
                    <DeskConsultasPanel
                      ticket={ticket}
                      client={client}
                      active={mainTab === 'consultas'}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
              </DeskTicketErrorBoundary>
            )}
          </>
        )}
      </main>

      {ticket && !createOpen && !showTableQueueMain && (
        <DeskTicketErrorBoundary resetKey={activeTabId}>
        <DeskRightPanel
          ticket={ticket}
          client={client}
          queueId={entry?.queueId}
          rightFields={rightFields}
          sendStatus={sendStatus}
          onFieldChange={handleFieldChange}
          onAssumeTicket={handleAssumeTicket}
          assumingTicket={assumingTicket}
          showAssumeTicket={showAssumeTicket}
          onApplyTabulation={handleApplyTabulation}
          onStartWorkflow={handleStartWorkflow}
          startingWorkflow={startingWorkflow}
          canStartWorkflow={Boolean(matchedWorkflowTemplate)}
          canInitiateWorkflow={canInitiateWorkflow}
          onReplyWorkflowRequest={handleOpenComunicacaoModal}
          replyWorkflowBusy={comunicacaoBusy}
          onCommitStatus={handleCommitWithStatus}
          waChatOpen={waChatOpen}
          onOpenChat={handleOpenChat}
          onCloseChat={() => setWaChatOpen(false)}
          sendDisabled={
            ticketReadOnly
            || (composeMode === 'public' ? !canPublicCompose : !canInternalCompose)
            || sendCommitMenuState.menuDisabled
          }
          sendMenuDisabledReason={sendCommitMenuState.menuDisabledReason}
          isSendStatusOptionDisabled={sendCommitMenuState.isOptionDisabled}
          iaTabulationDisplay={ticketAi.tabulacaoDisplay}
          iaTabulation={ticketAi.tabulacao}
          iaTabulationFonte={ticketAi.tabulacaoFonte}
          iaTabulationLoading={ticketAi.loading}
          iaWaitingMessage={ticketAi.waitingMessage}
          iaHasSuggestion={ticketAi.hasSuggestion}
          iaHasTabulationSuggestion={ticketAi.hasTabulationSuggestion}
          iaShowSection={ticketAi.showIaSection}
          iaAuditScore={ticketAi.auditScore}
          tabulationReadonly={tabulationReadonly}
          ticketReadOnly={ticketReadOnly}
        />
        </DeskTicketErrorBoundary>
      )}

      <DeskAiRevisionModal
        open={aiRevisionOpen}
        auditScore={ticketAi.auditScore}
        submitting={aiRevisionSubmitting}
        onClose={handleCloseAiRevision}
        onSubmit={handleAiRevisionSubmit}
      />

      <WorkflowComunicacaoModal
        open={comunicacaoModalOpen}
        busy={comunicacaoBusy}
        ticket={ticket}
        origem="responsavel"
        title="Responder solicitação"
        subtitle="Comunicação com o time do workflow"
        onClose={() => !comunicacaoBusy && setComunicacaoModalOpen(false)}
        onSubmit={handleSubmitComunicacao}
      />

      <ProdutosForwardPopover
        open={workflowStartModalOpen}
        workflowDef={workflowStartTemplate}
        ticket={ticket}
        submitting={startingWorkflow}
        onClose={handleWorkflowStartModalClose}
        onSubmitted={handleWorkflowStartModalSubmitted}
      />
    </div>
  );
}
