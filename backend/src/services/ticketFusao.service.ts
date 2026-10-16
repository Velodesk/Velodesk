/**
 * Mesclagem de tickets estilo Ouvidoria — ativo + inativos
 * VERSION: v1.2.0 | DATE: 2026-10-16
 * — aceita resolvidos na mesclagem; principal resolvido é reaberto (em-andamento)
 * — absorvidos: status resolvido via appendStatusTransition (sai das filas abertas)
 * — textos de usuário: mesclar / mesclagem
 */
import mongoose from 'mongoose';
import type { AuthPayload } from '../middleware/auth';
import { Box } from '../models/Box';
import { ChamadoN1, type IChamadoN1, type IRegistro } from '../models/ChamadoN1';
import { ChamadoIaAnalise } from '../models/ChamadoIaAnalise';
import {
  appendStatusTransition,
  ChamadoClosedError,
  chamadoToTicket,
  currentStatus,
  isChamadoFechado,
  resolveBoxIdForChamado,
  resolveRegistroAutor,
  type TicketDto,
} from './chamado.mapper';
import {
  assertCanActOnTicket,
  PermissionDeniedError,
} from './permission.service';
import { isFusaoAbsorvidoChamado } from './ticketFusao.helpers';

export { PermissionDeniedError };

export class TicketFusaoError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'TicketFusaoError';
    this.status = status;
  }
}

function normalizeCpf(value?: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

function getChamadoCpf(chamado: IChamadoN1): string {
  return normalizeCpf(chamado.cliente?.[0]?.clienteCpf);
}

function protocolOf(chamado: IChamadoN1): string {
  return chamado.chamadoProtocolo?.trim() || chamado._id.toString();
}

function appendFusaoRegistro(
  chamado: IChamadoN1,
  params: {
    anotacaoInterna: string;
    status: string;
    metadados: Record<string, unknown>;
    authUser?: AuthPayload | null;
  },
): void {
  const autor = resolveRegistroAutor('agente', { authUser: params.authUser });
  const entry: IRegistro = {
    data: new Date(),
    origin: 'agente',
    autor,
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: params.anotacaoInterna,
    anexosAnotacaoInterna: [],
    alteracoes: [],
    metadados: params.metadados,
    status: params.status,
  };
  if (!chamado.registro) chamado.registro = [];
  chamado.registro.push(entry);
}

function mergeDedupStrings(...lists: Array<string[] | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list || []) {
      const s = String(raw || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
      if (out.length >= 50) return out;
    }
  }
  return out;
}

export interface FusaoParams {
  activeId: string;
  inactiveIds: string[];
  cpf: string;
}

