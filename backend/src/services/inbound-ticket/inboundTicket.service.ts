/** inboundTicket.service v1.1.0 — clientPhone no cadastro + enriquecimento parcial via API */
import { ChamadoN1 } from '../../models/ChamadoN1';
import type { IChamadoN1 } from '../../models/ChamadoN1';
import { applyAssignmentIfNeeded } from '../assignmentRouter.service';
import { createChamadoFromBody } from '../chamado.mapper';
import { findClienteByPhone, resolveClienteRefFromBody } from '../cliente.service';
import { notifyTicketOpenedAsync } from '../emailNotification.service';
import { runInboundPostCreateHooks } from '../agents/inboundAgentPipeline.service';
import type {
  InboundTicketOrigin,
  InboundTicketPayload,
  InboundTicketResult,
} from './types';
import { ORIGIN_CANAL_CONFIG } from './types';
import { normalizeBrPhoneLocal } from '../phone.util';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trim(item)).filter(Boolean);
}

export function parseInboundTicketPayload(body: Record<string, unknown>): InboundTicketPayload {
  const externalId = trim(body.externalId);
  const title = trim(body.title ?? body.chamadoTitulo);
  const text = trim(body.text ?? body.description);
  const clientName = trim(body.clientName);
  const clientCPF = trim(body.clientCPF);
  const clientPhone = normalizeBrPhoneLocal(body.clientPhone);
  const clientEmail = trim(body.clientEmail);

  if (!externalId) throw new Error('externalId é obrigatório');
  if (!title) throw new Error('title ou chamadoTitulo é obrigatório');
  if (!text) throw new Error('text ou description é obrigatório');
  if (!clientName) throw new Error('clientName é obrigatório');
  if (!clientCPF && !clientPhone && !clientEmail) {
    throw new Error('Informe clientCPF, clientPhone ou clientEmail');
  }

  const priority = trim(body.priority);
  if (priority && !['baixa', 'media', 'alta'].includes(priority)) {
    throw new Error('priority inválida — use baixa, media ou alta');
  }

  const metadata = body.metadata;
  if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
    throw new Error('metadata deve ser um objeto');
  }

  return {
    externalId,
    title,
    text,
    clientName,
    clientCPF: clientCPF || undefined,
    clientPhone: clientPhone || undefined,
    clientEmail: clientEmail || undefined,
    attachments: readStringList(body.attachments),
    priority: priority || undefined,
    produto: trim(body.produto) || undefined,
    motivo: trim(body.motivo) || undefined,
    detalhe: trim(body.detalhe) || undefined,
    tipoChamado: trim(body.tipoChamado ?? body.classificacaoTipo) || undefined,
    classificacaoTipo: trim(body.classificacaoTipo ?? body.tipoChamado) || undefined,
    responsavel: trim(body.responsavel ?? body.responsibleAgent) || undefined,
    metadata: metadata as Record<string, unknown> | undefined,
  };
}

export async function findExistingInboundTicket(
  origin: InboundTicketOrigin,
  externalId: string,
): Promise<IChamadoN1 | null> {
  return ChamadoN1.findOne({
    registro: {
      $elemMatch: {
        'metadados.inboundTicketOrigin': origin,
        'metadados.inboundTicketExternalId': externalId,
      },
    },
  });
}

async function resolveClienteRefs(
  payload: InboundTicketPayload,
  origin: InboundTicketOrigin,
): Promise<ReturnType<typeof resolveClienteRefFromBody>> {
  const body: Record<string, unknown> = {
    clientName: payload.clientName,
    clientCPF: payload.clientCPF,
    clientPhone: payload.clientPhone,
    clientEmail: payload.clientEmail,
    lateralForm: {
      clienteNome: payload.clientName,
      ...(payload.clientEmail ? { clienteEmail: [payload.clientEmail] } : {}),
      ...(payload.clientPhone ? { clienteTelefone: [payload.clientPhone] } : {}),
    },
  };

  let refs = await resolveClienteRefFromBody(body);
  if (refs.length > 0 || !payload.clientPhone) {
    return refs;
  }

  const byPhone = await findClienteByPhone(payload.clientPhone);
  if (!byPhone?._id) return refs;

  refs = await resolveClienteRefFromBody({
    ...body,
    clientCPF: payload.clientCPF,
    clienteId: byPhone._id.toString(),
  });

  if (refs.length === 0 && origin !== 'app') {
    console.info('[inbound-ticket] cliente encontrado por telefone sem CPF vinculado', {
      origin,
      externalId: payload.externalId,
      clientPhone: payload.clientPhone,
    });
  }

  return refs;
}

