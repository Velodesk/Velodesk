/**
 * test-workflow-finalizados-filter — filtros da fila Finalizados (espelho da lógica frontend)
 * Rode: npx tsx scripts/test-workflow-finalizados-filter.ts
 */

type Ticket = {
  id: string;
  clientName?: string;
  createdAt?: string;
  updatedAt?: string;
  workflow?: { active?: boolean; completedAt?: string };
  lateralForm?: {
    workflow?: {
      templateId?: string;
      definicaoSlug?: string;
      status?: string;
      completedAt?: string;
      stepHistory?: Array<{ stepId?: string; status?: string; at?: string }>;
    };
    solicitacaoProdutos?: { categoria?: string; createdAt?: string };
    solicitacaoFinanceiro?: { categoria?: string; createdAt?: string };
  };
};

const PRODUTOS_CATEGORIAS = new Set(['erros-bugs', 'solicitacoes', 'liberacao-pix', 'documentos']);
const FINANCEIRO_CATEGORIAS = new Set(['estorno', 'cobranca', 'outros']);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function readSolicitacaoProdutos(ticket: Ticket) {
  return ticket.lateralForm?.solicitacaoProdutos || null;
}

function readSolicitacaoFinanceiro(ticket: Ticket) {
  return ticket.lateralForm?.solicitacaoFinanceiro || null;
}

function ticketHadTeamSolicitation(ticket: Ticket) {
  return Boolean(readSolicitacaoProdutos(ticket) || readSolicitacaoFinanceiro(ticket));
}

function normalizeTeamSlug(value: string) {
  return String(value || '').trim().toLowerCase();
}

function ticketBelongsToWorkflowTeam(ticket: Ticket, teamId: string) {
  const team = normalizeTeamSlug(teamId);
  if (!team) return false;

  const wf = ticket.lateralForm?.workflow || {};
  const templateSlug = normalizeTeamSlug(wf.definicaoSlug || wf.templateId || '');

  if (templateSlug === `escalonar-${team}` || templateSlug === team || templateSlug.endsWith(`-${team}`)) {
    return true;
  }

  if (team === 'produtos') {
    const solicitacao = readSolicitacaoProdutos(ticket);
    if (solicitacao && PRODUTOS_CATEGORIAS.has(solicitacao.categoria || '')) return true;
    const financeiroLegacy = readSolicitacaoFinanceiro(ticket);
    if (financeiroLegacy?.categoria === 'documentos') return true;
  }

  if (team === 'financeiro') {
    const solicitacao = readSolicitacaoFinanceiro(ticket);
    if (solicitacao && FINANCEIRO_CATEGORIAS.has(solicitacao.categoria || '')) return true;
  }

  return false;
}

function resolveTeamSolicitationFromTicket(ticket: Ticket) {
  const produtos = readSolicitacaoProdutos(ticket);
  if (produtos?.categoria) {
    return { team: 'produtos', categoria: produtos.categoria };
  }
  const financeiro = readSolicitacaoFinanceiro(ticket);
  if (financeiro?.categoria) {
    const team = financeiro.categoria === 'documentos' ? 'produtos' : 'financeiro';
    return { team, categoria: financeiro.categoria };
  }
  return null;
}

function isTicketWorkflowCompleted(ticket: Ticket) {
  const lateral = ticket.lateralForm?.workflow;
  if (lateral?.status === 'completed') return true;
  if (ticket.workflow?.completedAt) return true;
  return false;
}

function ticketMatchesFinalizadosFilter(ticket: Ticket, teamId?: string | null) {
  if (!isTicketWorkflowCompleted(ticket)) return false;

  const hadSolicitation = ticketHadTeamSolicitation(ticket);
  if (teamId) {
    const belongsToTeam = ticketBelongsToWorkflowTeam(ticket, teamId);
    const solicitation = resolveTeamSolicitationFromTicket(ticket);
    const solicitationForTeam = solicitation?.team === teamId;
    if (!hadSolicitation && !belongsToTeam) return false;
    if (!belongsToTeam && !solicitationForTeam) return false;
    return hadSolicitation || belongsToTeam;
  }

  if (hadSolicitation) return true;
  return ticketBelongsToWorkflowTeam(ticket, 'produtos') || ticketBelongsToWorkflowTeam(ticket, 'financeiro');
}

function buildCompletedProdutosTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    clientName: 'Cliente Teste',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-02T12:00:00.000Z',
    workflow: { active: true, completedAt: '2026-07-02T12:00:00.000Z' },
    lateralForm: {
      workflow: {
        templateId: 'escalonar-produtos',
        definicaoSlug: 'escalonar-produtos',
        status: 'completed',
        completedAt: '2026-07-02T12:00:00.000Z',
        stepHistory: [{ stepId: 'produtos', status: 'completed', at: '2026-07-02T12:00:00.000Z' }],
      },
      solicitacaoProdutos: {
        categoria: 'erros-bugs',
        createdAt: '2026-07-01T10:00:00.000Z',
      },
    },
    ...overrides,
  };
}

function run() {
  const completed = buildCompletedProdutosTicket('t-completed');
  assert(ticketMatchesFinalizadosFilter(completed), 'completed com solicitacaoProdutos entra');

  const active = buildCompletedProdutosTicket('t-active', {
    workflow: { active: true },
    lateralForm: {
      ...completed.lateralForm,
      workflow: {
        ...completed.lateralForm!.workflow!,
        status: 'active',
      },
    },
  });
  assert(!ticketMatchesFinalizadosFilter(active), 'ticket ativo nao entra');

  const noSolicitation: Ticket = {
    id: 't-no-sol',
    workflow: { active: true, completedAt: '2026-07-02T12:00:00.000Z' },
    lateralForm: {
      workflow: {
        templateId: 'outro-fluxo',
        status: 'completed',
        completedAt: '2026-07-02T12:00:00.000Z',
      },
    },
  };
  assert(!ticketMatchesFinalizadosFilter(noSolicitation), 'completed sem solicitacao nao entra');

  const produtos = buildCompletedProdutosTicket('t-produtos');
  const financeiro = buildCompletedProdutosTicket('t-financeiro', {
    lateralForm: {
      workflow: {
        templateId: 'escalonar-financeiro',
        definicaoSlug: 'escalonar-financeiro',
        status: 'completed',
        completedAt: '2026-07-02T12:00:00.000Z',
      },
      solicitacaoFinanceiro: {
        categoria: 'estorno',
        createdAt: '2026-07-01T10:00:00.000Z',
      },
    },
  });

  assert(ticketMatchesFinalizadosFilter(produtos, 'produtos'), 'filtro produtos inclui produtos');
  assert(!ticketMatchesFinalizadosFilter(financeiro, 'produtos'), 'filtro produtos exclui financeiro');
  assert(ticketMatchesFinalizadosFilter(financeiro, 'financeiro'), 'filtro financeiro inclui financeiro');

  console.log('test-workflow-finalizados-filter: OK');
}

run();
