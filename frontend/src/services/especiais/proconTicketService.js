/**
 * proconTicketService — bridge Procon ↔ API tickets
 */
import { clientsApi, ticketsApi, boxesApi, reclamacoesApi } from '../../api/client';
import { mapClienteDocToContact } from '../../api/adapters/clienteAdapter';
import { apiTicketToCockpit, adaptColumnsFromApi } from '../../api/adapters/ticketAdapter';
import { getAgentName } from '../clientDb';
import { buildWhatsAppConvMsgs, toWhatsAppChatIdDigits } from '../desk/utils';
import { createWorkflowState, getWorkflowTemplateById } from '../desk/workflowEngine';
import { PC_STATUS } from './proconData';
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
} from './proconStore';

const PC_WORKFLOW_SLUG = 'procon-tratativa';

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Funde o snapshot congelado do ticket (registro[0].metadados.procon, gravado só na criação
 * e nunca mais atualizado) sob o item do store — o store é a fonte viva (PATCH de classificação/
 * dados via PcClassificacaoFields etc.); o snapshot só preenche campos que o item nunca teve.
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

function buildProconMeta(form) {
  const defaults = buildRegistroDefaults(form);
  return {
    protocoloProcon: defaults.protocoloProcon,
    idDemanda: defaults.idDemanda || defaults.protocoloProcon,
    statusPc: PC_STATUS.NAO_RESPONDIDA,
    prazoLegal: defaults.prazoLegal,
    dataDemanda: defaults.dataDemanda,
    assunto: defaults.assunto,
    descricao: defaults.descricao,
    consumidor: defaults.consumidor,
    cpf: defaults.cpf,
    produto: defaults.produto,
    tipo: defaults.tipo,
    motivo: defaults.motivo,
    orgaoProcon: defaults.orgaoProcon,
    cidade: defaults.cidade,
    uf: defaults.uf,
  };
}

export function buildTicketPayloadFromDemanda(form, workflow = null) {
  const meta = buildProconMeta(form);
  const cpf = normalizeCpf(form.cpf);
  const author = getAgentName();

  return {
    chamadoTitulo: String(form.assunto || '').trim() || 'Demanda Procon',
    title: String(form.assunto || '').trim() || 'Demanda Procon',
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
      detalhe: 'Demanda Procon',
      canal: 'Procon',
      responsavel: author,
      clienteCpf: cpf,
      cpf,
      clienteNome: form.consumidor || '',
      clienteTelefone: form.telefoneWhatsapp ? [form.telefoneWhatsapp] : [],
      clienteEmail: form.email ? [form.email] : [],
      procon: meta,
      workflow: workflow || undefined,
    },
  };
}

function buildFallbackPcWorkflow() {
  const now = new Date().toISOString();
  const author = getAgentName() || 'sistema';
  return {
    templateId: PC_WORKFLOW_SLUG,
    definicaoSlug: PC_WORKFLOW_SLUG,
    title: 'TRATATIVA PROCON',
    currentStepId: 'pc-triagem',
    step: 0,
    startedAt: now,
    stepHistory: [{
      stepId: 'pc-triagem',
      status: 'active',
      at: now,
      by: author,
      trigger: 'procon-register',
    }],
    status: 'active',
    systemMessageInjected: false,
  };
}

export function buildPcWorkflowState() {
  const template = getWorkflowTemplateById(PC_WORKFLOW_SLUG);
  if (template) {
    return createWorkflowState(template, {
      by: getAgentName() || 'sistema',
      trigger: 'procon-register',
    });
  }
  return buildFallbackPcWorkflow();
}

export async function registerDemandaAndCreateTicket(form) {
  const workflow = buildPcWorkflowState();
  const payload = buildTicketPayloadFromDemanda(form, workflow);
  const created = await ticketsApi.create(payload);
  const ticket = apiTicketToCockpit(created);
  const ticketId = String(ticket.id || ticket._id);

  try {
    await reclamacoesApi.create('procon', { chamadoId: ticketId });
  } catch (err) {
    console.warn('proconTicketService: triagem reclamação fail-soft', err?.message || err);
  }

  const publicText = String(form.respostaPublica || '').trim();
  if (publicText) {
    await ticketsApi.addMessage(ticketId, {
      text: publicText,
      author: getAgentName(),
      sender: 'me',
    });
  }

  const pcItem = registerDemanda({
    ...form,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo,
    workflowAtivo: true,
    workflow: 'Tratativa Procon',
    statusPc: PC_STATUS.NAO_RESPONDIDA,
  });

  return {
    id: pcItem.id,
    ticketId,
    pcItem,
    ticket,
  };
}

