/**
 * bacenTicketService — bridge Bacen ↔ API tickets
 */
import { clientsApi, ticketsApi, boxesApi, reclamacoesApi } from '../../api/client';
import { mapClienteDocToContact } from '../../api/adapters/clienteAdapter';
import { apiTicketToCockpit, adaptColumnsFromApi } from '../../api/adapters/ticketAdapter';
import { getAgentName } from '../clientDb';
import { buildWhatsAppConvMsgs, toWhatsAppChatIdDigits } from '../desk/utils';
import { createWorkflowState, getWorkflowTemplateById } from '../desk/workflowEngine';
import { BC_STATUS } from './bacenData';
import { applyTicketStatusToEspeciaisItem } from './especiaisGroupKey';
import {
  buildRegistroDefaults,
  createEmptyDemanda,
  registerDemanda,
  getDemandaById,
  getDemandaByTicketId,
  mirrorDemandaFromTicket,
  refreshDemandasFromApi,
  updateDemandaGroupFromTicket,
} from './bacenStore';

const BC_WORKFLOW_SLUG = 'bacen-tratativa';

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Funde o snapshot congelado do ticket (registro[0].metadados.bacen, gravado só na criação e
 * nunca mais atualizado) sob o item do store — o store é a fonte viva (PATCH de classificação/
 * dados via BcClassificacaoFields etc.); o snapshot só preenche campos que o item nunca teve.
 */
function overlayFrozenTicketMeta(storeItem, frozenMeta) {
  if (!frozenMeta || typeof frozenMeta !== 'object') return storeItem;
  const merged = { ...frozenMeta, ...storeItem };
  Object.keys(frozenMeta).forEach((key) => {
    if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
      merged[key] = frozenMeta[key];
    }
  });
  return merged;
}

function buildBacenMeta(form) {
  const defaults = buildRegistroDefaults(form);
  return {
    protocoloBacen: defaults.protocoloBacen,
    idDemanda: defaults.idDemanda || defaults.protocoloBacen,
    statusBc: BC_STATUS.NAO_RESPONDIDA,
    prazoLegal: defaults.prazoLegal,
    dataDemanda: defaults.dataDemanda,
    assunto: defaults.assunto,
    descricao: defaults.descricao,
    consumidor: defaults.consumidor,
    cpf: defaults.cpf,
    produto: defaults.produto,
    tipo: defaults.tipo,
    motivo: defaults.motivo,
    orgaoBacen: defaults.orgaoBacen,
    cidade: defaults.cidade,
    uf: defaults.uf,
  };
}

export function buildTicketPayloadFromDemanda(form, workflow = null) {
  const meta = buildBacenMeta(form);
  const cpf = normalizeCpf(form.cpf);
  const author = getAgentName();

  return {
    chamadoTitulo: String(form.assunto || '').trim() || 'Demanda Bacen',
    title: String(form.assunto || '').trim() || 'Demanda Bacen',
    text: String(form.descricao || '').trim(),
    description: String(form.descricao || '').trim(),
    status: 'novo',
    clientName: String(form.consumidor || '').trim(),
    clientCPF: cpf || undefined,
    author,
    lateralForm: {
      classificacaoTipo: form.tipo || 'Reclamação',
      tipoChamado: form.tipo || 'Reclamação',
      produto: form.produto || '',
      motivo: form.motivo || form.assunto || '',
      detalhe: 'Demanda Bacen',
      canal: 'Bacen',
      responsavel: author,
      clienteCpf: cpf,
      cpf,
      clienteNome: form.consumidor || '',
      clienteTelefone: form.telefoneWhatsapp ? [form.telefoneWhatsapp] : [],
      clienteEmail: form.email ? [form.email] : [],
      bacen: meta,
      workflow: workflow || undefined,
    },
  };
}

function buildFallbackBcWorkflow() {
  const now = new Date().toISOString();
  const author = getAgentName() || 'sistema';
  return {
    templateId: BC_WORKFLOW_SLUG,
    definicaoSlug: BC_WORKFLOW_SLUG,
    title: 'TRATATIVA BACEN',
    currentStepId: 'bc-triagem',
    step: 0,
    startedAt: now,
    stepHistory: [{
      stepId: 'bc-triagem',
      status: 'active',
      at: now,
      by: author,
      trigger: 'bacen-register',
    }],
    status: 'active',
    systemMessageInjected: false,
  };
}

export function buildBcWorkflowState() {
  const template = getWorkflowTemplateById(BC_WORKFLOW_SLUG);
  if (template) {
    return createWorkflowState(template, {
      by: getAgentName() || 'sistema',
      trigger: 'bacen-register',
    });
  }
  return buildFallbackBcWorkflow();
}

