/** reclamacoes.routes v1.2.0 — lista paginada 50; upsert RA obrigatório */
import { Router, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import type { AuthPayload } from '../middleware/auth';
import { isMongoConnected, isReclamacoesConnected } from '../config/database';
import {
  resolveUserPermissions,
  hasPermission,
} from '../services/permission.service';
import {
  findByIdOrgao,
  findByChamadoId,
  listByOrgao,
  countByOrgao,
  countCasosEspeciaisByCpf,
  parseReclamacaoOrgaoRoute,
  patchReclamacao,
  reclamacaoToPortalDto,
  searchPortalByOrgao,
  upsertFromChamado,
} from '../services/reclamacoes/reclamacao.service';
import type { CasoEspecialOrgao } from '../services/agents/casosEspeciais.types';
import { createChamadoFromBody } from '../services/chamado.mapper';
import { ChamadoN1 } from '../models/ChamadoN1';
import { runCasosEspeciaisTriagem } from '../services/agents/casosEspeciaisTrigger.service';
import { buildFastPathTriagem } from '../services/agents/casosEspeciaisAgent.service';
import { scheduleCasosEspeciaisRelacionadosAnalise } from '../services/agents/casosEspeciaisRelacionadosTrigger.service';

const router = Router();

const ORGAO_FUNCAO_SLUG: Record<Exclude<CasoEspecialOrgao, 'indefinido'>, string> = {
  reclame_aqui: 'reclame-aqui',
  procon: 'procon',
  bacen: 'bacen',
  consumidor_gov: 'consumidor-gov',
};

const ORGAO_PERM_KEY: Record<Exclude<CasoEspecialOrgao, 'indefinido'>, string> = {
  reclame_aqui: 'reclame_aqui_gerenciar',
  procon: 'procon_gerenciar',
  bacen: 'bacen_gerenciar',
  consumidor_gov: 'consumidor_gov_gerenciar',
};

async function assertCanAccessOrgao(
  authUser: AuthPayload,
  orgao: CasoEspecialOrgao,
): Promise<void> {
  if (orgao === 'indefinido') {
    throw Object.assign(new Error('Órgão inválido'), { status: 400 });
  }

  const resolved = await resolveUserPermissions(authUser);
  if (hasPermission(resolved.permissoes, 'tickets', 'ver_todos')) return;
  if (resolved.funcaoSlug === 'gestao' || resolved.funcoes.includes('gestao')) return;

  const funcaoSlug = ORGAO_FUNCAO_SLUG[orgao];
  if (resolved.funcoes.includes(funcaoSlug) || resolved.funcaoSlug === funcaoSlug) return;

  const permKey = ORGAO_PERM_KEY[orgao];
  if (hasPermission(resolved.permissoes, 'especiais', permKey)) return;

  throw Object.assign(new Error('Sem permissão para este canal'), { status: 403 });
}

function parseOrgaoParam(raw: string): CasoEspecialOrgao {
  const orgao = parseReclamacaoOrgaoRoute(raw);
  if (!orgao) {
    throw Object.assign(new Error('Órgão inválido'), { status: 400 });
  }
  return orgao;
}

/**
 * Cruza CPFs com Procon/Bacen/Consumidor.Gov — alimenta a coluna "Casos Especiais" da tabela
 * do RA. Precisa vir antes de '/:orgao' pra não ser engolida por esse param de 1 segmento
 * (aqui o path tem 2 segmentos, então nem colidiria, mas mantém o registro no topo por clareza).
 */
router.post('/casos-especiais/por-cpf', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    const cpfs = Array.isArray(req.body?.cpfs) ? req.body.cpfs.map(String) : [];
    const byCpf = await countCasosEspeciaisByCpf(cpfs);
    return res.json({ byCpf });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao cruzar CPFs com casos especiais';
    return res.status(status).json({ message });
  }
});

router.get('/:orgao', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    const orgao = parseOrgaoParam(String(req.params.orgao));
    await assertCanAccessOrgao(req.user!, orgao);

    const aberta = req.query.aberta === 'true'
      ? true
      : req.query.aberta === 'false'
        ? false
        : undefined;
    const limit = parseInt(String(req.query.limit ?? '50'), 10) || 50;
    const skip = parseInt(String(req.query.skip ?? '0'), 10) || 0;

    const listFilters = {
      aberta,
      statusCanal: typeof req.query.statusCanal === 'string' ? req.query.statusCanal : undefined,
      limit,
      skip,
    };
    const [items, total] = await Promise.all([
      listByOrgao(orgao, listFilters),
      countByOrgao(orgao, listFilters),
    ]);

    return res.json({
      items: items.map(reclamacaoToPortalDto),
      total,
      limit,
      skip,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao listar reclamações';
    return res.status(status).json({ message });
  }
});

router.get('/:orgao/by-ticket/:chamadoId', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    const orgao = parseOrgaoParam(String(req.params.orgao));
    await assertCanAccessOrgao(req.user!, orgao);

    const doc = await findByChamadoId(orgao, String(req.params.chamadoId));
    if (!doc) return res.status(404).json({ message: 'Reclamação não encontrada' });
    return res.json(reclamacaoToPortalDto(doc));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao buscar reclamação';
    return res.status(status).json({ message });
  }
});

