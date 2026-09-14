/**
 * telecom55B2cTicket.service v1.0.0 — abertura de ticket a partir do webhook "55" (call
 * center humano). Distinto do fluxo Contact Tel (telephonyTicketNotify.service.ts) — mesmo
 * espírito (compõe ticket + notifica CTA), payload e regras de negócio diferentes.
 */
import { Types } from 'mongoose';
import { ChamadoN1 } from '../models/ChamadoN1';
import { createChamadoFromBody } from './chamado.mapper';
import { findColaboradorByEmail, resolveColaboradorDisplayName } from './colaboradoresCadastro.service';
import { findOrCreateClienteFromCpfLookup } from './cliente.service';
import { createWorkflowNotificacao } from './workflowNotificacao.service';
import { runInboundPostCreateHooks } from './agents/inboundAgentPipeline.service';
import type { Telecom55B2cEvent } from './telephony-inbound/adapters/telecom55B2c.adapter';

/** Sentinel de workflow para CTAs do webhook 55 B2C (sem workflow real, mesmo padrão do Contact Tel). */
const TELECOM55_B2C_NOTIF_WORKFLOW_ID = new Types.ObjectId('00000000000000000000aa02');

const KNOWN_DIDS = new Set(['551130037293', '08008000049', '08002371339']);
const CHAVES_PIX_DID = '08002371339';

const URA_TO_CATEGORIA: Record<string, string> = {
  'opcao - 1': 'Crédito',
  'opcao - 2': 'Conta e PIX',
  'opcao - 3': 'Seguros',
  'opcao - 4': 'Clube',
  'opcao - a': 'Calculadora',
};
const DEFAULT_CATEGORIA = 'Crédito';

/** motivo fica sempre em branco — o agente completa ao atender. */
const CATEGORIA_TO_PRODUTO: Record<string, string> = {
  'Crédito': 'Emprestimo Pessoal',
  'Conta e PIX': 'Conta Velotax',
  'Seguros': 'Seguros',
  'Calculadora': 'Calculadora',
  'Chaves PIX': 'Antecipação 2026',
  // 'Clube' fica sem produto — não existe no catálogo hoje.
};

export function shouldCreateTicketFromTelecom55B2cEvent(event: Telecom55B2cEvent): boolean {
  if (event.callType !== 'receptive') return false;
  if (event.callStatus !== 'new_call') return false;
  if (event.callTransferId) return false;
  if (!KNOWN_DIDS.has(event.callTerminal)) return false;
  if (event.callUrlAudio) return false;
  if (!event.callUra) return false;
  if (!event.branchEmail) return false;
  return true;
}

