/** assignmentRouter.service v1.5.0 — responsável gravado só como nome/alias (nunca login/e-mail) */
import { env } from '../config/env';
import type { AuthPayload } from '../middleware/auth';
import { ChamadoN1 } from '../models/ChamadoN1';
import type { IChamadoN1 } from '../models/ChamadoN1';
import { listOnlineEligiblePresenceKeys } from './agentPresence.service';
import { listAgentesDeskLive } from './agenteDesk.service';
import { listColaboradoresDesk } from './colaboradoresCadastro.service';
import { loadParticipanteOverrides } from './roletaParticipantes.service';
import { extractFuncoes } from '../utils/normalizeFuncao';
import { currentStatus, isConsumidorGovChamado, isProconChamado } from './chamado.mapper';
import {
  isRealResponsavel,
  looksLikeNonDisplayResponsavelToken,
  resolveResponsavelDisplayNameSync,
} from './responsavel.util';

type RoletaPoolAgent = {
  email: string;
  colaboradorNome: string;
  atuacao: unknown;
  funcaoSlug: string | null;
  afastado: boolean;
};

export interface AssignmentContext {
  source: 'email-inbound' | 'app-integrado' | 'api-tickets' | 'backfill' | 'manual-retry' | 'casos-especiais' | 'inbound-ticket';
  canal?: string;
}

export interface AssignmentResult {
  responsavel: string;
  carga: number;
}

function emailLocalPart(email?: string): string {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized.includes('@')) return normalized;
  return normalized.split('@')[0] ?? '';
}

/** Identificador do agente — alias ou primeiro+último; nunca e-mail/login. */
export function provisionalResponsavelFromUser(user: { name?: string; email?: string }): string {
  const name = String(user.name ?? '').trim();
  if (name && isRealResponsavel(name) && !looksLikeNonDisplayResponsavelToken(name)) {
    const resolved = resolveResponsavelDisplayNameSync(name);
    if (resolved) return resolved;
    return name;
  }
  const fromEmail = resolveResponsavelDisplayNameSync(user.email);
  if (fromEmail) return fromEmail;
  return '';
}

export function provisionalResponsavelFromAuth(authUser: AuthPayload): string {
  return provisionalResponsavelFromUser({ name: authUser.name, email: authUser.email });
}

export function buildAgentCandidates(user: { name?: string; email?: string; _id?: { toString(): string } }): string[] {
  const values: string[] = [];
  const push = (raw?: string) => {
    const value = String(raw ?? '').trim();
    if (value) values.push(value);
  };

  push(user.name);
  push(user.email);
  push(emailLocalPart(user.email));
  push(user._id?.toString());

  return [...new Set(values.map((value) => value.toLowerCase()).filter(Boolean))];
}

export function resolveTerminalStatuses(): string[] {
  const raw = env.assignmentRouterTerminalStatuses.length
    ? env.assignmentRouterTerminalStatuses
    : ['resolvido', 'cancelado', 'fechado'];
  return [...new Set(raw.map((status) => status.toLowerCase()).filter(Boolean))];
}

export function countLoadForAgent(
  countByResponsavel: Map<string, number>,
  candidates: string[]
): number {
  let total = 0;
  for (const candidate of candidates) {
    total += countByResponsavel.get(candidate) ?? 0;
  }
  return total;
}

export function pickLeastLoadedAgent(
  agents: Array<{ responsavel: string; candidates: string[] }>,
  countByResponsavel: Map<string, number>
): AssignmentResult | null {
  if (agents.length === 0) return null;

  const cap = env.assignmentRouterMaxOpen;
  const ranked = agents
    .map((agent) => ({
      responsavel: agent.responsavel,
      carga: countLoadForAgent(countByResponsavel, agent.candidates),
    }))
    .filter((agent) => agent.carga < cap)
    .sort((a, b) => {
      if (a.carga !== b.carga) return a.carga - b.carga;
      return a.responsavel.localeCompare(b.responsavel, 'pt-BR');
    });

  return ranked[0] ?? null;
}

function ensureTabulacaoSlot(partial: Partial<IChamadoN1> | IChamadoN1): void {
  if (!partial.tabulacao?.length) {
    partial.tabulacao = [{
      tipoChamado: '',
      produto: '',
      motivo: '',
      detalhe: '',
      canal: '',
      responsavel: '',
      atribuido: '',
    }];
  }
}

