/**
 * qaEmailGuard v1.0.0 — trava de e-mails para tickets do agente de QA
 *
 * Por que existe: o agente de QA roda em produção e cria tickets de teste. Se
 * a lista de e-mails permitidos ficasse só no script de teste, um erro de
 * digitação lá poderia disparar e-mail para cliente real. Aqui a trava fica no
 * caminho de envio do próprio backend: um ticket marcado como QA só consegue
 * enviar e-mail para endereço da lista QA_EMAIL_ALLOWLIST.
 *
 * Ticket normal (de cliente real) NÃO é afetado por esta trava em nada.
 */
import type { IChamadoN1 } from '../models/ChamadoN1';

/** Marca gravada pelo agente de QA em registro[].metadados.inboundTicketMetadata.origemQa */
export const QA_ORIGEM = 'qa-velodesk';

function parseAllowlist(): string[] {
  return String(process.env.QA_EMAIL_ALLOWLIST ?? '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

/** O ticket foi criado pelo agente de QA? */
export function isQaChamado(chamado: Pick<IChamadoN1, 'registro'> | null | undefined): boolean {
  const registros = (chamado?.registro ?? []) as Array<{ metadados?: Record<string, any> }>;
  return registros.some((r) => {
    const meta = r?.metadados ?? {};
    if (meta?.inboundTicketMetadata?.origemQa === QA_ORIGEM) return true;
    if (meta?.origemQa === QA_ORIGEM) return true;
    return String(meta?.inboundTicketExternalId ?? '').startsWith(`${QA_ORIGEM}-`);
  });
}

/** O endereço está na lista de e-mails autorizados para QA? */
export function isQaEmailPermitido(to: unknown): boolean {
  const email = String(to ?? '').trim().toLowerCase();
  if (!email.includes('@')) return false;
  return parseAllowlist().includes(email);
}

/**
 * Devolve o motivo do bloqueio, ou null quando o envio pode seguir.
 *
 * Regra: se o ticket é de QA e o destinatário não está na lista, bloqueia.
 * Lista vazia com ticket de QA também bloqueia — é o modo seguro.
 */
export function blockQaOutboundEmail(
  chamado: Pick<IChamadoN1, 'registro' | 'chamadoProtocolo'> | null | undefined,
  to: unknown,
): string | null {
  if (!isQaChamado(chamado)) return null;
  if (isQaEmailPermitido(to)) return null;
  const protocolo = String(chamado?.chamadoProtocolo ?? '(sem protocolo)');
  const email = String(to ?? '').trim().toLowerCase() || '(vazio)';
  const lista = parseAllowlist();
  return (
    `ticket de QA ${protocolo} tentou enviar e-mail para "${email}", que não está em ` +
    `QA_EMAIL_ALLOWLIST (${lista.length ? lista.join(', ') : 'lista vazia'}). Envio bloqueado.`
  );
}
