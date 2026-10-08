/**
 * workflowAssignmentNotification.service v2.0.0 — notifica por e-mail quem a etapa de Workflow
 * foi atribuída (colaborador nominal OU todos os agentes da função/grupo). Etapas de aprovação
 * levam botões Aprovar/Reprovar funcionais (ver workflowDecisao.routes).
 * Não notifica 'responsavel_ticket' (já está na fila dele) nem 'sistema'.
 */
import type { IChamadoN1, IWorkflowPathSegment } from '../models/ChamadoN1';
import type { IWorkflowAtribuicao, IWorkflowDefinicao, IWorkflowPassoEnvelope } from '../models/WorkflowDefinicao';
import { listColaboradoresVelotaxDesk } from './colaboradoresCadastro.service';
import { findAgenteEmailByNome } from './agenteDesk.service';
import { extractFuncoes, normalizeFuncao } from '../utils/normalizeFuncao';
import { GRUPO_TO_FUNCAO_MAP } from '../config/funcaoPermissaoDefaults';
import { sendOutboundEmail } from './email-outbound.service';
import { buildStandardEmailHeaderHtml } from './emailBrand.util';
import { escapeHtmlAttribute } from './emailHtml.util';
import { getRequisicaoConfig } from './workflowRequisicao.service';
import {
  buildWorkflowDecisionUrl,
  buildWorkflowStepSignature,
  signWorkflowDecisionToken,
} from './workflowDecisionToken.util';

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

async function resolveFuncaoRecipients(slug: string): Promise<string[]> {
  const target = normalizeFuncao(slug);
  if (!target) return [];
  const colaboradores = await listColaboradoresVelotaxDesk();
  const emails = colaboradores
    .filter((col) => col.afastado !== true && col.desligado !== true)
    .filter((col) => extractFuncoes(col.atuacao).includes(target))
    .map((col) => normalizeEmail(col.userMail))
    .filter((mail) => mail.includes('@'));
  return Array.from(new Set(emails));
}

export async function resolveNotificationRecipients(
  atribuicao: IWorkflowAtribuicao | null | undefined,
): Promise<string[]> {
  if (!atribuicao) return [];

  switch (atribuicao.tipo) {
    case 'colaborador': {
      const raw = String(atribuicao.colaborador || '').trim();
      if (!raw) return [];
      if (raw.includes('@')) return [normalizeEmail(raw)];
      const email = await findAgenteEmailByNome(raw);
      return email ? [email] : [];
    }
    case 'funcao':
      return resolveFuncaoRecipients(atribuicao.funcaoSlug || '');
    case 'grupo': {
      const grupoSlug = String(atribuicao.grupoSlug || '').trim().toLowerCase();
      const mapped = GRUPO_TO_FUNCAO_MAP[grupoSlug] || grupoSlug;
      return resolveFuncaoRecipients(mapped);
    }
    case 'responsavel_ticket':
    case 'sistema':
    default:
      return [];
  }
}

function esc(value: unknown): string {
  return escapeHtmlAttribute(String(value ?? ''));
}

function formatRequisicaoValue(
  campo: { tipo: string; opcoes?: Array<{ valor: string; label: string }> } | undefined,
  raw: unknown,
): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (campo?.tipo === 'boolean') return raw === true || raw === 'true' ? 'Sim' : 'Não';
  if (campo?.tipo === 'select') {
    const opt = campo.opcoes?.find((o) => o.valor === String(raw));
    if (opt) return opt.label;
  }
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

interface EmailRow {
  label: string;
  value: string;
}

function collectRequisicaoRows(chamado: IChamadoN1, definicao: IWorkflowDefinicao): EmailRow[] {
  const requisicao = chamado.workflow?.requisicao;
  if (!requisicao) return [];
  const rows: EmailRow[] = [];
  const campos = getRequisicaoConfig(definicao).campos || [];
  const valores = (requisicao.valores || {}) as Record<string, unknown>;
  const usados = new Set<string>();
  for (const campo of campos) {
    if (!(campo.id in valores)) continue;
    usados.add(campo.id);
    rows.push({ label: campo.label || campo.id, value: formatRequisicaoValue(campo, valores[campo.id]) });
  }
  for (const [key, raw] of Object.entries(valores)) {
    if (usados.has(key)) continue;
    rows.push({ label: key, value: formatRequisicaoValue(undefined, raw) });
  }
  const solic = requisicao.solicitacaoProdutos as Record<string, unknown> | undefined;
  if (solic) {
    for (const [key, raw] of Object.entries(solic)) {
      if (raw === null || raw === undefined || raw === '') continue;
      rows.push({ label: key, value: formatRequisicaoValue(undefined, raw) });
    }
  }
  return rows;
}

