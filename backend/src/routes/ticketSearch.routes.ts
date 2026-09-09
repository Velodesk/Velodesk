/**
 * Rotas de busca avançada de tickets
 * VERSION: v1.3.0 | DATE: 2026-08-18
 * — by-cpf / desk-bar incluem chamados_reclamacoes
 */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import {
  clampSearchLimit,
  normalizeSearchCriterios,
  searchTickets,
  searchTicketsByCpf,
  searchTicketsByCpfDeskBar,
} from '../services/ticketSearch.service';
import { findSimilarSubjectTickets } from '../services/agents/similarSubjectAgent.service';

const router = Router();

function parseCriteriosFromRequest(req: Request) {
  if (req.method === 'POST' && req.body && typeof req.body === 'object') {
    return normalizeSearchCriterios((req.body as Record<string, unknown>).criterios);
  }
  const raw = req.query.criterios;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return normalizeSearchCriterios(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) {
    return normalizeSearchCriterios(raw);
  }
  return [];
}

function parseLimitFromRequest(req: Request) {
  if (req.method === 'POST' && req.body && typeof req.body === 'object') {
    return clampSearchLimit((req.body as Record<string, unknown>).limit);
  }
  return clampSearchLimit(req.query.limit);
}

async function handleSearch(req: Request, res: Response) {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ success: false, message: 'MongoDB indisponível' });
    }
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Não autenticado' });
    }

    const criterios = parseCriteriosFromRequest(req);
    if (!criterios.length) {
      return res.status(400).json({
        success: false,
        message: 'Informe ao menos um critério de busca',
        tickets: [],
        total: 0,
      });
    }

    const limit = parseLimitFromRequest(req);
    const result = await searchTickets(req.user, { criterios, limit });

    return res.json({
      success: true,
      tickets: result.tickets,
      total: result.total,
      limit: result.limit,
      source: 'ticket_search',
    });
  } catch (err) {
    console.error('[ticket-search] falhou:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar tickets',
      tickets: [],
      total: 0,
    });
  }
}

router.get('/by-cpf/:cpf', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ success: false, message: 'MongoDB indisponível' });
    }
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Não autenticado' });
    }

    const result = await searchTicketsByCpf(req.user, String(req.params.cpf || ''));
    return res.json({
      success: true,
      tickets: result.tickets,
      total: result.total,
      cpf: result.cpf,
      source: 'ticket_search_by_cpf',
    });
  } catch (err) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : 'Erro ao buscar tickets por CPF';
    if (status >= 400 && status < 500) {
      return res.status(status).json({ success: false, message, tickets: [], total: 0 });
    }
    console.error('[ticket-search/by-cpf] falhou:', err);
    return res.status(500).json({ success: false, message: 'Erro ao buscar tickets por CPF', tickets: [], total: 0 });
  }
});

/** Barra de busca do Desk — ignora visão meus-chamados (lookup operacional por CPF). */
router.get('/desk-bar/cpf/:cpf', authMiddleware, async (req: Request, res: Response) => {
  try {
    if (!isMongoConnected()) {
      return res.status(503).json({ success: false, message: 'MongoDB indisponível' });
    }
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Não autenticado' });
    }

    const result = await searchTicketsByCpfDeskBar(req.user, String(req.params.cpf || ''));
    return res.json({
      success: true,
      tickets: result.tickets,
      total: result.total,
      cpf: result.cpf,
      source: 'ticket_search_desk_bar_cpf',
    });
  } catch (err) {
    const status = (err as { status?: number })?.status || 500;
    const message = err instanceof Error ? err.message : 'Erro ao buscar tickets por CPF';
    if (status >= 400 && status < 500) {
      return res.status(status).json({ success: false, message, tickets: [], total: 0 });
    }
    console.error('[ticket-search/desk-bar/cpf] falhou:', err);
    return res.status(500).json({ success: false, message: 'Erro ao buscar tickets por CPF', tickets: [], total: 0 });
  }
});

/** IA compara o assunto do ticket atual com o histórico do cliente (por CPF) — usado pela área
 * "Assunto Semelhante" no modal de histórico das telas de casos especiais. */
router.post('/similar-subject', authMiddleware, async (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Não autenticado' });
  }

  const currentSubject = String(req.body?.currentSubject || '').trim();
  const candidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  if (!currentSubject || !candidates.length) {
    return res.status(400).json({
      success: false,
      message: 'Informe o assunto atual e ao menos um candidato',
    });
  }

  const capped = candidates
    .slice(0, 30)
    .map((c: { id?: unknown; title?: unknown }) => ({
      id: String(c?.id ?? '').trim(),
      title: String(c?.title ?? '').trim(),
    }))
    .filter((c: { id: string; title: string }) => c.id && c.title);

  if (!capped.length) {
    return res.status(400).json({ success: false, message: 'Nenhum candidato válido' });
  }

  const userId = req.user.email || req.user.userId || 'anonymous';

  try {
    const result = await findSimilarSubjectTickets({
      currentSubject,
      candidates: capped,
      ticketId: req.body?.ticketId ? String(req.body.ticketId) : undefined,
      protocolo: req.body?.protocolo ? String(req.body.protocolo) : undefined,
      userId: String(userId),
    });

    if (!result.success) {
      return res.status(503).json({ success: false, message: result.error || 'IA indisponível' });
    }

    return res.json({ success: true, matches: result.matches || [] });
  } catch (err) {
    console.error('[ticket-search/similar-subject] falhou:', err);
    return res.status(500).json({ success: false, message: 'Erro ao comparar assuntos' });
  }
});

router.get('/', authMiddleware, handleSearch);
router.post('/', authMiddleware, handleSearch);

export default router;