export function markChamadoAtribuicaoRoleta(chamado: Partial<IChamadoN1> | IChamadoN1): void {
  const registros = chamado.registro ?? [];
  const target = registros[registros.length - 1] ?? registros[0];
  if (!target) return;
  target.metadados = {
    ...(target.metadados ?? {}),
    atribuicaoRoleta: true,
    atribuidoEm: new Date(),
  };
}

export function isChamadoAtribuicaoRoleta(chamado: IChamadoN1): boolean {
  return (chamado.registro ?? []).some((reg) => reg.metadados?.atribuicaoRoleta === true);
}

export function shouldAutoAssign(partial: Partial<IChamadoN1>): boolean {
  if (!env.assignmentRouterEnabled) return false;
  const chamado = partial as IChamadoN1;
  if (isProconChamado(chamado) || isConsumidorGovChamado(chamado)) return false;
  // Tickets de canal telefone ou agente-ia chegam com o responsável já identificado no
  // próprio atendimento (ramal/operador humano por trás da IA) — não podem cair na roleta
  // genérica; se o responsável não veio preenchido, o chamado fica sem dono de propósito.
  const canal = String(partial.tabulacao?.[0]?.canal ?? '').trim().toLowerCase();
  if (canal === 'telefone' || canal === 'agente ia') return false;
  return !isRealResponsavel(partial.tabulacao?.[0]?.responsavel);
}

function readLastTabResponsavel(chamado: IChamadoN1): string {
  const tabulacao = chamado.tabulacao ?? [];
  const lastTab = tabulacao[tabulacao.length - 1] ?? tabulacao[0];
  return String(lastTab?.responsavel ?? '').trim();
}

/** Agente já registrou mensagem/anexo público ou nota interna. */
export function hasPriorAgentInteraction(chamado: IChamadoN1): boolean {
  return (chamado.registro ?? []).some((reg) => {
    if (String(reg.origin ?? '').trim().toLowerCase() !== 'agente') return false;
    return Boolean(
      String(reg.mensagemPublica ?? '').trim()
      || String(reg.anotacaoInterna ?? '').trim()
      || (reg.anexosMensagemPublica?.length ?? 0) > 0
      || (reg.anexosAnotacaoInterna?.length ?? 0) > 0,
    );
  });
}

function writeResponsavel(chamado: IChamadoN1, responsavel: string): void {
  ensureTabulacaoSlot(chamado);
  const idx = chamado.tabulacao!.length - 1;
  chamado.tabulacao![idx].responsavel = responsavel;
  chamado.markModified('tabulacao');
}

export function applySessionResponsavelIfNeeded(
  partial: Partial<IChamadoN1>,
  authUser?: AuthPayload | null
): void {
  if (!authUser) return;
  if (isRealResponsavel(partial.tabulacao?.[0]?.responsavel)) return;

  const responsavel = provisionalResponsavelFromAuth(authUser);
  if (!responsavel) return;

  ensureTabulacaoSlot(partial);
  partial.tabulacao![0].responsavel = responsavel;
}

/**
 * Regra mandatória: agente que faz a 1ª interação em ticket novo passa a ser o responsável.
 * Também atribui quando ainda não há responsável real (ex.: placeholder "Agente").
 * Deve ser chamado antes de appendRegistroEntry na rota de mensagens.
 */
export function applyManualResponsavelClaim(
  chamado: IChamadoN1,
  authUser?: AuthPayload | null
): boolean {
  if (!authUser) return false;

  const responsavel = provisionalResponsavelFromAuth(authUser);
  if (!responsavel || !isRealResponsavel(responsavel)) return false;

  const status = currentStatus(chamado).toLowerCase();
  const priorInteraction = hasPriorAgentInteraction(chamado);
  const mandatoryFirstClaim = status === 'novo' && !priorInteraction;

  if (mandatoryFirstClaim || !isRealResponsavel(readLastTabResponsavel(chamado))) {
    writeResponsavel(chamado, responsavel);
    return true;
  }

  return false;
}