function normalizeUra(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveCategoriaFromUra(callTerminal: string, callUra: string): string {
  if (callTerminal === CHAVES_PIX_DID) return 'Chaves PIX';
  return URA_TO_CATEGORIA[normalizeUra(callUra)] || DEFAULT_CATEGORIA;
}

/**
 * Fonte de verdade é o cadastro de colaboradores do VeloHub (funcionarios_cadastroColaboradores,
 * console_funcionarios) — o mesmo usado no login (auth.routes.ts). O model `User` local é só um
 * cache "sombra" criado na primeira vez que o colaborador loga no Desk; um agente com acesso
 * liberado mas que nunca logou não existe lá, e o lookup falhava sempre por isso, independente
 * de qual cluster Mongo o Desk usa.
 */
async function resolveAgentByBranchEmail(branchEmail: string): Promise<{ email: string; displayName: string } | null> {
  const colaborador = await findColaboradorByEmail(branchEmail);
  if (!colaborador?.userMail) {
    console.info('[telecom55-b2c-ticket] atendente não resolvido no cadastro de colaboradores', { branchEmail });
    return null;
  }
  return {
    email: String(colaborador.userMail).trim().toLowerCase(),
    displayName: resolveColaboradorDisplayName(colaborador),
  };
}

interface ResolvedCliente {
  clienteId: Types.ObjectId | null;
  clienteNome: string;
}

async function resolveClienteParaTicket(cpf: string): Promise<ResolvedCliente> {
  const { cliente } = await findOrCreateClienteFromCpfLookup(cpf, true);
  if (!cliente) return { clienteId: null, clienteNome: '' };
  const dados = cliente.clienteDados?.[0];
  return {
    clienteId: cliente._id as Types.ObjectId,
    clienteNome: String(dados?.clienteNome || '').trim(),
  };
}

export async function createTicketFromTelecom55B2cCall(
  event: Telecom55B2cEvent,
): Promise<{ ticketId: string; protocolo: string; notified: boolean }> {
  // Sem branch_email resolvido, o ticket ainda é criado (não pode ficar sem registro da
  // ligação), só que sem responsável — e nunca cai na roleta genérica (shouldAutoAssign
  // exclui canal Telefone), porque atribuir a alguém que não atendeu a ligação é pior do
  // que ficar sem dono até um humano puxar manualmente.
  const agent = await resolveAgentByBranchEmail(event.branchEmail);

  const categoria = resolveCategoriaFromUra(event.callTerminal, event.callUra);
  const produto = CATEGORIA_TO_PRODUTO[categoria] || '';
  const cliente = await resolveClienteParaTicket(event.callDocument);
  const cadastroNaoEncontrado = !cliente.clienteId;
  const title = `Velotax - Central de Atendimento (Tel ${event.callNumber})`;

  const partial = await createChamadoFromBody({
    title,
    chamadoTitulo: title,
    ...(agent ? { author: agent.displayName } : {}),
    source: 'telecom55-b2c-inbound',
    channel: 'telefone',
    internalText: `CPF digitado na URA: ${event.callDocument} · Telefone: ${event.callNumber}`,
    // clientCPF/clientName só passam quando há cadastro resolvido — senão o resolvedor de
    // cliente do createChamadoFromBody cria um cadastro local em branco por engano (ele
    // dispara upsert sempre que recebe clientCPF, mesmo sem nome/e-mail). Sem cadastro, o
    // vínculo é setado manualmente abaixo, sem tocar na coleção de clientes.
    ...(cliente.clienteId ? { clientCPF: event.callDocument, clientName: cliente.clienteNome, clienteId: cliente.clienteId.toString() } : {}),
    clientPhone: event.callNumber,
    lateralForm: {
      canal: 'Telefone',
      // responsavel '' explícito quando não resolvido — tabulacaoFromBody() faria fallback
      // pra body.responsibleAgent se omitido, e aqui o pedido é ficar em branco mesmo.
      responsavel: agent?.displayName || '',
      tipo: 'Solicitação',
      tipoChamado: 'Solicitação',
      // motivo explicitamente '' (não omitido) — sem isso tabulacaoFromBody usa o título do
      // ticket como fallback de motivo, e o pedido é motivo sempre em branco pro agente.
      motivo: '',
      ...(produto ? { produto } : {}),
    },
  }, 'novo');

  if (cadastroNaoEncontrado) {
    partial.cliente = [{ clienteCpf: event.callDocument, clienteId: null }];
  }

  const chamado = await ChamadoN1.create(partial);
  const ticketId = String(chamado._id);
  const protocolo = String(chamado.chamadoProtocolo || '');

  void runInboundPostCreateHooks(chamado, { source: 'telecom55-b2c-inbound' }).catch((err: Error) => {
    console.warn('[telecom55-b2c-ticket] runInboundPostCreateHooks fail-soft:', err.message);
  });

  if (!agent) {
    console.info('[telecom55-b2c-ticket] ticket criado sem responsável — branch_email não resolvido', {
      ticketId,
      protocolo,
      branchEmail: event.branchEmail,
    });
    return { ticketId, protocolo, notified: false };
  }

  let notified = false;
  try {
    await createWorkflowNotificacao({
      destinatarioEmail: agent.email,
      ticketId,
      chamadoProtocolo: protocolo,
      workflowId: TELECOM55_B2C_NOTIF_WORKFLOW_ID.toString(),
      workflowSlug: 'telecom55-b2c-inbound',
      step: 0,
      passoId: null,
      titulo: 'Nova ligação atribuída',
      mensagem: `${cliente.clienteNome || 'Cliente'} — ${protocolo || ticketId}. Abra o ticket para atender.`,
    });
    notified = true;
  } catch (err) {
    console.warn('[telecom55-b2c-ticket] falha ao criar CTA no sininho:', (err as Error).message);
  }

  return { ticketId, protocolo, notified };
}
