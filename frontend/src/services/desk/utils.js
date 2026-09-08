/**
 * Desk CRM — utilitários de fila e conversa
 * VERSION: v3.23.0 | DATE: 2026-08-25
 * — Evento de resposta do CSAT marcado com isCsatEvent (ícone de estrela)
 */
import {
  formatDateBr,
  formatDateTimeBr,
  formatMsgMetaBr,
  formatTimeBr,
  isSameBrDay,
  parseApiInstant,
} from '../../utils/dateTimeBr';
import { getTicketColumns, saveTicketColumns, getAllCockpitTickets, mapTicketQueueId } from '../ticketsStorage';
import { getDeskQueueOptimisticDelta, markTicketResolvedOptimistic } from './queueCounts';
import { getWorkflowInfoRequestsForTicket } from '../workflow/workflowInfoNotifications';
import { ticketBelongsInMeusTicketsList, ticketBelongsInAgentNovosQueue, ticketMatchesAgentResponsavel, shouldUseMeusChamadosFila, shouldViewAllDeskTickets, readDeskProfileId } from './responsavelSegmentation';
import { isEspeciaisDeskExcludedTicket } from '../especiais/especiaisChannelDetection';
import { normalizeMessageDisplayText } from '../../utils/htmlText.util';
import { sanitizeResponsavel } from '../tabulationConfig';
import { CONSULTA_PRODUCT_LABELS, mapTabulacaoProdutoToSlug } from './consultaFormatters';
import { ticketsApi, ticketSearchApi } from '../../api/client';
import { upsertDeskSearchTicketsInCache, isApiMode } from '../ticketsCache';
import {
  MEUS_TICKETS_QUEUE_ID,
  QUEUE_STATUSES,
  DESK_SEARCH_MODE_CPF,
  DESK_SEARCH_MODE_TICKET,
  DESK_SEARCH_MODE_BOTH,
} from './constants';
import { lookupClient, getAgentName } from '../clientDb';
import { getCustomQueueById } from './customQueueBoxes';
import { ticketMatchesQueueCriterios } from './customQueueBoxCriteria';
import {
  advanceWorkflowStep,
  advanceWorkflowByDecision,
  buildTemplateFromPassosResumo,
  buildWorkflowAdvanceMessage,
  createWorkflowState,
  evaluateWorkflowAutoAdvance,
  getWorkflowTeamLabel,
  getWorkflowTemplateById,
  resolveWorkflowForTicket,
  resolveAtribuidoForStep,
} from './workflowEngine';

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Corrige texto UTF-8 lido como Latin-1 (ex.: AprovaÃ§Ã£o → Aprovação). */
export function repairUtf8Mojibake(text) {
  const value = String(text ?? '');
  if (!value || !/[ÃÂâ€]/.test(value)) return value;
  try {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) {
      bytes[i] = value.charCodeAt(i) & 0xff;
    }
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return decoded.includes('\uFFFD') ? value : decoded;
  } catch {
    return value;
  }
}

export function getInitials(name) {
  const parts = String(name || '??').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return String(name || '?').slice(0, 2).toUpperCase();
}

export function normalizeCpf(v) {
  return String(v || '').replace(/\D/g, '');
}

/** Número de protocolo visível (sem #, sem fallback de _id) */
export function getTicketProtocolLabel(ticket) {
  return String(ticket?.chamadoProtocolo || '').trim();
}

