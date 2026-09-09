/** inboundTicketRead.service v1.0.0 — leitura server-to-server dos tickets do cliente para o app */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import {
  currentStatus,
  excludeEspeciaisChannelsMongoFilter,
  resolveCanalLabelFromSource,
  readChamadoOriginSource,
} from '../chamado.mapper';
import { findClienteByCpf, findClienteByEmail, findClienteByPhone } from '../cliente.service';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface ClientTicketIdentifiers {
  clientCPF?: string;
  clientPhone?: string;
  clientEmail?: string;
}

export interface ClientTicketMessageSummary {
  texto: string;
  remetente: 'cliente' | 'agente' | 'sistema';
  data: Date;
}

export interface ClientTicketSummary {
  chamadoProtocolo: string;
  titulo: string;
  status: string;
  canal: string;
  createdAt: Date;
  updatedAt: Date;
  ultimaMensagem: ClientTicketMessageSummary | null;
}

function remetenteFromOrigin(origin: unknown): ClientTicketMessageSummary['remetente'] {
  const value = String(origin ?? '').trim().toLowerCase();
  if (value === 'cliente') return 'cliente';
  if (value === 'agente') return 'agente';
  return 'sistema';
}

/** Última mensagem PÚBLICA do ticket — nunca expõe anotação interna. */
function resolveUltimaMensagem(chamado: IChamadoN1): ClientTicketMessageSummary | null {
  const registro = chamado.registro ?? [];
  for (let i = registro.length - 1; i >= 0; i -= 1) {
    const entry = registro[i];
    const texto = String(entry?.mensagemPublica ?? '').trim();
    if (!texto) continue;
    return {
      texto,
      remetente: remetenteFromOrigin(entry?.origin),
      data: entry?.data ? new Date(entry.data) : new Date(chamado.updatedAt ?? Date.now()),
    };
  }
  return null;
}

function serializeForClientRead(chamado: IChamadoN1): ClientTicketSummary {
  const tabs = chamado.tabulacao ?? [];
  const canal = String(tabs[tabs.length - 1]?.canal ?? '').trim()
    || resolveCanalLabelFromSource(readChamadoOriginSource(chamado))
    || 'Portal';

  return {
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
    titulo: String(chamado.chamadoTitulo ?? ''),
    status: currentStatus(chamado),
    canal,
    createdAt: new Date(chamado.createdAt ?? Date.now()),
    updatedAt: new Date(chamado.updatedAt ?? Date.now()),
    ultimaMensagem: resolveUltimaMensagem(chamado),
  };
}

async function resolveClienteIdForRead(identifiers: ClientTicketIdentifiers): Promise<string | null> {
  const cpf = String(identifiers.clientCPF ?? '').trim();
  if (cpf) {
    const cliente = await findClienteByCpf(cpf);
    if (cliente?._id) return cliente._id.toString();
  }

  const phone = String(identifiers.clientPhone ?? '').trim();
  if (phone) {
    const cliente = await findClienteByPhone(phone);
    if (cliente?._id) return cliente._id.toString();
  }

  const email = String(identifiers.clientEmail ?? '').trim();
  if (email) {
    const cliente = await findClienteByEmail(email);
    if (cliente?._id) return cliente._id.toString();
  }

  return null;
}

/** Lista os tickets do cliente para exibição no app — CPF > telefone > e-mail, nessa ordem de prioridade. */
export async function listClientTicketsForApp(
  identifiers: ClientTicketIdentifiers,
  limit = DEFAULT_LIMIT,
): Promise<ClientTicketSummary[]> {
  const clienteId = await resolveClienteIdForRead(identifiers);
  if (!clienteId) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));

  const chamados = await ChamadoN1.find({
    'cliente.clienteId': clienteId,
    $and: [excludeEspeciaisChannelsMongoFilter()],
  })
    .sort({ updatedAt: -1 })
    .limit(safeLimit);

  return chamados.map(serializeForClientRead);
}
