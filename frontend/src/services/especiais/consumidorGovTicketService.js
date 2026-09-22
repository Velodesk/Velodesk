/**
 * consumidorGovTicketService — bridge ConsumidorGov ↔ API tickets
 */
import { clientsApi, ticketsApi, boxesApi, reclamacoesApi } from '../../api/client';
import { mapClienteDocToContact } from '../../api/adapters/clienteAdapter';
import { apiTicketToCockpit, adaptColumnsFromApi } from '../../api/adapters/ticketAdapter';
import { getAgentName } from '../clientDb';
import { buildWhatsAppConvMsgs, toWhatsAppChatIdDigits } from '../desk/utils';
import { createWorkflowState, getWorkflowTemplateById } from '../desk/workflowEngine';
import { CG_STATUS } from './consumidorGovData';
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
} from './consumidorGovStore';

const CG_WORKFLOW_SLUG = 'consumidor-gov-tratativa';

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Funde o snapshot congelado do ticket (registro[0].metadados.consumidorGov, gravado só na
 * criação e nunca mais atualizado) sob o item do store — o store é a fonte viva (PATCH de
 * classificação/dados via CgClassificacaoFields etc.); o snapshot só preenche campos que o item
 * nunca teve.
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

function buildConsumidorGovMeta(form) {
  const defaults = buildRegistroDefaults(form);
  return {
    protocoloGov: defaults.protocoloGov,
    idDemanda: defaults.idDemanda || defaults.protocoloGov,
    statusGov: CG_STATUS.NAO_RESPONDIDA,
    prazoLegal: defaults.prazoLegal,
    dataDemanda: defaults.dataDemanda,
    assunto: defaults.assunto,
    descricao: defaults.descricao,
    consumidor: defaults.consumidor,
    cpf: defaults.cpf,
    produto: defaults.produto,
    tipo: defaults.tipo,
    motivo: defaults.motivo,
    orgaoGov: defaults.orgaoGov,
    cidade: defaults.cidade,
    uf: defaults.uf,
  };
}

export function buildTicketPayloadFromDemanda(form, workflow = null) {
  const meta = buildConsumidorGovMeta(form);
  const cpf = normalizeCpf(form.cpf);
  const author = getAgentName();

  return {
    chamadoTitulo: String(form.assunto || '').trim() || 'Demanda Consumidor.Gov',
    title: String(form.assunto || '').trim() || 'Demanda Consumidor.Gov',
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
      detalhe: 'Demanda Consumidor.Gov',
      canal: 'Consumidor.Gov',
      responsavel: author,
      clienteCpf: cpf,
      cpf,
      clienteNome: form.consumidor || '',
      clienteTelefone: form.telefoneWhatsapp ? [form.telefoneWhatsapp] : [],
      clienteEmail: form.email ? [form.email] : [],
      consumidorGov: meta,
      workflow: workflow || undefined,
    },
  };
}

function buildFallbackCgWorkflow() {
  const now = new Date().toISOString();
  const author = getAgentName() || 'sistema';
  return {
    templateId: CG_WORKFLOW_SLUG,
    definicaoSlug: CG_WORKFLOW_SLUG,
    title: 'TRATATIVA CONSUMIDOR.GOV',
    currentStepId: 'cg-triagem',
    step: 0,
    startedAt: now,
    stepHistory: [{
      stepId: 'cg-triagem',
      status: 'active',
      at: now,
      by: author,
      trigger: 'consumidor-gov-register',
    }],
    status: 'active',
    systemMessageInjected: false,
  };
}

export function buildCgWorkflowState() {
  const template = getWorkflowTemplateById(CG_WORKFLOW_SLUG);
  if (template) {
    return createWorkflowState(template, {
      by: getAgentName() || 'sistema',
      trigger: 'consumidor-gov-register',
    });
  }
  return buildFallbackCgWorkflow();
}