/** Máscara CPF enquanto digita (máx. 11 dígitos): 000.000.000-00 */
export function maskCpfInput(value) {
  const d = normalizeCpf(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatCpf(digits) {
  const d = normalizeCpf(digits);
  if (d.length !== 11) return maskCpfInput(d);
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

/** Remove não-dígitos do telefone */
export function normalizePhone(v) {
  return String(v || '').replace(/\D/g, '');
}

/** E.164 Brasil — adiciona +55 quando o número local tem 10 ou 11 dígitos */
export function normalizePhoneE164(value) {
  const digits = normalizePhone(value);
  if (digits.length < 8) return '';
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12) return `+${digits}`;
  return '';
}

/** Dígitos canônicos para waChatId (5511...) */
export function toWhatsAppChatIdDigits(value) {
  const e164 = normalizePhoneE164(value);
  return e164 ? e164.replace(/^\+/, '') : normalizePhone(value);
}

/**
 * Remove o código de país +55 quando presente, deixando só DDD + número local.
 * Só 12/13 dígitos totais indicam DDI — um número local nunca chega a esse tamanho sozinho —
 * então não há ambiguidade com DDDs que também começam em "55" (ex. Santa Maria/RS).
 */
export function stripBrCountryCode(value) {
  const d = normalizePhone(value);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d.slice(2);
  return d;
}

/** Máscara telefone BR enquanto digita (máx. 11 dígitos): (11) 99999-9999 ou (11) 9999-9999 */
export function maskPhoneInput(value) {
  const d = stripBrCountryCode(value).slice(0, 11);
  if (!d.length) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatPhone(digits) {
  const d = normalizePhone(digits);
  if (!d.length) return '';
  return maskPhoneInput(d);
}

export function isValidCpfDigits(value) {
  return normalizeCpf(value).length === 11;
}

/** Valida dígitos verificadores do CPF (11 números). */
export function isValidCpfChecksum(value) {
  const d = normalizeCpf(value);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(d[i]) * (10 - i);
  let rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  if (rev !== Number(d[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(d[i]) * (11 - i);
  rev = 11 - (sum % 11);
  if (rev >= 10) rev = 0;
  return rev === Number(d[10]);
}

function hasCpfFormatting(raw) {
  return /[.\-]/.test(String(raw || ''));
}

/** Infere se a busca é por CPF, protocolo ou ambos (parcial ambíguo). */
export function inferDeskSearchMode(rawQuery) {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return DESK_SEARCH_MODE_CPF;

  if (/^#/.test(trimmed)) return DESK_SEARCH_MODE_TICKET;

  const withoutHash = trimmed.replace(/^#/, '');
  if (/[a-zA-Z]/.test(withoutHash)) return DESK_SEARCH_MODE_TICKET;

  const digits = normalizeCpf(trimmed);
  if (hasCpfFormatting(trimmed) && digits.length > 0 && digits.length <= 11) {
    return DESK_SEARCH_MODE_CPF;
  }

  if (!digits) return DESK_SEARCH_MODE_TICKET;

  if (digits.length === 11) {
    /* Match literal: CPF no ticket pode ter typo ou ser fictício — checksum não bloqueia busca */
    return DESK_SEARCH_MODE_CPF;
  }

  if (digits.length > 11) return DESK_SEARCH_MODE_TICKET;

  /* 1–10 dígitos sem máscara: CPF ainda em digitação ou protocolo parcial — busca nos dois */
  return DESK_SEARCH_MODE_BOTH;
}

export function getDeskSearchModeLabel(mode) {
  if (mode === DESK_SEARCH_MODE_TICKET) return 'Protocolo';
  if (mode === DESK_SEARCH_MODE_BOTH) return 'CPF / Protocolo';
  return 'CPF';
}

export function getDeskSearchInferredLabel(rawQuery) {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return 'Auto';
  return getDeskSearchModeLabel(inferDeskSearchMode(rawQuery));
}

export function getDeskSearchNotFoundMessage(rawQuery) {
  const mode = inferDeskSearchMode(rawQuery);
  if (mode === DESK_SEARCH_MODE_TICKET) return 'Nenhum ticket encontrado para o protocolo informado.';
  if (mode === DESK_SEARCH_MODE_CPF) return 'Nenhum ticket encontrado para o CPF informado.';
  return 'Nenhum ticket encontrado para o CPF ou protocolo informado.';
}

export function getDeskSearchSuccessMessage(rawQuery, count) {
  const mode = inferDeskSearchMode(rawQuery);
  if (mode === DESK_SEARCH_MODE_TICKET) {
    return count === 1
      ? 'Ticket localizado pelo protocolo.'
      : `${count} tickets correspondem ao protocolo informado.`;
  }
  if (mode === DESK_SEARCH_MODE_CPF) {
    return count === 1
      ? '1 ticket encontrado para este CPF.'
      : `${count} tickets encontrados para este CPF.`;
  }
  return count === 1
    ? '1 ticket encontrado.'
    : `${count} tickets encontrados.`;
}

/** Exige formato mínimo local@dominio.ext (pelo menos um ponto após @) */
export function isValidEmailFormat(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export function formatMsgMeta(iso, author) {
  return formatMsgMetaBr(iso, author);
}

export function formatWaTime(iso) {
  if (!iso) return '';
  return formatTimeBr(iso);
}

export function formatWaDateSeparator(iso) {
  if (!iso) return '';
  const d = parseApiInstant(iso);
  if (!d) return '';
  return d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatTicketDate(iso) {
  if (!iso) return '—';
  return `${formatDateBr(iso, { year: false })} · ${formatTimeBr(iso)}`;
}

/** Hora curta para card da lista (ex.: 14:56). */
export function formatTicketListTime(iso) {
  return formatTimeBr(iso);
}

/** Data curta para card da lista (ex.: 03/09), sem ano. */
export function formatTicketListDate(iso) {
  return formatDateBr(iso, { year: false });
}

/** Badge de canal para card da lista branca. */
export function resolveTicketChannelBadge(ticket) {
  if (!ticket) return { label: 'Digital', variant: 'digital' };

  const lf = ticket.lateralForm || {};
  const raw = [
    lf.canal,
    ticket.channel,
    ticket.source,
    lf.reclameAqui ? 'reclame aqui' : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (raw.includes('reclame') || raw.includes('reclame-aqui') || ticket.channel === 'reclame-aqui') {
    return { label: 'RA', variant: 'ra' };
  }
  if (isTicketInWorkflow(ticket)) {
    return { label: 'Workflow', variant: 'workflow' };
  }
  if (raw.includes('whats') || raw.includes('wa')) {
    return { label: 'WA', variant: 'wa' };
  }
  if (raw.includes('tel') || raw.includes('phone') || raw.includes('telefone') || raw.includes('call')) {
    return { label: 'Tel.', variant: 'tel' };
  }
  if (raw.includes('mail') || raw.includes('email') || raw.includes('e-mail')) {
    return { label: 'Digital', variant: 'digital' };
  }
  if (raw.includes('portal') || raw.includes('digital') || raw.includes('web')) {
    return { label: 'Digital', variant: 'digital' };
  }

  return { label: 'Digital', variant: 'digital' };
}

/** Data de finalização (último registro com status resolvido). */
export function getTicketResolvedAt(ticket) {
  if (!ticket) return null;
  normalizeTicketForDeskV2(ticket);
  const historico = ticket.registroHistorico || ticket.registroAlteracoes || [];
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const entry = historico[i];
    const status = String(entry.status ?? '').trim().toLowerCase();
    if (status === 'resolvido' || status === 'resolvidos') {
      return entry.time || entry.timestamp || entry.data || null;
    }
  }
  if (String(ticket.status || '').toLowerCase() === 'resolvido') {
    return ticket.updatedAt || ticket.createdAt || null;
  }
  return ticket.updatedAt || ticket.createdAt || null;
}

/** Data de entrada na caixa/fila atual (último registro de status). */
export function getTicketQueueEntryAt(ticket) {
  if (!ticket) return null;
  if (ticket.queueEntryAt) return ticket.queueEntryAt;
  const historico = ticket.registroHistorico || ticket.registroAlteracoes || [];
  if (historico.length) {
    const last = historico[historico.length - 1];
    return last.time || last.timestamp || last.data || null;
  }
  return ticket.createdAt || ticket.updatedAt || null;
}

/** Formato curto para coluna Finalização (ex.: 21 Jan). */
export function formatResolvedDateShort(iso) {
  if (!iso) return '—';
  const d = parseApiInstant(iso);
  if (!d) return '—';
  const day = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric' });
  const monthRaw = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', month: 'short' }).replace('.', '');
  const month = monthRaw.charAt(0).toUpperCase() + monthRaw.slice(1);
  return `${day} ${month}`;
}

export function getTicketResponsible(ticket) {
  if (!ticket) return '—';
  normalizeTicketForDeskV2(ticket);
  const responsavel = sanitizeResponsavel(ticket.responsibleAgent)
    || sanitizeResponsavel(ticket.lateralForm?.responsavel);
  return responsavel || '—';
}

export function getTicketTitle(ticket) {
  const raw = ticket?.title || ticket?.description || 'Sem assunto';
  return repairUtf8Mojibake(raw);
}

export function statusMeta(queueId) {
  const map = {
    'em-andamento': { label: 'Em andamento', cls: 'andamento' },
    novos: { label: 'Novo', cls: 'novo' },
    pendente: { label: 'Pendente', cls: 'pendente' },
    resolvidos: { label: 'Resolvido', cls: 'resolvido' },
  };
  return map[queueId] || { label: 'Em andamento', cls: 'andamento' };
}

export function buildTags(ticket) {
  const tags = [];
  const lf = ticket.lateralForm || {};
  if (isTicketInWorkflow(ticket)) tags.push('Workflow');
  if (lf.produto) tags.push(repairUtf8Mojibake(lf.produto.replace(/Internet\s+/i, '').trim() || lf.produto));
  return tags.slice(0, 4);
}

export function getClientContactFields(ticket, client) {
  const lf = ticket?.lateralForm || {};
  const emailsRaw = lf.clienteEmail;
  const phonesRaw = lf.clienteTelefone;
  const emailList = Array.isArray(emailsRaw)
    ? emailsRaw.map((item) => String(item || '').trim()).filter(Boolean)
    : (emailsRaw?.lista || []).map((item) => String(item || '').trim()).filter(Boolean);
  const replyFromLf = String(lf.clienteEmailResposta || emailsRaw?.resposta || '').trim().toLowerCase();
  const replyFromList = replyFromLf
    ? emailList.find((item) => String(item).trim().toLowerCase() === replyFromLf)
    : '';
  const replyEmail = replyFromList || emailList[0] || '';
  const phoneListRaw = Array.isArray(phonesRaw)
    ? phonesRaw.map((item) => String(item || '').trim()).filter(Boolean)
    : (phonesRaw?.lista || []).map((item) => String(item || '').trim()).filter(Boolean);
  const phoneList = phoneListRaw.map((item) => formatPhone(item)).filter(Boolean);
  const whatsappFromLf = String(lf.clienteTelefoneWhatsapp || '').trim();
  const whatsappFromClient = String(client?.whatsappPhone || client?.telefoneWhatsapp || '').trim();
  const whatsappRaw = whatsappFromLf || whatsappFromClient || phoneListRaw[0] || '';
  const whatsappPhone = whatsappRaw ? formatPhone(whatsappRaw) : '';
  const emailFromLf = replyEmail;
  const phoneFromLf = whatsappPhone || phoneList[0];
  return {
    name: lf.clienteNome || ticket?.clientName || ticket?.solicitante || client?.name || '',
    cpf: formatCpf(lf.clienteCpf || lf.cpf || ticket?.clientCPF || client?.cpf || ''),
    email: emailFromLf || ticket?.clientEmail || client?.email || '',
    phone: phoneFromLf ? formatPhone(phoneFromLf) : formatPhone(ticket?.clientPhone || client?.telefone || ''),
    emails: emailList,
    replyEmail: replyEmail || '',
    phones: phoneList.length ? phoneList : (phoneFromLf ? [formatPhone(phoneFromLf)] : []),
    whatsappPhone,
  };
}

export function getProductTagClass(product) {
  const lower = String(product || '').toLowerCase();
  if (lower.indexOf('móvel') >= 0 || lower.indexOf('movel') >= 0) return 'velo-tag--mobile';
  if (lower.indexOf('combo') >= 0) return 'velo-tag--combo';
  if (lower.indexOf('fibra') >= 0 || lower.indexOf('internet') >= 0) return 'velo-tag--fiber';
  if (lower.indexOf('tv') >= 0) return 'velo-tag--tv';
  if (lower.indexOf('fixo') >= 0 || lower.indexOf('telefone') >= 0) return 'velo-tag--landline';
  if (lower.indexOf('streaming') >= 0) return 'velo-tag--streaming';
  return 'velo-tag--default';
}

export function getClientProducts(ticket, client) {
  const products = client?.produtos ? [...client.produtos] : [];
  const prod = ticket.lateralForm?.produto || '';
  if (prod && products.indexOf(prod) < 0) products.unshift(prod);
  if (!products.length && prod) return [prod];
  return products;
}

/**
 * Produtos exibidos no painel superior — objetos { name, contracted }.
 * `contracted: true` = produto Velotax que o cadastro (B2C) confirma como contratado (tag azul).
 * O produto da tabulação sempre aparece primeiro; fica cinza se não constar como contratado.
 */
export function getClientActiveProducts(ticket, client) {
  const contractedSlugs = new Set(
    Array.isArray(client?.produtosContratados) ? client.produtosContratados : [],
  );

  const seen = new Set();
  const list = [];

  const ticketProd = String(ticket?.lateralForm?.produto || '').trim();
  if (ticketProd) {
    const slug = mapTabulacaoProdutoToSlug(ticketProd);
    list.push({ name: ticketProd, contracted: Boolean(slug && contractedSlugs.has(slug)) });
    seen.add(ticketProd);
  }

  contractedSlugs.forEach((slug) => {
    const label = CONSULTA_PRODUCT_LABELS[slug];
    if (!label || seen.has(label)) return;
    seen.add(label);
    list.push({ name: label, contracted: true });
  });

  return list;
}

export function buildIaReply(ticket) {
  const lf = ticket.lateralForm || {};
  const name = (ticket.clientName || 'cliente').split(' ')[0];
  return `Olá ${name}! Entendo sua solicitação sobre ${lf.motivo || ticket.title || 'seu atendimento'}. Vou verificar agora e retorno em instantes com a melhor solução.`;
}

export function buildIaTabulation(ticket, fields) {
  const lf = ticket?.lateralForm || {};
  const tipo = fields?.tipo || lf.classificacaoTipo || '';
  const produto = fields?.produto || lf.produto || '';
  const motivo = fields?.motivo || lf.motivo || '';
  const detalhe = fields?.detalhe || lf.detalhe || '';
  const parts = [tipo, produto, motivo, detalhe].filter(Boolean);
  return parts.length ? parts.join(' → ') : 'Tabulação incompleta';
}

export const TICKET_OPERATION_STEPS = [
  { id: 1, title: 'Caixa de entrada e atendimento N1', subtitle: 'N1', icon: 'ti-inbox' },
  { id: 2, title: 'Workflow', subtitle: 'Workflow', icon: 'ti-arrows-exchange' },
  { id: 3, title: 'Retorno ao atendimento N1', subtitle: 'Finalização', icon: 'ti-home' },
];

function resolveWorkflowAreaFromGroup(group) {
  if (group.includes('n2')) return 'N2';
  if (group.includes('financeiro')) return 'Financeiro';
  if (group.includes('produtos')) return 'Produtos';
  if (group.includes('suporte')) return 'Suporte';
  return null;
}

export function getTicketOperationProgress(ticket, queueId) {
  const group = String(ticket?.group || '').toLowerCase();
  const resolved = queueId === 'resolvidos' || ticket?.status === 'resolvido';
  const inWorkflow = isTicketInWorkflow(ticket);
  let workflowArea = null;
  if (inWorkflow) {
    const progress = getWorkflowProgress(ticket);
    workflowArea = progress?.awaitingTeamLabel || null;
  } else {
    workflowArea = resolveWorkflowAreaFromGroup(group);
  }

  let activeStep = 1;
  if (resolved) {
    activeStep = 4;
  } else if (inWorkflow) {
    activeStep = 2;
  } else if (queueId === 'novos' || ticket?.status === 'novo') {
    activeStep = 1;
  }

  return {
    activeStep,
    workflowArea,
    resolved,
    steps: TICKET_OPERATION_STEPS,
  };
}

export function getTicketOperationAreaLabel(ticket) {
  const { activeStep, workflowArea } = getTicketOperationProgress(ticket);
  if (activeStep >= 4) return 'Finalizado';
  if (activeStep === 2 && workflowArea) return workflowArea;
  if (activeStep === 3) return 'N1 — Finalização';
  return 'N1';
}

function readTicketLateralWorkflow(ticket) {
  const lateral = ticket?.lateralForm?.workflow;
  if (lateral?.templateId || lateral?.definicaoSlug) {
    return lateral;
  }

  const persisted = ticket?.workflow;
  if (
    !persisted?.active
    && persisted?.workflowStatus !== 'finished'
    && !persisted?.pendingPersist
    && !ticket?._pendingWorkflowStart
  ) {
    return lateral || null;
  }

  const pendingSlug = ticket?._pendingWorkflowStart?.definicaoSlug;
  const workflowKey = pendingSlug
    || persisted?.workflowId
    || lateral?.templateId
    || lateral?.definicaoSlug;
  if (!workflowKey) {
    return lateral || {
      title: ticket?._pendingWorkflowStart?.templateTitle || 'Workflow',
      definicaoSlug: pendingSlug,
      templateId: pendingSlug,
      step: 0,
      status: 'active',
      stepHistory: [],
    };
  }

  const template = getWorkflowTemplateById(workflowKey);
  const templateSlug = template?.id || pendingSlug || null;

  return {
    ...(lateral || {}),
    templateId: templateSlug || lateral?.templateId || pendingSlug,
    definicaoSlug: templateSlug || lateral?.definicaoSlug || pendingSlug,
    definicaoId: lateral?.definicaoId || (persisted?.workflowId ? String(persisted.workflowId) : undefined),
    title: lateral?.title || template?.title || ticket?._pendingWorkflowStart?.templateTitle || 'Workflow',
    step: persisted?.step ?? lateral?.step ?? 0,
    passoId: persisted?.passoId ?? lateral?.passoId,
    startedAt: persisted?.startedAt ?? lateral?.startedAt,
    completedAt: persisted?.completedAt ?? lateral?.completedAt,
    workflowStatus: persisted?.workflowStatus ?? lateral?.workflowStatus,
    status: persisted?.workflowStatus === 'finished' || persisted?.completedAt
      ? 'completed'
      : (lateral?.status || 'active'),
    pendingDecision: persisted?.pendingDecision ?? lateral?.pendingDecision ?? null,
    currentStepId: lateral?.currentStepId,
    stepHistory: lateral?.stepHistory || [],
    passosResumo: lateral?.passosResumo || template?.steps?.map((s, index) => ({
      id: s.id,
      nome: s.label,
      ordem: index,
      acaoTipo: s.acao?.tipo || 'manual',
      team: s.team || 'n1',
      slaHoras: s.slaHours ?? null,
    })) || undefined,
  };
}

export function isTicketWorkflowFinished(ticket) {
  const persisted = ticket?.workflow;
  const lateral = readTicketLateralWorkflow(ticket);
  return Boolean(
    persisted?.workflowStatus === 'finished'
    || lateral?.workflowStatus === 'finished',
  );
}

export function isTicketWorkflowCancelled(ticket) {
  const persisted = ticket?.workflow;
  const lateral = readTicketLateralWorkflow(ticket);
  return Boolean(
    persisted?.workflowStatus === 'cancel'
    || lateral?.workflowStatus === 'cancel',
  );
}

function ticketRegistroHasWorkflowReject(ticket) {
  const rows = ticket?.registroHistorico || ticket?.registro || [];
  return rows.some((row) => {
    if (row?.metadados?.workflowDecision === 'reject') return true;
    return (row?.alteracoes || []).some((item) => item?.workflowDecision === 'reject');
  });
}

/** Workflow reprovado — responsável (N1) deve retornar ao cliente manualmente. */
export function isWorkflowRejectAwaitingAgent(ticket) {
  if (!isTicketWorkflowActive(ticket)) return false;
  if (!ticketRegistroHasWorkflowReject(ticket)) return false;
  const status = String(ticket?.status || '').trim().toLowerCase().replace(/\s+/g, '-');
  return status === 'em-andamento' || status === 'pendente' || status === 'em-espera';
}

/** Presença de workflow atual ou concluído — usado somente para indicação visual/histórico. */
export function isTicketInWorkflow(ticket) {
  if (ticket?.workflow?.active) return true;
  if (isTicketWorkflowFinished(ticket)) return true;
  if (ticket?.workflow?.pendingPersist) return true;
  if (ticket?._pendingWorkflowStart?.definicaoSlug) return true;
  return false;
}

export function isTicketWorkflowActive(ticket) {
  if (isTicketWorkflowFinished(ticket)) return false;
  if (ticket?.workflow?.active) return true;
  if (ticket?.workflow?.pendingPersist) return true;
  if (ticket?._pendingWorkflowStart?.definicaoSlug) return true;
  // Não usar lateralForm.workflow.status === 'active' stale — escondia o botão Iniciar WF
  return false;
}

export function getWorkflowTemplateForTicket(ticket) {
  const wf = readTicketLateralWorkflow(ticket);
  const templateKey = wf?.templateId
    || wf?.definicaoSlug
    || wf?.definicaoId
    || ticket?.workflow?.workflowId;
  if (templateKey) {
    const fromRuntime = getWorkflowTemplateById(templateKey);
    if (fromRuntime?.steps?.length) return fromRuntime;
  }
  const fromPassos = buildTemplateFromPassosResumo(wf);
  if (fromPassos?.steps?.length) return fromPassos;
  return null;
}

function formatDurationMs(ms) {
  if (ms <= 0) return '0min';
  const totalMin = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
}

function getStepStartedAt(workflow, stepId) {
  const entry = (workflow?.stepHistory || []).find((h) => h.stepId === stepId);
  return entry?.at || workflow?.startedAt || null;
}

function buildFallbackWorkflowTemplate(workflow, ticket) {
  const fromPassos = buildTemplateFromPassosResumo(workflow);
  if (fromPassos?.steps?.length) return fromPassos;

  const slug = workflow?.definicaoSlug || workflow?.templateId || ticket?.workflow?.workflowId || 'workflow';
  const title = workflow?.title || 'Workflow';
  const stepIndex = typeof workflow?.step === 'number' ? workflow.step : 0;
  const history = Array.isArray(workflow?.stepHistory) ? workflow.stepHistory : [];
  const stepCount = Math.max(history.length, stepIndex + 1, 1);
  const steps = Array.from({ length: stepCount }, (_, index) => ({
    id: history[index]?.stepId || `step-${index}`,
    label: history[index]?.label || `Etapa ${index + 1}`,
    icon: 'ti-circle',
    team: 'n1',
  }));
  return {
    id: String(slug),
    title,
    steps,
    defaultActiveStepId: steps[Math.min(stepIndex, steps.length - 1)]?.id || steps[0].id,
  };
}

export function getWorkflowProgress(ticket) {
  if (!isTicketInWorkflow(ticket)) return null;
  const workflow = readTicketLateralWorkflow(ticket);
  if (!workflow) return null;
  const workflowFinished = isTicketWorkflowFinished(ticket);
  const workflowCancelled = isTicketWorkflowCancelled(ticket);

  let template = getWorkflowTemplateForTicket(ticket);
  if (!template?.steps?.length) {
    template = buildFallbackWorkflowTemplate(workflow, ticket);
  }
  if (!template?.steps?.length) return null;

  const stepIndex = typeof workflow.step === 'number' ? workflow.step : null;
  const currentStepId = stepIndex != null && template.steps[stepIndex]
    ? template.steps[stepIndex].id
    : (workflow.currentStepId || template.defaultActiveStepId);
  const currentIndex = template.steps.findIndex((s) => s.id === currentStepId);
  const activeStepIndex = currentIndex >= 0 ? currentIndex : 0;
  const activeStep = template.steps[activeStepIndex];

  const completedIds = new Set(
    (workflow.stepHistory || [])
      .filter((h) => h.status === 'completed')
      .map((h) => h.stepId),
  );

  const deniedIds = new Set(
    (workflow.stepHistory || [])
      .filter((h) => h.status === 'denied')
      .map((h) => h.stepId),
  );

  const stepsWithState = template.steps.map((step, index) => {
    let state = 'pending';
    if (workflowCancelled) {
      state = index < activeStepIndex ? 'completed' : 'skipped';
    } else if (deniedIds.has(step.id)) {
      state = 'denied';
    } else if (workflowFinished || completedIds.has(step.id)) {
      state = 'completed';
    } else if (step.id === currentStepId) {
      state = 'active';
    } else if (index < activeStepIndex) {
      state = 'completed';
    }

    const historyEntry = (workflow.stepHistory || []).find((h) => h.stepId === step.id);
    return {
      ...step,
      state,
      teamLabel: getWorkflowTeamLabel(step.team),
      completedAt: historyEntry?.status === 'completed' ? historyEntry.at : null,
    };
  });

  const agentRetainsTicket = Boolean(ticket?.lateralForm?.agentRetainsTicket);

  let slaRemainingMs = null;
  let slaTotalHours = null;
  if (activeStep?.slaHours) {
    slaTotalHours = activeStep.slaHours;
    const startedAt = getStepStartedAt(workflow, activeStep.id);
    if (startedAt) {
      const deadline = new Date(startedAt).getTime() + activeStep.slaHours * 3600000;
      slaRemainingMs = Math.max(0, deadline - Date.now());
    }
  }

  const externalTeamActive = activeStep && !['n1', 'agent'].includes(activeStep.team);

  return {
    workflow,
    template,
    activeStepIndex,
    activeStep,
    stepsWithState,
    forwardTargetStepIndex: -1,
    forwardTargetStepId: null,
    slaRemainingMs,
    slaRemainingLabel: slaRemainingMs != null ? formatDurationMs(slaRemainingMs) : null,
    slaTotalHours,
    externalTeamActive,
    awaitingTeamLabel: externalTeamActive ? getWorkflowTeamLabel(activeStep.team) : null,
    composeLocked: Boolean(externalTeamActive && !agentRetainsTicket),
  };
}

export function buildWorkflowSystemMessage(template) {
  return `Workflow **${template.title}** iniciado pelo agente.`;
}

function getWorkflowInstanceKey(workflow) {
  return workflow?.templateId || workflow?.definicaoSlug || '';
}

/** Match por tabulação — ativação efetiva só via botão Iniciar Workflow (pending → save). */
export function maybeActivateWorkflowForTicket(ticket, rightFields, _unused, author) {
  const lf = ticket.lateralForm || {};
  if (getWorkflowInstanceKey(lf.workflow)) {
    return { activated: false, workflow: lf.workflow, template: getWorkflowTemplateForTicket(ticket) };
  }

  const template = resolveWorkflowForTicket(ticket, rightFields);
  if (!template) {
    return { activated: false, workflow: null, template: null };
  }

  const workflow = createWorkflowState(template, {
    by: author || getAgentName() || 'sistema',
    trigger: 'tabulation',
  });
  const activeStep = template.steps.find((s) => s.id === workflow.currentStepId);
  const atribuido = resolveAtribuidoForStep(activeStep);
  return { activated: true, workflow, template, atribuido };
}

function pushWorkflowSystemMessage(ticket, text) {
  const ts = new Date().toISOString();
  if (!ticket.messages) ticket.messages = [];
  ticket.messages.push({
    id: `wf-sys-${Date.now()}`,
    type: 'system',
    fromClient: false,
    origin: 'sistema',
    text,
    timestamp: ts,
    author: 'Sistema',
  });
}

/** Preserva workflow existente no commit — ativação só via botão Iniciar Workflow */
export function syncTicketWorkflowOnCommit(ticket) {
  if (!ticket) return { activated: false, advanced: false };
  const lf = ticket.lateralForm || {};
  const workflow = lf.workflow;

  if (workflow) {
    ticket.lateralForm = { ...lf, workflow };
  }

  return {
    activated: false,
    advanced: false,
    workflow: workflow || null,
    template: workflow ? getWorkflowTemplateForTicket(ticket) : null,
  };
}

export function advanceTicketWorkflowByDecision(ticket, variavel, author) {
  const lf = ticket?.lateralForm || {};
  const workflow = lf.workflow;
  const template = getWorkflowTemplateForTicket(ticket);
  if (!workflow || !template || workflow.status === 'completed') {
    return { advanced: false, completed: false };
  }

  const result = advanceWorkflowByDecision(workflow, template, variavel, {
    by: author || getAgentName() || 'sistema',
    trigger: `decision-${variavel}`,
  });

  if (!result.advanced) return { advanced: false, completed: false };

  ticket.lateralForm = { ...lf, workflow: result.workflow };
  if (result.statusTicket) ticket.status = result.statusTicket;
  if (result.nextStep) {
    const atribuido = resolveAtribuidoForStep(result.nextStep);
    if (atribuido) ticket.lateralForm.atribuido = atribuido;
  }

  if (variavel === 'approve') {
    pushWorkflowSystemMessage(
      ticket,
      buildWorkflowAdvanceMessage(template, result.previousStepId, result.nextStepId, author),
    );
  }

  return {
    advanced: true,
    completed: result.completed,
    workflow: result.workflow,
    template,
  };
}

export function advanceTicketWorkflow(ticket, author) {
  const lf = ticket?.lateralForm || {};
  const workflow = lf.workflow;
  const template = getWorkflowTemplateForTicket(ticket);
  if (!workflow || !template || workflow.status === 'completed') {
    return { advanced: false, completed: false };
  }

  const result = advanceWorkflowStep(workflow, template, {
    by: author || getAgentName() || 'sistema',
    trigger: 'manual',
  });

  if (!result.advanced) return { advanced: false, completed: false };

  ticket.lateralForm = { ...lf, workflow: result.workflow };
  const nextStep = template.steps.find((s) => s.id === result.nextStepId);
  if (nextStep) {
    const atribuido = resolveAtribuidoForStep(nextStep);
    if (atribuido) ticket.lateralForm.atribuido = atribuido;
  }
  pushWorkflowSystemMessage(
    ticket,
    buildWorkflowAdvanceMessage(template, result.previousStepId, result.nextStepId, author),
  );

  return {
    advanced: true,
    completed: result.completed,
    workflow: result.workflow,
    template,
  };
}

export function injectWorkflowSystemMessage(ticket, template) {
  if (!ticket || !template) return ticket;
  const lf = ticket.lateralForm || {};
  if (lf.workflow?.systemMessageInjected) return ticket;

  const text = buildWorkflowSystemMessage(template);
  const ts = new Date().toISOString();
  if (!ticket.messages) ticket.messages = [];
  ticket.messages.push({
    id: `wf-sys-${Date.now()}`,
    type: 'system',
    fromClient: false,
    origin: 'sistema',
    text,
    timestamp: ts,
    author: 'Sistema',
  });

  ticket.lateralForm = {
    ...lf,
    workflow: {
      ...(lf.workflow || {}),
      systemMessage: text,
      systemMessageInjected: true,
    },
  };
  return ticket;
}

export function getCascadeCategoryLabel(id) {
  const map = {
    'emprestimo-pessoal': 'Empréstimo pessoal',
    antecipacao: 'Antecipação',
    'alteracao-dados': 'Alteração de dados',
  };
  return map[id] || 'Selecionar categoria';
}

export function getCascadeActionLabel(id) {
  const map = { cancelamento: 'Cancelamento', estorno: 'Estorno' };
  return map[id] || 'Selecionar ação';
}

function ensureTicketSlaFields(ticket) {
  if (ticket.slaRemaining != null && ticket.slaStatus) return;
  const priority = String(ticket.priority || '').toLowerCase();
  const limitHours = priority === 'critica' || priority === 'critical' ? 4
    : priority === 'alta' || priority === 'high' ? 8 : 24;
  const created = ticket.createdAt ? new Date(ticket.createdAt).getTime() : Date.now();
  const elapsedMin = Math.max(0, Math.round((Date.now() - created) / 60000));
  const totalMin = limitHours * 60;
  ticket.slaRemaining = totalMin - elapsedMin;
  if (ticket.slaRemaining <= 0) ticket.slaStatus = 'critical';
  else if (ticket.slaRemaining <= Math.min(60, totalMin * 0.2)) ticket.slaStatus = 'warning';
  else ticket.slaStatus = 'ok';
}

export function getSlaClass(ticket) {
  ensureTicketSlaFields(ticket);
  if (ticket.slaStatus === 'critical') return 'critical';
  if (ticket.slaStatus === 'warning' || ticket.slaStatus === 'attention') return 'warning';
  if (ticket.slaRemaining != null) {
    if (ticket.slaRemaining <= 0) return 'critical';
    if (ticket.slaRemaining <= 30) return 'warning';
  }
  return 'ok';
}

export function normalizeTicketForDeskV2(ticket) {
  if (!ticket) return ticket;
  if (!ticket.lateralForm) ticket.lateralForm = {};

  const cpfDigits = normalizeCpf(ticket.lateralForm.cpf || ticket.clientCPF);
  if (cpfDigits && !ticket.lateralForm.cpf) ticket.lateralForm.cpf = cpfDigits;
  if (cpfDigits && !ticket.clientCPF) ticket.clientCPF = formatCpf(cpfDigits);

  const client = lookupClient(cpfDigits);
  ticket.clientName = ticket.clientName || ticket.solicitante || (client && client.name) || 'Cliente';
  ticket.solicitante = ticket.solicitante || ticket.clientName;

  if (!ticket.lateralForm.canal && (ticket.channel || ticket.source)) {
    ticket.lateralForm.canal = ticket.channel || ticket.source;
  }
  const responsavel = sanitizeResponsavel(ticket.lateralForm.responsavel)
    || sanitizeResponsavel(ticket.responsibleAgent);
  ticket.lateralForm.responsavel = responsavel;
  ticket.responsibleAgent = responsavel || undefined;

  ensureTicketSlaFields(ticket);

  if (!ticket.updatedAt) ticket.updatedAt = ticket.createdAt || new Date().toISOString();
  if (!ticket.createdAt) ticket.createdAt = ticket.updatedAt;
  return ticket;
}

export function migrateAllTicketsForDeskV2() {
  const columns = getTicketColumns();
  if (!columns.length) return;
  let changed = false;
  columns.forEach((box) => {
    (box.tickets || []).forEach((t) => {
      const before = JSON.stringify(t);
      normalizeTicketForDeskV2(t);
      if (JSON.stringify(t) !== before) changed = true;
    });
  });
  if (changed) saveTicketColumns(columns);
}

function compareQueueEntryTime(a, b, dir = 1) {
  const aTime = new Date(getTicketQueueEntryAt(a.ticket) || 0).getTime();
  const bTime = new Date(getTicketQueueEntryAt(b.ticket) || 0).getTime();
  if (aTime !== bTime) return dir * (aTime - bTime);
  return String(a.ticket.id).localeCompare(String(b.ticket.id), 'pt-BR', { numeric: true });
}

export function sortTicketEntries(entries, activeSort, sortDir = 'desc', forceEntrySort = false) {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (forceEntrySort) {
      return compareQueueEntryTime(a, b, 1);
    }
    if (activeSort === 'prioridade') {
      const prio = { critica: 0, alta: 1, normal: 2, baixa: 3 };
      return (prio[a.ticket.priority] || 9) - (prio[b.ticket.priority] || 9);
    }
    if (activeSort === 'sla') {
      return (a.ticket.slaRemaining || 999) - (b.ticket.slaRemaining || 999);
    }
    if (activeSort === 'titulo') {
      return dir * getTicketTitle(a.ticket).localeCompare(getTicketTitle(b.ticket), 'pt-BR', { sensitivity: 'base' });
    }
    if (activeSort === 'finalizacao') {
      const aTime = new Date(getTicketResolvedAt(a.ticket) || 0).getTime();
      const bTime = new Date(getTicketResolvedAt(b.ticket) || 0).getTime();
      return dir * (aTime - bTime);
    }
    return compareQueueEntryTime(a, b, dir);
  });
}

function shouldFilterByAgentResponsavel(queueId) {
  return queueId !== 'resolvidos' && queueId !== MEUS_TICKETS_QUEUE_ID;
}

/** ver_todos: fila por status. ver_meus: backend já filtra (meus-chamados). Demais: responsável do agente. */
function shouldApplyAgentResponsavelFilter(queueId) {
  if (!shouldFilterByAgentResponsavel(queueId)) return false;
  if (shouldViewAllDeskTickets()) return false;
  if (shouldUseMeusChamadosFila()) return false;
  return true;
}

export function isMeusTicketsQueue(queueId) {
  return queueId === MEUS_TICKETS_QUEUE_ID;
}

export function isDeskTableQueue(queueId) {
  return queueId === 'resolvidos' || isMeusTicketsQueue(queueId);
}

export const MY_TICKETS_STATUS_SECTIONS = [
  { id: 'novos', label: 'Novos', dot: '#1634FF' },
  { id: 'cliente-respondeu', label: 'Cliente respondeu', dot: '#E85D04' },
  { id: 'em-andamento', label: 'Em andamento', dot: '#15A237' },
  { id: 'pendentes', label: 'Pendentes', dot: '#FCC200' },
];

const MEUS_TICKETS_ACTIVE_QUEUE_IDS = new Set(['novos', 'em-andamento', 'pendente']);
const MEUS_TICKETS_ACTIVE_STATUSES = new Set(['novo', 'em-aberto', 'em-andamento', '']);

function matchesTicketByCpf(ticket, rawQuery) {
  const digits = normalizeCpf(String(rawQuery || '').trim());
  if (!digits) return false;
  const ticketCpf = normalizeCpf(ticket.lateralForm?.cpf || ticket.clientCPF || '');
  if (digits.length === 11) return ticketCpf === digits;
  return ticketCpf.startsWith(digits);
}

function matchesTicketByProtocol(ticket, rawQuery) {
  const protocol = getTicketProtocolLabel(ticket);
  if (!protocol) return false;
  const query = String(rawQuery || '').trim().replace(/^#/, '');
  if (!query) return false;
  const queryDigits = normalizeCpf(query);
  const protocolDigits = normalizeCpf(protocol);
  if (protocol.toLowerCase() === query.toLowerCase()) return true;
  if (queryDigits.length >= 4 && protocolDigits.includes(queryDigits)) return true;
  if (query.length >= 3 && protocol.toLowerCase().includes(query.toLowerCase())) return true;
  return false;
}

function matchesTicketSearch(entry, q, searchMode) {
  if (!q) return true;
  const t = entry.ticket;
  const mode = searchMode === DESK_SEARCH_MODE_CPF || searchMode === DESK_SEARCH_MODE_TICKET
    ? searchMode
    : inferDeskSearchMode(q);

  if (mode === DESK_SEARCH_MODE_BOTH) {
    return matchesTicketByCpf(t, q) || matchesTicketByProtocol(t, q);
  }
  if (mode === DESK_SEARCH_MODE_TICKET) return matchesTicketByProtocol(t, q);
  return matchesTicketByCpf(t, q);
}

/** Filtra entradas por protocolo ou CPF (detecção automática por padrão). */
export function filterEntriesByDeskSearch(entries, rawQuery, searchMode) {
  const q = String(rawQuery || '').trim();
  if (!q) return entries || [];
  return (entries || []).filter((entry) => matchesTicketSearch(entry, q, searchMode));
}

function shouldExcludeEspeciaisFromDesk(ticket) {
  return isEspeciaisDeskExcludedTicket(ticket, readDeskProfileId());
}

function filterMyTicketsEntries(searchQuery) {
  const q = String(searchQuery || '').trim();

  return getAllCockpitTickets().filter((entry) => {
    if (shouldExcludeEspeciaisFromDesk(entry.ticket)) return false;
    if (!MEUS_TICKETS_ACTIVE_QUEUE_IDS.has(entry.queueId)) return false;
    if (isFusaoAbsorvido(entry.ticket)) return false;
    if (isTicketTerminalStatus(entry.ticket)) return false;

    // Regra Meus Tickets: SOMENTE responsável OU atribuído = usuário logado (nunca confiar só no backend).
    if (!ticketBelongsInMeusTicketsList(entry.ticket)) return false;

    const status = normalizeTicketStatusKey(entry.ticket?.status);

    if (entry.queueId === 'pendente') {
      return (status === 'pendente' || status === 'em-espera') && matchesTicketSearch(entry, q);
    }

    if (entry.queueId === 'novos') {
      if (status && status !== 'novo') return false;
    } else if (!MEUS_TICKETS_ACTIVE_STATUSES.has(status)) {
      return false;
    }

    return matchesTicketSearch(entry, q);
  });
}

export function formatTicketSlaRemaining(ticket) {
  normalizeTicketForDeskV2(ticket);
  const remaining = ticket.slaRemaining;
  if (remaining == null) return '—';
  if (remaining <= 0) return 'Vencido';
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes} min`;
}

export function groupMyTicketsByStatus(entries) {
  return MY_TICKETS_STATUS_SECTIONS.map((section) => ({
    ...section,
    entries: sortTicketEntries(
      (entries || []).filter((entry) => matchesMyTicketsStatusSection(entry, section.id)),
      'sla',
      'asc',
    ),
  })).filter((section) => section.entries.length > 0);
}

function normalizeTicketStatusKey(status) {
  return String(status || '').trim().toLowerCase().replace(/\s+/g, '-');
}

/** Ticket reaberto por resposta do cliente (backend move para 'em-aberto' ao reabrir pendente/em-andamento/resolvido). */
export function isClienteRespondeuTicket(ticket) {
  return normalizeTicketStatusKey(ticket?.status) === 'em-aberto';
}

const CLIENTE_RESPONDEU_READ_STORAGE_KEY = 'veloDeskClienteRespondeuReadV1';

function readClienteRespondeuReadMap() {
  try {
    return JSON.parse(localStorage.getItem(CLIENTE_RESPONDEU_READ_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeClienteRespondeuReadMap(map) {
  try {
    localStorage.setItem(CLIENTE_RESPONDEU_READ_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* localStorage indisponível (modo privado/quota) — marcação vale só até recarregar */
  }
}

/** Agente responsável marca manualmente a última resposta do cliente como lida (some o ponto roxo na fila). */
export function markClienteRespondeuRead(ticket) {
  const entryAt = getTicketQueueEntryAt(ticket);
  if (!ticket?.id || !entryAt) return;
  const map = readClienteRespondeuReadMap();
  map[String(ticket.id)] = entryAt;
  writeClienteRespondeuReadMap(map);
}

/** Agente responsável marca manualmente a última resposta do cliente como não lida (mantém o ponto roxo). */
export function markClienteRespondeuUnread(ticket) {
  if (!ticket?.id) return;
  const map = readClienteRespondeuReadMap();
  delete map[String(ticket.id)];
  writeClienteRespondeuReadMap(map);
}

/**
 * true quando o agente responsável marcou explicitamente esta resposta do cliente como lida.
 * Uma nova resposta do cliente gera um novo `entryAt` (reabre para 'em-aberto'), o que
 * invalida sozinha a marcação anterior — o ponto roxo volta a aparecer.
 */
export function isClienteRespondeuRead(ticket) {
  const entryAt = getTicketQueueEntryAt(ticket);
  const readAt = readClienteRespondeuReadMap()[String(ticket?.id)];
  return Boolean(readAt) && readAt === entryAt;
}

function matchesMyTicketsStatusSection(entry, sectionId) {
  if (sectionId === 'cliente-respondeu') {
    return isClienteRespondeuTicket(entry.ticket);
  }

  const status = normalizeTicketStatusKey(entry.ticket?.status);
  if (sectionId === 'em-andamento') return status === 'em-andamento';
  if (sectionId === 'pendentes') return status === 'pendente' || status === 'em-espera';
  if (sectionId === 'novos') return status === 'novo' || status === '' || entry.queueId === 'novos';
  return entry.queueId === sectionId;
}

function filterCustomQueueEntries(customBox, searchQuery) {
  const q = String(searchQuery || '').trim();
  return getAllCockpitTickets().filter((entry) => {
    if (shouldExcludeEspeciaisFromDesk(entry.ticket)) return false;
    if (isFusaoAbsorvido(entry.ticket)) return false;
    if (!ticketMatchesQueueCriterios(entry.ticket, customBox.criterios)) {
      return false;
    }
    return matchesTicketSearch(entry, q);
  });
}

export function filterTickets(activeQueue, searchQuery, activeSort, entrySortOldestFirst = false) {
  const q = String(searchQuery || '').trim();
  if (isMeusTicketsQueue(activeQueue)) {
    return sortTicketEntries(filterMyTicketsEntries(q), 'sla', 'asc');
  }
  const customBox = getCustomQueueById(activeQueue);
  if (customBox) {
    return sortTicketEntries(
      filterCustomQueueEntries(customBox, searchQuery),
      activeSort,
      'desc',
      entrySortOldestFirst,
    );
  }
  const filterByResponsavel = shouldApplyAgentResponsavelFilter(activeQueue);
  const filtered = getAllCockpitTickets()
    .filter((entry) => {
      if (shouldExcludeEspeciaisFromDesk(entry.ticket)) return false;
      if (isFusaoAbsorvido(entry.ticket)) return false;
      if (entry.queueId !== activeQueue) return false;
      if (activeQueue === 'novos' && !ticketBelongsInAgentNovosQueue(entry.ticket)) return false;
      if (filterByResponsavel && !ticketMatchesAgentResponsavel(entry.ticket)) {
        return false;
      }
      return matchesTicketSearch(entry, q);
    });
  return sortTicketEntries(filtered, activeSort, 'desc', entrySortOldestFirst);
}

/** Busca global por Enter: CPF ou protocolo — ignora visão meus-chamados (cache local). */
export function resolveDeskSearchEntries(
  rawQuery,
  activeSort,
  entrySortOldestFirst = false,
  searchMode,
) {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return [];

  const all = getAllCockpitTickets();
  const filtered = all.filter(({ ticket: t }) => {
    if (shouldExcludeEspeciaisFromDesk(t)) return false;
    if (isFusaoAbsorvido(t)) return false;
    return matchesTicketSearch({ ticket: t }, trimmed, searchMode);
  });

  return sortTicketEntries(filtered, activeSort, 'desc', entrySortOldestFirst);
}

function cockpitEntryFromApiTicket(apiTicket) {
  const ticket = upsertDeskSearchTicketsInCache(apiTicket);
  const boxId = ticket.boxId || mapTicketQueueId(ticket, ticket.boxId);
  return {
    ticket,
    boxId,
    queueId: mapTicketQueueId(ticket, boxId),
  };
}

/**
 * Busca Desk — sempre consulta API para CPF/protocolo e une com o cache local.
 * Não é a fila ver_meus: devolve todas as ocorrências (exceto CE, que ficam no módulo do órgão).
 */
export async function resolveDeskSearchEntriesAsync(
  rawQuery,
  activeSort,
  entrySortOldestFirst = false,
  searchMode,
) {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed) return [];

  const local = resolveDeskSearchEntries(rawQuery, activeSort, entrySortOldestFirst, searchMode);
  const entries = [];
  const seen = new Set();

  const pushEntry = (entry) => {
    if (!entry?.ticket) return;
    if (shouldExcludeEspeciaisFromDesk(entry.ticket)) return;
    const id = String(entry.ticket?.id || entry.ticket?._id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    entries.push(entry);
  };

  local.forEach(pushEntry);

  if (!isApiMode() || !localStorage.getItem('velodesk_token')) {
    return sortTicketEntries(entries, activeSort, 'desc', entrySortOldestFirst);
  }

  const mode = searchMode || inferDeskSearchMode(trimmed);

  const pushApiTicket = (apiTicket) => {
    if (!apiTicket) return;
    pushEntry(cockpitEntryFromApiTicket(apiTicket));
  };

  const protocolQuery = trimmed.replace(/^#/, '').trim();

  if (mode === DESK_SEARCH_MODE_TICKET || mode === DESK_SEARCH_MODE_BOTH) {
    try {
      pushApiTicket(await ticketsApi.getByProtocol(protocolQuery));
    } catch {
      /* protocolo não encontrado */
    }
  }

  if (mode === DESK_SEARCH_MODE_CPF || mode === DESK_SEARCH_MODE_BOTH) {
    const digits = normalizeCpf(trimmed);
    if (digits.length >= 4) {
      try {
        const data = await ticketSearchApi.deskBarByCpf(digits);
        (data?.tickets || []).forEach(pushApiTicket);
      } catch {
        /* CPF não encontrado ou inválido */
      }
    }
  }

  return sortTicketEntries(entries, activeSort, 'desc', entrySortOldestFirst);
}

export function countByQueue(queueId) {
  if (isMeusTicketsQueue(queueId)) {
    return filterMyTicketsEntries('').length;
  }
  const customBox = getCustomQueueById(queueId);
  if (customBox) {
    return filterCustomQueueEntries(customBox, '').length;
  }

  const baseCount = filterTickets(queueId, '', 'data', false).length;
  const delta = getDeskQueueOptimisticDelta(queueId);
  return Math.max(0, baseCount + delta);
}

/** Fila com tickets visíveis — prioriza Novos (maior volume no Atlas). */
export function pickDefaultQueueId(preferred = 'novos') {
  if (countByQueue(preferred) > 0) return preferred;
  const match = QUEUE_STATUSES.find((queue) => (
    queue.id !== 'resolvidos'
    && queue.id !== MEUS_TICKETS_QUEUE_ID
    && countByQueue(queue.id) > 0
  ));
  return match?.id || preferred;
}

export function pickDefaultTicket(activeQueue) {
  const list = filterTickets(activeQueue || 'novos', '', 'data');
  return getEntryTicketId(list[0]) ?? null;
}

export function getEntryTicketId(entry) {
  return entry?.ticket?.id ?? entry?.ticket?._id ?? null;
}

/** Lista visível no Desk (fila ativa ou busca aplicada). */
export function resolveDeskWorkingEntries(
  activeQueue,
  appliedSearch,
  activeSort,
  entrySortOldestFirst = false,
) {
  const search = String(appliedSearch || '').trim();
  if (isMeusTicketsQueue(activeQueue)) {
    return filterTickets(activeQueue, search, activeSort, entrySortOldestFirst);
  }
  return search
    ? resolveDeskSearchEntries(search, activeSort, entrySortOldestFirst)
    : filterTickets(activeQueue, '', activeSort, entrySortOldestFirst);
}

/** Próximo ticket na lista visível após salvar/fechar o atual. */
export function pickNextTicketFromEntries(currentId, entries) {
  const list = entries || [];
  if (!list.length || currentId == null) return null;
  const current = String(currentId);
  const idx = list.findIndex((e) => String(getEntryTicketId(e)) === current);
  if (idx === -1) {
    const fallback = list.find((e) => String(getEntryTicketId(e)) !== current);
    return getEntryTicketId(fallback) ?? null;
  }
  for (let i = idx + 1; i < list.length; i += 1) {
    return getEntryTicketId(list[i]);
  }
  for (let i = 0; i < idx; i += 1) {
    return getEntryTicketId(list[i]);
  }
  return null;
}

/** Próximo ticket na fila ativa após salvar/fechar o atual. */
export function pickNextTicketInQueue(currentId, activeQueue, activeSort) {
  return pickNextTicketFromEntries(currentId, filterTickets(activeQueue, '', activeSort));
}

export function isConversationMessage(message) {
  if (!message) return false;
  if (message.type === 'system' || message.type === 'internal') return false;
  const text = String(message.text || message.message || '').trim();
  if (!text) return false;
  return true;
}

export function isClientConversationMessage(message) {
  if (!isConversationMessage(message)) return false;
  if (message.fromClient === true || message.type === 'client') return true;
  if (message.type === 'agent') return false;
  return message.sender === 'them';
}

export function buildConversationMessages(ticket) {
  const msgs = [];
  (ticket.messages || []).forEach((m) => {
    if (!isConversationMessage(m)) return;
    const isClient = isClientConversationMessage(m);
    const ts = m.timestamp || m.time || m.createdAt;
    msgs.push({
      type: isClient ? 'client' : 'agent',
      initials: isClient ? getInitials(ticket.clientName || m.author) : getInitials(m.author || getAgentName()),
      text: String(m.text || m.message || '').trim(),
      meta: formatMsgMeta(ts, m.author || (isClient ? ticket.clientName : getAgentName())),
      timestamp: ts,
    });
  });
  return msgs;
}

function parseRegistroSortKey(id) {
  const match = String(id || '').match(/^(\d+)-(pub|int)$/);
  if (!match) return { index: 999999, part: 9 };
  return { index: Number(match[1]), part: match[2] === 'pub' ? 0 : 1 };
}

function isWorkflowInfoNoteText(text) {
  return /^\[Workflow\].*Pedido de informação/i.test(String(text || '').trim());
}

export function shouldHideWorkflowSystemThreadMessage(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (isWorkflowInfoNoteText(value)) return true;
  if (/^Workflow\s+\*\*/i.test(value)) return true;
  if (/^Etapa\s+\*\*/i.test(value)) return true;
  if (/^Decisão\s+\*\*aprovada\*\*/i.test(value)) return true;
  return false;
}

function mapAgentInternalNote(note, ticket) {
  const text = String(note.text || '').trim();
  if (!text) return null;
  const plain = /<[a-z][\s\S]*>/i.test(text)
    ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : text;
  if (!plain) return null;

  const isWorkflowInfo = isWorkflowInfoNoteText(text);
  const author = note.author || 'Agente';

  return {
    id: note.id || `int-${note.timestamp}`,
    kind: isWorkflowInfo ? 'workflow' : 'agent',
    author: isWorkflowInfo ? (note.author || 'Workflow') : author,
    initials: isWorkflowInfo ? 'WF' : getInitials(author),
    badge: isWorkflowInfo ? 'Pedido de info' : 'Interna',
    timestamp: note.timestamp || ticket.updatedAt,
    body: isWorkflowInfo ? text.replace(/^\[Workflow\]\s*/i, '') : text,
    tags: isWorkflowInfo ? ['Workflow'] : [],
    ticketId: String(ticket.id || ticket._id),
    ticketTitle: getTicketTitle(ticket),
    boldSegments: [],
  };
}

/**
 * Extrai só o conteúdo novo de uma resposta de e-mail (sem citação/assinatura).
 * Espelha backend/src/services/emailReplyContent.util.ts
 */
export function extractEmailReplyContent(raw) {
  let text = String(raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text.trim()) return '';

  const quoteHeaders = [
    /^Em\s.+?\sescreveu:\s*$/im,
    /^On\s.+?\swrote:\s*$/im,
    /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^De:\s.+$/im,
    /^From:\s.+$/im,
  ];

  let cutAt = text.length;
  for (const pattern of quoteHeaders) {
    const match = pattern.exec(text);
    if (match && match.index != null && match.index < cutAt) {
      cutAt = match.index;
    }
  }
  text = text.slice(0, cutAt);

  text = text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  const sig = /^-- \s*$/m.exec(text);
  if (sig && sig.index != null) {
    text = text.slice(0, sig.index);
  }

  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function buildRegistroThread(ticket) {
  if (!ticket) return [];

  const raw = (ticket.messages || [])
    .filter((m) => {
      if (!m || m.type === 'internal') return false;
      const text = String(m.text || m.message || '').trim();
      const hasAttachments = Array.isArray(m.attachments) && m.attachments.length > 0;
      if (m.type === 'system') {
        if (shouldHideWorkflowSystemThreadMessage(text)) return false;
        return Boolean(text) || hasAttachments;
      }
      return Boolean(text) || hasAttachments;
    })
    .map((m) => {
      if (m.type === 'system') {
        return {
          type: 'system',
          text: normalizeMessageDisplayText(String(m.text || m.message || '').trim()),
          meta: 'Sistema',
          timestamp: m.timestamp || m.time || m.createdAt,
        };
      }
      return { ...m, _kind: 'public' };
    });

  raw.sort((a, b) => {
    const tsA = new Date(a.timestamp || a.time || a.createdAt || 0).getTime();
    const tsB = new Date(b.timestamp || b.time || b.createdAt || 0).getTime();
    if (tsA !== tsB) return tsA - tsB;
    if (a.type === 'system' || b.type === 'system') return 0;
    const keyA = parseRegistroSortKey(a.id);
    const keyB = parseRegistroSortKey(b.id);
    if (keyA.index !== keyB.index) return keyA.index - keyB.index;
    return keyA.part - keyB.part;
  });

  const mapped = raw.map((m) => {
    if (m.type === 'system') return m;
    const origin = m.origin || (m.sender === 'them' ? 'cliente' : 'agente');
    const isClient = (
      origin === 'cliente'
      || m.fromClient === true
      || m.type === 'client'
      || m.sender === 'them'
    );
    const bubbleType = isClient ? 'client' : 'agent';
    const ts = m.timestamp || m.time || m.createdAt;
    const authorName = isClient
      ? (ticket.clientName || m.author)
      : (m.author || getAgentName());
    const rawText = String(m.text || m.message || '').trim();
    const looksLikeEmailReply = /escreveu:|wrote:|Original Message|^\s*>/m.test(rawText);
    let parsedText = rawText;
    if (isClient && looksLikeEmailReply) {
      const extracted = extractEmailReplyContent(rawText);
      parsedText = extracted || rawText;
    }
    const text = normalizeMessageDisplayText(parsedText);
    return {
      id: m.id,
      type: bubbleType,
      initials: getInitials(isClient ? ticket.clientName || m.author : authorName),
      text,
      attachments: Array.isArray(m.attachments) ? m.attachments.filter(Boolean) : [],
      meta: formatMsgMeta(ts, authorName),
      timestamp: ts,
      channel: m.channel,
      deliveryStatus: m.deliveryStatus,
      deliveryErrorMessage: m.deliveryErrorMessage,
      mediaContentTypes: Array.isArray(m.mediaContentTypes) ? m.mediaContentTypes : [],
      attachmentScanStatuses: Array.isArray(m.attachmentScanStatuses) ? m.attachmentScanStatuses : [],
      transcriptionStatus: m.transcriptionStatus,
    };
  });

  const combined = mapped.sort(
    (a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0),
  );

  return combined;
}

/**
 * Timeline do ticket: substitui as mensagens individuais de WhatsApp por um balão
 * único de presença da conversa (abre o chat ao clicar). Sem WhatsApp, retorna a lista original.
 */
export function collapseWhatsAppThreadToBalloon(msgs) {
  const list = msgs || [];
  const waMsgs = list.filter((m) => m?.channel === 'whatsapp');
  if (!waMsgs.length) return list;

  const rest = list.filter((m) => m?.channel !== 'whatsapp');
  const last = waMsgs[waMsgs.length - 1];
  const clienteCount = waMsgs.filter((m) => m.type === 'client').length;

  const balloon = {
    type: 'whatsapp-thread',
    count: waMsgs.length,
    clienteCount,
    lastText: String(last?.text || '').trim(),
    lastType: last?.type,
    timestamp: last?.timestamp,
  };

  const lastTs = new Date(last?.timestamp || 0).getTime();
  const insertAt = rest.findIndex((m) => {
    const ts = new Date(m?.timestamp || 0).getTime();
    return Number.isFinite(ts) && ts > lastTs;
  });

  if (insertAt < 0) return [...rest, balloon];
  return [...rest.slice(0, insertAt), balloon, ...rest.slice(insertAt)];
}

/** Mensagens exclusivas da conversa WhatsApp (thread contínua, sem e-mail/outros canais). */
export function buildWhatsAppConvMsgs(ticket) {
  if (!ticket) return [];
  const waOnly = (ticket.messages || []).filter((m) => {
    if (!m || m.type === 'internal') return false;
    if (m.channel === 'whatsapp') return true;
    const metaSource = String(m.source || m.metadados?.source || '').toLowerCase();
    return metaSource === 'whatsapp-thread';
  });
  if (!waOnly.length) return [];
  return buildRegistroThread({ ...ticket, messages: waOnly });
}

export const WHATSAPP_SESSION_MS = 24 * 60 * 60 * 1000;

/** True se o cliente enviou WhatsApp nas últimas 24h (texto livre permitido). */
export function isWhatsAppCustomerSessionOpen(ticket) {
  const msgs = buildWhatsAppConvMsgs(ticket);
  let lastClienteAt = 0;
  for (const m of msgs) {
    if (m.type !== 'client') continue;
    const ts = new Date(m.timestamp || 0).getTime();
    if (!Number.isNaN(ts) && ts > lastClienteAt) lastClienteAt = ts;
  }
  if (!lastClienteAt) return false;
  return Date.now() - lastClienteAt < WHATSAPP_SESSION_MS;
}

/** Agente já enviou ao menos uma mensagem na thread WhatsApp. */
export function hasWhatsAppAgentOutbound(ticket) {
  return buildWhatsAppConvMsgs(ticket).some((m) => m.type === 'agent');
}

/**
 * Estado UX do chat WhatsApp no Desk.
 * - needsInitial: exibir botão "Enviar Mensagem Inicial" (template)
 * - awaitingClient: template enviado, aguardando resposta
 * - composeEnabled: sessão 24h aberta — texto livre
 */
export function getWhatsAppDeskUiState(ticket) {
  const sessionOpen = isWhatsAppCustomerSessionOpen(ticket);
  const agentOutbound = hasWhatsAppAgentOutbound(ticket);
  if (sessionOpen) {
    return {
      mode: 'session',
      composeEnabled: true,
      needsInitial: false,
      awaitingClient: false,
    };
  }
  if (!agentOutbound) {
    return {
      mode: 'needsInitial',
      composeEnabled: false,
      needsInitial: true,
      awaitingClient: false,
    };
  }
  return {
    mode: 'awaitingClient',
    composeEnabled: false,
    needsInitial: false,
    awaitingClient: true,
  };
}

export function getClientAnalise(client) {
  if (client?.analise) return client.analise;
  if ((client?.termometro ?? 0) >= 55 || client?.risco === 'Alto') {
    return 'Termômetro crítico: combinar financeiro + retenção no mesmo atendimento.';
  }
  if (client?.risco === 'Médio') {
    return 'Cliente requer acompanhamento proativo no atendimento.';
  }
  return 'Perfil estável — seguir fluxo padrão de atendimento.';
}

export function getTicketStatusLabel(status) {
  const map = {
    novo: 'Novo',
    'em-aberto': 'Em Andamento',
    'em-andamento': 'Em Andamento',
    pendente: 'Pendente',
    resolvido: 'Resolvido',
    resolvidos: 'Resolvido',
    cancelado: 'Cancelado',
    fechado: 'Fechado',
  };
  return map[status] || status || '—';
}

const TERMINAL_TICKET_STATUSES = new Set(['resolvido', 'resolvidos', 'cancelado', 'fechado']);

/** Ticket absorvido na mesclagem (hierarquia inferior / redundante com parent). */
export function isFusaoAbsorvido(ticket) {
  const fusao = ticket?.fusao;
  if (!fusao || fusao.fundido !== true) return false;
  const h = String(fusao.hierarquia || '').toLowerCase();
  if (h === 'inferior') return true;
  if (h === 'redundante' && fusao.parentId != null && String(fusao.parentId) !== '') {
    return true;
  }
  return false;
}

export function isTicketTerminalStatus(ticket) {
  return isTerminalTicketStatusValue(ticket?.status);
}

/** Mesma checagem de `isTicketTerminalStatus`, mas a partir do status bruto (sem precisar do ticket inteiro) —
 * usado pra decidir se um "salvar" acabou de verdade o atendimento (só então faz sentido fechar/avançar a aba). */
export function isTerminalTicketStatusValue(status) {
  return TERMINAL_TICKET_STATUSES.has(String(status || '').trim().toLowerCase());
}

/** Ticket fechado: somente leitura no Desk (sem mutação de agente). */
export function isTicketReadOnly(ticket) {
  return String(ticket?.status || '').trim().toLowerCase() === 'fechado';
}

/**
 * Badge do ticket prioriza status real (ex.: Fechado na fila Resolvidos)
 * e cai no meta da fila quando o status não tem label próprio.
 */
export function getTicketStatusBadgeMeta(ticket, queueId) {
  const status = String(ticket?.status || '').trim().toLowerCase();
  if (status === 'fechado') return { label: 'Fechado', cls: 'fechado' };
  if (status === 'cancelado') return { label: 'Cancelado', cls: 'cancelado' };
  if (status === 'resolvido' || status === 'resolvidos') return { label: 'Resolvido', cls: 'resolvido' };
  if (status === 'pendente') return { label: 'Pendente', cls: 'pendente' };
  if (status === 'novo') return { label: 'Novo', cls: 'novo' };
  if (status === 'em-andamento' || status === 'em-aberto') return { label: 'Em andamento', cls: 'andamento' };
  return statusMeta(queueId || 'em-andamento');
}

export function getTicketCpfDigits(ticket, client = null) {
  const lf = ticket?.lateralForm || {};
  const clienteRef = Array.isArray(ticket?.cliente) ? ticket.cliente[0] : ticket?.cliente;
  return normalizeCpf(
    lf.clienteCpf
    || lf.cpf
    || ticket?.clientCPF
    || clienteRef?.clienteCpf
    || clienteRef?.cpf
    || client?.cpf
    || client?.clientCPF
    || '',
  );
}

function normalizeClientNameKey(ticket) {
  const lf = ticket?.lateralForm || {};
  return String(lf.clienteNome || ticket?.clientName || ticket?.solicitante || '')
    .trim()
    .toLowerCase();
}

export function ticketsBelongToSameClient(source, target, context = {}) {
  const sourceCpf = getTicketCpfDigits(source);
  const targetCpf = getTicketCpfDigits(target);
  const contextCpf = normalizeCpf(context.clientCpfDigits || context.cpf || '');

  if (sourceCpf && targetCpf) return sourceCpf === targetCpf;

  if (contextCpf.length === 11) {
    const sourceMatchesContext = !sourceCpf || sourceCpf === contextCpf;
    const targetMatchesContext = !targetCpf || targetCpf === contextCpf;
    if (sourceMatchesContext && targetMatchesContext) return true;
  }

  const contextName = String(context.clientName || '').trim().toLowerCase();
  const sourceName = normalizeClientNameKey(source) || contextName;
  const targetName = normalizeClientNameKey(target);
  return Boolean(sourceName && targetName && sourceName === targetName);
}

export function isTicketAlreadyMergedSource(ticket) {
  const lf = ticket?.lateralForm || {};
  if (lf.mergedIntoTicketId) return true;
  const historico = ticket.registroHistorico || ticket.registroAlteracoes || [];
  return historico.some((entry) => entry?.metadados?.merge?.role === 'source');
}

export function isTicketMergeTargetEligible(source, target, context = {}) {
  if (!source || !target) return false;
  const sourceId = String(source.id || source._id);
  const targetId = String(target.id || target._id);
  if (sourceId === targetId) return false;
  if (isTicketTerminalStatus(target)) return false;
  if (isTicketAlreadyMergedSource(target)) return false;
  if (!ticketsBelongToSameClient(source, target, context)) return false;
  return true;
}

export function buildTicketMergeNote(source, target) {
  const sourceProto = getTicketProtocolLabel(source) || source.id || source._id;
  const targetProto = getTicketProtocolLabel(target) || target.id || target._id;
  return `O ticket #${sourceProto} foi mesclado ao chamado #${targetProto}.`;
}

export function copyTabulationFromTicket(source, target) {
  const targetLf = target?.lateralForm || {};
  const sourceLf = source?.lateralForm || {};
  const tabFields = {
    tipoChamado: targetLf.tipoChamado || targetLf.classificacaoTipo || targetLf.tipo || '',
    classificacaoTipo: targetLf.classificacaoTipo || targetLf.tipoChamado || targetLf.tipo || '',
    tipo: targetLf.tipo || targetLf.classificacaoTipo || targetLf.tipoChamado || '',
    produto: targetLf.produto || '',
    motivo: targetLf.motivo || '',
    detalhe: targetLf.detalhe || '',
    responsavel: sanitizeResponsavel(targetLf.responsavel) || sanitizeResponsavel(target.responsibleAgent),
    atribuido: targetLf.atribuido || '',
  };
  return {
    ...source,
    responsibleAgent: tabFields.responsavel,
    lateralForm: {
      ...sourceLf,
      ...tabFields,
    },
  };
}

/** Cliente determinado para histórico 360° — exige CPF completo. */
export function isClientIdentifiedForHistory(cpf) {
  return isValidCpfDigits(cpf);
}

/** CPF completo no ticket — obrigatório para iniciar workflow. */
export function isClientIdentifiedForWorkflow(ticket, client = null) {
  if (!ticket) return false;
  return isValidCpfDigits(getTicketCpfDigits(ticket, client));
}

export function collectClientTickets(cpf, _clientName) {
  const cpfDigits = normalizeCpf(cpf);
  if (!isValidCpfDigits(cpfDigits)) {
    return [];
  }

  const seen = new Set();
  const list = [];

  getAllCockpitTickets().forEach(({ ticket: t }) => {
    const id = String(t.id || t._id);
    if (seen.has(id)) return;
    const tCpf = normalizeCpf(t.lateralForm?.clienteCpf || t.lateralForm?.cpf || t.clientCPF || '');
    if (tCpf !== cpfDigits) return;
    seen.add(id);
    list.push(t);
  });

  list.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  return list;
}

/** Status operacionais do cliente — outro ticket ativo além do atual. */
const CLIENT_ACTIVE_TICKET_STATUSES = new Set(['em-aberto', 'em-andamento', 'pendente']);

export function isClientActiveTicketStatus(status) {
  const key = String(status || '').trim().toLowerCase().replace(/\s+/g, '-');
  return CLIENT_ACTIVE_TICKET_STATUSES.has(key);
}

/**
 * CPF identificado com outro ticket em aberto, em andamento ou pendente (exclui o ticket atual).
 * Sem CPF válido não acusa alerta — evita falso positivo em "Cliente" genérico.
 */
export function clientHasOtherActiveTickets(cpf, _clientName, excludeTicketId) {
  if (!isValidCpfDigits(cpf)) return false;

  const cpfDigits = normalizeCpf(cpf);
  const excludeId = String(excludeTicketId || '');
  return collectClientTickets(cpfDigits, '').some((t) => {
    const id = String(t.id || t._id);
    if (excludeId && id === excludeId) return false;
    return isClientActiveTicketStatus(t.status);
  });
}

function isSameDay(isoA, isoB) {
  return isSameBrDay(isoA, isoB);
}

export function formatInternalNoteTimestamp(iso) {
  if (!iso) return '—';
  const time = formatTimeBr(iso);
  if (time === '—') return '—';
  if (isSameDay(iso, new Date().toISOString())) return `hoje · ${time}`;
  const date = formatDateBr(iso, { year: false });
  return `${date} · ${time}`;
}

export function formatRegistroOccurrenceTimestamp(iso) {
  if (!iso) return '—';
  return `${formatDateBr(iso)} · ${formatTimeBr(iso)}`;
}

const ALTERACAO_FIELD_LABELS = {
  tipoChamado: 'Tipo',
  classificacaoTipo: 'Tipo',
  produto: 'Produto',
  motivo: 'Motivo',
  detalhe: 'Detalhe',
  responsavel: 'Responsável',
  atribuido: 'Atribuído',
  status: 'Status',
  workflowActivated: 'Workflow ativado',
  workflowStep: 'Passo workflow',
  passoNome: 'Passo workflow',
  workflowCompleted: 'Workflow concluído',
  workflowDecision: 'Decisão workflow',
  agentHandoff: 'Handoff agente',
  nivelCriticidade: 'Criticidade',
  auditScore: 'Score auditoria',
  origem: 'Origem',
  palavrasCriticas: 'Palavras críticas',
  trigger: 'Gatilho',
};

const ALTERACAO_STATE_ALIASES = {
  classificacaoTipo: 'tipoChamado',
};

function normalizeAlteracaoStateKey(key) {
  return ALTERACAO_STATE_ALIASES[key] || key;
}

function extractAlteracaoFields(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const rows = [];
  Object.entries(raw).forEach(([key, value]) => {
    if (key === 'status') return;
    const display = String(value ?? '').trim();
    if (!display) return;
    rows.push({
      key: normalizeAlteracaoStateKey(key),
      field: ALTERACAO_FIELD_LABELS[key] || ALTERACAO_FIELD_LABELS[normalizeAlteracaoStateKey(key)] || key,
      value: display,
    });
  });
  return rows;
}

function applyAlteracoesToTabulationState(state, alteracoes) {
  (alteracoes || []).forEach((raw) => {
    extractAlteracaoFields(raw).forEach(({ key, value }) => {
      state[key] = value;
    });
  });
  return state;
}

function collectRegistroOccurrenceData(entry, previousTabulationState = {}, prevStatus = null) {
  const tabulationChanges = [];
  const seen = new Set();

  (entry.alteracoes || []).forEach((raw) => {
    extractAlteracaoFields(raw).forEach(({ key, field, value }) => {
      const prevVal = String(previousTabulationState[key] ?? '').trim();
      if (prevVal === value) return;
      const token = `${field}:${prevVal}->${value}`;
      if (seen.has(token)) return;
      seen.add(token);
      tabulationChanges.push({
        field,
        value,
        previousValue: prevVal || undefined,
      });
    });
  });

  const hasAlteracoes = (entry.alteracoes || []).length > 0;
  const statusChanged = Boolean(
    entry.status
    && (
      (prevStatus !== null && String(entry.status) !== String(prevStatus))
      || (
        prevStatus === null
        && hasAlteracoes
        && String(entry.status).trim() !== ''
        && String(entry.status) !== 'novo'
      )
    )
  );
  const statusLabel = statusChanged ? getTicketStatusLabel(entry.status) : null;
  const previousStatusLabel = statusChanged && prevStatus
    ? getTicketStatusLabel(prevStatus)
    : null;

  return { tabulationChanges, statusLabel, previousStatusLabel, statusChanged };
}

function isAgentRegistroEntry(entry) {
  return String(entry.origin || 'agente').toLowerCase() !== 'cliente';
}

/** Envio de e-mail automático (padrão/CSAT) — nome cadastrado no catálogo de e-mails de saída. */
function emailAutomaticoNomeFromEntry(entry) {
  const nome = String(entry?.metadados?.emailPadraoNome ?? '').trim();
  return nome || null;
}

/** Recebimento da avaliação CSAT (ver csat.routes.ts) é um evento em si — a nota/
 * comentário do cliente é que fica só na aba Notas via anotacaoInterna. Usa o
 * metadado estruturado, nunca o texto, pra Eventos não vazar conteúdo de nota. */
function csatNotaFromEntry(entry) {
  const n = Number(entry?.metadados?.csatNota);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** Aba Eventos: só tabulação/status/workflow/CSAT recebido — nota interna pura
 * (sem outra mudança junto) pertence só à aba Notas (buildInternalNotesOnlyFeed),
 * nunca às duas. */
function shouldShowSupervisorRegistroOccurrence(entry, previousTabulationState, prevStatus) {
  if (!isAgentRegistroEntry(entry)) return false;
  if (emailAutomaticoNomeFromEntry(entry) !== null) return true;
  if (csatNotaFromEntry(entry) !== null) return true;

  const { tabulationChanges, statusChanged } = collectRegistroOccurrenceData(
    entry,
    previousTabulationState,
    prevStatus,
  );
  return tabulationChanges.length > 0 || statusChanged;
}

function mapSupervisorRegistroOccurrence(entry, ticket, client, previousTabulationState, prevStatus) {
  if (!shouldShowSupervisorRegistroOccurrence(entry, previousTabulationState, prevStatus)) return null;

  const ticketId = String(ticket.id || ticket._id);

  // Envio de e-mail automático — evento de uma linha só, sem detalhar o conteúdo enviado.
  const emailAutomaticoNome = emailAutomaticoNomeFromEntry(entry);
  if (emailAutomaticoNome !== null) {
    return {
      id: `${ticketId}:${entry.id}`,
      kind: 'email-automatico',
      author: 'Sistema',
      initials: 'SY',
      badge: `Mensagem Automática Enviada: ${emailAutomaticoNome}`,
      timestamp: entry.time || entry.timestamp || ticket.updatedAt,
      ticketId,
      ticketTitle: getTicketTitle(ticket),
    };
  }

  const author = resolveRegistroAutorLabel(entry, ticket, client);
  const {
    tabulationChanges,
    statusLabel,
    previousStatusLabel,
    statusChanged,
  } = collectRegistroOccurrenceData(entry, previousTabulationState, prevStatus);
  const csatNota = csatNotaFromEntry(entry);

  // Eventos mostra só a mudança (tabulação/status/CSAT recebido) — nunca o texto
  // da anotação interna/comentário que possa ter acompanhado o mesmo save; esse
  // conteúdo vive só na aba Notas.
  return {
    id: `${ticketId}:${entry.id}`,
    kind: 'registro',
    author,
    initials: getInitials(author),
    badge: csatNota !== null ? 'Avaliação CSAT' : 'Registro',
    timestamp: entry.time || entry.timestamp || ticket.updatedAt,
    tabulationChanges,
    statusLabel,
    previousStatusLabel,
    statusChanged,
    csatNota,
    isCsatEvent: csatNota !== null,
    ticketId,
    ticketTitle: getTicketTitle(ticket),
  };
}

function buildAgentInternalNotesFeed(ticket) {
  const merged = [];
  const seen = new Set();
  const seenBody = new Set();

  normalizeTicketForDeskV2(ticket);

  const pushMappedNote = (mappedNote) => {
    if (!mappedNote || seen.has(mappedNote.id)) return;
    const bodyKey = String(mappedNote.body || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (bodyKey && seenBody.has(bodyKey)) return;
    seen.add(mappedNote.id);
    if (bodyKey) seenBody.add(bodyKey);
    merged.push(mappedNote);
  };

  (ticket.internalNotes || []).forEach((note) => {
    pushMappedNote(mapAgentInternalNote(note, ticket));
  });

  (ticket.registroHistorico || ticket.registroAlteracoes || []).forEach((entry, index) => {
    const text = String(entry.anotacaoInterna ?? '').trim();
    if (!text) return;
    pushMappedNote(mapAgentInternalNote({
      id: `${entry.id || index}-int-reg`,
      text,
      timestamp: entry.time || entry.timestamp,
      author: entry.autor,
    }, ticket));
  });

  getWorkflowInfoRequestsForTicket(ticket).forEach((req) => {
    const id = req.id || `wf-req-${req.createdAt}`;
    if (seen.has(id)) return;
    seen.add(id);
    merged.push({
      id,
      kind: 'workflow',
      author: req.requestedBy || 'Workflow',
      initials: 'WF',
      badge: 'Pedido de info',
      timestamp: req.createdAt,
      body: `${req.message} (${req.stepLabel || 'Aprovação'})`,
      tags: ['Workflow'],
      ticketId: String(ticket.id || ticket._id),
      ticketTitle: getTicketTitle(ticket),
      boldSegments: [],
    });
  });

  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return merged;
}

function isGenericRegistroAutorLabel(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || normalized === 'agente' || normalized === 'agent';
}

function resolveRegistroAutorLabel(entry, ticket, client) {
  const stored = String(entry.autor ?? '').trim();
  if (stored && !isGenericRegistroAutorLabel(stored)) return stored;

  const origin = entry.origin || 'agente';
  if (origin === 'cliente') {
    return ticket?.clientName || ticket?.solicitante || client?.name || 'Cliente';
  }

  return getAgentName() || '—';
}

function buildSupervisorRegistroFeed(ticket, client) {
  const merged = [];
  const seen = new Set();

  normalizeTicketForDeskV2(ticket);
  const historico = ticket.registroHistorico || ticket.registroAlteracoes || [];
  const tabulationState = {};
  let prevStatus = null;
  historico.forEach((entry) => {
    const previousTabulationState = { ...tabulationState };
    const mapped = mapSupervisorRegistroOccurrence(
      entry,
      ticket,
      client,
      previousTabulationState,
      prevStatus,
    );
    if (mapped && !seen.has(mapped.id)) {
      seen.add(mapped.id);
      merged.push(mapped);
    }
    applyAlteracoesToTabulationState(tabulationState, entry.alteracoes);
    if (entry.status) prevStatus = entry.status;
  });

  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return merged;
}

/** Aba Notas: somente notas internas e pedidos workflow (sem registros/alterações). */
export function buildInternalNotesOnlyFeed(ticket) {
  if (!ticket) return [];
  return buildAgentInternalNotesFeed(ticket);
}

/** @deprecated Use buildInternalNotesOnlyFeed — mantido por compatibilidade. */
export function buildClientInternalNotesFeed(ticket) {
  return buildInternalNotesOnlyFeed(ticket);
}

/**
 * Aba Eventos: só registros/gatilhos (mudança de tabulação/status, envio de mensagem
 * automática) — nunca o texto de mensagens enviadas/recebidas, que pertence só à
 * aba Conversa (inclusive e-mails manuais). Não duplicar conteúdo entre as duas abas.
 */
export function buildTicketEventsFeed(ticket, client) {
  if (!ticket) return [];
  return buildSupervisorRegistroFeed(ticket, client);
}

export function applySendStatus(entry, queueId) {
  const statusMap = {
    'em-andamento': { box: 'em-andamento', status: 'em-andamento' },
    pendente: { box: 'em-espera', status: 'pendente' },
    resolvidos: { box: 'resolvidos', status: 'resolvido' },
    cancelado: { box: 'resolvidos', status: 'cancelado' },
  };
  const cfg = statusMap[queueId] || statusMap['em-andamento'];
  entry.ticket.status = cfg.status;
  const targetBoxId = resolveDeskBoxColumnId(cfg.box);
  if (targetBoxId) {
    entry.ticket.boxId = targetBoxId;
  } else {
    delete entry.ticket.boxId;
  }
  moveTicketToBox(entry, targetBoxId || cfg.box);
}

function resolveDeskBoxColumnId(semanticBoxId) {
  const columns = getTicketColumns();
  const semantic = String(semanticBoxId || '').trim();
  if (!semantic) return null;

  const direct = columns.find((box) => box.id === semantic);
  if (direct) return direct.id;

  const nameMatchers = {
    novos: ['novo', 'novos'],
    'em-andamento': ['em andamento', 'em-aberto', 'em aberto', 'em-andamento'],
    'em-espera': ['pendente', 'em espera', 'em-espera', 'aguardando'],
    resolvidos: ['resolvido', 'resolvidos'],
  };
  const needles = nameMatchers[semantic] || [semantic];

  const byName = columns.find((box) => {
    const name = String(box.name || '').trim().toLowerCase();
    return needles.some((needle) => name === needle || name.includes(needle));
  });
  return byName?.id || semantic;
}

export function moveTicketToBox(entry, targetBoxId) {
  if (!entry || !targetBoxId) return;
  const columns = getTicketColumns();
  const ticket = entry.ticket;
  const ticketId = String(ticket.id);
  const resolvedTargetId = resolveDeskBoxColumnId(targetBoxId) || targetBoxId;
  const sourceQueueId = mapTicketQueueId(ticket, entry.boxId);

  columns.forEach((box) => {
    if (!box.tickets) return;
    box.tickets = box.tickets.filter((t) => String(t.id) !== ticketId && String(t._id) !== ticketId);
  });

  const target = columns.find((b) => b.id === resolvedTargetId)
    || columns.find((b) => String(b.name || '').trim().toLowerCase().includes(String(targetBoxId).toLowerCase()));
  if (!target) return;

  if (!target.tickets) target.tickets = [];
  target.tickets.push(ticket);
  if (target.id === 'resolvidos' && sourceQueueId !== 'resolvidos') {
    markTicketResolvedOptimistic(sourceQueueId);
  }
  saveTicketColumns(columns);
  entry.boxId = target.id;
  ticket.boxId = target.id;
  try {
    window.dispatchEvent(new CustomEvent('velodesk:queues-changed'));
  } catch {
    /* ignore */
  }
}

export { getAgentName };
