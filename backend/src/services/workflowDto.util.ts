/**
 * workflowDto.util v2.0.0 — stepper reconstruído a partir de `path` (bifurcação
 * em árvore): não existe mais "etapa N de M" com M fixo (ramos diferentes têm
 * tamanhos diferentes) — o histórico mostra o caminho realmente percorrido,
 * mais uma prévia dos próximos passos JÁ conhecidos (dentro do mesmo ramo,
 * até a próxima aprovação ainda não decidida).
 */
import { Types } from 'mongoose';
import type { IChamadoN1, IChamadoWorkflow, IRegistro, IWorkflowPathSegment } from '../models/ChamadoN1';
import type { IWorkflowDefinicao, IWorkflowPassoEnvelope, IWorkflowRota } from '../models/WorkflowDefinicao';
import { getWorkflowById, resolveWorkflowForTicket } from './workflowDefinicao.service';

function sortPassos(passos: IWorkflowPassoEnvelope[] = []): IWorkflowPassoEnvelope[] {
  return [...(passos || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

function findRota(
  passo: IWorkflowPassoEnvelope | null,
  variavel: 'approve' | 'reject',
): IWorkflowRota | null {
  return (passo?.passo?.acao?.rotas || []).find((r) => r.variavel === variavel) || null;
}

interface WalkedSegment {
  envelope: IWorkflowPassoEnvelope;
  container: IWorkflowPassoEnvelope[];
  index: number;
}

/** Caminho atual — upgrade preguiçoso de dado legado (passoId único, sem path). */
function resolveEffectivePath(chamado: IChamadoN1, definicao: IWorkflowDefinicao): IWorkflowPathSegment[] {
  const wf = chamado.workflow;
  if (wf?.path?.length) return wf.path;
  if (wf?.passoId) return [{ passoEnvelopeId: wf.passoId }];
  const raiz = sortPassos(definicao.passos);
  return raiz.length ? [{ passoEnvelopeId: raiz[0]._id as Types.ObjectId }] : [];
}

/** Percorre `path` desde a raiz, devolvendo cada segmento com seu container/índice. */
function walkPath(
  definicao: IWorkflowDefinicao,
  path: IWorkflowPathSegment[],
): WalkedSegment[] {
  const walked: WalkedSegment[] = [];
  let container = sortPassos(definicao.passos);
  let parent: IWorkflowPassoEnvelope | undefined;

  for (const segment of path) {
    if (parent) {
      if (parent.passo?.acao?.tipo !== 'aprovacao' || !segment.viaVariavel) break;
      const rota = findRota(parent, segment.viaVariavel as 'approve' | 'reject');
      if (!rota) break;
      container = sortPassos(rota.passos);
    }
    const index = container.findIndex((p) => String(p._id) === String(segment.passoEnvelopeId));
    if (index < 0) break;
    const envelope = container[index];
    walked.push({ envelope, container, index });
    parent = envelope;
  }

  return walked;
}

/**
 * Prévia dos próximos passos JÁ conhecidos a partir do último segmento
 * percorrido: irmãos seguintes do mesmo container, até (e incluindo) o
 * próximo nó de aprovação — sem tentar adivinhar o que vem depois de uma
 * bifurcação ainda não decidida.
 */
function buildUpcomingPreview(last: WalkedSegment | undefined): IWorkflowPassoEnvelope[] {
  if (!last) return [];
  const preview: IWorkflowPassoEnvelope[] = [];
  for (let i = last.index + 1; i < last.container.length; i += 1) {
    const envelope = last.container[i];
    preview.push(envelope);
    if (envelope.passo?.acao?.tipo === 'aprovacao') break;
  }
  return preview;
}

function registroHasWorkflowReject(registro: IRegistro[] = []): boolean {
  return registro.some((row) => {
    if (row.metadados?.workflowDecision === 'reject') return true;
    return (row.alteracoes || []).some(
      (item) => (item as Record<string, unknown>)?.workflowDecision === 'reject',
    );
  });
}

/** Id do passo de aprovação reprovado dentro do caminho percorrido (para stepper denied). */
function resolveRejectedApprovalStepId(
  chamado: IChamadoN1,
  walked: WalkedSegment[],
): string | null {
  if (!registroHasWorkflowReject(chamado.registro || [])) return null;
  for (let i = walked.length - 1; i >= 0; i -= 1) {
    if (walked[i].envelope.passo?.acao?.tipo === 'aprovacao') {
      return String(walked[i].envelope._id);
    }
  }
  return null;
}

function summarizePasso(envelope: IWorkflowPassoEnvelope) {
  const cfg = envelope.passo || {};
  return {
    id: String(envelope._id),
    nome: String(cfg.nome || 'Etapa').trim() || 'Etapa',
    ordem: envelope.ordem ?? 0,
    acaoTipo: cfg.acao?.tipo || 'manual',
    team: cfg.atribuicao?.funcaoSlug
      || cfg.atribuicao?.grupoSlug
      || (cfg.atribuicao?.tipo === 'colaborador' ? 'n1' : 'n1'),
    slaHoras: cfg.slaHoras ?? null,
  };
}

export function buildLateralWorkflowDto(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
): Record<string, unknown> | null {
  const wf = chamado.workflow;
  const finished = wf?.workflowStatus === 'finished';
  const cancelled = wf?.workflowStatus === 'cancel';
  if ((!wf?.active && !finished && !cancelled) || !wf.workflowId) return null;

  const path = resolveEffectivePath(chamado, definicao);
  const walked = walkPath(definicao, path);
  const last = walked[walked.length - 1];
  const rejectedStepId = resolveRejectedApprovalStepId(chamado, walked);
  const currentStepId = last ? String(last.envelope._id) : '';
  const startedAt = wf.startedAt ? new Date(wf.startedAt).toISOString() : new Date().toISOString();
  const completedAt = wf.completedAt ? new Date(wf.completedAt).toISOString() : null;

  type StepHistoryEntry = {
    stepId: string;
    status: 'completed' | 'active' | 'pending' | 'skipped' | 'denied';
    at: string;
    by: string;
    trigger: string;
    label?: string;
  };

  const stepHistory: StepHistoryEntry[] = walked.map((seg, index) => {
    const stepId = String(seg.envelope._id);
    const isLast = index === walked.length - 1;
    let status: StepHistoryEntry['status'] = 'completed';
    if (rejectedStepId && stepId === rejectedStepId) {
      status = 'denied';
    } else if (cancelled) {
      status = isLast ? 'skipped' : 'completed';
    } else if (finished || wf.completedAt || !isLast) {
      status = 'completed';
    } else {
      status = 'active';
    }
    return {
      stepId,
      status,
      at: startedAt,
      by: 'sistema',
      trigger: isLast ? 'active' : 'history',
      label: String(seg.envelope.passo?.nome || '').trim() || undefined,
    };
  });

  // Prévia dos próximos passos já conhecidos (mesmo ramo, sem adivinhar bifurcação futura).
  if (!finished && !cancelled) {
    buildUpcomingPreview(last).forEach((envelope) => {
      stepHistory.push({
        stepId: String(envelope._id),
        status: 'pending',
        at: startedAt,
        by: 'sistema',
        trigger: 'history',
        label: String(envelope.passo?.nome || '').trim() || undefined,
      });
    });
  }

  const passosResumo = [
    ...walked.map((seg) => summarizePasso(seg.envelope)),
    ...(!finished && !cancelled ? buildUpcomingPreview(last).map(summarizePasso) : []),
  ];

  return {
    templateId: definicao.slug,
    definicaoSlug: definicao.slug,
    definicaoId: String(definicao._id),
    title: definicao.titulo,
    currentStepId,
    step: walked.length - 1,
    startedAt,
    completedAt,
    status: finished ? 'completed' : cancelled ? 'cancelled' : 'active',
    workflowStatus: wf.workflowStatus ?? (wf.active ? 'active' : null),
    stepHistory,
    passosResumo,
    pendingDecision: wf.pendingDecision ?? null,
  };
}

export async function loadWorkflowDefForChamado(chamado: IChamadoN1): Promise<IWorkflowDefinicao | null> {
  const wf = chamado.workflow;
  if (wf?.workflowId) {
    return getWorkflowById(String(wf.workflowId));
  }
  return resolveWorkflowForTicket({
    tabulacao: chamado.tabulacao as unknown as Array<Record<string, string>>,
  });
}

function ensureWorkflowState(chamado: IChamadoN1): IChamadoWorkflow {
  if (!chamado.workflow) {
    chamado.workflow = {
      active: false,
      workflowStatus: null,
      workflowId: null,
      path: [],
      startedAt: null,
      completedAt: null,
      pendingDecision: null,
    };
  }
  return chamado.workflow;
}

export function syncLegacyWorkflowFromBody(
  chamado: IChamadoN1,
  lateralWorkflow: Record<string, unknown> | undefined,
): void {
  if (!lateralWorkflow || typeof lateralWorkflow !== 'object') return;
  const wf = ensureWorkflowState(chamado);
  if (wf.active && wf.workflowId) return;

  const definicaoId = lateralWorkflow.definicaoId || lateralWorkflow.workflowId;
  const step = typeof lateralWorkflow.step === 'number'
    ? lateralWorkflow.step
    : undefined;

  if (definicaoId) {
    const finished = lateralWorkflow.workflowStatus === 'finished'
      || lateralWorkflow.status === 'completed';
    wf.active = !finished;
    wf.workflowStatus = finished ? 'finished' : 'active';
    wf.workflowId = new Types.ObjectId(String(definicaoId));
    wf.step = step ?? 0;
    wf.startedAt = lateralWorkflow.startedAt ? new Date(String(lateralWorkflow.startedAt)) : new Date();
    wf.completedAt = lateralWorkflow.completedAt ? new Date(String(lateralWorkflow.completedAt)) : null;
    if (lateralWorkflow.currentStepId) {
      wf.passoId = new Types.ObjectId(String(lateralWorkflow.currentStepId));
    }
  }
}