export async function registerDemandaAndCreateTicket(form) {
  const workflow = buildCgWorkflowState();
  const payload = buildTicketPayloadFromDemanda(form, workflow);
  const created = await ticketsApi.create(payload);
  const ticket = apiTicketToCockpit(created);
  const ticketId = String(ticket.id || ticket._id);

  try {
    await reclamacoesApi.create('consumidor-gov', { chamadoId: ticketId });
  } catch (err) {
    console.warn('consumidorGovTicketService: triagem reclamação fail-soft', err?.message || err);
  }

  const publicText = String(form.respostaPublica || '').trim();
  if (publicText) {
    await ticketsApi.addMessage(ticketId, {
      text: publicText,
      author: getAgentName(),
      sender: 'me',
    });
  }

  const cgItem = registerDemanda({
    ...form,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo,
    workflowAtivo: true,
    workflow: 'Tratativa Consumidor.Gov',
    statusGov: CG_STATUS.NAO_RESPONDIDA,
  });

  return {
    id: cgItem.id,
    ticketId,
    cgItem,
    ticket,
  };
}

export async function ensureCgTicketForRespond(cgItem) {
  if (!cgItem?.id) {
    throw new Error('Demanda inválida.');
  }

  const current = getDemandaById(cgItem.id) || cgItem;

  if (current.ticketId) {
    const view = await fetchCgTicketView(current.id);
    if (!view?.cgItem) {
      throw new Error('Demanda não encontrada.');
    }
    return {
      cgItem: view.cgItem,
      ticket: view.ticket,
    };
  }

  const form = {
    ...buildRegistroDefaults(current),
    ...current,
    id: current.id,
    consumidor: String(current.consumidor || '').trim() || 'Consumidor',
    assunto: String(current.assunto || '').trim() || 'Demanda Consumidor.Gov',
    descricao: String(current.descricao || current.assunto || '').trim() || 'Demanda Consumidor.Gov',
    isDraft: false,
  };

  const result = await registerDemandaAndCreateTicket(form);
  return {
    cgItem: result.cgItem,
    ticket: result.ticket,
  };
}

