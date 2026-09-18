/** redesSociais.routes v1.0.0 — leitura/gestão dos comentários e avaliações
 * classificados de Facebook/Instagram/Google Play (desk_config.redes_sociais_comentarios) */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isDeskConfigConnected } from '../config/database';
import {
  gerarRelatorio,
  listarComentarios,
  marcarComentarioIgnorado,
  marcarComentarioRespondido,
  type ListarComentariosFiltro,
} from '../services/redesSociais/redesSociaisComentario.service';
import type { RedesSociaisCanal } from '../models/RedesSociaisComentario';

const router = Router();

const CANAIS_VALIDOS: RedesSociaisCanal[] = ['facebook', 'instagram', 'google_play'];

function actorName(req: Request): string {
  return req.user?.name || req.user?.email || 'sistema';
}

function deskConfigUnavailable(res: Response) {
  return res.status(503).json({ message: 'Banco desk_config indisponível' });
}

router.get('/comentarios', authMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);

    const canais = String(req.query.canal || '')
      .split(',')
      .map((c) => c.trim())
      .filter((c): c is RedesSociaisCanal => CANAIS_VALIDOS.includes(c as RedesSociaisCanal));
    const filtro: ListarComentariosFiltro = {
      canal: canais.length ? canais : undefined,
      busca: req.query.busca ? String(req.query.busca) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    };
    if (req.query.sentimento === 'positivo' || req.query.sentimento === 'neutro' || req.query.sentimento === 'negativo') {
      filtro.sentimento = req.query.sentimento;
    }
    if (req.query.respondido === 'true' || req.query.respondido === 'false') {
      filtro.respondido = req.query.respondido === 'true';
    }
    if (req.query.ignorado === 'true' || req.query.ignorado === 'false') {
      filtro.ignorado = req.query.ignorado === 'true';
    }

    const resultado = await listarComentarios(filtro);
    return res.json(resultado);
  } catch (err) {
    console.error('[redes-sociais] GET /comentarios', err);
    return deskConfigUnavailable(res);
  }
});

router.get('/relatorio', authMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const desde = req.query.desde ? new Date(String(req.query.desde)) : undefined;
    const canal = String(req.query.canal || '');
    const relatorio = await gerarRelatorio(
      desde,
      CANAIS_VALIDOS.includes(canal as RedesSociaisCanal) ? (canal as RedesSociaisCanal) : undefined,
    );
    return res.json(relatorio);
  } catch (err) {
    console.error('[redes-sociais] GET /relatorio', err);
    return deskConfigUnavailable(res);
  }
});

router.patch('/comentarios/:id/responder', authMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const resposta = String(req.body?.resposta || '').trim();
    if (!resposta) return res.status(400).json({ message: 'Informe a resposta' });

    const item = await marcarComentarioRespondido(String(req.params.id), resposta, actorName(req));
    if (!item) return res.status(404).json({ message: 'Comentário não encontrado' });
    return res.json(item);
  } catch (err) {
    console.error('[redes-sociais] PATCH /comentarios/:id/responder', err);
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.patch('/comentarios/:id/ignorar', authMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const item = await marcarComentarioIgnorado(String(req.params.id));
    if (!item) return res.status(404).json({ message: 'Comentário não encontrado' });
    return res.json(item);
  } catch (err) {
    console.error('[redes-sociais] PATCH /comentarios/:id/ignorar', err);
    return res.status(400).json({ message: (err as Error).message });
  }
});

export default router;
