/** emailSkeleton.service v1.4.0 — showTicketBox opcional (CSAT usa linha compacta própria) */
import type { IChamadoN1 } from '../models/ChamadoN1';
import { EMAIL_BRAND_COLORS, buildStandardEmailHeaderHtml, emailHeaderStatusLabel, loadVelotaxHeaderLogoInline } from './emailBrand.util';
import { composeHtmlToEmailHtml, escapeHtmlAttribute, htmlToPlainTextForEmail } from './emailHtml.util';
import { EMAIL_FAREWELL_REPLY_HINT, EMAIL_FAREWELL_SIGN_OFF, EMAIL_FAREWELL_TEXT } from './emailOutbound.constants';
import { getEmailAssinaturaModel } from '../models/EmailAssinatura';
import { readSignatureImageFromGcs } from './emailSignatureStorage.service';
import type { GmailInlineImage } from './gmail/gmailApiSend';
import { currentStatus } from './chamado.mapper';

export type EmailSkeletonMode = 'template' | 'agent';

export interface EmailSkeletonTicket {
  protocolo: string;
  titulo: string;
}

export interface EmailSkeletonParts {
  html: string;
  text: string;
  inlineImages: GmailInlineImage[];
}

const SIG_IMG_RE = /<img\b[^>]*>/gi;