export function buildDemandaFromCliente(doc) {
  const contact = mapClienteDocToContact(doc);
  if (!contact) return null;
  const consumidor = String(contact.clientName || '').trim() || 'Consumidor';
  const assunto = `Demanda Consumidor.Gov — ${consumidor}`;
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

export async function fetchCgTicketView(cgId) {
  const cgItem = getDemandaById(cgId) || getDemandaByTicketId(cgId);
  if (!cgItem) return null;

  if (!cgItem.ticketId) {
    return { cgItem, ticket: null };
  }

  const raw = await ticketsApi.get(cgItem.ticketId);
  const ticket = apiTicketToCockpit(raw);
  updateDemandaGroupFromTicket(ticket);
  const syncedItem = getDemandaById(cgId) || cgItem;
  const apiCg = ticket.lateralForm?.consumidorGov;

  return {
    cgItem: {
      ...overlayFrozenTicketMeta(syncedItem, apiCg),
      ticketId: syncedItem.ticketId,
      chamadoProtocolo: ticket.chamadoProtocolo || syncedItem.chamadoProtocolo,
    },
    ticket,
  };
}

function resolveCgWhatsAppChatId(ticket) {
  return toWhatsAppChatIdDigits(
    ticket?.lateralForm?.clienteTelefoneWhatsapp
    || (Array.isArray(ticket?.lateralForm?.clienteTelefone) ? ticket.lateralForm.clienteTelefone[0] : '')
    || ticket?.clientPhone
    || '',
  );
}

export async function sendCgWaMessage(ticketId, text, ticket) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const waChatId = resolveCgWhatsAppChatId(ticket);
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
export function cgTicketHasAgentReply(ticket) {
  return buildWhatsAppConvMsgs(ticket).some((msg) => msg.type === 'agent' && String(msg.text || '').trim());
}

/**
 * Saudação inicial padrão do time de Consumidor.gov — vira o {{3}} do template WhatsApp
 * aprovado (DESK_ACTIVE_WHATSAPP_TEMPLATE_TWILIO_BODY), que já cobre "Olá {nome}, aqui é o
 * Velotax." e "Referente ao seu chamado {protocolo}:" — por isso não repete nome nem protocolo.
 */
export function buildCgInitialGreetingMessage({ agentName }) {
  const agente = String(agentName || '').trim() || 'Atendimento Velotax';
  return `Tudo bem? Me chamo ${agente} e sou especialista no atendimento de demandas Consumidor.gov, no Velotax. Podemos conversar por aqui?`;
}

export async function publishCgPublicResponse(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    text: String(text || '').trim(),
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export async function saveCgInternalNote(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    internalText: String(text || '').trim(),
    text: '',
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export function getCgThreadMessages(ticket, cgItem) {
  const messages = ticket?.messages || [];
  if (!messages.length) return [];

  const complaintText = String(cgItem?.descricao || messages[0]?.text || '').trim();
  return messages.filter((msg, index) => {
    if (index === 0 && msg.fromClient && String(msg.text || '').trim() === complaintText) {
      return false;
    }
    return Boolean(String(msg.text || '').trim());
  });
}

/** Mostra a data-limite em si (só data, sem hora — diferente de "Data da demanda"). */
export function formatCgDeadlineLabel(iso) {
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

export function isConsumidorGovChannelTicket(ticket) {
  if (!ticket) return false;
  const channel = normalizeCanal(ticket.channel ?? ticket.source);
  if (channel === 'consumidor-gov' || channel === 'consumidorgov') return true;
  const lf = ticket.lateralForm || {};
  const canal = normalizeCanal(lf.canal);
  if (canal.includes('consumidor') && canal.includes('gov')) return true;
  const gov = lf.consumidorGov;
  return Boolean(gov && typeof gov === 'object' && !Array.isArray(gov));
}

export function buildDemandaFromTicket(ticket) {
  const lf = ticket.lateralForm || {};
  const pc = (lf.consumidorGov && typeof lf.consumidorGov === 'object' && !Array.isArray(lf.consumidorGov))
    ? lf.consumidorGov
    : {};
  const ticketId = String(ticket.id || ticket._id || '');
  const consumidor = String(
    pc.consumidor || ticket.clientName || lf.clienteNome || '',
  ).trim();
  const assunto = String(
    pc.assunto || ticket.chamadoTitulo || ticket.title || 'Demanda Consumidor.Gov',
  ).trim();
  const cpf = String(pc.cpf || ticket.clientCPF || lf.clienteCpf || lf.cpf || '').trim();
  const prazoLegal = pc.prazoLegal || null;
  const defaults = buildRegistroDefaults({
    protocoloGov: pc.protocoloGov || ticket.chamadoProtocolo || undefined,
    consumidor,
    assunto,
    cpf,
    descricao: String(pc.descricao || ticket.description || ticket.text || '').trim(),
    idDemanda: pc.idDemanda || '',
    dataDemanda: pc.dataDemanda || ticket.createdAt,
    orgaoGov: pc.orgaoGov || '',
    cidade: pc.cidade || '',
    uf: pc.uf || '',
    produto: pc.produto || lf.produto || '',
    tipo: pc.tipo || lf.tipoChamado || lf.classificacaoTipo || 'Reclamação',
    motivo: pc.motivo || lf.motivo || assunto,
    prazoLegal,
    statusGov: pc.statusGov || CG_STATUS.NAO_RESPONDIDA,
    tabulacao: lf.produto || pc.produto || '—',
    atendente: lf.responsavel || ticket.responsibleAgent || '—',
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo || '',
    workflowAtivo: false,
    respostaAction: 'responder',
  });

  return applyTicketStatusToEspeciaisItem({
    ...defaults,
    id: `cg-ticket-${ticketId}`,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo || defaults.chamadoProtocolo,
  }, ticket, {
    statusField: 'statusGov',
    naoRespondidaStatus: CG_STATUS.NAO_RESPONDIDA,
    prazoField: 'prazoLegal',
  });
}

export function syncConsumidorGovDemandaFromTicket(ticket) {
  if (!isConsumidorGovChannelTicket(ticket)) return null;
  const ticketId = String(ticket.id || ticket._id || '');
  if (!ticketId) return null;
  if (getDemandaByTicketId(ticketId)) return null;
  return mirrorDemandaFromTicket(buildDemandaFromTicket(ticket));
}

export function syncConsumidorGovDemandasFromTickets(tickets = []) {
  let synced = 0;
  (tickets || []).forEach((entry) => {
    const ticket = entry?.ticket ?? entry;
    if (syncConsumidorGovDemandaFromTicket(ticket)) synced += 1;
  });
  return synced;
}

export async function loadConsumidorGovTicketsFromApi() {
  try {
    const items = await refreshDemandasFromApi();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('velodesk:consumidor-gov-sync'));
    }
    return items.length;
  } catch (err) {
    console.warn('consumidorGovTicketService: falha ao carregar reclamacoes consumidor-gov', err?.message || err);
    return 0;
  }
}
