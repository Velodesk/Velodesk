/** emailOutbound.routes v1.3.0 — POST /preview-reply: prévia do e-mail de resposta do agente */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth';
import { supervisorMiddleware } from '../middleware/supervisor';
import { isDeskConfigConnected, isMongoConnected } from '../config/database';
import mongoose from 'mongoose';
import { ChamadoN1 } from '../models/ChamadoN1';
import { canViewTicket, resolveUserPermissions } from '../services/permission.service';
import { buildAgentReplyEmailPreview } from '../services/emailReplyPreview.service';
import {
  createEmailConteudo,
  deleteEmailConteudo,
  getEmailConteudoById,
  listEmailConteudos,
  seedEmailConteudosIfEmpty,
  updateEmailConteudo,
} from '../services/emailConteudo.service';
import {
  buildAssinaturaPreviewHtml,
  getEmailAssinatura,
  loadAssinaturaImageBuffer,
  saveEmailAssinatura,
  uploadAssinaturaImagem,
} from '../services/emailAssinatura.service';
import {
  EMAIL_CANAL_OPCOES,
  EMAIL_SLA_OPCOES,
  EMAIL_STATUS_OPCOES,
  EMAIL_FAREWELL_TEXT,
} from '../services/emailOutbound.constants';
import {
  buildStandardEmailHeaderHtml,
  EMAIL_HEADER_PREVIEW_STATUS,
  loadVelotaxHeaderLogoInline,
} from '../services/emailBrand.util';
import { buildFarewellHtml } from '../services/emailSkeleton.service';
import { isValidObjectId } from '../models/EmailConteudo';
import { isValidSignatureObjectKey } from '../services/emailSignatureStorage.service';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});

function actorName(req: Request): string {
  return req.user?.name || req.user?.email || 'sistema';
}

function deskConfigUnavailable(res: Response) {
  return res.status(503).json({ message: 'Configuração de e-mail indisponível' });
}

router.get('/opcoes', authMiddleware, async (_req, res: Response) => {
  return res.json({
    canais: EMAIL_CANAL_OPCOES,
    status: EMAIL_STATUS_OPCOES,
    sla: EMAIL_SLA_OPCOES,
    farewell: EMAIL_FAREWELL_TEXT,
  });
});

/**
 * Prévia do e-mail que o cliente recebe para uma resposta do agente (mesmo template do envio real).
 * Body: { ticketId, text, hasAttachments }. Não envia nada.
 */
router.post('/preview-reply', authMiddleware, async (req: Request, res: Response) => {
  if (!isMongoConnected()) return res.status(503).json({ message: 'Banco indisponível' });
  const ticketId = String(req.body?.ticketId ?? '').trim();
  if (!mongoose.Types.ObjectId.isValid(ticketId)) {
    return res.status(400).json({ message: 'Ticket inválido para prévia.' });
  }
  try {
    const chamado = await ChamadoN1.findById(ticketId);
    if (!chamado) return res.status(404).json({ message: 'Ticket não encontrado' });
    const resolved = await resolveUserPermissions(req.user!);
    if (!canViewTicket(resolved, chamado)) {
      return res.status(403).json({ message: 'Sem permissão para ver este ticket.' });
    }
    const preview = await buildAgentReplyEmailPreview(
      chamado,
      String(req.body?.text ?? ''),
      Boolean(req.body?.hasAttachments),
    );
    return res.json(preview);
  } catch (err) {
    console.error('[emailOutbound] POST /preview-reply', err);
    return res.status(500).json({ message: 'Não foi possível montar a prévia do e-mail.' });
  }
});

router.get('/layout', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const logo = loadVelotaxHeaderLogoInline();
    const headerHtml = buildStandardEmailHeaderHtml(EMAIL_HEADER_PREVIEW_STATUS, Boolean(logo));
    const assinatura = await getEmailAssinatura();
    const signaturePreviewHtml = await buildAssinaturaPreviewHtml(assinatura.html);
    let headerPreviewHtml = headerHtml;
    if (logo) {
      const dataUrl = `data:${logo.contentType};base64,${logo.buffer.toString('base64')}`;
      headerPreviewHtml = headerHtml.replace(`cid:${logo.cid}`, dataUrl);
    }
    return res.json({
      headerHtml: headerPreviewHtml,
      farewell: EMAIL_FAREWELL_TEXT,
      farewellHtml: buildFarewellHtml(),
      signatureHtml: signaturePreviewHtml,
      assinatura,
    });
  } catch (err) {
    console.error('[emailOutbound] GET /layout', err);
    return deskConfigUnavailable(res);
  }
});

