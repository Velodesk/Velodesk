/** emailBrand.util v1.2.0 — cabeçalho padrão (faixa #000058 + status) */
import fs from 'fs';
import path from 'path';
import { escapeHtmlAttribute } from './emailHtml.util';

export const EMAIL_BRAND_COLORS = {
  blueDark: '#000058',
  blueMedium: '#1634FF',
  blueLight: '#1694FF',
  /** Azul claro 40% sobre branco — equivalente sólido para clientes de e-mail */
  blueLight40: '#A2D4FF',
  blueOpaque: '#006AB9',
} as const;

export const VELOTAX_LOGO_CID = 'velotax-logo';
export const VELOTAX_LOGO_COMPLETO_CID = 'velotax-logo-completo';
export const VELOTAX_HEADER_LOGO_CID = 'velotax-header-logo';
export const EMAIL_HEADER_PREVIEW_STATUS = '• PROTOCOLO · EM ATENDIMENTO';

const HEADER_LOGO_FILENAME = 'velotax_ajustada_branco.png';
const LOGO_COMPLETO_FILENAME = 'velotax_logo_completo.png';
const LOGO_SIMBOLO_FILENAME = 'simbolo_velotax_ajustada_branco.png';
const HEADER_TOP_RADIUS = 20;

function resolveAssetPath(fileName: string): string | null {
  const candidates = [
    path.join(process.cwd(), 'assets', 'email', fileName),
    path.join(process.cwd(), 'public', fileName),
    path.join(process.cwd(), '..', 'public', fileName),
    path.join(__dirname, '..', '..', 'assets', 'email', fileName),
    path.join(__dirname, '..', '..', '..', 'public', fileName),
    path.join(__dirname, '..', '..', 'public', fileName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveVelotaxLogoPath(): string | null {
  return resolveAssetPath(LOGO_SIMBOLO_FILENAME);
}

function resolveVelotaxHeaderLogoPath(): string | null {
  return resolveAssetPath(HEADER_LOGO_FILENAME)
    || resolveAssetPath(LOGO_COMPLETO_FILENAME)
    || resolveVelotaxLogoPath();
}

export function loadVelotaxHeaderLogoInline(): {
  cid: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
} | null {
  const logoPath = resolveVelotaxHeaderLogoPath();
  if (!logoPath) {
    console.warn('[emailBrand] logo do cabeçalho padrão não encontrado');
    return null;
  }
  return loadLogoFromPath(logoPath, VELOTAX_HEADER_LOGO_CID, HEADER_LOGO_FILENAME);
}

/**
 * Rótulo exibido pra cada status realmente usado no dia a dia — sempre "PROTOCOLO · <STATUS>".
 * "em-aberto"/"em-espera"/"fechado" não têm rótulo próprio (não são usados na prática como
 * estado final visível ao cliente) — herdam o selo do status equivalente mais próximo.
 */
const STATUS_LABEL_BY_KEY: Record<string, string> = {
  novo: 'NOVO',
  'em-andamento': 'EM ANDAMENTO',
  'em-aberto': 'EM ANDAMENTO',
  pendente: 'PENDENTE',
  'em-espera': 'PENDENTE',
  resolvido: 'RESOLVIDO',
  fechado: 'RESOLVIDO',
  cancelado: 'CANCELADO',
};

export function emailHeaderStatusLabel(status: string): string {
  const key = String(status || '').trim().toLowerCase();
  const label = STATUS_LABEL_BY_KEY[key];
  return label ? `• PROTOCOLO · ${label}` : EMAIL_HEADER_PREVIEW_STATUS;
}

/** Cabeçalho padrão: faixa #000058 + logo branca + faixa de status. */
export function buildStandardEmailHeaderHtml(statusLabel: string, withLogo: boolean): string {
  const safeStatus = escapeHtmlAttribute(statusLabel || EMAIL_HEADER_PREVIEW_STATUS);
  const logoCell = withLogo
    ? `<img src="cid:${VELOTAX_HEADER_LOGO_CID}" alt="Velotax" height="36" style="display:block;border:0;outline:none;height:36px;width:auto;max-width:180px;" />`
    : `<span style="font-size:18px;font-weight:700;color:#ffffff;font-family:Arial,sans-serif;">Velotax</span>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;">
  <tr>
    <td style="background:${EMAIL_BRAND_COLORS.blueDark};padding:18px 24px;border-radius:${HEADER_TOP_RADIUS}px ${HEADER_TOP_RADIUS}px 0 0;">
      ${logoCell}
    </td>
  </tr>
  <tr>
    <td style="background:${EMAIL_BRAND_COLORS.blueLight40};background-color:${EMAIL_BRAND_COLORS.blueLight40};padding:8px 24px;">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;color:${EMAIL_BRAND_COLORS.blueDark};font-family:Arial,sans-serif;">${safeStatus}</p>
    </td>
  </tr>
</table>`;
}

function resolveVelotaxLogoCompletoPath(): string | null {
  return resolveAssetPath(LOGO_COMPLETO_FILENAME) || resolveVelotaxLogoPath();
}

function loadLogoFromPath(
  logoPath: string | null,
  cid: string,
  filename: string,
): { cid: string; filename: string; contentType: string; buffer: Buffer } | null {
  if (!logoPath) return null;
  try {
    return {
      cid,
      filename,
      contentType: 'image/png',
      buffer: fs.readFileSync(logoPath),
    };
  } catch (err) {
    console.warn('[emailBrand] falha ao ler logo:', (err as Error).message);
    return null;
  }
}

export function loadVelotaxLogoInline(): {
  cid: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
} | null {
  const logoPath = resolveVelotaxLogoPath();
  if (!logoPath) {
    console.warn('[emailBrand] logo Velotax (símbolo) não encontrado');
    return null;
  }
  return loadLogoFromPath(logoPath, VELOTAX_LOGO_CID, 'velodesk-brand.png');
}

/** Logo completo Velotax — header de resposta do agente (fallback: símbolo existente). */
export function loadVelotaxLogoCompletoInline(): {
  cid: string;
  filename: string;
  contentType: string;
  buffer: Buffer;
} | null {
  const logoPath = resolveVelotaxLogoCompletoPath();
  if (!logoPath) {
    console.warn('[emailBrand] logo completo Velotax não encontrado');
    return null;
  }
  const cid = logoPath.includes(LOGO_COMPLETO_FILENAME)
    ? VELOTAX_LOGO_COMPLETO_CID
    : VELOTAX_LOGO_CID;
  return loadLogoFromPath(logoPath, cid, 'velotax-logo-completo.png');
}

/** Header legado (gradiente + símbolo + título) — confirmação abertura e fluxos não migrados. */
export function buildEmailHeaderHtml(title: string, withLogo: boolean): string {
  const safeTitle = escapeHtmlAttribute(String(title || '').trim());
  const gradient = `linear-gradient(90deg, ${EMAIL_BRAND_COLORS.blueDark} 0%, ${EMAIL_BRAND_COLORS.blueMedium} 50%, ${EMAIL_BRAND_COLORS.blueOpaque} 100%)`;
  const logoCell = withLogo
    ? `<td style="vertical-align:middle;padding-right:12px;width:40px;">
        <img src="cid:${VELOTAX_LOGO_CID}" alt="Velotax" width="32" height="32" style="display:block;border:0;outline:none;" />
      </td>`
    : `<td style="vertical-align:middle;padding-right:12px;width:40px;">
        <div style="width:32px;height:32px;border-radius:6px;background:rgba(255,255,255,0.15);"></div>
      </td>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border-collapse:collapse;">
  <tr>
    <td style="background:${EMAIL_BRAND_COLORS.blueDark};background-image:${gradient};padding:16px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${logoCell}
          <td style="vertical-align:middle;">
            <h2 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;font-family:Arial,sans-serif;line-height:1.3;">${safeTitle}</h2>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

/** Header de resposta do agente — somente logo completo, sem barra gradiente/título. */
export function buildEmailLogoHeaderHtml(withLogo: boolean): string {
  if (!withLogo) {
    return `<p style="margin:0 0 20px 0;font-size:20px;font-weight:700;color:${EMAIL_BRAND_COLORS.blueMedium};font-family:Arial,sans-serif;">Velotax</p>`;
  }
  const cid = resolveAssetPath(LOGO_COMPLETO_FILENAME)
    ? VELOTAX_LOGO_COMPLETO_CID
    : VELOTAX_LOGO_CID;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:8px 0 16px 0;">
      <img src="cid:${cid}" alt="Velotax" width="180" style="display:block;border:0;outline:none;max-width:180px;height:auto;" />
    </td>
  </tr>
</table>`;
}