function buildRowsHtml(rows: EmailRow[]): string {
  return rows
    .map(
      (row) => `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eef0f3;font-size:13px;color:#6b7280;vertical-align:top;width:35%;">${esc(row.label)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eef0f3;font-size:13px;color:#111827;vertical-align:top;white-space:pre-wrap;">${esc(row.value)}</td>
      </tr>`,
    )
    .join('');
}

function buildButtonHtml(href: string, label: string, bg: string): string {
  return `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 28px;margin:0 6px 8px 0;background:${bg};color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:8px;">${label}</a>`;
}

function buildAssignmentEmailHtml(params: {
  workflowTitulo: string;
  passoNome: string;
  passoDescricao: string;
  protocolo: string;
  ticketTitulo: string;
  iniciadoPor: string;
  rows: EmailRow[];
  approveUrl?: string;
  rejectUrl?: string;
}): string {
  const header = buildStandardEmailHeaderHtml(
    params.approveUrl ? '• WORKFLOW · APROVAÇÃO PENDENTE' : '• WORKFLOW · AÇÃO PENDENTE',
    false,
  );
  const meta: EmailRow[] = [
    { label: 'Ticket', value: `#${params.protocolo}${params.ticketTitulo ? ` — ${params.ticketTitulo}` : ''}` },
    { label: 'Workflow', value: params.workflowTitulo },
    { label: 'Etapa', value: params.passoNome },
    ...(params.passoDescricao ? [{ label: 'Descrição', value: params.passoDescricao }] : []),
    ...(params.iniciadoPor ? [{ label: 'Iniciado por', value: params.iniciadoPor }] : []),
  ];
  const requisicao = params.rows.length
    ? `<p style="margin:20px 0 6px;font-size:13px;font-weight:700;color:#000058;">Dados da requisição</p>
       <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:6px;">${buildRowsHtml(params.rows)}</table>`
    : '';
  const buttons = params.approveUrl && params.rejectUrl
    ? `<p style="margin:24px 0 6px;font-size:13px;color:#374151;">Revise as informações e decida:</p>
       <div>${buildButtonHtml(params.approveUrl, '✔ Aprovar', '#15803d')}${buildButtonHtml(params.rejectUrl, '✖ Reprovar', '#b91c1c')}</div>
       <p style="margin:8px 0 0;font-size:12px;color:#6b7280;">O clique abre uma página de confirmação — a decisão só é registrada depois de confirmada lá.</p>`
    : `<p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Acesse o Velodesk, painel de Workflow, para revisar e decidir.</p>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;border-spacing:0;font-family:Arial,sans-serif;">
  <tr><td>${header}</td></tr>
  <tr>
    <td style="padding:24px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;">
      <p style="margin:0 0 14px;font-size:15px;color:#111827;">Um ticket em workflow está aguardando a sua atuação.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${buildRowsHtml(meta)}</table>
      ${requisicao}
      ${buttons}
    </td>
  </tr>
</table>`;
}

function buildAssignmentEmailText(params: {
  workflowTitulo: string;
  passoNome: string;
  protocolo: string;
  ticketTitulo: string;
  iniciadoPor: string;
  rows: EmailRow[];
  approveUrl?: string;
  rejectUrl?: string;
}): string {
  const lines = [
    `O ticket #${params.protocolo}${params.ticketTitulo ? ` (${params.ticketTitulo})` : ''} entrou na etapa "${params.passoNome}" do workflow "${params.workflowTitulo}" e depende da sua ação.`,
  ];
  if (params.iniciadoPor) lines.push(`Iniciado por: ${params.iniciadoPor}`);
  if (params.rows.length) {
    lines.push('', 'Dados da requisição:', ...params.rows.map((r) => `- ${r.label}: ${r.value}`));
  }
  if (params.approveUrl && params.rejectUrl) {
    lines.push('', `Aprovar: ${params.approveUrl}`, `Reprovar: ${params.rejectUrl}`);
  } else {
    lines.push('', 'Acesse o Velodesk, painel de Workflow, para revisar e decidir.');
  }
  return lines.join('\n');
}

