/**
 * clientMessageSendMask.util v1.0.0 — fechamento visual e-mail + suffix WPP
 * VERSION: v1.0.0 | DATE: 2026-08-10
 */
import type { IChamadoN1 } from '../models/ChamadoN1';
import { escapeHtmlAttribute } from './emailHtml.util';
import { EMAIL_BRAND_COLORS } from './emailBrand.util';
import { resolveClientFirstName } from './agents/openaiAgent.util';

export interface SendMaskChamadoContext {
  protocolo: string;
  titulo?: string;
  dataHora?: string;
}

function formatChamadoDateTime(chamado: IChamadoN1): string {
  const raw = chamado.createdAt;
  if (!raw) return '';
  try {
    const d = raw instanceof Date ? raw : new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function buildSendMaskContext(chamado: IChamadoN1): SendMaskChamadoContext {
  return {
    protocolo: String(chamado.chamadoProtocolo ?? '').trim(),
    titulo: String(chamado.chamadoTitulo ?? '').trim(),
    dataHora: formatChamadoDateTime(chamado),
  };
}

/** Fechamento HTML padrão (guia Velotax) — box protocolo, CTA, assinatura, rodapé. */
export function buildSendMaskClosingHtml(chamado: IChamadoN1): string {
  const ctx = buildSendMaskContext(chamado);
  const safeProtocolo = escapeHtmlAttribute(ctx.protocolo || '—');
  const safeTitulo = escapeHtmlAttribute(ctx.titulo || '');
  const safeDataHora = escapeHtmlAttribute(ctx.dataHora || '');

  const footerMeta = [
    ctx.protocolo ? `Protocolo ${safeProtocolo}` : '',
    safeTitulo,
    safeDataHora ? `registrado em ${safeDataHora}` : '',
  ].filter(Boolean).join(' · ');

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;border-collapse:collapse;">
  <tr>
    <td style="background:#f4f6fb;border-left:4px solid ${EMAIL_BRAND_COLORS.blueMedium};padding:16px 20px;border-radius:0 8px 8px 0;">
      <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SEU PROTOCOLO</p>
      <p style="margin:0 0 8px 0;font-size:28px;font-weight:700;color:${EMAIL_BRAND_COLORS.blueMedium};line-height:1.2;">${safeProtocolo}</p>
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Guarde este número para acompanhar o seu atendimento.</p>
    </td>
  </tr>
</table>
<p style="margin:20px 0 16px 0;font-size:14px;color:#333;line-height:1.6;">
  Se você precisar de mais informações, quiser acompanhar o andamento ou tiver alguma atualização, é só responder esta mensagem por aqui.
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-collapse:collapse;">
  <tr>
    <td style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;padding:14px 16px;">
      <p style="margin:0;font-size:14px;color:${EMAIL_BRAND_COLORS.blueMedium};line-height:1.5;">
        <span style="font-size:18px;margin-right:6px;">↲</span>
        É só responder este e-mail — a sua mensagem entra direto no mesmo protocolo.
      </p>
    </td>
  </tr>
</table>
<p style="margin:0 0 8px 0;font-size:14px;color:#333;line-height:1.6;">Estamos por aqui para te ajudar no que precisar!</p>
<p style="margin:0 0 24px 0;font-size:14px;color:#111;font-weight:700;line-height:1.5;">Time de Atendimento Velotax</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;border-collapse:collapse;">
  <tr>
    <td style="background:#f1f5f9;padding:12px 16px;border-radius:6px;">
      <p style="margin:0;font-size:11px;color:#64748b;line-height:1.5;">
        Este e-mail foi gerado automaticamente.${footerMeta ? ` ${footerMeta}.` : ''}
      </p>
    </td>
  </tr>
</table>`;
}

/** Versão texto plano do fechamento (fallback multipart e-mail). */
export function buildSendMaskClosingPlain(chamado: IChamadoN1): string {
  const ctx = buildSendMaskContext(chamado);
  const lines = [
    '',
    '---',
    `Protocolo: ${ctx.protocolo || '—'}`,
    'Guarde este número para acompanhar o seu atendimento.',
    '',
    'Se precisar de mais informações, responda este e-mail.',
    '',
    'Estamos por aqui para te ajudar no que precisar!',
    'Time de Atendimento Velotax',
  ];
  if (ctx.dataHora) {
    lines.push('', `Registrado em ${ctx.dataHora}`);
  }
  return lines.join('\n');
}

/**
 * Suffix curto para WhatsApp — enviado ao cliente, não persiste no Mongo. O protocolo só é
 * incluído na primeira mensagem ativa da conversa; nas seguintes o nome do agente no início já
 * identifica quem está falando, então repetir protocolo + assinatura a cada mensagem é ruído.
 */
export function buildWhatsAppSendMaskSuffix(chamado: IChamadoN1, isFirstOutboundMessage: boolean): string {
  if (!isFirstOutboundMessage) return '';
  const protocolo = String(chamado.chamadoProtocolo ?? '').trim();
  if (!protocolo) return '';
  return `\n\nProtocolo: ${protocolo}`;
}

/** Prefixo "Nome: " com o primeiro nome do agente, para identificação na conversa. */
export function buildWhatsAppSendMaskPrefix(agentName?: string): string {
  const first = resolveClientFirstName(String(agentName ?? '').trim());
  return first ? `${first}: ` : '';
}

export interface WhatsAppSendMaskOptions {
  agentName?: string;
  isFirstOutboundMessage?: boolean;
}

/** Monta body Twilio = "Agente: " + composer + (protocolo, só na 1ª mensagem). */
export function applyWhatsAppSendMask(
  composerText: string,
  chamado: IChamadoN1,
  opts: WhatsAppSendMaskOptions = {},
): string {
  const base = String(composerText ?? '').trim();
  if (!base) return '';
  const prefix = buildWhatsAppSendMaskPrefix(opts.agentName);
  const suffix = buildWhatsAppSendMaskSuffix(chamado, opts.isFirstOutboundMessage ?? false);
  return `${prefix}${base}${suffix}`;
}