function roletaTicketMatchExpr(terminalStatuses: string[]) {
  return {
    $expr: {
      $and: [
        {
          $not: {
            $in: [
              {
                $toLower: {
                  $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'],
                },
              },
              terminalStatuses,
            ],
          },
        },
        {
          $ne: [
            {
              $toLower: {
                $ifNull: [
                  {
                    $let: {
                      vars: { lastTab: { $arrayElemAt: ['$tabulacao', -1] } },
                      in: '$$lastTab.responsavel',
                    },
                  },
                  '',
                ],
              },
            },
            '',
          ],
        },
        {
          $gt: [
            {
              $size: {
                $filter: {
                  input: { $ifNull: ['$registro', []] },
                  as: 'reg',
                  cond: { $eq: ['$$reg.metadados.atribuicaoRoleta', true] },
                },
              },
            },
            0,
          ],
        },
      ],
    },
  };
}

async function aggregateRoletaOpenCounts(): Promise<Map<string, number>> {
  const terminalStatuses = resolveTerminalStatuses();
  const rows = await ChamadoN1.aggregate<{ _id: string; count: number }>([
    { $match: roletaTicketMatchExpr(terminalStatuses) },
    {
      $group: {
        _id: {
          $toLower: {
            $ifNull: [
              {
                $let: {
                  vars: { lastTab: { $arrayElemAt: ['$tabulacao', -1] } },
                  in: '$$lastTab.responsavel',
                },
              },
              '',
            ],
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const map = new Map<string, number>();
  for (const row of rows) {
    const key = String(row._id ?? '').trim().toLowerCase();
    if (!key) continue;
    map.set(key, row.count);
  }
  return map;
}

function agentEligibleForRoletaPool(
  agent: {
    email: string;
    funcaoSlug: string | null;
    atuacao: unknown;
    afastado: boolean;
  },
  overrides: Map<string, boolean>,
): boolean {
  // Override manual (desk_roleta_participantes) decide sozinho, sem outras condições — é assim
  // que se tira alguém que a atuacao do cadastro erroneamente marca como "Atendimento"/"N2" (ex.:
  // QA/produto que loga no Desk mas não atende ticket), ou se inclui alguém fora do padrão.
  const override = overrides.get(String(agent.email ?? '').trim().toLowerCase());
  if (override !== undefined) return override;

  if (agent.afastado) return false;
  const funcoes = extractFuncoes(agent.atuacao);
  if (funcoes.includes('atendimento') || funcoes.includes('n2')) return true;
  if (agent.funcaoSlug && agent.funcaoSlug !== 'gestao') return true;
  return false;
}

async function loadRoletaPoolAgents(): Promise<RoletaPoolAgent[]> {
  const synced = await listAgentesDeskLive();
  if (synced.length > 0) {
    return synced.map((agente) => ({
      email: agente.email,
      colaboradorNome: agente.colaboradorNome,
      atuacao: agente.atuacao,
      funcaoSlug: agente.funcaoSlug,
      afastado: agente.afastado,
    }));
  }

  const colaboradores = await listColaboradoresDesk();
  return colaboradores.map((col) => ({
    email: col.userMail,
    colaboradorNome: col.colaboradorNome,
    atuacao: col.atuacao,
    funcaoSlug: null,
    afastado: col.afastado,
  }));
}

async function loadOnlineEligibleAgents(): Promise<Array<{ responsavel: string; candidates: string[] }>> {
  const [onlineKeys, agentes, overrides] = await Promise.all([
    listOnlineEligiblePresenceKeys(),
    loadRoletaPoolAgents(),
    loadParticipanteOverrides(),
  ]);

  const onlineSet = new Set(onlineKeys.map((key) => key.toLowerCase()));
  const agents: Array<{ responsavel: string; candidates: string[] }> = [];

  for (const agente of agentes) {
    if (!agentEligibleForRoletaPool(agente, overrides)) continue;

    const responsavel = provisionalResponsavelFromUser({
      name: agente.colaboradorNome,
      email: agente.email,
    });
    if (!responsavel) continue;

    const responsavelKey = responsavel.toLowerCase();
    if (!onlineSet.has(responsavelKey)) continue;

    agents.push({
      responsavel,
      candidates: buildAgentCandidates({
        name: agente.colaboradorNome,
        email: agente.email,
      }),
    });
  }

  return agents;
}

export async function resolveLeastLoadedAgent(): Promise<AssignmentResult | null> {
  const [agents, countByResponsavel] = await Promise.all([
    loadOnlineEligibleAgents(),
    aggregateRoletaOpenCounts(),
  ]);

  if (agents.length === 0) return null;
  return pickLeastLoadedAgent(agents, countByResponsavel);
}

function applyRoletaAssignment(
  target: Partial<IChamadoN1> | IChamadoN1,
  assignment: AssignmentResult,
  context: AssignmentContext
): void {
  ensureTabulacaoSlot(target);
  const idx = target.tabulacao!.length - 1;
  target.tabulacao![idx].responsavel = assignment.responsavel;
  markChamadoAtribuicaoRoleta(target);

  console.info(
    `[assignmentRouter] responsavel=${assignment.responsavel} (carga=${assignment.carga}) source=${context.source}`
  );
}

export async function applyAssignmentIfNeeded(
  partial: Partial<IChamadoN1>,
  context: AssignmentContext
): Promise<void> {
  if (!shouldAutoAssign(partial)) return;

  const assignment = await resolveLeastLoadedAgent();
  if (!assignment) {
    console.warn('[assignmentRouter] pool vazio ou cap atingido — chamado permanece sem responsavel', context);
    return;
  }

  applyRoletaAssignment(partial, assignment, context);
}

function agentMatchesFuncaoSlug(
  agent: RoletaPoolAgent,
  funcaoSlug: string,
  overrides: Map<string, boolean>,
): boolean {
  // override=false tira de QUALQUER pool da roleta, inclusive as filas de função especial —
  // não faz sentido alguém marcado como "não deve receber ticket" continuar elegível aqui.
  // override=true não inventa participação numa fila que a pessoa não tem função para: só
  // dispensa a checagem de afastado, igual ao pool genérico.
  const override = overrides.get(String(agent.email ?? '').trim().toLowerCase());
  if (override === false) return false;
  if (agent.afastado && override !== true) return false;
  const slug = String(funcaoSlug ?? '').trim().toLowerCase();
  if (!slug) return false;
  const funcoes = extractFuncoes(agent.atuacao);
  return agent.funcaoSlug === slug || funcoes.includes(slug);
}

async function resolveFuncaoEspecialAgent(funcaoSlug: string): Promise<AssignmentResult | null> {
  const [onlineKeys, agentes, countByResponsavel, overrides] = await Promise.all([
    listOnlineEligiblePresenceKeys(),
    loadRoletaPoolAgents(),
    aggregateRoletaOpenCounts(),
    loadParticipanteOverrides(),
  ]);

  const slug = String(funcaoSlug ?? '').trim().toLowerCase();
  const eligible = agentes.filter((agente) => agentMatchesFuncaoSlug(agente, slug, overrides));
  if (eligible.length === 0) return null;

  const onlineSet = new Set(onlineKeys.map((key) => key.toLowerCase()));
  const onlineEligible = eligible.filter((agente) => {
    const responsavel = provisionalResponsavelFromUser({
      name: agente.colaboradorNome,
      email: agente.email,
    });
    return responsavel && onlineSet.has(responsavel.toLowerCase());
  });

  const poolSource = onlineEligible.length > 0 ? onlineEligible : eligible;
  const agents = poolSource.map((agente) => {
    const responsavel = provisionalResponsavelFromUser({
      name: agente.colaboradorNome,
      email: agente.email,
    });
    return {
      responsavel,
      candidates: buildAgentCandidates({
        name: agente.colaboradorNome,
        email: agente.email,
      }),
    };
  }).filter((item) => item.responsavel);

  return pickLeastLoadedAgent(agents, countByResponsavel);
}

function markChamadoAtribuicaoFuncaoEspecial(
  chamado: Partial<IChamadoN1> | IChamadoN1,
  funcaoSlug: string,
): void {
  const registros = chamado.registro ?? [];
  const target = registros[registros.length - 1] ?? registros[0];
  if (!target) return;
  target.metadados = {
    ...(target.metadados ?? {}),
    atribuicaoFuncaoEspecial: funcaoSlug,
    atribuidoEm: new Date(),
  };
}

export async function applyFuncaoEspecialAssignment(
  chamado: IChamadoN1,
  funcaoSlug: string,
  context: AssignmentContext,
): Promise<boolean> {
  const assignment = await resolveFuncaoEspecialAgent(funcaoSlug);
  if (!assignment) {
    console.warn(
      `[assignmentRouter] função especial "${funcaoSlug}" sem agente elegível — chamado permanece sem responsavel`,
      context,
    );
    return false;
  }

  ensureTabulacaoSlot(chamado);
  const idx = chamado.tabulacao!.length - 1;
  chamado.tabulacao![idx].responsavel = assignment.responsavel;
  markChamadoAtribuicaoFuncaoEspecial(chamado, funcaoSlug);
  chamado.markModified('tabulacao');

  console.info(
    `[assignmentRouter] funcaoEspecial=${funcaoSlug} responsavel=${assignment.responsavel} (carga=${assignment.carga}) source=${context.source}`,
  );
  return true;
}

export async function applyAssignmentToChamado(
  chamado: IChamadoN1,
  context: AssignmentContext
): Promise<boolean> {
  if (!env.assignmentRouterEnabled) return false;
  if (String(chamado.tabulacao?.[0]?.responsavel ?? '').trim()) return false;

  const assignment = await resolveLeastLoadedAgent();
  if (!assignment) {
    console.warn('[assignmentRouter] pool vazio ou cap atingido — chamado permanece sem responsavel', context);
    return false;
  }

  applyRoletaAssignment(chamado, assignment, context);
  return true;
}

async function findOrphanTickets(limit: number): Promise<IChamadoN1[]> {
  return ChamadoN1.find({
    $expr: {
      $and: [
        {
          $eq: [
            { $toLower: { $ifNull: [{ $arrayElemAt: ['$registro.status', -1] }, 'novo'] } },
            'novo',
          ],
        },
        {
          $eq: [
            {
              $toLower: {
                $ifNull: [
                  {
                    $let: {
                      vars: { lastTab: { $arrayElemAt: ['$tabulacao', -1] } },
                      in: '$$lastTab.responsavel',
                    },
                  },
                  '',
                ],
              },
            },
            '',
          ],
        },
      ],
    },
  })
    .sort({ createdAt: 1 })
    .limit(limit);
}

export async function rebalanceAgentToCap(responsavelKey: string): Promise<number> {
  if (!env.assignmentRouterEnabled) return 0;

  const key = String(responsavelKey ?? '').trim().toLowerCase();
  if (!key) return 0;

  // Backfill roda pra QUALQUER autenticado que volte a ficar online (é a rota de heartbeat quem
  // chama, sem filtro nenhum) — sem esta checagem, alguém sem função de atendimento (QA, produto,
  // gestão que só usa o Desk pra acompanhar) herda ticket órfão só por ter feito login depois de
  // um tempo offline. Mesma regra de elegibilidade do pool genérico, incl. override manual.
  const [agentes, overrides] = await Promise.all([loadRoletaPoolAgents(), loadParticipanteOverrides()]);
  const agente = agentes.find((a) => {
    const responsavel = provisionalResponsavelFromUser({ name: a.colaboradorNome, email: a.email });
    return responsavel && responsavel.toLowerCase() === key;
  });
  if (!agente || !agentEligibleForRoletaPool(agente, overrides)) return 0;

  const counts = await aggregateRoletaOpenCounts();
  const current = counts.get(key) ?? 0;
  const slots = env.assignmentRouterMaxOpen - current;
  if (slots <= 0) return 0;

  const orphans = await findOrphanTickets(slots);
  let assigned = 0;

  for (const chamado of orphans) {
    if (assigned >= slots) break;
    if (String(chamado.tabulacao?.[0]?.responsavel ?? '').trim()) continue;

    ensureTabulacaoSlot(chamado);
    const idx = chamado.tabulacao!.length - 1;
    chamado.tabulacao![idx].responsavel = responsavelKey;
    markChamadoAtribuicaoRoleta(chamado);
    await chamado.save();
    assigned += 1;
  }

  if (assigned > 0) {
    console.info(`[assignmentRouter] backfill responsavel=${responsavelKey} atribuidos=${assigned}`);
  }

  return assigned;
}
