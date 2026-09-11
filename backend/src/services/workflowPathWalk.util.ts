/**
 * workflowPathWalk.util v1.0.0 — navegação compartilhada na árvore de etapas
 * do Workflow (bifurcação real): resolve o nó atual do ticket a partir de
 * `chamado.workflow.path`, descendo recursivamente por `definicao.passos`
 * (raiz) e `rota.passos` (ramos) conforme necessário. Usado por
 * workflowTicket.service, workflowDto.util e permission.service — extraído
 * pra um módulo próprio pra evitar duplicar a lógica de travessia e evitar
 * ciclo de import entre esses três (workflowTicket já importa de
 * permission.service).
 */
import { Types } from 'mongoose';
import type { IChamadoN1, IWorkflowPathSegment } from '../models/ChamadoN1';
import type { IWorkflowDefinicao, IWorkflowPassoEnvelope, IWorkflowRota } from '../models/WorkflowDefinicao';

export function sortPassos(passos: IWorkflowPassoEnvelope[] = []): IWorkflowPassoEnvelope[] {
  return [...(passos || [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

export function findRota(
  passo: IWorkflowPassoEnvelope | null,
  variavel: 'approve' | 'reject',
): IWorkflowRota | null {
  return (passo?.passo?.acao?.rotas || []).find((r) => r.variavel === variavel) || null;
}

export interface ResolvedWorkflowNode {
  node: IWorkflowPassoEnvelope;
  container: IWorkflowPassoEnvelope[];
  index: number;
}

/**
 * Desce recursivamente pela árvore de etapas seguindo `path`. Retorna null se
 * o path estiver vazio ou apontar pra um nó/rota que não existe mais (dado
 * legado/inválido).
 */
export function findNodeAndContainer(
  definicao: IWorkflowDefinicao,
  path: IWorkflowPathSegment[] | null | undefined,
): ResolvedWorkflowNode | null {
  if (!path?.length) return null;
  let container = sortPassos(definicao.passos);
  let node: IWorkflowPassoEnvelope | undefined;
  let index = -1;

  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    if (i > 0) {
      const parent = node;
      if (!parent || parent.passo?.acao?.tipo !== 'aprovacao' || !segment.viaVariavel) return null;
      const rota = findRota(parent, segment.viaVariavel as 'approve' | 'reject');
      if (!rota) return null;
      container = sortPassos(rota.passos);
    }
    index = container.findIndex((p) => String(p._id) === String(segment.passoEnvelopeId));
    if (index < 0) return null;
    node = container[index];
  }

  if (!node) return null;
  return { node, container, index };
}

/** Caminho até o primeiro nó do array raiz (início do workflow). */
export function buildRootPath(definicao: IWorkflowDefinicao): IWorkflowPathSegment[] | null {
  const passos = sortPassos(definicao.passos);
  if (!passos.length) return null;
  return [{ passoEnvelopeId: passos[0]._id as Types.ObjectId }];
}

/** Path atual do ticket — upgrade preguiçoso de dado legado (passoId único, sem path). */
export function resolveCurrentPath(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
): IWorkflowPathSegment[] | null {
  const wf = chamado.workflow;
  if (wf?.path?.length) return wf.path;
  if (wf?.passoId) return [{ passoEnvelopeId: wf.passoId }];
  return buildRootPath(definicao);
}
