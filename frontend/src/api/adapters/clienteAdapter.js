/**
 * clienteAdapter v1.4.2 — hidratação só se faltar email ou telefone no ticket
 * VERSION: v1.4.2 | DATE: 2026-08-19
 */
import { formatPhone, normalizeCpf, normalizePhone } from '../../services/desk/utils';

function normalizeListInput(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean);
  }
  const single = String(value ?? '').trim();
  return single ? [single] : [];
}

export function resolveReplyEmail(emailList, replyEmail) {
  const emails = normalizeListInput(emailList);
  if (!emails.length) return '';
  const selected = String(replyEmail ?? '').trim().toLowerCase();
  if (selected) {
    const match = emails.find((item) => String(item).trim().toLowerCase() === selected);
    if (match) return match.trim().toLowerCase();
  }
  return String(emails[0]).trim().toLowerCase();
}

export function resolveWhatsappPhone(phoneList, whatsappPhone) {
  const phones = normalizeListInput(phoneList);
  if (!phones.length) return '';
  const selected = String(whatsappPhone ?? '').trim();
  if (selected) {
    const match = phones.find((item) => normalizePhone(item) === normalizePhone(selected));
    if (match) return match;
  }
  return phones[0];
}

export function getPrimaryDados(doc) {
  if (!doc?.clienteDados?.length) return null;
  return doc.clienteDados[0];
}

export function mapClienteDocToContact(doc) {
  const dados = getPrimaryDados(doc);
  if (!dados) return null;
  const cpf = normalizeCpf(dados.clienteCpf);
  const emails = dados.clienteEmail?.lista || [];
  const replyEmailRaw = dados.clienteEmail?.resposta || resolveReplyEmail(emails, '');
  const replyEmail = replyEmailRaw ? String(replyEmailRaw).trim().toLowerCase() : '';
  const phonesRaw = dados.clienteTelefone?.lista || [];
  const phones = phonesRaw.map((item) => formatPhone(item)).filter(Boolean);
  const whatsappRaw = dados.clienteTelefone?.whatsapp || resolveWhatsappPhone(phonesRaw, '');
  const whatsappPhone = whatsappRaw ? formatPhone(whatsappRaw) : '';
  return {
    clienteId: doc._id || doc.id,
    clientCPF: cpf,
    clientName: dados.clienteNome || '',
    emails,
    phones,
    replyEmail,
    whatsappPhone,
    email: replyEmail || emails[0] || '',
    phone: whatsappPhone || phones[0] || '',
    produtosContratados: Array.isArray(dados.produtosContratados) ? dados.produtosContratados : [],
  };
}

export function buildClienteCreateBody({
  cpf,
  nome,
  email,
  telefone,
  emails,
  phones,
  whatsappPhone,
  replyEmail,
}) {
  const clienteCpf = normalizeCpf(cpf);
  const clienteNome = String(nome || '').trim();
  const emailList = normalizeListInput(emails ?? email);
  const phoneList = normalizeListInput(phones ?? telefone);
  const whatsapp = resolveWhatsappPhone(phoneList, whatsappPhone);
  const resposta = resolveReplyEmail(emailList, replyEmail);
  return {
    clienteDados: [{
      clienteCpf,
      clienteNome,
      clienteEmail: {
        lista: emailList,
        ...(resposta ? { resposta } : {}),
      },
      clienteTelefone: {
        lista: phoneList,
        ...(whatsapp ? { whatsapp } : {}),
      },
    }],
    atendimentoHistorico: [],
  };
}

