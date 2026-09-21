/**
 * reclameAquiTicketService — bridge Reclame Aqui ↔ API tickets
 * VERSION: v1.2.3 | DATE: 2026-08-24
 * — createReclamacaoFromCpf sinaliza clienteNotFound explicitamente (404 nunca chega como err.response)
 */
import { ticketsApi, reclamacoesApi, clientsApi } from '../../api/client';
import { apiTicketToCockpit } from '../../api/adapters/ticketAdapter';
import { mapClienteDocToContact } from '../../api/adapters/clienteAdapter';
import { getAgentName } from '../clientDb';
import { buildWhatsAppConvMsgs, toWhatsAppChatIdDigits } from '../desk/utils';
import { RA_STATUS } from './reclameAquiData';
import {
  buildRegistroDefaults,
  createEmptyReclamacao,
  registerReclamacao,
  getReclamacaoById,
  getReclamacaoByTicketId,
  updateReclamacaoGroupFromTicket,
  refreshReclamacoesFromApi,
} from './reclameAquiStore';

function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Funde o snapshot congelado do ticket (registro[0].metadados.reclameAqui, gravado só na criação
 * e nunca mais atualizado) sob o item do store — o store é a fonte viva (PATCH de classificação/
 * dados via RaClassificacaoFields, RaDadosEditableFields etc.); o snapshot só preenche campos que
 * o item nunca teve.
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

function buildReclameAquiMeta(form) {
  const defaults = buildRegistroDefaults(form);
  const idOrigem = String(defaults.idReclamacaoRa || defaults.protocoloRa || '').trim();
  return {
    protocoloRa: idOrigem,
    idReclamacaoRa: idOrigem,
    statusRa: RA_STATUS.NAO_RESPONDIDA,
    prazoRa: defaults.prazoRa || undefined,
    dataReclamacao: defaults.dataReclamacao,
    passivelNota: Boolean(defaults.passivelNota),
    assunto: defaults.assunto,
    descricao: defaults.descricao,
    consumidor: defaults.consumidor,
    cpf: defaults.cpf,
    produto: defaults.produto,
    tipo: defaults.tipo,
    motivo: defaults.motivo,
    urlRa: defaults.urlRa || '',
  };
}

export function buildTicketPayloadFromReclamacao(form) {
  const meta = buildReclameAquiMeta(form);
  const cpf = normalizeCpf(form.cpf);
  const author = getAgentName();

  return {
    chamadoTitulo: String(form.assunto || '').trim() || 'Reclamação Reclame Aqui',
    title: String(form.assunto || '').trim() || 'Reclamação Reclame Aqui',
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
      motivo: form.motivo || '',
      detalhe: 'Reclamação Reclame Aqui',
      canal: 'Reclame Aqui',
      responsavel: author,
      clienteCpf: cpf,
      cpf,
      clienteNome: form.consumidor || '',
      clienteTelefone: form.telefoneWhatsapp ? [form.telefoneWhatsapp] : [],
      clienteEmail: form.email ? [form.email] : [],
      reclameAqui: meta,
    },
  };
}

/**
 * Reclamação a partir de um cliente achado/cadastrado por CPF — ID Reclame Aqui, assunto,
 * produto, motivo e prazo ficam em branco para edição direta no DADOS do ticket recém-criado.
 */
export function buildReclamacaoFromCliente(doc) {
  const contact = mapClienteDocToContact(doc);
  if (!contact) return null;
  const consumidor = String(contact.clientName || '').trim() || 'Consumidor';
  return {
    ...createEmptyReclamacao(),
    consumidor,
    cpf: contact.clientCPF || '',
    email: contact.email || contact.emails?.[0] || '',
    telefoneWhatsapp: contact.whatsappPhone || contact.phone || contact.phones?.[0] || '',
    assunto: `Reclamação Reclame Aqui — ${consumidor}`,
    isDraft: false,
  };
}

export async function createReclamacaoFromCliente(doc) {
  const form = buildReclamacaoFromCliente(doc);
  if (!form) {
    throw new Error('Dados do cliente inválidos.');
  }
  return registerReclamacaoAndCreateTicket(form);
}

export async function createReclamacaoFromCpf(cpfRaw) {
  const cpf = normalizeCpf(cpfRaw);
  // getByCpf resolve `null` em 404 (não lança) — sinaliza explicitamente pro chamador em vez de
  // deixar cair no erro genérico "Dados do cliente inválidos" de createReclamacaoFromCliente,
  // que não tem como o catch de UI distinguir de "cliente não encontrado" (err.response é undefined).
  const cliente = await clientsApi.getByCpf(cpf);
  if (!cliente) {
    throw Object.assign(new Error('Cliente não encontrado.'), { clienteNotFound: true });
  }
  return createReclamacaoFromCliente(cliente);
}

export async function createTicketFromReclamacao(form) {
  const payload = buildTicketPayloadFromReclamacao(form);
  const created = await ticketsApi.create(payload);
  return apiTicketToCockpit(created);
}