export async function registerDemandaAndCreateTicket(form) {
  const workflow = buildBcWorkflowState();
  const payload = buildTicketPayloadFromDemanda(form, workflow);
  const created = await ticketsApi.create(payload);
  const ticket = apiTicketToCockpit(created);
  const ticketId = String(ticket.id || ticket._id);

  try {
    await reclamacoesApi.create('bacen', { chamadoId: ticketId });
  } catch (err) {
    console.warn('bacenTicketService: triagem reclamação fail-soft', err?.message || err);
  }

  const publicText = String(form.respostaPublica || '').trim();
  if (publicText) {
    await ticketsApi.addMessage(ticketId, {
      text: publicText,
      author: getAgentName(),
      sender: 'me',
    });
  }

  const bcItem = registerDemanda({
    ...form,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo,
    workflowAtivo: true,
    workflow: 'Tratativa Bacen',
    statusBc: BC_STATUS.NAO_RESPONDIDA,
  });

  return {
    id: bcItem.id,
    ticketId,
    bcItem,
    ticket,
  };
}

export async function ensureBcTicketForRespond(bcItem) {
  if (!bcItem?.id) {
    throw new Error('Demanda inválida.');
  }

  const current = getDemandaById(bcItem.id) || bcItem;

  if (current.ticketId) {
    const view = await fetchBcTicketView(current.id);
    if (!view?.bcItem) {
      throw new Error('Demanda não encontrada.');
    }
    return {
      bcItem: view.bcItem,
      ticket: view.ticket,
    };
  }

  const form = {
    ...buildRegistroDefaults(current),
    ...current,
    id: current.id,
    consumidor: String(current.consumidor || '').trim() || 'Consumidor',
    assunto: String(current.assunto || '').trim() || 'Demanda Bacen',
    descricao: String(current.descricao || current.assunto || '').trim() || 'Demanda Bacen',
    isDraft: false,
  };

  const result = await registerDemandaAndCreateTicket(form);
  return {
    bcItem: result.bcItem,
    ticket: result.ticket,
  };
}

export function buildDemandaFromCliente(doc) {
  const contact = mapClienteDocToContact(doc);
  if (!contact) return null;
  const consumidor = String(contact.clientName || '').trim() || 'Consumidor';
  const assunto = `Demanda Bacen — ${consumidor}`;
  const empty = createEmptyDemanda();
  return {
    ...empty,
    ...buildRegistroDefaults({
      ...empty,
      consumidor,
      cpf: contact.clientCPF,
      email: contact.email || contact.emails?.[0] || '',
      telefoneWhatsapp: contact.whatsappPhone || contact.phone || contact.phones?.[0] || '',
      assunto,
      descricao: '',
      produto: 'Empréstimo',
      tipo: 'Reclamação',
      motivo: assunto,
      isDraft: false,
    }),
    id: empty.id,
  };
}

export async function createDemandaFromCliente(doc) {
  const form = buildDemandaFromCliente(doc);
  if (!form) {
    throw new Error('Dados do cliente inválidos.');
  }
  return registerDemandaAndCreateTicket(form);
}

export async function createDemandaFromCpf(cpfRaw) {
  const cpf = normalizeCpf(cpfRaw);
  // getByCpf resolve `null` em 404 (não lança) — sinaliza explicitamente pro chamador.
  const cliente = await clientsApi.getByCpf(cpf);
  if (!cliente) {
    throw Object.assign(new Error('Cliente não encontrado.'), { clienteNotFound: true });
  }
  return createDemandaFromCliente(cliente);
}

export async function fetchBcTicketView(bcId) {
  const bcItem = getDemandaById(bcId) || getDemandaByTicketId(bcId);
  if (!bcItem) return null;

  if (!bcItem.ticketId) {
    return { bcItem, ticket: null };
  }

  const raw = await ticketsApi.get(bcItem.ticketId);
  const ticket = apiTicketToCockpit(raw);
  updateDemandaGroupFromTicket(ticket);
  const syncedItem = getDemandaById(bcId) || bcItem;
  const apiBc = ticket.lateralForm?.bacen;

  return {
    bcItem: {
      ...overlayFrozenTicketMeta(syncedItem, apiBc),
      ticketId: syncedItem.ticketId,
      chamadoProtocolo: ticket.chamadoProtocolo || syncedItem.chamadoProtocolo,
    },
    ticket,
  };
}

function resolveBcWhatsAppChatId(ticket) {
  return toWhatsAppChatIdDigits(
    ticket?.lateralForm?.clienteTelefoneWhatsapp
    || (Array.isArray(ticket?.lateralForm?.clienteTelefone) ? ticket.lateralForm.clienteTelefone[0] : '')
    || ticket?.clientPhone
    || '',
  );
}