export async function persistClienteContact(clientsApi, {
  cpf,
  nome,
  email,
  telefone,
  emails,
  phones,
  whatsappPhone,
  replyEmail,
  clienteId,
}) {
  const payload = buildClienteCreateBody({
    cpf,
    nome,
    email,
    telefone,
    emails,
    phones,
    whatsappPhone,
    replyEmail,
  });
  const updatePayload = { clienteDados: payload.clienteDados };
  const id = String(clienteId || '').trim();

  if (id) {
    return clientsApi.update(id, updatePayload);
  }

  const cpfDigits = normalizeCpf(cpf);
  if (cpfDigits) {
    try {
      const existing = await clientsApi.getByCpf(cpfDigits);
      const existingId = existing?._id || existing?.id;
      if (existingId) return clientsApi.update(existingId, updatePayload);
    } catch (err) {
      if (err?.response?.status !== 404) throw err;
    }
  }

  const emailList = normalizeListInput(emails ?? email);
  const firstEmail = emailList[0] || '';
  if (firstEmail) {
    try {
      const existing = await clientsApi.getByEmail(firstEmail);
      const existingId = existing?._id || existing?.id;
      if (existingId) return clientsApi.update(existingId, updatePayload);
    } catch (err) {
      if (err?.response?.status !== 404) throw err;
    }
  }

  if (!cpfDigits && !firstEmail) {
    throw new Error('CPF ou e-mail necessário para atualizar o cadastro.');
  }

  return clientsApi.create(payload);
}

export function buildDraftTicketFromCliente(doc, agentName) {
  const contact = mapClienteDocToContact(doc);
  if (!contact) return null;
  const agent = agentName || 'Agente';
  const clientName = contact.clientName || 'Cliente';
  return {
    title: `Atendimento — ${clientName}`,
    clienteId: contact.clienteId,
    clientCPF: contact.clientCPF,
    clientName: contact.clientName,
    channel: 'Interno',
    tipo: 'Solicitação',
    atribuir: `${agent} (eu)`,
    lateralForm: {
      cpf: contact.clientCPF,
      clienteCpf: contact.clientCPF,
      clienteNome: contact.clientName,
      clienteEmail: contact.emails,
      clienteEmailResposta: contact.replyEmail,
      clienteTelefone: contact.phones,
      clienteTelefoneWhatsapp: contact.whatsappPhone,
      canal: 'Interno',
      classificacaoTipo: 'Solicitação',
      produto: '',
      motivo: '',
      detalhe: '',
      responsavel: agent,
    },
  };
}

/** Aplica dados do doc b2c_cadastros no ticket (mutação in-place). */
export function applyClienteDocToTicket(ticket, doc) {
  if (!ticket || !doc) return ticket;
  const contact = mapClienteDocToContact(doc);
  if (!contact) return ticket;

  const clienteId = contact.clienteId || ticket.clienteId || ticket.lateralForm?.clienteId;
  const primaryEmail = contact.replyEmail || contact.emails[0] || '';
  const primaryPhone = contact.whatsappPhone || contact.phones[0] || '';

  ticket.clientName = contact.clientName || ticket.clientName;
  ticket.solicitante = contact.clientName || ticket.solicitante;
  ticket.clientEmail = primaryEmail || ticket.clientEmail;
  ticket.clientPhone = primaryPhone || ticket.clientPhone;
  ticket.clientCPF = contact.clientCPF || ticket.clientCPF;
  if (clienteId) ticket.clienteId = clienteId;

  ticket.lateralForm = {
    ...ticket.lateralForm,
    cpf: contact.clientCPF || ticket.lateralForm?.cpf,
    clienteCpf: contact.clientCPF || ticket.lateralForm?.clienteCpf,
    clienteNome: contact.clientName || ticket.lateralForm?.clienteNome,
    clienteEmail: contact.emails.length ? contact.emails : ticket.lateralForm?.clienteEmail,
    clienteEmailResposta: contact.replyEmail || ticket.lateralForm?.clienteEmailResposta,
    clienteTelefone: contact.phones.length ? contact.phones : ticket.lateralForm?.clienteTelefone,
    clienteTelefoneWhatsapp: contact.whatsappPhone || ticket.lateralForm?.clienteTelefoneWhatsapp,
    clienteId: clienteId || ticket.lateralForm?.clienteId,
  };
  ticket.updatedAt = new Date().toISOString();
  return ticket;
}

