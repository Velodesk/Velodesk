/**
 * Persiste contato do cliente em tickets de canais especiais.
 */
import { clientsApi } from '../../../api/client';
import { persistClienteContact } from '../../../api/adapters/clienteAdapter';
import { isValidEmailFormat, isTicketReadOnly, normalizeCpf } from '../../../services/desk/utils';
import { updateTicketInCache } from '../../../services/ticketsStorage';

export async function saveEspeciaisTicketContact(ticket, draft, client) {
  if (!ticket) throw new Error('Ticket não encontrado');
  if (isTicketReadOnly(ticket)) throw new Error('Ticket fechado');

  const nome = String(draft?.name || '').trim();
  const emailList = Array.isArray(draft?.emails)
    ? draft.emails.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const phoneList = Array.isArray(draft?.phones)
    ? draft.phones.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const whatsappPhone = String(draft?.whatsappPhone || '').trim()
    || (phoneList.length === 1 ? phoneList[0] : '');
  const cpf = normalizeCpf(
    draft?.cpf || ticket.lateralForm?.cpf || ticket.lateralForm?.clienteCpf || ticket.clientCPF,
  );

  if (!nome) throw new Error('Nome obrigatório');
  for (const email of emailList) {
    if (!isValidEmailFormat(email)) throw new Error('E-mail inválido');
  }
  if (phoneList.length > 1 && !whatsappPhone) throw new Error('WhatsApp obrigatório');

  // O cadastro (b2c_cadastros) só reflete o telefone que o próprio app trouxe — nunca ganha
  // número que o atendente só incluiu no ticket, nem quando o cadastro ainda não tem nenhum
  // telefone (cliente novo): fica só no ticket, editável/removível (mesma regra do Desk padrão).
  const phonesForCadastro = Array.isArray(client?.phones)
    ? client.phones.map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  const clienteDoc = await persistClienteContact(clientsApi, {
    cpf,
    nome,
    emails: emailList,
    phones: phonesForCadastro,
    whatsappPhone,
    clienteId: draft?.clienteId || ticket.clienteId || ticket.lateralForm?.clienteId,
  });
  const clienteId = clienteDoc?._id || clienteDoc?.id || ticket.clienteId || ticket.lateralForm?.clienteId;
  const primaryEmail = emailList[0] || '';
  const primaryPhone = whatsappPhone || phoneList[0] || '';

  const updated = await updateTicketInCache(ticket.id, (t) => {
    t.clientName = nome;
    t.solicitante = nome;
    t.clientEmail = primaryEmail;
    t.clientPhone = primaryPhone;
    if (clienteId) t.clienteId = clienteId;
    t.lateralForm = {
      ...t.lateralForm,
      cpf,
      clienteCpf: cpf,
      clienteNome: nome,
      clienteEmail: emailList,
      clienteTelefone: phoneList,
      clienteTelefoneWhatsapp: whatsappPhone,
      clienteId: clienteId || t.lateralForm?.clienteId,
    };
    t.updatedAt = new Date().toISOString();
    return t;
  });

  return updated;
}