export async function executeTicketFusao(
  authUser: AuthPayload,
  params: FusaoParams,
): Promise<{ active: TicketDto; inativos: TicketDto[] }> {
  const cpf = normalizeCpf(params.cpf);
  if (cpf.length !== 11) {
    throw new TicketFusaoError('CPF inválido.');
  }

  const activeId = String(params.activeId || '').trim();
  const inactiveIds = [...new Set(
    (params.inactiveIds || []).map((id) => String(id || '').trim()).filter(Boolean),
  )].filter((id) => id !== activeId);

  if (!activeId || !mongoose.Types.ObjectId.isValid(activeId)) {
    throw new TicketFusaoError('Ticket ativo inválido.');
  }
  if (!inactiveIds.length) {
    throw new TicketFusaoError('Selecione ao menos um ticket para tornar inativo.');
  }
  for (const id of inactiveIds) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new TicketFusaoError(`ID inválido: ${id}`);
    }
  }

  const allIds = [activeId, ...inactiveIds];
  const chamados = await ChamadoN1.find({ _id: { $in: allIds } });
  const byId = new Map(chamados.map((c) => [c._id.toString(), c]));

  const active = byId.get(activeId);
  if (!active) throw new TicketFusaoError('Ticket ativo não encontrado.', 404);

  const inativos: IChamadoN1[] = [];
  for (const id of inactiveIds) {
    const doc = byId.get(id);
    if (!doc) throw new TicketFusaoError(`Ticket não encontrado: ${id}`, 404);
    inativos.push(doc);
  }

  if (isChamadoFechado(active)) {
    throw new ChamadoClosedError('Ticket ativo fechado — não é possível mesclar.');
  }

  await assertCanActOnTicket(authUser, active);
  for (const doc of inativos) {
    if (isChamadoFechado(doc)) {
      throw new ChamadoClosedError(`Ticket #${protocolOf(doc)} fechado — não é possível mesclar.`);
    }
    if (isFusaoAbsorvidoChamado(doc)) {
      throw new TicketFusaoError(`Ticket #${protocolOf(doc)} já está mesclado como inativo.`);
    }
    await assertCanActOnTicket(authUser, doc);
  }

  if (getChamadoCpf(active) !== cpf) {
    throw new TicketFusaoError('O ticket ativo não pertence ao CPF informado.');
  }
  for (const doc of inativos) {
    if (getChamadoCpf(doc) !== cpf) {
      throw new TicketFusaoError(`Ticket #${protocolOf(doc)} não pertence ao mesmo CPF.`);
    }
  }

  const now = new Date();
  const activeProtocol = protocolOf(active);
  const childIds = inativos.map((d) => d._id as mongoose.Types.ObjectId);
  const childProtocolos = mergeDedupStrings(
    active.fusao?.childProtocolos,
    inativos.map((d) => protocolOf(d)),
  );
  const existingChildIds = (active.fusao?.childIds || []).map((id) => id);
  const mergedChildIds = [
    ...existingChildIds,
    ...childIds.filter((id) => !existingChildIds.some((e) => String(e) === String(id))),
  ].slice(0, 50);

  // Principal resolvido volta para em-andamento (o ticket volta a ser trabalhado).
  const reabrirAtivo = String(currentStatus(active)).trim().toLowerCase() === 'resolvido';

  const firstChild = inativos[0];
  active.fusao = {
    fundido: true,
    dataFundido: now,
    hierarquia: 'superior',
    parentId: null,
    childId: firstChild?._id ?? null,
    childProtocolo: firstChild ? protocolOf(firstChild) : '',
    childProtocolos,
    childIds: mergedChildIds,
    parentProtocolo: '',
  };

  appendFusaoRegistro(active, {
    anotacaoInterna: `Mesclagem registrada. Tickets absorvidos: ${inativos.map((d) => `#${protocolOf(d)}`).join(', ')}.`,
    status: currentStatus(active),
    metadados: {
      fusao: {
        role: 'ativo',
        childIds: inactiveIds,
      },
    },
    authUser,
  });

  if (reabrirAtivo) {
    appendStatusTransition(active, 'em-andamento', {
      autor: resolveRegistroAutor('agente', { authUser }),
      anotacaoInterna: 'Ticket resolvido reaberto automaticamente ao ser definido como principal de uma mesclagem.',
      metadados: { fusao: { role: 'ativo', reaberto: true } },
      origin: 'agente',
    });
  }

  for (const doc of inativos) {
    doc.fusao = {
      fundido: true,
      dataFundido: now,
      hierarquia: 'inferior',
      parentId: active._id as mongoose.Types.ObjectId,
      childId: null,
      parentProtocolo: activeProtocol,
      childProtocolo: '',
      childProtocolos: [],
      childIds: [],
    };
    // Transição canônica → último registro.status = resolvido (filas abertas deixam de listar)
    appendStatusTransition(doc, 'resolvido', {
      autor: resolveRegistroAutor('agente', { authUser }),
      anotacaoInterna: `Ticket mesclado ao chamado ativo #${activeProtocol}.`,
      metadados: {
        fusao: {
          role: 'inativo',
          parentId: activeId,
          parentProtocol: activeProtocol,
        },
      },
      origin: 'agente',
    });
  }

  await Promise.all([active.save(), ...inativos.map((d) => d.save())]);

  await Promise.all(
    allIds.map((id) =>
      ChamadoIaAnalise.updateOne(
        { chamadoId: id, origem: { $ne: 'manual' } },
        { $set: { needsReanalysis: true } },
      ),
    ),
  );

  const boxes = await Box.find().sort({ order: 1 });
  const activeTicket = await chamadoToTicket(active, await resolveBoxIdForChamado(active, boxes));
  const inativoTickets = await Promise.all(
    inativos.map(async (d) => chamadoToTicket(d, await resolveBoxIdForChamado(d, boxes))),
  );

  return { active: activeTicket, inativos: inativoTickets };
}
