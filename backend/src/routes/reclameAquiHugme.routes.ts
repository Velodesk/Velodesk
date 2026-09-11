/** reclameAquiHugme.routes v1.2.0 — import Hug Me assíncrono com progresso por lote */
import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import type { AuthPayload } from '../middleware/auth';
import { isReclamacoesConnected } from '../config/database';
import {
  resolveUserPermissions,
  hasPermission,
} from '../services/permission.service';
import {
  beginHugmeImport,
  getHugmeImportBatch,
  getHugmeImportStats,
  getHugmeRegistroByIdOrigem,
  isHugmeBatchRunning,
  listHugmeImportBatches,
  listHugmeRegistros,
  runHugmeImportLoop,
} from '../services/reclame-aqui/hugmeImport.service';
import type { HugmeOrigemImportacao } from '../models/reclamacoes/ReclameAquiHugmeImportBatch.schema';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

async function assertCanAccessReclameAqui(authUser: AuthPayload): Promise<void> {
  const resolved = await resolveUserPermissions(authUser);
  if (hasPermission(resolved.permissoes, 'tickets', 'ver_todos')) return;
  if (resolved.funcaoSlug === 'gestao' || resolved.funcoes.includes('gestao')) return;
  if (resolved.funcoes.includes('reclame-aqui') || resolved.funcaoSlug === 'reclame-aqui') return;
  if (hasPermission(resolved.permissoes, 'especiais', 'reclame_aqui_gerenciar')) return;
  throw Object.assign(new Error('Sem permissão para Reclame Aqui'), { status: 403 });
}

function parseModo(raw: unknown): HugmeOrigemImportacao {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value || value === 'base_inicial' || value === 'incremental') {
    return value === 'base_inicial' ? 'base_inicial' : 'incremental';
  }
  throw Object.assign(new Error('modo inválido — use base_inicial ou incremental'), { status: 400 });
}

router.post('/import', authMiddleware, upload.single('file'), async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    await assertCanAccessReclameAqui(req.user!);

    if (!req.file?.buffer?.length) {
      return res.status(400).json({ message: 'Arquivo obrigatório (.xlsx, .xls ou .csv)' });
    }

    const modo = parseModo(req.query.modo ?? req.body?.modo);
    const started = await beginHugmeImport(req.file.buffer, {
      modo,
      fileName: req.file.originalname,
      importedBy: req.user?.email || req.user?.name || 'sistema',
    });

    void runHugmeImportLoop(started).catch((err) => {
      console.error('[hugme-import] lote falhou', started.batchId, err);
    });

    return res.status(201).json({
      batchId: started.batchId,
      modo,
      fileName: req.file.originalname,
      stats: started.stats,
      parseStats: started.parse.stats,
      missingColumns: started.parse.missingColumns,
      errors: started.errors.slice(0, 100),
      running: isHugmeBatchRunning(started.stats),
    });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao importar planilha Hugme';
    return res.status(status).json({ message });
  }
});

router.get('/registros', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    await assertCanAccessReclameAqui(req.user!);
    const semTicket = req.query.semTicket === 'true';
    const limit = parseInt(String(req.query.limit ?? '200'), 10) || 200;
    const skip = parseInt(String(req.query.skip ?? '0'), 10) || 0;
    const comTicket = req.query.comTicket === 'true';

    const data = await listHugmeRegistros({
      semTicket: semTicket || undefined,
      limit,
      skip,
    });

    const items = comTicket
      ? data.items.filter((item) => item.chamadoId)
      : data.items;

    return res.json({ items, total: comTicket ? items.length : data.total });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao listar registros Hugme';
    return res.status(status).json({ message });
  }
});

router.get('/registros/:idOrigem', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    await assertCanAccessReclameAqui(req.user!);
    const doc = await getHugmeRegistroByIdOrigem(String(req.params.idOrigem));
    if (!doc) return res.status(404).json({ message: 'Registro não encontrado' });
    return res.json(doc);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao buscar registro Hugme';
    return res.status(status).json({ message });
  }
});

router.get('/import-batches', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    await assertCanAccessReclameAqui(req.user!);
    const limit = parseInt(String(req.query.limit ?? '50'), 10) || 50;
    const items = await listHugmeImportBatches(limit);
    return res.json({ items });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao listar lotes de importação';
    return res.status(status).json({ message });
  }
});

router.get('/import-batches/:batchId', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    await assertCanAccessReclameAqui(req.user!);
    const batch = await getHugmeImportBatch(String(req.params.batchId || ''));
    if (!batch) return res.status(404).json({ message: 'Lote não encontrado' });
    return res.json(batch);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao consultar lote de importação';
    return res.status(status).json({ message });
  }
});

router.get('/stats', authMiddleware, async (req, res: Response) => {
  if (!isReclamacoesConnected()) {
    return res.status(503).json({ message: 'Banco chamados_reclamacoes indisponível' });
  }

  try {
    await assertCanAccessReclameAqui(req.user!);
    const stats = await getHugmeImportStats();
    return res.json(stats);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Erro ao obter estatísticas Hugme';
    return res.status(status).json({ message });
  }
});

export default router;