export async function ensurePcTicketForRespond(pcItem) {
  if (!pcItem?.id) {
    throw new Error('Demanda inválida.');
  }

  const current = getDemandaById(pcItem.id) || pcItem;

  if (current.ticketId) {
    const view = await fetchPcTicketView(current.id);
    if (!view?.pcItem) {
      throw new Error('Demanda não encontrada.');
    }
    return {
      pcItem: view.pcItem,
      ticket: view.ticket,
    };
  }

  const form = {
    ...buildRegistroDefaults(current),
    ...current,
    id: current.id,
    consumidor: String(current.consumidor || '').trim() || 'Consumidor',
    assunto: String(current.assunto || '').trim() || 'Demanda Procon',
    descricao: String(current.descricao || current.assunto || '').trim() || 'Demanda Procon',
    isDraft: false,
  };

  const result = await registerDemandaAndCreateTicket(form);
  return {
    pcItem: result.pcItem,
    ticket: result.ticket,
  };
}

export function buildDemandaFromCliente(doc) {
  const contact = mapClienteDocToContact(doc);
  if (!contact) return null;
  const consumidor = String(contact.clientName || '').trim() || 'Consumidor';
  const assunto = `Demanda Procon — ${consumidor}`;
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

export async function fetchPcTicketView(pcId) {
  const pcItem = getDemandaById(pcId) || getDemandaByTicketId(pcId);
  if (!pcItem) return null;

  if (!pcItem.ticketId) {
    return { pcItem, ticket: null };
  }

  const raw = await ticketsApi.get(pcItem.ticketId);
  const ticket = apiTicketToCockpit(raw);
  updateDemandaGroupFromTicket(ticket);
  const syncedItem = getDemandaById(pcId) || pcItem;
  const apiPc = ticket.lateralForm?.procon;

  return {
    pcItem: {
      ...overlayFrozenTicketMeta(syncedItem, apiPc),
      ticketId: syncedItem.ticketId,
      chamadoProtocolo: ticket.chamadoProtocolo || syncedItem.chamadoProtocolo,
    },
    ticket,
  };
}

function resolvePcWhatsAppChatId(ticket) {
  return toWhatsAppChatIdDigits(
    ticket?.lateralForm?.clienteTelefoneWhatsapp
    || (Array.isArray(ticket?.lateralForm?.clienteTelefone) ? ticket.lateralForm.clienteTelefone[0] : '')
    || ticket?.clientPhone
    || '',
  );
}

export async function sendPcWaMessage(ticketId, text, ticket) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const waChatId = resolvePcWhatsAppChatId(ticket);
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
export function pcTicketHasAgentReply(ticket) {
  return buildWhatsAppConvMsgs(ticket).some((msg) => msg.type === 'agent' && String(msg.text || '').trim());
}

/**
 * Saudação inicial padrão do time de Procon — vira o {{3}} do template WhatsApp aprovado
 * (DESK_ACTIVE_WHATSAPP_TEMPLATE_TWILIO_BODY), que já cobre "Olá {nome}, aqui é o Velotax."
 * e "Referente ao seu chamado {protocolo}:" — por isso não repete nome nem protocolo.
 */
export function buildPcInitialGreetingMessage({ agentName }) {
  const agente = String(agentName || '').trim() || 'Atendimento Velotax';
  return `Tudo bem? Me chamo ${agente} e sou especialista no atendimento de demandas Procon, no Velotax. Podemos conversar por aqui?`;
}

export async function publishPcPublicResponse(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    text: String(text || '').trim(),
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export async function savePcInternalNote(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    internalText: String(text || '').trim(),
    text: '',
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export function getPcThreadMessages(ticket, pcItem) {
  const messages = ticket?.messages || [];
  if (!messages.length) return [];

  const complaintText = String(pcItem?.descricao || messages[0]?.text || '').trim();
  return messages.filter((msg, index) => {
    if (index === 0 && msg.fromClient && String(msg.text || '').trim() === complaintText) {
      return false;
    }
    return Boolean(String(msg.text || '').trim());
  });
}

export function formatPcDeadlineLabel(iso) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Prazo vencido';
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days > 0) {
    return `${days} dia${days > 1 ? 's' : ''} e ${hours} hora${hours !== 1 ? 's' : ''}`;
  }
  return `${hours} hora${hours !== 1 ? 's' : ''}`;
}

function normalizeCanal(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function isProconChannelTicket(ticket) {
  if (!ticket) return false;
  const channel = normalizeCanal(ticket.channel ?? ticket.source);
  if (channel === 'procon') return true;
  const lf = ticket.lateralForm || {};
  if (normalizeCanal(lf.canal).includes('procon')) return true;
  const pc = lf.procon;
  return Boolean(pc && typeof pc === 'object' && !Array.isArray(pc));
}

export function buildDemandaFromTicket(ticket) {
  const lf = ticket.lateralForm || {};
  const pc = (lf.procon && typeof lf.procon === 'object' && !Array.isArray(lf.procon))
    ? lf.procon
    : {};
  const ticketId = String(ticket.id || ticket._id || '');
  const consumidor = String(
    pc.consumidor || ticket.clientName || lf.clienteNome || '',
  ).trim();
  const assunto = String(
    pc.assunto || ticket.chamadoTitulo || ticket.title || 'Demanda Procon',
  ).trim();
  const cpf = String(pc.cpf || ticket.clientCPF || lf.clienteCpf || lf.cpf || '').trim();
  const prazoLegal = pc.prazoLegal || null;
  const defaults = buildRegistroDefaults({
    protocoloProcon: pc.protocoloProcon || ticket.chamadoProtocolo || undefined,
    consumidor,
    assunto,
    cpf,
    descricao: String(pc.descricao || ticket.description || ticket.text || '').trim(),
    idDemanda: pc.idDemanda || '',
    dataDemanda: pc.dataDemanda || ticket.createdAt,
    orgaoProcon: pc.orgaoProcon || '',
    cidade: pc.cidade || '',
    uf: pc.uf || '',
    produto: pc.produto || lf.produto || '',
    tipo: pc.tipo || lf.tipoChamado || lf.classificacaoTipo || 'Reclamação',
    motivo: pc.motivo || lf.motivo || assunto,
    prazoLegal,
    statusPc: pc.statusPc || PC_STATUS.NAO_RESPONDIDA,
    tabulacao: lf.produto || pc.produto || '—',
    atendente: lf.responsavel || ticket.responsibleAgent || '—',
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo || '',
    workflowAtivo: false,
    respostaAction: 'responder',
  });

  return applyTicketStatusToEspeciaisItem({
    ...defaults,
    id: `pc-ticket-${ticketId}`,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo || defaults.chamadoProtocolo,
  }, ticket, {
    statusField: 'statusPc',
    naoRespondidaStatus: PC_STATUS.NAO_RESPONDIDA,
    prazoField: 'prazoLegal',
  });
}

export function syncProconDemandaFromTicket(ticket) {
  if (!isProconChannelTicket(ticket)) return null;
  const ticketId = String(ticket.id || ticket._id || '');
  if (!ticketId) return null;
  if (getDemandaByTicketId(ticketId)) return null;
  return mirrorDemandaFromTicket(buildDemandaFromTicket(ticket));
}

export function syncProconDemandasFromTickets(tickets = []) {
  let synced = 0;
  (tickets || []).forEach((entry) => {
    const ticket = entry?.ticket ?? entry;
    if (syncProconDemandaFromTicket(ticket)) synced += 1;
  });
  return synced;
}

export async function loadProconTicketsFromApi() {
  try {
    const items = await refreshDemandasFromApi();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('velodesk:procon-sync'));
    }
    return items.length;
  } catch (err) {
    console.warn('proconTicketService: falha ao carregar reclamacoes procon', err?.message || err);
    return 0;
  }
}
