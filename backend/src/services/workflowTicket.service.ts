/**
 * workflowTicket.service v2.0.0 — bifurcação real em árvore: rotas (approve/reject)
 * têm sub-listas de etapas próprias (rota.passos[]); a posição do ticket no
 * workflow passa a ser um `path` (sequência de nós da raiz até a folha atual,
 * incluindo qual rota foi tomada em cada aprovação) em vez de um índice `step`
 * num array plano único. Isso elimina por construção o vazamento entre
 * caminhos (uma etapa automática de um ramo nunca pode "cair" no array de
 * outro ramo, porque cada ramo tem seu próprio array).
 */
import { isAutomaticaStep, resolveAutomaticaConfig } from './workflowAutomatica.util';
import { Types } from 'mongoose';
import type { AuthPayload } from '../middleware/auth';
import type { IChamadoN1, IChamadoWorkflow, IRegistro, IWorkflowPathSegment } from '../models/ChamadoN1';
import type { IWorkflowDefinicao, IWorkflowPassoEnvelope, IWorkflowRota } from '../models/WorkflowDefinicao';
import {
  appendStatusTransition,
  currentStatus,
  isClientIdentifiedOnChamado,
  MERGE_TERMINAL_STATUSES,
  normalizeStatusValue,
  readTabulacaoSnapshot,
} from './chamado.mapper';
import {
  buildRootPath,
  findNodeAndContainer,
  findRota,
  resolveCurrentPath,
  sortPassos,
} from './workflowPathWalk.util';
import { getActiveWorkflows, getWorkflowById, getWorkflowBySlug, resolveWorkflowForTicket } from './workflowDefinicao.service';
import {
  buildTabulationFieldsFromChamado,
  buildTabulationFieldsFromTicket,
  buildWorkflowTicketContextFromChamado,
  evaluateGatilhoCriterios,
  resolveAtribuidoForPasso,
} from './workflowMatcher.service';
import {
  canApproveWorkflow,
  canUserActOnWorkflowStep,
  matchesWorkflowDefinitionTeam,
  resolveUserPermissions,
  resolveWorkflowTeamQueueForUser,
  ticketMatchesWorkflowTeamAsync,
} from './permission.service';
import { executeSistemaStep, isDevolutivaPasso } from './workflowSistemaExecutor.service';
import { notifyWorkflowRejectToResponsavel } from './workflowNotificacao.service';
import { notifyWorkflowStepAssignmentAsync } from './workflowAssignmentNotification.service';
import { buildLateralWorkflowDto } from './workflowDto.util';
import {
  applyRequisicaoToChamado,
  buildRequisicaoSnapshot,
  WorkflowRequisicaoError,
} from './workflowRequisicao.service';
import type { IChamadoWorkflowRequisicao } from '../config/workflowRequisicaoDefaults';
import { normalizeFuncao } from '../utils/normalizeFuncao';

export class WorkflowAdvanceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------
// Navegação na árvore de etapas (sortPassos/findRota/findNodeAndContainer/
// buildRootPath/resolveCurrentPath vêm de workflowPathWalk.util, compartilhado
// com workflowDto.util e permission.service)
// ---------------------------------------------------------------------

/**
 * Próximo item do MESMO container (mesmo ramo/nível) do nó atual — nunca
 * atravessa para o array de outro ramo, porque cada ramo tem seu próprio
 * array. `null` = fim do ramo/tronco (encerra o workflow).
 */
function resolveNextSiblingPath(
  path: IWorkflowPathSegment[],
  container: IWorkflowPassoEnvelope[],
  index: number,
): IWorkflowPathSegment[] | null {
  if (index + 1 >= container.length) return null;
  const next = container[index + 1];
  const nextPath = path.slice(0, -1);
  nextPath.push({ ...path[path.length - 1], passoEnvelopeId: next._id as Types.ObjectId });
  return nextPath;
}

/**
 * Caminho pra dentro do ramo escolhido numa decisão (approve/reject): entra
 * no primeiro item de `rota.passos`. `null` = rota sem etapas ("sem
 * destino") — reject volta ao responsável, approve simplesmente encerra o
 * workflow (ver `advanceWorkflowManual`).
 */