function wrapEmailDocument(headerHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fb;padding:16px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;background:#ffffff;border-collapse:separate;border-spacing:0;overflow:hidden;">
          <tr>
            <td style="padding:0;">${headerHtml}</td>
          </tr>
          <tr>
            <td style="font-family:Arial,sans-serif;line-height:1.6;color:#333;padding:24px;">
              ${bodyHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

export function plainTextToEmailHtml(raw: string): string {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) {
    return composeHtmlToEmailHtml(text);
  }
  const paragraphs = text.split(/\n{2,}/).map((block) => {
    const safe = escapeHtmlAttribute(block).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 12px 0;font-size:14px;color:#333;line-height:1.6;">${safe}</p>`;
  });
  return paragraphs.join('');
}

export function buildTicketBoxHtml(ticket: EmailSkeletonTicket): string {
  const protocolo = escapeHtmlAttribute(ticket.protocolo || '—');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-collapse:collapse;">
  <tr>
    <td style="background:#f4f6fb;border-left:4px solid ${EMAIL_BRAND_COLORS.blueMedium};padding:16px 20px;">
      <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">Atendimento</p>
      <p style="margin:0;font-size:22px;font-weight:700;color:${EMAIL_BRAND_COLORS.blueMedium};line-height:1.2;">${protocolo}</p>
    </td>
  </tr>
</table>`;
}

export function buildFarewellHtml(): string {
  const blue = EMAIL_BRAND_COLORS.blueMedium;
  const hint = escapeHtmlAttribute(EMAIL_FAREWELL_REPLY_HINT);
  const text = escapeHtmlAttribute(EMAIL_FAREWELL_TEXT);
  const signOff = escapeHtmlAttribute(EMAIL_FAREWELL_SIGN_OFF);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;border-collapse:separate;border-spacing:0;">
  <tr>
    <td style="background:#EEF2FF;border:1px solid ${blue};border-radius:8px;padding:14px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td valign="top" style="padding:1px 10px 0 0;color:${blue};font-size:18px;line-height:1.4;font-weight:700;">&#8617;</td>
          <td style="font-family:Arial,sans-serif;font-size:14px;color:${blue};line-height:1.5;">${hint}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<p style="margin:20px 0 8px 0;font-size:14px;color:#333;line-height:1.6;">${text}</p>
<p style="margin:0;font-size:14px;color:#111;font-weight:700;line-height:1.5;">${signOff}</p>`;
}

export function buildFarewellPlain(): string {
  return [EMAIL_FAREWELL_REPLY_HINT, EMAIL_FAREWELL_TEXT, EMAIL_FAREWELL_SIGN_OFF].join('\n\n');
}

function ticketFromChamado(chamado: IChamadoN1): EmailSkeletonTicket {
  return {
    protocolo: String(chamado.chamadoProtocolo ?? '').trim() || '—',
    titulo: String(chamado.chamadoTitulo ?? '').trim(),
  };
}

function extractObjectKeyFromImgTag(tag: string): string {
  const dataKey = tag.match(/\bdata-gcs-key\s*=\s*["']([^"']+)["']/i);
  if (dataKey?.[1]) return dataKey[1].trim();
  const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const value = String(src?.[1] ?? '').trim();
  const desk = value.match(/^desk-sig:([a-zA-Z0-9._-]+)$/i);
  if (desk?.[1]) return desk[1];
  return '';
}

export async function loadAssinaturaForEmail(): Promise<{
  html: string;
  inlineImages: GmailInlineImage[];
}> {
  try {
    const Model = getEmailAssinaturaModel();
    const doc = await Model.findOne({ configKey: 'desk_email_assinatura' }).lean().exec();
    const rawHtml = String(doc?.html ?? '').trim();
    if (!rawHtml) {
      return { html: '', inlineImages: [] };
    }

    const inlineImages: Array<GmailInlineImage & { objectKey?: string }> = [];
    let index = 0;
    const html = rawHtml.replace(SIG_IMG_RE, (tag) => {
      const objectKey = extractObjectKeyFromImgTag(tag);
      if (!objectKey) return '';
      index += 1;
      const cid = `email-assinatura-${index}@velodesk`;
      inlineImages.push({
        cid,
        filename: objectKey,
        contentType: 'image/png',
        buffer: Buffer.alloc(0),
        objectKey,
      });
      // Preserva width/height/style originais (ícones em tamanho fixo, ex. 20x20) — só
      // cai no genérico quando a tag não trazia nenhum dimensionamento próprio.
      const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
      const widthMatch = tag.match(/\bwidth\s*=\s*["']?(\d+)["']?/i);
      const heightMatch = tag.match(/\bheight\s*=\s*["']?(\d+)["']?/i);
      const styleMatch = tag.match(/\bstyle\s*=\s*["']([^"']*)["']/i);
      const alt = altMatch?.[1] || 'assinatura';
      const width = widthMatch ? ` width="${widthMatch[1]}"` : '';
      const height = heightMatch ? ` height="${heightMatch[1]}"` : '';
      const style = styleMatch?.[1] || 'max-width:100%;height:auto;border:0;outline:none;';
      return `<img src="cid:${cid}" alt="${alt}"${width}${height} style="${style}" />`;
    });

    const resolved: GmailInlineImage[] = [];
    for (const image of inlineImages) {
      const key = image.objectKey || image.filename;
      const loaded = await readSignatureImageFromGcs(key);
      if (!loaded) continue;
      resolved.push({
        cid: image.cid,
        filename: image.filename,
        contentType: loaded.contentType || 'image/png',
        buffer: loaded.buffer,
      });
    }

    const allowedCids = new Set(resolved.map((item) => item.cid));
    const safeHtml = html.replace(/<img\b[^>]*src="cid:([^"]+)"[^>]*>/gi, (full, cid) => (
      allowedCids.has(cid) ? full : ''
    ));

    return { html: safeHtml, inlineImages: resolved };
  } catch (err) {
    console.warn('[emailSkeleton] assinatura indisponível:', (err as Error).message);
    return { html: '', inlineImages: [] };
  }
}

export function buildSkeletonInnerHtml(params: {
  mode: EmailSkeletonMode;
  saudacaoHtml?: string;
  ticket: EmailSkeletonTicket;
  corpoHtml: string;
  assinaturaHtml?: string;
  showTicketBox?: boolean;
}): string {
  const parts: string[] = [];
  if (params.mode === 'template' && params.saudacaoHtml) {
    parts.push(params.saudacaoHtml);
  }
  if (params.showTicketBox !== false) {
    parts.push(buildTicketBoxHtml(params.ticket));
  }
  if (params.corpoHtml) parts.push(params.corpoHtml);
  parts.push(buildFarewellHtml());
  if (params.assinaturaHtml) {
    parts.push(`<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;">${params.assinaturaHtml}</div>`);
  }
  return parts.join('\n');
}

export async function assembleClientEmail(params: {
  mode: EmailSkeletonMode;
  chamado: IChamadoN1;
  saudacao?: string;
  corpo: string;
  corpoAlreadyHtml?: boolean;
  showTicketBox?: boolean;
}): Promise<EmailSkeletonParts> {
  const logo = loadVelotaxHeaderLogoInline();
  const headerHtml = buildStandardEmailHeaderHtml(emailHeaderStatusLabel(currentStatus(params.chamado)), Boolean(logo));
  const ticket = ticketFromChamado(params.chamado);
  const saudacaoHtml = params.mode === 'template' ? plainTextToEmailHtml(params.saudacao || '') : '';
  const corpoHtml = params.corpoAlreadyHtml
    ? params.corpo
    : (params.mode === 'template' ? plainTextToEmailHtml(params.corpo) : composeHtmlToEmailHtml(params.corpo));
  const assinatura = await loadAssinaturaForEmail();

  const inner = buildSkeletonInnerHtml({
    mode: params.mode,
    saudacaoHtml,
    ticket,
    corpoHtml,
    assinaturaHtml: assinatura.html,
    showTicketBox: params.showTicketBox,
  });

  const textParts: string[] = [];
  if (params.mode === 'template' && params.saudacao) textParts.push(String(params.saudacao).trim());
  if (params.showTicketBox !== false) {
    textParts.push(`Protocolo: ${ticket.protocolo}`);
  }
  textParts.push(htmlToPlainTextForEmail(params.corpo || ''));
  textParts.push(buildFarewellPlain());
  if (assinatura.html) textParts.push(htmlToPlainTextForEmail(assinatura.html));

  const inlineImages: GmailInlineImage[] = [
    ...(logo ? [logo] : []),
    ...assinatura.inlineImages,
  ];

  return {
    html: wrapEmailDocument(headerHtml, inner),
    text: textParts.filter(Boolean).join('\n\n'),
    inlineImages,
  };
}

export function wrapPreviewEmailDocument(headerHtml: string, bodyHtml: string): string {
  return wrapEmailDocument(headerHtml, bodyHtml);
}