export async function registerReclamacaoAndCreateTicket(form) {
  const idOrigem = String(form.idReclamacaoRa || form.protocoloRa || '').trim();

  const payload = buildTicketPayloadFromReclamacao({ ...form, idReclamacaoRa: idOrigem, protocoloRa: idOrigem });
  const created = await ticketsApi.create(payload);
  const ticket = apiTicketToCockpit(created);
  const ticketId = String(ticket.id || ticket._id);

  const reclamacao = await reclamacoesApi.create('reclame-aqui', { chamadoId: ticketId });
  const reclamacaoId = reclamacao?.id || reclamacao?.reclamacao?.id;

  const publicText = String(form.respostaPublica || '').trim();
  if (publicText) {
    await ticketsApi.addMessage(ticketId, {
      text: publicText,
      author: getAgentName(),
      sender: 'me',
    });
  }

  const raItem = registerReclamacao({
    ...form,
    id: reclamacaoId,
    idReclamacaoRa: idOrigem,
    protocoloRa: idOrigem,
    ticketId,
    chamadoProtocolo: ticket.chamadoProtocolo,
    statusRa: RA_STATUS.NAO_RESPONDIDA,
  });

  return {
    id: raItem.id,
    ticketId,
    raItem,
    ticket,
  };
}

export { updateReclamacaoGroupFromTicket, getReclamacaoByTicketId };

export async function loadReclameAquiTicketsFromApi() {
  try {
    const items = await refreshReclamacoesFromApi();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('velodesk:ra-sync'));
    }
    return items.length;
  } catch (err) {
    console.warn('reclameAquiTicketService: falha ao carregar reclamacoes reclame-aqui', err?.message || err);
    return 0;
  }
}

export async function fetchRaTicketView(raId) {
  const raItem = getReclamacaoById(raId) || getReclamacaoByTicketId(raId);
  if (!raItem) return null;

  if (!raItem.ticketId) {
    return { raItem, ticket: null };
  }

  const raw = await ticketsApi.get(raItem.ticketId);
  const ticket = apiTicketToCockpit(raw);
  updateReclamacaoGroupFromTicket(ticket);
  const syncedItem = getReclamacaoById(raId) || raItem;
  const apiRa = ticket.lateralForm?.reclameAqui;

  return {
    raItem: {
      ...overlayFrozenTicketMeta(syncedItem, apiRa),
      ticketId: syncedItem.ticketId,
      chamadoProtocolo: ticket.chamadoProtocolo || syncedItem.chamadoProtocolo,
    },
    ticket,
  };
}

function resolveRaWhatsAppChatId(ticket) {
  return toWhatsAppChatIdDigits(
    ticket?.lateralForm?.clienteTelefoneWhatsapp
    || (Array.isArray(ticket?.lateralForm?.clienteTelefone) ? ticket.lateralForm.clienteTelefone[0] : '')
    || ticket?.clientPhone
    || '',
  );
}

export async function sendRaWaMessage(ticketId, text, ticket) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const waChatId = resolveRaWhatsAppChatId(ticket);
  await ticketsApi.sendWhatsAppMessage(ticketId, {
    text: trimmed,
    waChatId: waChatId || undefined,
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export async function publishRaPublicResponse(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    text: String(text || '').trim(),
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

export async function saveRaInternalNote(ticketId, text) {
  await ticketsApi.addMessage(ticketId, {
    internalText: String(text || '').trim(),
    text: '',
    author: getAgentName(),
    sender: 'me',
  });
  const raw = await ticketsApi.get(ticketId);
  return apiTicketToCockpit(raw);
}

/**
 * true assim que o agente enviar a 1ª mensagem via WhatsApp — critério é específico do canal
 * WhatsApp (não considera mensagens registradas públicas/internas de outros canais).
 */
export function raTicketHasAgentReply(ticket) {
  return buildWhatsAppConvMsgs(ticket).some((msg) => msg.type === 'agent' && String(msg.text || '').trim());
}

/**
 * Saudação inicial padrão do time de Reclame Aqui — vira o {{3}} do template WhatsApp
 * aprovado (DESK_ACTIVE_WHATSAPP_TEMPLATE_TWILIO_BODY), que já cobre "Olá {nome}, aqui é o
 * Velotax." e "Referente ao seu chamado {protocolo}:" — por isso não repete nome nem protocolo.
 */
export function buildRaInitialGreetingMessage({ agentName }) {
  const agente = String(agentName || '').trim() || 'Atendimento Velotax';
  return `Tudo bem? Me chamo ${agente} e sou especialista no atendimento de demandas Reclame Aqui, no Velotax. Podemos conversar por aqui?`;
}

export function formatRaDeadlineLabel(iso) {
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

/** Ticket de canal Reclame Aqui — exclusão do Desk Agente. */
export function isReclameAquiChannelTicket(ticket) {
  if (!ticket) return false;
  const channel = normalizeCanal(ticket.channel ?? ticket.source ?? ticket.especialChannel);
  if (channel === 'reclame-aqui' || channel === 'reclameaqui') return true;
  const lf = ticket.lateralForm || {};
  const canal = normalizeCanal(lf.canal);
  if (canal.includes('reclame') && canal.includes('aqui')) return true;
  const ra = lf.reclameAqui;
  if (ra && typeof ra === 'object' && !Array.isArray(ra)) return true;
  const registro = Array.isArray(ticket.registro) ? ticket.registro : [];
  return registro.some((reg) => {
    const src = normalizeCanal(reg?.metadados?.source ?? reg?.source);
    return src === 'reclame-aqui' || src === 'reclameaqui'
      || Boolean(reg?.metadados?.reclameAqui && typeof reg.metadados.reclameAqui === 'object');
  });
}