function resolveDecisionPath(
  path: IWorkflowPathSegment[],
  node: IWorkflowPassoEnvelope,
  variavel: 'approve' | 'reject',
): IWorkflowPathSegment[] | null {
  const rota = findRota(node, variavel);
  const passos = sortPassos(rota?.passos || []);
  if (!passos.length) return null;
  return [...path, { passoEnvelopeId: passos[0]._id as Types.ObjectId, viaVariavel: variavel }];
}

function resolveTeamApprovalPath(definicao: IWorkflowDefinicao, teamSlug: string): IWorkflowPathSegment[] | null {
  const team = normalizeFuncao(teamSlug);
  const passos = sortPassos(definicao.passos);
  const found = passos.find((p) => {
    if (p.passo?.acao?.tipo !== 'aprovacao') return false;
    const grupo = normalizeFuncao(p.passo?.atribuicao?.grupoSlug || '');
    const funcao = normalizeFuncao(p.passo?.atribuicao?.funcaoSlug || '');
    return grupo === team || funcao === team;
  });
  return found ? [{ passoEnvelopeId: found._id as Types.ObjectId }] : null;
}

/**
 * Busca a etapa de aprovação de "Produtos" só no array raiz (nunca desce em
 * ramos): o atalho de "pular direto pra lá" só faz sentido antes de qualquer
 * decisão ter sido tomada em outro lugar do workflow — a etapa de Produtos
 * deve estar no tronco, antes de qualquer bifurcação.
 */
export function resolveProdutosApprovalPath(definicao: IWorkflowDefinicao): IWorkflowPathSegment[] | null {
  return resolveTeamApprovalPath(definicao, 'produtos');
}

/**
 * Compara a posição de dois paths de 1 segmento dentro do array raiz. Retorna
 * null quando qualquer um dos dois já saiu do tronco (path com mais de 1
 * segmento) — nesse caso a comparação linear não faz mais sentido, porque a
 * posição está dentro de um ramo, não no array raiz.
 */