/** Busca rápida: chamados_reclamacoes + chamados_n1 (canal do órgão). */
router.get('/:orgao/search', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected() && !isMongoConnected()) {
    return res.status(503).json({ message: 'Bancos de reclamações/chamados indisponíveis' });
  }

  try {
    const orgao = parseOrgaoParam(String(req.params.orgao));
    await assertCanAccessOrgao(req.user!, orgao);

    const q = String(req.query.q ?? req.query.search ?? '').trim();
    if (!q) {
      return res.status(400).json({ message: 'Informe q ou search', items: [], total: 0 });
    }

    const limit = parseInt(String(req.query.limit ?? '100'), 10) || 100;
    const items = await searchPortalByOrgao(orgao, q, limit);
    return res.json({
      items,
      total: items.length,
      source: 'reclamacoes_dual_search',
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro na busca de reclamações';
    return res.status(status).json({ message, items: [], total: 0 });
  }
});

router.get('/:orgao/:id', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    const orgao = parseOrgaoParam(String(req.params.orgao));
    await assertCanAccessOrgao(req.user!, orgao);

    const doc = await findByIdOrgao(orgao, String(req.params.id));
    if (!doc) return res.status(404).json({ message: 'Reclamação não encontrada' });
    return res.json(reclamacaoToPortalDto(doc));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao buscar reclamação';
    return res.status(status).json({ message });
  }
});

router.post('/:orgao', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    const orgao = parseOrgaoParam(String(req.params.orgao));
    await assertCanAccessOrgao(req.user!, orgao);

    const body = req.body ?? {};
    const chamadoId = String(body.chamadoId ?? body.ticketId ?? '').trim();

    if (chamadoId) {
      const chamado = await ChamadoN1.findById(chamadoId);
      if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });

      await runCasosEspeciaisTriagem(chamado, { source: 'reclamacoes-manual' });
      let doc = await findByChamadoId(orgao, chamadoId);
      if (!doc && orgao === 'reclame_aqui') {
        const triagem = {
          ...buildFastPathTriagem('reclame_aqui', ['reclamacoes-manual']),
          signals: ['reclamacoes-manual'],
          at: new Date().toISOString(),
        };
        doc = await upsertFromChamado(chamado, triagem, { origemEntrada: 'reclamacoes-manual' });
        if (!doc) {
          return res.status(500).json({ message: 'Falha ao persistir reclamação Reclame Aqui' });
        }
      }
      if (!doc) {
        return res.status(202).json({
          message: 'Triagem executada; reclamação pendente de validação IA',
          chamadoId,
        });
      }
      if (orgao === 'reclame_aqui') {
        scheduleCasosEspeciaisRelacionadosAnalise(doc, { source: 'reclamacoes-manual' });
      }
      return res.status(201).json(reclamacaoToPortalDto(doc));
    }

    const ticketBody = body.ticket ?? body;
    if (!ticketBody || typeof ticketBody !== 'object') {
      return res.status(400).json({ message: 'Payload ticket ou chamadoId obrigatório' });
    }

    const partial = await createChamadoFromBody(ticketBody as Record<string, unknown>, 'novo');
    const chamado = await ChamadoN1.create(partial);
    await runCasosEspeciaisTriagem(chamado, { source: 'reclamacoes-register' });

    const doc = await findByChamadoId(orgao, chamado._id.toString());
    if (!doc && orgao === 'reclame_aqui') {
      const triagem = {
        ...buildFastPathTriagem('reclame_aqui', ['reclamacoes-register']),
        signals: ['reclamacoes-register'],
        at: new Date().toISOString(),
      };
      const forced = await upsertFromChamado(chamado, triagem, { origemEntrada: 'reclamacoes-register' });
      if (!forced) {
        return res.status(500).json({ message: 'Falha ao persistir reclamação Reclame Aqui' });
      }
      scheduleCasosEspeciaisRelacionadosAnalise(forced, { source: 'reclamacoes-register' });
      return res.status(201).json({
        chamadoId: chamado._id.toString(),
        chamadoProtocolo: chamado.chamadoProtocolo,
        reclamacao: reclamacaoToPortalDto(forced),
      });
    }
    if (doc && orgao === 'reclame_aqui') {
      scheduleCasosEspeciaisRelacionadosAnalise(doc, { source: 'reclamacoes-register' });
    }
    return res.status(201).json({
      chamadoId: chamado._id.toString(),
      chamadoProtocolo: chamado.chamadoProtocolo,
      reclamacao: doc ? reclamacaoToPortalDto(doc) : null,
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao registrar reclamação';
    return res.status(status).json({ message });
  }
});

router.patch('/:orgao/:id', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    const orgao = parseOrgaoParam(String(req.params.orgao));
    await assertCanAccessOrgao(req.user!, orgao);

    const doc = await patchReclamacao(orgao, String(req.params.id), req.body ?? {});
    if (!doc) return res.status(404).json({ message: 'Reclamação não encontrada' });
    if (orgao === 'reclame_aqui') {
      scheduleCasosEspeciaisRelacionadosAnalise(doc, { source: 'reclamacoes-patch' });
    }
    return res.json(reclamacaoToPortalDto(doc));
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao atualizar reclamação';
    return res.status(status).json({ message });
  }
});

export default router;
