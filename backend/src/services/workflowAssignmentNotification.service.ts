/**
 * workflowAssignmentNotification.service v1.0.0 — notifica por e-mail quem uma etapa de
 * Workflow foi atribuída (função/grupo/colaborador). Não notifica 'responsavel_ticket'
 * (já aparece na fila normal dele) nem 'sistema' (sem colaborador humano).
 */
import type { IChamadoN1 } from '../models/ChamadoN1';
import type { IWorkflowAtribuicao, IWorkflowDefinicao, IWorkflowPassoEnvelope } from '../models/WorkflowDefinicao';
import { listColaboradoresVelotaxDesk } from './colaboradoresCadastro.service';
import { findAgenteEmailByNome } from './agenteDesk.service';
import { extractFuncoes, normalizeFuncao } from '../utils/normalizeFuncao';
import { GRUPO_TO_FUNCAO_MAP } from '../config/funcaoPermissaoDefaults';
import { sendOutboundEmail } from './email-outbound.service';
import { buildStandardEmailHeaderHtml } from './emailBrand.util';

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
    .filter(Boolean);
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

function buildAssignmentEmailHtml(params: {
  workflowTitulo: string;
  passoNome: string;
  protocolo: string;
  ticketTitulo: string;
}): string {
  const header = buildStandardEmailHeaderHtml('• WORKFLOW · AÇÃO PENDENTE', false);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:separate;border-spacing:0;font-family:Arial,sans-serif;">
  <tr><td>${header}</td></tr>
  <tr>
    <td style="padding:24px;background:#ffffff;border:1px solid #e5e7eb;border-top:none;">
      <p style="margin:0 0 12px;font-size:15px;color:#111827;">
        O ticket <strong>#${params.protocolo}</strong>${params.ticketTitulo ? ` (${params.ticketTitulo})` : ''}
        entrou na etapa <strong>"${params.passoNome}"</strong> do workflow <strong>"${params.workflowTitulo}"</strong>
        e depende da sua ação.
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280;">
        Acesse o Velodesk, painel de Workflow, para revisar e decidir.
      </p>
    </td>
  </tr>
</table>`;
}

/**
 * Fail-soft: nunca lança. Chamar sem `await` bloqueante — não deve atrasar o avanço do
 * workflow nem falhar a operação principal se o e-mail não sair.
 */
export async function notifyWorkflowStepAssignmentAsync(
  chamado: IChamadoN1,
  definicao: Pick<IWorkflowDefinicao, 'titulo'>,
  node: IWorkflowPassoEnvelope | null | undefined,
): Promise<void> {
  try {
    const atribuicao = node?.passo?.atribuicao;
    const recipients = await resolveNotificationRecipients(atribuicao);
    if (!recipients.length) return;

    const protocolo = String(chamado.chamadoProtocolo || '').trim() || String(chamado._id);
    const ticketTitulo = String(chamado.chamadoTitulo || '').trim();
    const passoNome = String(node?.passo?.nome || 'Etapa').trim() || 'Etapa';
    const workflowTitulo = String(definicao.titulo || 'Workflow').trim() || 'Workflow';

    const subject = `Workflow pendente: ${workflowTitulo} — Ticket #${protocolo}`;
    const text = `O ticket #${protocolo}${ticketTitulo ? ` (${ticketTitulo})` : ''} entrou na etapa "${passoNome}" do workflow "${workflowTitulo}" e depende da sua ação. Acesse o Velodesk, painel de Workflow, para revisar e decidir.`;
    const html = buildAssignmentEmailHtml({ workflowTitulo, passoNome, protocolo, ticketTitulo });

    for (const to of recipients) {
      try {
        await sendOutboundEmail({ to, subject, text, html });
      } catch (err) {
        console.warn('[workflow-assignment-notif] falha ao enviar para', to, (err as Error).message);
      }
    }
  } catch (err) {
    console.warn('[workflow-assignment-notif] falha geral:', (err as Error).message);
  }
}
