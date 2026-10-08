/**
 * workflowDecisao.routes v1.0.0 — página pública (sem login) aberta pelos botões Aprovar/Reprovar
 * do e-mail de workflow. GET só mostra a confirmação (scanners de e-mail pré-visitam links, então
 * GET nunca decide); o POST do formulário é que efetiva a decisão. Identidade = token assinado.
 */
import { Router, type Request, type Response } from 'express';
import { ChamadoN1 } from '../models/ChamadoN1';
import { User } from '../models/User';
import type { AuthPayload } from '../middleware/auth';
import { escapeHtmlAttribute } from '../services/emailHtml.util';
import {
  findColaboradorByEmail,
  resolveColaboradorDisplayName,
} from '../services/colaboradoresCadastro.service';
import { verifyWorkflowDecisionToken } from '../services/workflowDecisionToken.util';
import {
  decideWorkflowViaEmail,
  loadWorkflowEmailDecisionContext,
  WorkflowEmailDecisionError,
} from '../services/workflowTicket.service';
import { publishTicketEvent } from '../services/presence/ticketEventsBroadcast.service';

const router = Router();

const esc = (v: unknown) => escapeHtmlAttribute(String(v ?? ''));

function page(res: Response, status: number, title: string, body: string): void {
  res
    .status(status)
    .setHeader('Cache-Control', 'no-store')
    .setHeader('Referrer-Policy', 'no-referrer')
    .type('html')
    .send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827}
.card{max-width:520px;margin:48px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.08)}
.head{background:#000058;color:#fff;padding:18px 24px;font-weight:700;font-size:18px}
.body{padding:24px}
dl{margin:0 0 16px}dt{font-size:12px;color:#6b7280;margin-top:10px}dd{margin:2px 0 0;font-size:14px}
textarea{width:100%;box-sizing:border-box;min-height:90px;padding:10px;border:1px solid #d1d5db;border-radius:8px;font:14px Arial}
button{padding:12px 28px;border:0;border-radius:8px;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
.ok{background:#15803d}.no{background:#b91c1c}.msg{font-size:15px;line-height:1.5}
</style></head><body><div class="card"><div class="head">Velotax · Workflow</div><div class="body">${body}</div></div></body></html>`);
}

function parseDecision(raw: unknown): 'approve' | 'reject' | null {
  return raw === 'approve' || raw === 'reject' ? raw : null;
}

async function loadFromToken(token: string) {
  const payload = verifyWorkflowDecisionToken(token);
  if (!payload) {
    throw new WorkflowEmailDecisionError('Link inválido ou expirado.', 400);
  }
  const chamado = await ChamadoN1.findById(payload.chamadoId);
  if (!chamado) throw new WorkflowEmailDecisionError('Ticket não encontrado.', 404);
  const ctx = await loadWorkflowEmailDecisionContext(chamado, payload.stepSig);
  return { payload, chamado, ...ctx };
}

function errorPage(res: Response, err: unknown): void {
  if (err instanceof WorkflowEmailDecisionError) {
    page(res, err.status, 'Workflow', `<p class="msg">${esc(err.message)}</p>`);
    return;
  }
  console.error('[workflow-decisao]', (err as Error)?.message);
  page(res, 500, 'Workflow', '<p class="msg">Não foi possível processar sua decisão. Tente pelo painel do Velodesk.</p>');
}

router.get('/workflow-decisao', async (req: Request, res: Response) => {
  const token = String(req.query.t || '');
  const decision = parseDecision(req.query.d);
  if (!decision) return page(res, 400, 'Workflow', '<p class="msg">Link inválido.</p>');
  try {
    const { chamado, definicao, node } = await loadFromToken(token);
    const approve = decision === 'approve';
    const protocolo = chamado.chamadoProtocolo || String(chamado._id);
    page(
      res,
      200,
      approve ? 'Confirmar aprovação' : 'Confirmar reprovação',
      `<h2 style="margin:0 0 12px">${approve ? 'Confirmar aprovação' : 'Confirmar reprovação'}</h2>
<dl>
<dt>Ticket</dt><dd>#${esc(protocolo)}${chamado.chamadoTitulo ? ` — ${esc(chamado.chamadoTitulo)}` : ''}</dd>
<dt>Workflow</dt><dd>${esc(definicao.titulo)}</dd>
<dt>Etapa</dt><dd>${esc(node.passo?.nome)}</dd>
</dl>
<form method="post" action="/workflow-decisao">
<input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="d" value="${decision}">
${approve
        ? '<label style="font-size:13px;color:#374151">Observação (opcional)</label><textarea name="motivo"></textarea>'
        : '<label style="font-size:13px;color:#374151">Motivo da reprovação (obrigatório)</label><textarea name="motivo" required></textarea>'}
<p><button type="submit" class="${approve ? 'ok' : 'no'}">${approve ? 'Confirmar aprovação' : 'Confirmar reprovação'}</button></p>
</form>`,
    );
  } catch (err) {
    errorPage(res, err);
  }
});

router.post('/workflow-decisao', async (req: Request, res: Response) => {
  const token = String(req.body?.t || '');
  const decision = parseDecision(req.body?.d);
  const motivo = String(req.body?.motivo || '').slice(0, 4000);
  if (!decision) return page(res, 400, 'Workflow', '<p class="msg">Link inválido.</p>');
  try {
    const { payload, chamado } = await loadFromToken(token);

    const colaborador = await findColaboradorByEmail(payload.email);
    if (!colaborador || colaborador.desligado) {
      throw new WorkflowEmailDecisionError('Seu cadastro não está ativo no Velodesk.', 403);
    }
    const user = await User.findOne({ email: payload.email }).select('_id').lean();
    const authUser: AuthPayload = {
      userId: user?._id ? String(user._id) : '',
      email: payload.email,
      role: 'agent',
      name: resolveColaboradorDisplayName(colaborador) || payload.email,
    };

    await decideWorkflowViaEmail(chamado, payload.stepSig, decision, authUser, motivo);
    await chamado.save();
    void publishTicketEvent(chamado._id.toString(), 'workflow');

    const protocolo = chamado.chamadoProtocolo || String(chamado._id);
    page(
      res,
      200,
      'Decisão registrada',
      `<h2 style="margin:0 0 12px">${decision === 'approve' ? '✔ Aprovado' : '✖ Reprovado'}</h2>
<p class="msg">Sua decisão no ticket <strong>#${esc(protocolo)}</strong> foi registrada no Velodesk. Você já pode fechar esta página.</p>`,
    );
  } catch (err) {
    errorPage(res, err);
  }
});

export default router;