router.get('/conteudos', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    await seedEmailConteudosIfEmpty();
    const items = await listEmailConteudos();
    return res.json({ items });
  } catch (err) {
    console.error('[emailOutbound] GET /conteudos', err);
    return deskConfigUnavailable(res);
  }
});

router.post('/conteudos', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const item = await createEmailConteudo(req.body || {}, actorName(req));
    return res.status(201).json(item);
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.get('/conteudos/:id', authMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const id = String(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });
    const item = await getEmailConteudoById(id);
    if (!item) return res.status(404).json({ message: 'E-mail não encontrado' });
    return res.json(item);
  } catch (err) {
    console.error('[emailOutbound] GET /conteudos/:id', err);
    return deskConfigUnavailable(res);
  }
});

router.put('/conteudos/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const id = String(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });
    const item = await updateEmailConteudo(id, req.body || {}, actorName(req));
    if (!item) return res.status(404).json({ message: 'E-mail não encontrado' });
    return res.json(item);
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.delete('/conteudos/:id', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const id = String(req.params.id);
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'ID inválido' });
    const ok = await deleteEmailConteudo(id);
    if (!ok) return res.status(404).json({ message: 'E-mail não encontrado' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[emailOutbound] DELETE /conteudos/:id', err);
    return deskConfigUnavailable(res);
  }
});

router.get('/assinatura', authMiddleware, async (_req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const assinatura = await getEmailAssinatura();
    const previewHtml = await buildAssinaturaPreviewHtml(assinatura.html);
    return res.json({ ...assinatura, previewHtml });
  } catch (err) {
    console.error('[emailOutbound] GET /assinatura', err);
    return deskConfigUnavailable(res);
  }
});

router.put('/assinatura', authMiddleware, supervisorMiddleware, async (req, res: Response) => {
  try {
    if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
    const saved = await saveEmailAssinatura(
      { html: req.body?.html, imagens: req.body?.imagens },
      actorName(req),
    );
    const previewHtml = await buildAssinaturaPreviewHtml(saved.html);
    return res.json({ ...saved, previewHtml });
  } catch (err) {
    return res.status(400).json({ message: (err as Error).message });
  }
});

router.post(
  '/assinatura/imagem',
  authMiddleware,
  supervisorMiddleware,
  upload.single('file'),
  async (req, res: Response) => {
    try {
      if (!isDeskConfigConnected()) return deskConfigUnavailable(res);
      const file = req.file;
      if (!file) return res.status(400).json({ message: 'Envie uma imagem no campo file.' });
      const uploaded = await uploadAssinaturaImagem(file);
      return res.status(201).json(uploaded);
    } catch (err) {
      return res.status(400).json({ message: (err as Error).message });
    }
  },
);

router.get('/assets/signature/:objectKey', authMiddleware, async (req, res: Response) => {
  try {
    const objectKey = String(req.params.objectKey || '').trim();
    if (!isValidSignatureObjectKey(objectKey)) {
      return res.status(400).json({ message: 'Imagem inválida' });
    }
    const loaded = await loadAssinaturaImageBuffer(objectKey);
    if (!loaded) return res.status(404).json({ message: 'Imagem não encontrada' });
    res.setHeader('Content-Type', loaded.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(loaded.buffer);
  } catch (err) {
    console.error('[emailOutbound] GET /assets/signature', err);
    return res.status(404).json({ message: 'Imagem não encontrada' });
  }
});

router.get('/assets/header', authMiddleware, async (_req, res: Response) => {
  const logo = loadVelotaxHeaderLogoInline();
  if (!logo) return res.status(404).json({ message: 'Logo indisponível' });
  res.setHeader('Content-Type', logo.contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(logo.buffer);
});

export default router;