function compareRootPositions(
  definicao: IWorkflowDefinicao,
  pathA: IWorkflowPathSegment[],
  pathB: IWorkflowPathSegment[],
): number | null {
  if (pathA.length !== 1 || pathB.length !== 1) return null;
  const passos = sortPassos(definicao.passos);
  const idxA = passos.findIndex((p) => String(p._id) === String(pathA[0].passoEnvelopeId));
  const idxB = passos.findIndex((p) => String(p._id) === String(pathB[0].passoEnvelopeId));
  if (idxA < 0 || idxB < 0) return null;
  return idxA - idxB;
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

/** Grava o novo path e espelha step/passoId (deprecados, só observabilidade). */
function setWorkflowPath(wf: IChamadoWorkflow, path: IWorkflowPathSegment[]): void {
  wf.path = path;
  wf.step = path.length - 1;
  wf.passoId = path.length ? path[path.length - 1].passoEnvelopeId : null;
}

function applyAtribuidoForPasso(chamado: IChamadoN1, passo: IWorkflowPassoEnvelope): void {
  const fields = buildTabulationFieldsFromChamado(chamado);
  let atribuido = resolveAtribuidoForPasso(passo.passo?.atribuicao || { tipo: 'funcao', funcaoSlug: 'atendimento', colaborador: '' }, fields);
  if (!atribuido) return;
  if (atribuido.startsWith('funcao:')) {
    atribuido = `funcao:${normalizeFuncao(atribuido.slice(7))}`;
  }
  const tab = readTabulacaoSnapshot(chamado.tabulacao[0]);
  chamado.tabulacao = [{ ...tab, atribuido }];
}

/**
 * Reprovação sem destino sempre devolve o ticket ao responsável, independente
 * de como a atribuição da etapa-pai está configurada. Isso garante que
 * atribuido=responsavel e, por consequência, que o ticket some da fila do
 * aprovador (que não é mais o atribuído).
 */
function forceAtribuidoToResponsavel(chamado: IChamadoN1): void {
  const tab = readTabulacaoSnapshot(chamado.tabulacao?.[0]);
  const responsavel = String(tab?.responsavel || '').trim();
  if (!responsavel) return;
  chamado.tabulacao = [{ ...tab, atribuido: responsavel }];
}

const VALID_ROTA_STATUS = ['pendente', 'em-andamento', 'resolvido'] as const;

/**
 * Aplica rota.statusTicket (campo configurável no editor de Workflow) ao chamado,
 * com um fallback opcional para quando a rota não define status (usado hoje só
 * no caminho "reprovação sem destino", pra preservar o comportamento padrão).
 */
function applyRotaStatusTicket(
  chamado: IChamadoN1,
  rota: IWorkflowRota | null,
  autor: string,
  options: {
    fallback?: string;
    anotacaoInterna?: string;
    metadados?: Record<string, unknown>;
  } = {},
): void {
  const rotaStatus = rota?.statusTicket && (VALID_ROTA_STATUS as readonly string[]).includes(rota.statusTicket)
    ? rota.statusTicket
    : null;
  const desired = rotaStatus || options.fallback;
  if (!desired) return;
  const status = normalizeStatusValue(currentStatus(chamado));
  if ((MERGE_TERMINAL_STATUSES as readonly string[]).includes(status)) return;
  if (status === desired) return;
  appendStatusTransition(chamado, desired, {
    autor,
    anotacaoInterna: options.anotacaoInterna || `Workflow: status do ticket atualizado para "${desired}".`,
    metadados: options.metadados || {},
  });
}

function appendWorkflowRegistro(
  chamado: IChamadoN1,
  payload: {
    autor: string;
    alteracoes?: unknown[];
    metadados?: Record<string, unknown>;
    anotacaoInterna?: string;
  },
): void {
  const status = currentStatus(chamado);
  const entry: IRegistro = {
    data: new Date(),
    origin: 'agente',
    autor: payload.autor,
    mensagemPublica: '',
    anexosMensagemPublica: [],
    anotacaoInterna: payload.anotacaoInterna || '',
    anexosAnotacaoInterna: [],
    alteracoes: payload.alteracoes || [],
    metadados: payload.metadados || {},
    status,
  };
  chamado.registro.push(entry);
}

/**
 * Transição única para resolvido no instante em que o workflow conclui.
 * Não reexecuta em leituras/sync — só no bloco de conclusão de advanceToPath.
 * Respostas posteriores do cliente reabrem via resolveInboundClientReplyStatus.
 */
function resolveTicketOnWorkflowFinished(chamado: IChamadoN1, autor: string): void {
  const status = normalizeStatusValue(currentStatus(chamado));
  if ((MERGE_TERMINAL_STATUSES as readonly string[]).includes(status)) {
    return;
  }
  appendStatusTransition(chamado, 'resolvido', {
    autor,
    anotacaoInterna: 'Ticket resolvido automaticamente ao concluir o workflow.',
    metadados: {
      workflowFinishedResolve: true,
      trigger: 'workflow-finished',
    },
  });
}

async function runSistemaIfNeeded(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  path: IWorkflowPathSegment[],
): Promise<{ autoAdvanced: boolean }> {
  const resolved = findNodeAndContainer(definicao, path);
  if (!resolved || !isAutomaticaStep(resolved.node.passo)) {
    return { autoAdvanced: false };
  }

  const result = await executeSistemaStep(chamado, definicao, path.length - 1, resolved.node);
  if (result.autoAdvance && result.ok) {
    const nextPath = resolveNextSiblingPath(path, resolved.container, resolved.index);
    return advanceToPath(chamado, definicao, nextPath, 'Sistema', { trigger: 'sistema-auto' });
  }
  return { autoAdvanced: false };
}

async function advanceToPath(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  newPath: IWorkflowPathSegment[] | null,
  autor: string,
  options: {
    trigger?: string;
    skipped?: boolean;
    decision?: string;
    /** Reprovação sem destino: não dispara resposta automática ao cliente na devolutiva. */
    skipSistema?: boolean;
    /**
     * Encerramento sem destino configurado: não marca o ticket como
     * "resolvido" — quem chamou aplica o status correto (applyRotaStatusTicket
     * devolve ao responsável em "em-andamento" por padrão).
     */
    skipResolve?: boolean;
  } = {},
): Promise<{ autoAdvanced: boolean }> {
  const wf = ensureWorkflowState(chamado);

  if (!newPath) {
    wf.completedAt = new Date();
    wf.active = false;
    wf.workflowStatus = 'finished';
    wf.pendingDecision = null;
    appendWorkflowRegistro(chamado, {
      autor,
      anotacaoInterna: `Workflow "${definicao.titulo}" concluído.`,
      metadados: {
        workflow: buildLateralWorkflowDto(chamado, definicao),
      },
      alteracoes: [{ workflowCompleted: true, trigger: options.trigger }],
    });
    if (!options.skipResolve) {
      resolveTicketOnWorkflowFinished(chamado, autor);
    }
    return { autoAdvanced: true };
  }

  const resolved = findNodeAndContainer(definicao, newPath);
  if (!resolved) {
    // path inválido (dado legado/corrompido) — trata como fim de workflow por segurança.
    return advanceToPath(chamado, definicao, null, autor, options);
  }
  const { node } = resolved;

  setWorkflowPath(wf, newPath);
  wf.pendingDecision = null;
  applyAtribuidoForPasso(chamado, node);
  void notifyWorkflowStepAssignmentAsync(chamado, definicao, node);

  appendWorkflowRegistro(chamado, {
    autor,
    anotacaoInterna: `Workflow avançou para etapa "${node.passo?.nome || ''}".`,
    metadados: {
      workflow: buildLateralWorkflowDto(chamado, definicao),
      workflowAdvance: {
        path: newPath.map((s) => ({ passoEnvelopeId: String(s.passoEnvelopeId), viaVariavel: s.viaVariavel || null })),
        trigger: options.trigger,
        skipped: options.skipped ?? false,
        decision: options.decision,
      },
    },
    alteracoes: [{ workflowStep: newPath.length - 1, passoNome: node.passo?.nome }],
  });

  if (!options.skipSistema && isAutomaticaStep(node.passo)) {
    const nested = await runSistemaIfNeeded(chamado, definicao, newPath);
    return { autoAdvanced: nested.autoAdvanced };
  }

  return { autoAdvanced: false };
}

export async function activateWorkflowForChamado(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  autor = 'Sistema',
  options: { requisicao?: IChamadoWorkflowRequisicao | null } = {},
): Promise<boolean> {
  const wf = ensureWorkflowState(chamado);
  if (wf.active && wf.workflowId) return false;

  const initialPath = buildRootPath(definicao);
  if (!initialPath) return false;
  const resolved = findNodeAndContainer(definicao, initialPath);
  if (!resolved) return false;

  wf.active = true;
  wf.workflowStatus = 'active';
  wf.workflowId = definicao._id as Types.ObjectId;
  setWorkflowPath(wf, initialPath);
  wf.startedAt = new Date();
  wf.completedAt = null;
  wf.pendingDecision = null;

  if (options.requisicao) {
    wf.requisicao = options.requisicao;
  }

  applyAtribuidoForPasso(chamado, resolved.node);
  void notifyWorkflowStepAssignmentAsync(chamado, definicao, resolved.node);

  appendWorkflowRegistro(chamado, {
    autor,
    anotacaoInterna: `Workflow "${definicao.titulo}" ativado.`,
    metadados: {
      workflow: buildLateralWorkflowDto(chamado, definicao),
      ...(options.requisicao
        ? {
          requisicao: {
            valores: options.requisicao.valores,
            workflowId: String(definicao._id),
            campoIds: Object.keys(options.requisicao.valores || {}),
          },
        }
        : {}),
    },
    alteracoes: [{ workflowActivated: definicao.slug }],
  });

  await runSistemaIfNeeded(chamado, definicao, initialPath);
  return true;
}

export async function tryActivateWorkflowOnTabulation(
  chamado: IChamadoN1,
  autor = 'Sistema',
): Promise<boolean> {
  const wf = chamado.workflow;
  if (wf?.active && wf.workflowId) return false;
  // Conclusão permanece estável mesmo após reabertura/retabulação. Um novo
  // workflow pode ser iniciado explicitamente pelo agente.
  if (wf?.workflowStatus === 'finished') return false;

  const definicao = await resolveWorkflowForTicket(buildWorkflowTicketContextFromChamado(chamado));
  if (!definicao) return false;

  return activateWorkflowForChamado(chamado, definicao, autor);
}

function shouldAutoForwardAfterRequisicaoStart(
  definicao: IWorkflowDefinicao,
  path: IWorkflowPathSegment[],
): boolean {
  const resolved = findNodeAndContainer(definicao, path);
  if (!resolved) return false;
  const { node, container, index } = resolved;
  if (index + 1 >= container.length) return false;
  const p = node.passo;
  return (
    path.length === 1
    && index === 0
    && p?.acao?.tipo === 'manual'
    && String(p?.atribuicao?.grupoSlug || '').toLowerCase() === 'n1'
  );
}

export async function startWorkflowForChamado(
  chamado: IChamadoN1,
  authUser?: AuthPayload | null,
  requisicaoValores?: Record<string, unknown>,
  definicaoSlug?: string,
  solicitacaoProdutos?: Record<string, unknown>,
): Promise<IChamadoN1> {
  const wf = chamado.workflow;
  if (wf?.active && wf.workflowId) {
    throw new WorkflowAdvanceError('Workflow já está ativo neste ticket', 400);
  }

  if (!isClientIdentifiedOnChamado(chamado)) {
    throw new WorkflowAdvanceError(
      'Identifique o cliente (CPF válido) antes de iniciar o workflow.',
      400,
    );
  }

  const ticketCtx = buildWorkflowTicketContextFromChamado(chamado);
  const fields = buildTabulationFieldsFromTicket(ticketCtx);

  let definicao: IWorkflowDefinicao | null = null;
  const slug = String(definicaoSlug || '').trim();

  if (slug) {
    definicao = await getWorkflowBySlug(slug);
    if (!definicao || definicao.ativo === false) {
      throw new WorkflowAdvanceError('Workflow selecionado não encontrado ou inativo', 400);
    }
    if (!evaluateGatilhoCriterios(definicao.gatilho?.criterios || [], fields)) {
      throw new WorkflowAdvanceError('Tabulação não compatível com o workflow selecionado', 400);
    }
  } else {
    definicao = await resolveWorkflowForTicket(ticketCtx);
  }

  if (!definicao) {
    throw new WorkflowAdvanceError('Tabulação não compatível com nenhum workflow ativo', 400);
  }

  const requisicaoSnapshot = buildRequisicaoSnapshot(
    definicao,
    requisicaoValores,
    authUser,
    solicitacaoProdutos,
  );
  const autor = authUser?.name || authUser?.email || 'Agente';
  const activated = await activateWorkflowForChamado(chamado, definicao, autor, {
    requisicao: requisicaoSnapshot,
  });
  if (!activated) {
    throw new WorkflowAdvanceError('Não foi possível iniciar o workflow', 400);
  }

  applyRequisicaoToChamado(chamado, requisicaoSnapshot);

  const hasRequisicaoPayload = Boolean(
    (requisicaoValores && Object.keys(requisicaoValores).length)
    || (solicitacaoProdutos && Object.keys(solicitacaoProdutos).length),
  );
  const currentPath = chamado.workflow?.path?.length ? chamado.workflow.path : buildRootPath(definicao);
  if (
    hasRequisicaoPayload
    && currentPath
    && shouldAutoForwardAfterRequisicaoStart(definicao, currentPath)
  ) {
    const resolved = findNodeAndContainer(definicao, currentPath);
    if (resolved) {
      const nextPath = resolveNextSiblingPath(currentPath, resolved.container, resolved.index);
      await advanceToPath(chamado, definicao, nextPath, autor, {
        trigger: 'requisicao-start-forward',
      });
    }
  }

  return chamado;
}

export async function canUserActOnStep(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  authUser?: AuthPayload | null,
): Promise<boolean> {
  if (!authUser) return false;
  const wf = chamado.workflow;
  if (!wf?.active) return false;

  const path = resolveCurrentPath(chamado, definicao);
  const resolved = findNodeAndContainer(definicao, path);
  if (!resolved) return false;
  const passo = resolved.node;

  const automatica = resolveAutomaticaConfig(passo.passo);

  if (isAutomaticaStep(passo.passo) && automatica?.modo !== 'call_to_action') {
    return false;
  }

  const atribuicao = passo.passo?.atribuicao;
  if (atribuicao?.tipo === 'sistema') {
    return automatica?.modo === 'call_to_action';
  }

  const isApproval = passo.passo?.acao?.tipo === 'aprovacao';
  return canUserActOnWorkflowStep(authUser, chamado, isApproval);
}

export async function advanceWorkflowManual(
  chamado: IChamadoN1,
  authUser?: AuthPayload | null,
): Promise<IChamadoN1> {
  const wf = chamado.workflow;
  if (!wf?.active || !wf.workflowId) {
    throw new WorkflowAdvanceError('Ticket sem workflow ativo', 400);
  }

  const definicao = await getWorkflowById(String(wf.workflowId));
  if (!definicao) throw new WorkflowAdvanceError('Definição de workflow não encontrada', 404);

  const allowed = await canUserActOnStep(chamado, definicao, authUser);
  if (!allowed) throw new WorkflowAdvanceError('Sem permissão para avançar esta etapa', 403);

  const currentPath = resolveCurrentPath(chamado, definicao);
  const resolved = findNodeAndContainer(definicao, currentPath);
  if (!resolved || !currentPath) throw new WorkflowAdvanceError('Etapa atual do workflow não encontrada', 404);
  const { node: passo, container, index } = resolved;
  const acaoTipo = passo.passo?.acao?.tipo;

  if (acaoTipo === 'aprovacao' && !wf.pendingDecision) {
    throw new WorkflowAdvanceError('Selecione Aprovado ou Reprovado antes de avançar', 400);
  }

  const autor = authUser?.name || authUser?.email || 'Agente';

  let approveRota: IWorkflowRota | null = null;

  if (acaoTipo === 'aprovacao' && wf.pendingDecision === 'reject') {
    const rejectRota = findRota(passo, 'reject');
    const branchPath = resolveDecisionPath(currentPath, passo, 'reject');
    appendWorkflowRegistro(chamado, {
      autor,
      alteracoes: [{ workflowDecision: 'reject' }],
      metadados: { workflowDecision: 'reject' },
    });
    if (branchPath) {
      // Ramo com etapas configuradas: reprovação se comporta como um avanço
      // normal — respeita a atribuição própria do primeiro passo do ramo, roda
      // etapas automáticas do ramo, não força volta ao responsável.
      await advanceToPath(chamado, definicao, branchPath, autor, {
        trigger: 'decision-reject',
        decision: 'reject',
      });
      applyRotaStatusTicket(chamado, rejectRota, autor, {});
    } else {
      // Ramo sem etapas ("sem destino"): encerra a passagem pelo workflow aqui
      // mesmo e devolve o ticket ao responsável para devolutiva manual.
      await advanceToPath(chamado, definicao, null, autor, {
        trigger: 'decision-reject',
        decision: 'reject',
        skipSistema: true,
        skipResolve: true,
      });
      forceAtribuidoToResponsavel(chamado);
      applyRotaStatusTicket(chamado, rejectRota, autor, {
        fallback: 'em-andamento',
        anotacaoInterna: 'Workflow reprovado — aguardando retorno manual ao cliente pelo responsável.',
        metadados: { workflowReject: true },
      });
      await notifyWorkflowRejectToResponsavel(chamado, definicao);
    }
    wf.pendingDecision = null;
    return chamado;
  }

  if (acaoTipo === 'aprovacao' && wf.pendingDecision === 'approve') {
    appendWorkflowRegistro(chamado, {
      autor,
      alteracoes: [{ workflowDecision: 'approve' }],
      metadados: { workflowDecision: 'approve' },
    });
    approveRota = findRota(passo, 'approve');
    wf.pendingDecision = null;
  }

  // Nunca deixar uma decisão pendente (aprovar/reprovar) cair num avanço "cego":
  // se a etapa atual não está configurada como aprovação, a decisão não tem como
  // ser aplicada corretamente — falhar aqui evita reprovar e avançar como se fosse aprovado.
  if (wf.pendingDecision) {
    throw new WorkflowAdvanceError(
      'Etapa atual não está configurada para aprovação/reprovação. Ajuste o workflow antes de decidir.',
      400,
    );
  }

  // approve com rota sem etapas ("sem destino") passa a significar explicitamente
  // "aprovar encerra o workflow, sem mais nada" — não existe mais fallback implícito
  // pra "próxima posição do array", porque essa posição agora é privada de cada ramo.
  const targetPath = approveRota
    ? resolveDecisionPath(currentPath, passo, 'approve')
    : resolveNextSiblingPath(currentPath, container, index);
  await advanceToPath(chamado, definicao, targetPath, autor, {
    trigger: approveRota ? 'decision-approve' : 'manual-advance',
    decision: approveRota ? 'approve' : undefined,
  });
  if (approveRota) {
    applyRotaStatusTicket(chamado, approveRota, autor, {});
  }
  return chamado;
}

export function setWorkflowPendingDecision(
  chamado: IChamadoN1,
  decision: 'approve' | 'reject',
): void {
  const wf = ensureWorkflowState(chamado);
  if (!wf.active) throw new WorkflowAdvanceError('Ticket sem workflow ativo', 400);
  wf.pendingDecision = decision;
}

async function advanceWorkflowProdutosQueueDecision(
  chamado: IChamadoN1,
  decision: 'approve' | 'reject',
  authUser?: AuthPayload | null,
): Promise<IChamadoN1> {
  if (!authUser) {
    throw new WorkflowAdvanceError('Sem permissão para avançar esta etapa', 403);
  }

  const wf = chamado.workflow;
  if (!wf?.active || !wf.workflowId) {
    throw new WorkflowAdvanceError('Ticket sem workflow ativo', 400);
  }

  const resolved = await resolveUserPermissions(authUser);
  if (!canApproveWorkflow(resolved)) {
    throw new WorkflowAdvanceError('Sem permissão para aprovar/reprovar workflow', 403);
  }
  if (!(await ticketMatchesWorkflowTeamAsync(chamado, 'produtos'))) {
    throw new WorkflowAdvanceError('Ticket não pertence à fila Produtos', 403);
  }

  const definicao = await getWorkflowById(String(wf.workflowId));
  if (!definicao) throw new WorkflowAdvanceError('Definição de workflow não encontrada', 404);

  const produtosPath = resolveProdutosApprovalPath(definicao);
  if (!produtosPath) {
    setWorkflowPendingDecision(chamado, decision);
    return advanceWorkflowManual(chamado, authUser);
  }

  const autor = authUser.name || authUser.email || 'Agente';
  const currentPath = resolveCurrentPath(chamado, definicao);
  const cmp = currentPath ? compareRootPositions(definicao, currentPath, produtosPath) : null;

  if (cmp === null || cmp > 0) {
    // cmp === null: já saiu do tronco (bifurcou em outro lugar do workflow) — o atalho de
    // "pular direto pra Produtos" não se aplica mais; segue o fluxo manual normal.
    setWorkflowPendingDecision(chamado, decision);
    return advanceWorkflowManual(chamado, authUser);
  }

  if (cmp < 0) {
    await advanceToPath(chamado, definicao, produtosPath, autor, {
      trigger: 'produtos-queue-skip',
      skipped: true,
    });
  }

  wf.pendingDecision = decision;

  const produtosResolved = findNodeAndContainer(definicao, produtosPath);
  const produtosPasso = produtosResolved?.node ?? null;

  if (decision === 'reject') {
    const ticketJaEncerrado = (MERGE_TERMINAL_STATUSES as readonly string[]).includes(currentStatus(chamado));

    // Exigir comunicação prévia ao responsável antes de reprovar foi removido: a nota
    // interna obrigatória capturada no modal de reprovação (frontend) já cumpre esse
    // papel de registrar o motivo da negativa.
    appendWorkflowRegistro(chamado, {
      autor,
      alteracoes: [{ workflowDecision: 'reject' }],
      metadados: { workflowDecision: 'reject' },
    });
    wf.pendingDecision = null;

    if (ticketJaEncerrado) {
      // Ticket já encerrado pelo agente responsável — reprovar aqui apenas conclui o
      // workflow (não precisa de "Retorno ao cliente" nem de nova comunicação).
      await advanceToPath(chamado, definicao, null, autor, {
        trigger: 'produtos-queue-reject-encerrado',
        decision: 'reject',
      });
      forceAtribuidoToResponsavel(chamado);
      await notifyWorkflowRejectToResponsavel(chamado, definicao);
      return chamado;
    }

    const produtosRejectRota = findRota(produtosPasso, 'reject');
    const branchPath = produtosPasso ? resolveDecisionPath(produtosPath, produtosPasso, 'reject') : null;
    if (branchPath) {
      await advanceToPath(chamado, definicao, branchPath, autor, {
        trigger: 'decision-reject',
        decision: 'reject',
      });
      applyRotaStatusTicket(chamado, produtosRejectRota, autor, {});
    } else {
      await advanceToPath(chamado, definicao, null, autor, {
        trigger: 'decision-reject',
        decision: 'reject',
        skipSistema: true,
        skipResolve: true,
      });
      forceAtribuidoToResponsavel(chamado);
      applyRotaStatusTicket(chamado, produtosRejectRota, autor, {
        fallback: 'em-andamento',
        anotacaoInterna: 'Workflow reprovado — aguardando retorno manual ao cliente pelo responsável.',
        metadados: { workflowReject: true },
      });
      await notifyWorkflowRejectToResponsavel(chamado, definicao);
    }
    return chamado;
  }

  appendWorkflowRegistro(chamado, {
    autor,
    alteracoes: [{ workflowDecision: 'approve' }],
    metadados: { workflowDecision: 'approve' },
  });
  wf.pendingDecision = null;
  // "Feito" em produtos avança pra dentro do ramo "Aprovar" da etapa de Produtos (igual ao
  // aprovar do fluxo normal em advanceWorkflowManual) — se houver etapas configuradas ali
  // (ex.: "Resposta ao cliente"), rodam normalmente (IA ou e-mail padrão). Sem etapas
  // configuradas, encerra o workflow sem mensagem nenhuma.
  const produtosApproveRota = findRota(produtosPasso, 'approve');
  const approveBranchPath = produtosPasso ? resolveDecisionPath(produtosPath, produtosPasso, 'approve') : null;
  await advanceToPath(chamado, definicao, approveBranchPath, autor, {
    trigger: 'produtos-queue-feito',
    decision: 'approve',
  });
  applyRotaStatusTicket(chamado, produtosApproveRota, autor, {});
  return chamado;
}

export async function advanceWorkflowWithDecision(
  chamado: IChamadoN1,
  decision: 'approve' | 'reject',
  authUser?: AuthPayload | null,
): Promise<IChamadoN1> {
  if (authUser) {
    const resolved = await resolveUserPermissions(authUser);
    const teamQueue = resolveWorkflowTeamQueueForUser(resolved);
    if (teamQueue === 'produtos') {
      const belongsToProdutos = await ticketMatchesWorkflowTeamAsync(chamado, 'produtos')
        || await matchesWorkflowDefinitionTeam(resolved, chamado);
      if (belongsToProdutos) {
        return advanceWorkflowProdutosQueueDecision(chamado, decision, authUser);
      }
    }
  }

  setWorkflowPendingDecision(chamado, decision);
  return advanceWorkflowManual(chamado, authUser);
}

/**
 * Uma mensagem pública cumpre o último passo quando ele é uma devolutiva.
 * Outros tipos de último passo continuam sendo concluídos pelo executor/botão
 * de avanço correspondente, sem amarrar o encerramento geral a mensagens.
 */
export async function finishWorkflowAfterPublicReply(
  chamado: IChamadoN1,
  autor = 'Agente',
): Promise<boolean> {
  const wf = chamado.workflow;
  if (!wf?.active || !wf.workflowId || wf.workflowStatus === 'finished') return false;

  const definicao = await getWorkflowById(String(wf.workflowId));
  if (!definicao) return false;

  const path = resolveCurrentPath(chamado, definicao);
  const resolved = findNodeAndContainer(definicao, path);
  if (!resolved) return false;
  const { node, container, index } = resolved;
  if (index !== container.length - 1) return false;

  if (!isDevolutivaPasso(node.passo?.nome || '')) return false;

  await advanceToPath(chamado, definicao, null, autor, {
    trigger: 'devolutiva-publica-enviada',
  });
  return true;
}

/** Interrompe workflow ativo sem impedir novo start futuro (tabulação intacta). */
export async function cancelWorkflowForChamado(
  chamado: IChamadoN1,
  authUser?: AuthPayload | null,
  motivo?: string,
): Promise<IChamadoN1> {
  const wf = ensureWorkflowState(chamado);
  if (!wf.active || !wf.workflowId) {
    throw new WorkflowAdvanceError('Ticket sem workflow ativo', 400);
  }

  const definicao = await getWorkflowById(String(wf.workflowId));
  const titulo = definicao?.titulo || 'Workflow';
  const autor = authUser?.name || authUser?.email || 'Gestão';

  const lateralSnapshot = definicao
    ? buildLateralWorkflowDto(chamado, definicao)
    : null;

  wf.active = false;
  wf.workflowStatus = null;
  wf.workflowId = null;
  wf.path = [];
  wf.step = 0;
  wf.passoId = null;
  wf.startedAt = null;
  wf.completedAt = null;
  wf.pendingDecision = null;
  delete wf.requisicao;

  const tab = readTabulacaoSnapshot(chamado.tabulacao[0]);
  chamado.tabulacao = [{ ...tab, atribuido: '' }];

  appendWorkflowRegistro(chamado, {
    autor,
    anotacaoInterna: motivo
      ? `Workflow "${titulo}" interrompido: ${motivo}`
      : `Workflow "${titulo}" interrompido.`,
    metadados: {
      workflowInterrupted: true,
      workflow: lateralSnapshot,
    },
    alteracoes: [{ workflowInterrupted: true, workflowTitulo: titulo }],
  });

  return chamado;
}
