/** workflowNotificacao.service v1.3.0 — notifica responsável na reprovação do workflow */
import { Types } from 'mongoose';
import { getWorkflowNotificacaoModel, IWorkflowNotificacao } from '../models/WorkflowNotificacao';
import type { IChamadoN1 } from '../models/ChamadoN1';
import { User } from '../models/User';
import { findAgenteEmailByNome } from './agenteDesk.service';

export async function createWorkflowNotificacao(payload: {
  destinatarioEmail: string;
  ticketId: string;
  chamadoProtocolo?: string;
  workflowId: string;
  workflowSlug?: string;
  step: number;
  passoId?: string | null;
  titulo: string;
  mensagem: string;
}): Promise<IWorkflowNotificacao> {
  const Model = getWorkflowNotificacaoModel();
  const doc = await Model.create({
    tipo: 'workflow_cta',
    destinatarioEmail: String(payload.destinatarioEmail).trim().toLowerCase(),
    ticketId: new Types.ObjectId(payload.ticketId),
    chamadoProtocolo: payload.chamadoProtocolo || '',
    workflowId: new Types.ObjectId(payload.workflowId),
    workflowSlug: payload.workflowSlug || '',
    step: payload.step,
    passoId: payload.passoId ? new Types.ObjectId(payload.passoId) : null,
    titulo: payload.titulo || 'Ação necessária',
    mensagem: payload.mensagem || '',
    lida: false,
  });
  return doc.toObject() as IWorkflowNotificacao;
}

/**
 * Sininho do agente responsável quando o time de workflow pede informação.
 * Reusa tipo `workflow_cta` (sem alteração de schema). Fail-soft se o e-mail não resolver.
 */