export async function sendBcWaMessage(ticketId, text, ticket) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const waChatId = resolveBcWhatsAppChatId(ticket);
  await ticketsApi.sendWhatsAppMessage(ticketId, {
    text: trimmed,
    waChatId: waChatId || undefined,
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

/**
 * true assim que o agente enviar a 1ª mensagem via WhatsApp — critério é específico do canal
 * WhatsApp (não considera mensagens registradas públicas/internas de outros canais).
 */
export function bcTicketHasAgentReply(ticket) {
  return buildWhatsAppConvMsgs(ticket).some((msg) => msg.type === 'agent' && String(msg.text || '').trim());
}

/**
 * Saudação inicial padrão do time de Bacen — vira o {{3}} do template WhatsApp aprovado
 * (DESK_ACTIVE_WHATSAPP_TEMPLATE_TWILIO_BODY), que já cobre "Olá {nome}, aqui é o Velotax."
 * e "Referente ao seu chamado {protocolo}:" — por isso não repete nome nem protocolo.
 */
export function buildBcInitialGreetingMessage({ agentName }) {
  const agente = String(agentName || '').trim() || 'Atendimento Velotax';
  return `Tudo bem? Me chamo ${agente} e sou especialista no atendimento de demandas Bacen, no Velotax. Podemos conversar por aqui?`;
}

export async function publishBcPublicResponse(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    text: String(text || '').trim(),
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export async function saveBcInternalNote(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    internalText: String(text || '').trim(),
    text: '',
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export function getBcThreadMessages(ticket, bcItem) {
  const messages = ticket?.messages || [];
  if (!messages.length) return [];

  const complaintText = String(bcItem?.descricao || messages[0]?.text || '').trim();
  return messages.filter((msg, index) => {
    if (index === 0 && msg.fromClient && String(msg.text || '').trim() === complaintText) {
      return false;
    }
    return Boolean(String(msg.text || '').trim());
  });
}

/** Mostra a data-limite em si (só data, sem hora — diferente de "Data da demanda"). */
export function formatBcDeadlineLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const formatted = d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return d.getTime() <= Date.now() ? `${formatted} (vencido)` : formatted;
}

function normalizeCanal(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isBacenChannelTicket(ticket) {
  if (!ticket) return false;
  const channel = normalizeCanal(ticket.channel ?? ticket.source);
  if (channel === 'bacen') return true;
  const lf = ticket.lateralForm || {};
  if (normalizeCanal(lf.canal).includes('bacen')) return true;
  const pc = lf.bacen;
  return Boolean(pc && typeof pc === 'object' && !Array.isArray(pc));
}

export function buildDemandaFromTicket(ticket) {
  const lf = ticket.lateralForm || {};
  const pc = (lf.bacen && typeof lf.bacen === 'object' && !Array.isArray(lf.bacen))
    ? lf.bacen
    : {};
  const ticketId = String(ticket.id || ticket._id || '');
  const consumidor = String(
    pc.consumidor || ticket.clientName || lf.clienteNome || '',
  ).trim();
  const assunto = String(
    pc.assunto || ticket.chamadoTitulo || ticket.title || 'Demanda Bacen',
  ).trim();
  const cpf = String(pc.cpf || ticket.clientCPF || lf.clienteCpf || lf.cpf || '').trim();
  const prazoLegal = pc.prazoLegal || null;
  const defaults = buildRegistroDefaults({
    protocoloBacen: pc.protocoloBacen || ticket.chamadoProtocolo || undefined,
    consumidor,
    assunto,
    cpf,
    descricao: String(pc.descricao || ticket.description || ticket.text || '').trim(),
    idDemanda: pc.idDemanda || '',
    dataDemanda: pc.dataDemanda || ticket.createdAt,
    orgaoBacen: pc.orgaoBacen || '',
    cidade: pc.cidade || '',
    uf: pc.uf || '',
    produto: pc.produto || lf.produto || '',
    tipo: pc.tipo || lf.tipoChamado || lf.classificacaoTipo || 'Reclamação',
    motivo: pc.motivo || lf.motivo || assunto,
    prazoLegal,
    statusBc: pc.statusBc || BC_STATUS.NAO_RESPONDIDA,
    tabulacao: lf.produto || pc.produto || '—',
    atendente: lf.responsavel || ticket.responsibleAgent || '—',
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo || '',
    workflowAtivo: false,
    respostaAction: 'responder',
  });

  return applyTicketStatusToEspeciaisItem({
    ...defaults,
    id: `bc-ticket-${ticketId}`,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo || defaults.chamadoProtocolo,
  }, ticket, {
    statusField: 'statusBc',
    naoRespondidaStatus: BC_STATUS.NAO_RESPONDIDA,
    prazoField: 'prazoLegal',
  });
}

export function syncBacenDemandaFromTicket(ticket) {
  if (!isBacenChannelTicket(ticket)) return null;
  const ticketId = String(ticket.id || ticket._id || '');
  if (!ticketId) return null;
  if (getDemandaByTicketId(ticketId)) return null;
  return mirrorDemandaFromTicket(buildDemandaFromTicket(ticket));
}

export function syncBacenDemandasFromTickets(tickets = []) {
  let synced = 0;
  (tickets || []).forEach((entry) => {
    const ticket = entry?.ticket ?? entry;
    if (syncBacenDemandaFromTicket(ticket)) synced += 1;
  });
  return synced;
}

export async function loadBacenTicketsFromApi() {
  try {
    const items = await refreshDemandasFromApi();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('velodesk:bacen-sync'));
    }
    return items.length;
  } catch (err) {
    console.warn('bacenTicketService: falha ao carregar reclamacoes bacen', err?.message || err);
    return 0;
  }
}
