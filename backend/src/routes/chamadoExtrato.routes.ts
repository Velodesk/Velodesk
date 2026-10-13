/**
 * chamadoExtrato.routes v1.0.0 — GET /api/chamados/:protocolo/extrato.html
 * Extrato do ticket renderizado no servidor, para impressão / "Salvar como PDF" no Chrome.
 * O front busca com o Bearer (axios) e abre o HTML numa nova aba — o token nunca vai na URL.
 */
import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { isMongoConnected } from '../config/database';
import { canViewTicket, resolveUserPermissions } from '../services/permission.service';
import {
  ChamadoExtratoError,
  findChamadoForExtrato,
  renderChamadoExtrato,
} from '../services/chamadoExtrato.service';

const router = Router();

function errorPage(title: string, message: string): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title></head>`
    + `<body style="font-family:sans-serif;padding:24px"><h1>${esc(title)}</h1><p>${esc(message)}</p></body></html>`;
}

router.get('/:protocolo/extrato.html', authMiddleware, async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private');
  if (!isMongoConnected()) {
    return res.status(503).send(errorPage('Extrato indisponível', 'Banco de dados indisponível no momento.'));
  }

  const protocolo = String(req.params.protocolo ?? '').trim();
  const options = {
    incluirPublicas: req.query.publicas !== '0',
    incluirInternas: req.query.internas !== '0',
    incluirAutomaticas: req.query.autom !== '0',
    detalhamento: req.query.detalhe === '1',
    sla: req.query.sla === '1',
  };

  try {
    const chamado = await findChamadoForExtrato(protocolo);
    const resolved = await resolveUserPermissions(req.user!);
    if (!canViewTicket(resolved, chamado)) {
      console.warn('[chamado-extrato] acesso negado', { protocolo, user: req.user?.email });
      return res.status(403).send(errorPage('Sem permissão', 'Você não tem permissão para ver este ticket.'));
    }

    const geradoPor = req.user?.displayName || req.user?.name || req.user?.email || '';
    const html = await renderChamadoExtrato(chamado, options, geradoPor);
    // Trilha de auditoria: quem gerou, qual ticket, quando e com quais filtros.
    console.info('[chamado-extrato] gerado', {
      protocolo,
      user: req.user?.email,
      at: new Date().toISOString(),
      filtros: options,
    });
    res.setHeader('Content-Disposition', 'inline');
    return res.send(html);
  } catch (err) {
    if (err instanceof ChamadoExtratoError) {
      return res.status(404).send(errorPage('Ticket não encontrado', err.message));
    }
    console.error('[chamado-extrato] falha ao gerar', protocolo, err);
    return res.status(500).send(errorPage('Erro ao gerar extrato', 'Tente novamente em instantes.'));
  }
});

export default router;