async function resolveResponsavelEmail(nome: string): Promise<string> {
  const trimmed = String(nome || '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed.toLowerCase();

  const fromAgente = await findAgenteEmailByNome(trimmed);
  if (fromAgente) return fromAgente;

  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const user = await User.findOne({ name: new RegExp(`^${escaped}$`, 'i') }).select('email').lean();
  return user?.email ? String(user.email).trim().toLowerCase() : '';
}

export async function notifyWorkflowMensagemToResponsavel(
  chamado: IChamadoN1,
): Promise<IWorkflowNotificacao | null> {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  const responsavelNome = String(tab?.responsavel || '').trim();
  if (!responsavelNome) {
    console.info('[workflow-notif] pedido de info sem responsável no ticket', {
      ticketId: String(chamado._id),
    });
    return null;
  }

  const destinatarioEmail = await resolveResponsavelEmail(responsavelNome);
  if (!destinatarioEmail) {
    console.info('[workflow-notif] e-mail do responsável não resolvido', {
      ticketId: String(chamado._id),
      responsavelNome,
    });
    return null;
  }

  const workflowId = chamado.workflow?.workflowId
    ? String(chamado.workflow.workflowId)
    : '';
  if (!workflowId || !Types.ObjectId.isValid(workflowId)) {
    console.info('[workflow-notif] ticket sem workflowId válido para CTA', {
      ticketId: String(chamado._id),
    });
    return null;
  }

  const protocolo = String(chamado.chamadoProtocolo || '').trim() || String(chamado._id);
  const recado = `Você tem mensagem no ticket número ${protocolo}`;

  try {
    return await createWorkflowNotificacao({
      destinatarioEmail,
      ticketId: String(chamado._id),
      chamadoProtocolo: protocolo,
      workflowId,
      workflowSlug: 'workflow-info-request',
      step: chamado.workflow?.step ?? 0,
      passoId: chamado.workflow?.passoId ? String(chamado.workflow.passoId) : null,
      titulo: 'Workflow',
      mensagem: recado,
    });
  } catch (err) {
    console.warn('[workflow-notif] falha ao criar recado no sininho:', (err as Error).message);
    return null;
  }
}

/**
 * Sininho de quem está do lado workflow (aprovador) quando o agente responde a uma
 * mensagem do comunicador. Direção inversa de notifyWorkflowMensagemToResponsavel —
 * antes o agente não recebia aviso nenhum de resposta, e o comunicador nunca notificava
 * o lado workflow de volta quando o agente respondia. Usa comunicacaoResumo.
 * ultimoWorkflowAutorEmail (quem mandou por último como "workflow"), não o responsável do
 * ticket, porque quem está aguardando é quem escreveu a pergunta, não necessariamente o
 * dono do ticket.
 */
export async function notifyAgentReplyToWorkflowResponsavel(
  chamado: IChamadoN1,
): Promise<IWorkflowNotificacao | null> {
  const destinatarioEmail = String(
    chamado.workflow?.requisicao?.comunicacaoResumo?.ultimoWorkflowAutorEmail || '',
  ).trim().toLowerCase();
  if (!destinatarioEmail) {
    console.info('[workflow-notif] resposta do agente sem autor workflow conhecido pra notificar', {
      ticketId: String(chamado._id),
    });
    return null;
  }

  const workflowId = chamado.workflow?.workflowId
    ? String(chamado.workflow.workflowId)
    : '';
  if (!workflowId || !Types.ObjectId.isValid(workflowId)) {
    console.info('[workflow-notif] ticket sem workflowId válido para CTA de resposta', {
      ticketId: String(chamado._id),
    });
    return null;
  }

  const protocolo = String(chamado.chamadoProtocolo || '').trim() || String(chamado._id);
  const recado = `O agente respondeu sua mensagem no ticket número ${protocolo}`;

  try {
    return await createWorkflowNotificacao({
      destinatarioEmail,
      ticketId: String(chamado._id),
      chamadoProtocolo: protocolo,
      workflowId,
      workflowSlug: 'workflow-info-reply',
      step: chamado.workflow?.step ?? 0,
      passoId: chamado.workflow?.passoId ? String(chamado.workflow.passoId) : null,
      titulo: 'Workflow',
      mensagem: recado,
    });
  } catch (err) {
    console.warn('[workflow-notif] falha ao criar recado de resposta no sininho:', (err as Error).message);
    return null;
  }
}

/**
 * Sininho do responsável quando uma etapa de aprovação do workflow é reprovada.
 * A devolutiva automática ao cliente é suspensa nesse caso (skipSistema na reprovação) —
 * cabe ao responsável decidir manualmente o retorno; este recado só avisa que precisa agir.
 */
export async function notifyWorkflowRejectToResponsavel(
  chamado: IChamadoN1,
  definicao: { _id: unknown; slug?: string },
): Promise<IWorkflowNotificacao | null> {
  const tab = chamado.tabulacao?.[chamado.tabulacao.length - 1];
  const responsavelNome = String(tab?.responsavel || '').trim();
  if (!responsavelNome) {
    console.info('[workflow-notif] reprovação sem responsável no ticket', {
      ticketId: String(chamado._id),
    });
    return null;
  }

  const destinatarioEmail = await resolveResponsavelEmail(responsavelNome);
  if (!destinatarioEmail) {
    console.info('[workflow-notif] e-mail do responsável não resolvido (reprovação)', {
      ticketId: String(chamado._id),
      responsavelNome,
    });
    return null;
  }

  const protocolo = String(chamado.chamadoProtocolo || '').trim() || String(chamado._id);

  try {
    return await createWorkflowNotificacao({
      destinatarioEmail,
      ticketId: String(chamado._id),
      chamadoProtocolo: protocolo,
      workflowId: String(definicao._id),
      workflowSlug: definicao.slug || 'workflow-reject',
      step: chamado.workflow?.step ?? 0,
      passoId: chamado.workflow?.passoId ? String(chamado.workflow.passoId) : null,
      titulo: 'Workflow reprovado',
      mensagem: `O workflow do ticket número ${protocolo} foi reprovado — verifique o retorno ao cliente.`,
    });
  } catch (err) {
    console.warn('[workflow-notif] falha ao criar recado de reprovação no sininho:', (err as Error).message);
    return null;
  }
}

/**
 * Notificação de sininho para item novo em canal especial (Bacen/Procon/Consumidor.gov/Reclame Aqui).
 * Sem workflow dedicado: aponta direto para o item no dash do órgão (rota /especiais/:orgao/ticket/:id).
 */
export async function createCasoEspecialNotificacao(payload: {
  destinatarioEmail: string;
  ticketId: string;
  chamadoProtocolo?: string;
  orgao: string;
  reclamacaoId?: string;
  titulo: string;
  mensagem: string;
}): Promise<IWorkflowNotificacao> {
  const Model = getWorkflowNotificacaoModel();
  const doc = await Model.create({
    tipo: 'caso_especial',
    destinatarioEmail: String(payload.destinatarioEmail).trim().toLowerCase(),
    ticketId: new Types.ObjectId(payload.ticketId),
    chamadoProtocolo: payload.chamadoProtocolo || '',
    orgao: payload.orgao,
    reclamacaoId: payload.reclamacaoId ? new Types.ObjectId(payload.reclamacaoId) : null,
    titulo: payload.titulo || 'Caso especial',
    mensagem: payload.mensagem || '',
    lida: false,
  });
  return doc.toObject() as IWorkflowNotificacao;
}

export async function listUnreadNotificacoes(email: string) {
  const Model = getWorkflowNotificacaoModel();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return [];
  return Model.find({ destinatarioEmail: normalized, lida: false })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
}

export async function listNotificacoesForUser(email: string, limit = 30) {
  const Model = getWorkflowNotificacaoModel();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return [];
  return Model.find({ destinatarioEmail: normalized })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/** Lida = sem utilidade — marcar como lida apaga o documento em vez de reter histórico morto. */
export async function markNotificacaoLida(id: string, email: string): Promise<boolean> {
  const Model = getWorkflowNotificacaoModel();
  const normalized = String(email || '').trim().toLowerCase();
  const result = await Model.findOneAndDelete({ _id: id, destinatarioEmail: normalized });
  return Boolean(result);
}

export async function markNotificacoesLidasForTicket(ticketId: string, email: string): Promise<number> {
  const Model = getWorkflowNotificacaoModel();
  const normalized = String(email || '').trim().toLowerCase();
  const result = await Model.deleteMany({
    ticketId: new Types.ObjectId(ticketId),
    destinatarioEmail: normalized,
    lida: false,
  });
  return result.deletedCount ?? 0;
}

export async function countUnreadNotificacoes(email: string): Promise<number> {
  const Model = getWorkflowNotificacaoModel();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return 0;
  return Model.countDocuments({ destinatarioEmail: normalized, lida: false });
}

export async function listCtaTicketsForUser(email: string): Promise<string[]> {
  const Model = getWorkflowNotificacaoModel();
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return [];
  const rows = await Model.find({ destinatarioEmail: normalized, lida: false })
    .select('ticketId')
    .lean();
  return [...new Set(rows.map((r) => String(r.ticketId)))];
}