function buildTicketBody(
  origin: InboundTicketOrigin,
  payload: InboundTicketPayload,
  config: (typeof ORIGIN_CANAL_CONFIG)[InboundTicketOrigin],
): Record<string, unknown> {
  const lateralForm: Record<string, unknown> = {
    clienteNome: payload.clientName,
    canal: config.canal,
    classificacaoTipo: payload.classificacaoTipo || payload.tipoChamado || 'Solicitação',
    tipoChamado: payload.tipoChamado || payload.classificacaoTipo || 'Solicitação',
    produto: payload.produto || '',
    motivo: payload.motivo || payload.title,
    detalhe: payload.detalhe || payload.text.slice(0, 500),
  };

  if (payload.clientEmail) {
    lateralForm.clienteEmail = [payload.clientEmail];
  }
  if (payload.clientPhone) {
    lateralForm.clienteTelefone = [payload.clientPhone];
  }
  if (payload.responsavel) {
    lateralForm.responsavel = payload.responsavel;
  }

  return {
    title: payload.title,
    chamadoTitulo: payload.title,
    description: payload.text,
    text: payload.text,
    status: 'novo',
    priority: payload.priority || 'media',
    clientName: payload.clientName,
    clientCPF: payload.clientCPF,
    clientPhone: payload.clientPhone,
    attachments: payload.attachments ?? [],
    source: config.source,
    channel: config.channel,
    messageOrigin: 'cliente',
    lateralForm,
  };
}

export async function processInboundTicket(
  origin: InboundTicketOrigin,
  rawBody: Record<string, unknown>,
): Promise<InboundTicketResult> {
  const payload = parseInboundTicketPayload(rawBody);
  const config = ORIGIN_CANAL_CONFIG[origin];

  const existing = await findExistingInboundTicket(origin, payload.externalId);
  if (existing) {
    console.info('[inbound-ticket] duplicate origin=%s externalId=%s', origin, payload.externalId);
    return {
      action: 'duplicate',
      ticketId: existing._id.toString(),
      chamadoProtocolo: String(existing.chamadoProtocolo ?? ''),
      canal: config.canal,
    };
  }

  const ticketBody = buildTicketBody(origin, payload, config);
  const clienteRefs = await resolveClienteRefs(payload, origin);
  if (clienteRefs[0]?.clienteId) {
    ticketBody.clienteId = clienteRefs[0].clienteId.toString();
  }
  if (clienteRefs[0]?.clienteCpf) {
    ticketBody.clientCPF = clienteRefs[0].clienteCpf;
  }

  const partial = await createChamadoFromBody(ticketBody, 'novo');

  if (partial.registro?.[0]) {
    partial.registro[0].origin = 'cliente';
    partial.registro[0].autor = payload.clientName;
    partial.registro[0].metadados = {
      ...(partial.registro[0].metadados ?? {}),
      source: config.source,
      inboundTicketOrigin: origin,
      inboundTicketExternalId: payload.externalId,
      ...(payload.metadata ? { inboundTicketMetadata: payload.metadata } : {}),
    };
  }

  if (clienteRefs.length > 0 && (!partial.cliente || partial.cliente.length === 0)) {
    partial.cliente = clienteRefs;
  }

  await applyAssignmentIfNeeded(partial, {
    source: 'inbound-ticket',
    canal: config.canal,
  });

  const chamado = await ChamadoN1.create(partial);

  if (payload.clientEmail) {
    void notifyTicketOpenedAsync(chamado, payload.clientEmail).catch((err: Error) => {
      console.warn('[inbound-ticket] notifyTicketOpened fail-soft:', err.message);
    });
  }

  void runInboundPostCreateHooks(chamado, { source: config.source }).catch((err: Error) => {
    console.warn('[inbound-ticket] hooks inbound fail-soft:', err.message);
  });

  console.info('[inbound-ticket] created origin=%s externalId=%s ticketId=%s protocolo=%s',
    origin, payload.externalId, chamado._id, chamado.chamadoProtocolo);

  return {
    action: 'created',
    ticketId: chamado._id.toString(),
    chamadoProtocolo: String(chamado.chamadoProtocolo ?? ''),
    canal: config.canal,
  };
}