/**
 * Fail-soft: nunca lança. Aguardável — os callers aguardam (com teto de tempo) porque, no Cloud
 * Run, trabalho "fire-and-forget" depois da resposta HTTP fica sem CPU e o e-mail nunca sai.
 */
export async function notifyWorkflowStepAssignmentAsync(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  node: IWorkflowPassoEnvelope | null | undefined,
  path?: IWorkflowPathSegment[] | null,
): Promise<void> {
  const protocolo = String(chamado.chamadoProtocolo || '').trim() || String(chamado._id);
  try {
    const atribuicao = node?.passo?.atribuicao;
    const tipo = atribuicao?.tipo;
    if (!atribuicao || tipo === 'sistema' || tipo === 'responsavel_ticket') return;

    const recipients = await resolveNotificationRecipients(atribuicao);
    if (!recipients.length) {
      console.warn('[workflow-assignment-notif] nenhum destinatário resolvido', {
        protocolo,
        tipo,
        funcao: atribuicao.funcaoSlug,
        grupo: atribuicao.grupoSlug,
        colaborador: atribuicao.colaborador,
      });
      return;
    }

    const ticketTitulo = String(chamado.chamadoTitulo || '').trim();
    const passoNome = String(node?.passo?.nome || 'Etapa').trim() || 'Etapa';
    const passoDescricao = String(node?.passo?.descricao || '').trim();
    const workflowTitulo = String(definicao.titulo || 'Workflow').trim() || 'Workflow';
    const iniciadoPor = String(chamado.workflow?.requisicao?.preenchidaPor || '').trim();
    const rows = collectRequisicaoRows(chamado, definicao);
    const isApproval = node?.passo?.acao?.tipo === 'aprovacao';
    const stepSig = buildWorkflowStepSignature(path || chamado.workflow?.path);

    const subject = `${isApproval ? 'Aprovação de workflow pendente' : 'Workflow pendente'}: ${workflowTitulo} — Ticket #${protocolo}`;

    for (const to of recipients) {
      try {
        let approveUrl: string | undefined;
        let rejectUrl: string | undefined;
        if (isApproval && stepSig) {
          const token = signWorkflowDecisionToken({
            chamadoId: String(chamado._id),
            stepSig,
            email: to,
          });
          approveUrl = buildWorkflowDecisionUrl(token, 'approve');
          rejectUrl = buildWorkflowDecisionUrl(token, 'reject');
        }
        const common = { workflowTitulo, passoNome, protocolo, ticketTitulo, iniciadoPor, rows, approveUrl, rejectUrl };
        const result = await sendOutboundEmail({
          to,
          subject,
          text: buildAssignmentEmailText(common),
          html: buildAssignmentEmailHtml({ ...common, passoDescricao }),
        });
        if (result.sent) {
          console.info('[workflow-assignment-notif] enviado', { protocolo, to, passo: passoNome, aprovacao: isApproval });
        } else {
          console.warn('[workflow-assignment-notif] NÃO enviado', { protocolo, to, reason: result.reason });
        }
      } catch (err) {
        console.warn('[workflow-assignment-notif] falha ao enviar para', to, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[workflow-assignment-notif] falha geral:', (err as Error).message);
  }
}

/** Aguarda a notificação, mas nunca segura a operação principal por mais que `maxMs`. */
export async function notifyWorkflowStepAssignmentBounded(
  chamado: IChamadoN1,
  definicao: IWorkflowDefinicao,
  node: IWorkflowPassoEnvelope | null | undefined,
  path: IWorkflowPathSegment[] | null | undefined,
  maxMs = 20_000,
): Promise<void> {
  await Promise.race([
    notifyWorkflowStepAssignmentAsync(chamado, definicao, node, path),
    new Promise<void>((resolve) => setTimeout(resolve, maxMs)),
  ]);
}
