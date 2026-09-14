/**
 * emailPreviewHtml v1.5.0 — titulo/subtitulo das estrelas maiores (proporcional)
 * VERSION: v1.5.0 | DATE: 2026-08-24
 */

const BLUE = '#1634FF';
// Mesma imagem usada no e-mail real (backend/assets/email/csat-star.png),
// embutida aqui como base64 para a simulação não depender de rede/arquivo externo.
const CSAT_STAR_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAACE1BMVEVMaXH++/b6rw/5tAr//vP+/fT//fX99uT+/OH9+Oz9/Pj++u3//PX7tyD3nwr5pwn9+vP89uj7vTz8xhP90Bz9+/X9/Pj///n+803+9IP86Tj61lb9+9/++dX87dL9+/T5riD+//f73Bv74RT//d374SX86Sr86hn+/ff7+/j88ND+/vf86kT/9qL+/fr/+WH///781HT899r7yU7+/vv+/Pz7y2P/+sb877L+/e/87rj65rv60UL9+Nj9+c7++7X604f815H53Jz88JH/7Hv/7n//2Dv/5Tn/7IL+5Cf/5jP/7Hb9xgz+wRz+ywv+4TP+6V3/2xD/4lP/4Eb/6WX/3039vxf/41v/0zP9wg3+6Gv/2S7/5Uz+1hX/1k7+0BD/3jr+8qv/117+0y3/5IT+6HP/5UH+3DT/8aX+11f+3Gj/1zX/2UH+1wz+7Tr9vgj+4B/+3ED/3Rj/75n+4Hb+vRD+6FT/7Yz/9bj+0Dz+213+2kj/5or/9b7/5WP/4n7/8J//3VP8uRL+yhX/75P+12P+7SP/1iD+8Gv/62/9xCH+98j+uhn+6zL+1ET/4Wz+4C3+3mL9yCr+7lf/7iz/30H/6ET+8nj/2yb90gj+3G/+7E79zTT/3lj+ySD/55D/9K///8z/8WP/5nr+zjD+zSX+8bT//+n//7z/8Yv90En//4b//rL/7kT//qP/+pb/4J3TCUzBAAAAnXRSTlMASP39CQwRAQMGNhYc+/j8WCz7/v6Gdf7+/vr6zPyGZfnm+/v++/n6syOdwv7+ov7v/bX7zpP6z+rarGX64/Lt+s/y8f/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+tVRljwAAAAlwSFlzAAALEgAACxIB0t1+/AAADuVJREFUaN7tmvlXE9nWhitzVRLmeRJkklkE57m7gUAQSWMYxIgmAoaICAYDBJAwREHGgILNHMCAgOifeN9dFRD7apO+4vp++bZLXZLU+5x3731OnTolw/x/HGsoWPxW/DJ1yCs4qVTK/ioCq+A4nsT9EhOsVMEEhokQ6Qz3K0xwqiBR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';
const FAREWELL_REPLY_HINT =
  'É só responder este e-mail — a sua mensagem chega direto para quem está cuidando do seu caso.';
const FAREWELL_TEXT = 'Estou por aqui para o que você precisar.';
const FAREWELL_SIGN_OFF = 'Time de Atendimento Velotax';

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function plainTextToPreviewHtml(raw) {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  if (/<[a-z][\s\S]*>/i.test(text)) return text;
  return text.split(/\n{2,}/).map((block) => {
    const safe = escapeHtml(block).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 12px 0;font-size:14px;color:#333;line-height:1.6;">${safe}</p>`;
  }).join('');
}

export function buildTicketBoxPreviewHtml(protocolo, titulo) {
  const safeProtocolo = escapeHtml(protocolo || '0100000001');
  const safeTitulo = escapeHtml(titulo || 'Exemplo de assunto do atendimento');
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;border-collapse:collapse;">
  <tr>
    <td style="background:#f4f6fb;border-left:4px solid ${BLUE};padding:16px 20px;">
      <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">Atendimento</p>
      <p style="margin:0 0 8px 0;font-size:22px;font-weight:700;color:${BLUE};line-height:1.2;">${safeProtocolo}</p>
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Assunto: ${safeTitulo}</p>
    </td>
  </tr>
</table>`;
}

/**
 * Tamanho (px) de cada estrela na prévia — espelha CSAT_STAR_SIZE_BY_RATING do backend
 * (csatEmail.service.ts): crescente de 1 a 5, nota 1 é a menor e a 5 a maior.
 */
const CSAT_STAR_SIZE_BY_RATING = { 1: 28, 2: 32, 3: 36, 4: 40, 5: 44 };

/**
 * Bloco visual das 5 estrelas do e-mail de CSAT — usado SÓ na simulação.
 * No envio real esse bloco é gerado pelo backend (csatEmail.service.ts,
 * buildCsatStarsHtml) com links de verdade; aqui é só uma representação
 * estática (sem link) para a prévia mostrar como o e-mail final vai ficar.
 */
export function buildCsatStarsPreviewHtml() {
  const stars = [1, 2, 3, 4, 5]
    .map((n) => {
      const size = CSAT_STAR_SIZE_BY_RATING[n];
      // valign="bottom" + altura fixa: estrelas de tamanhos diferentes ficam ancoradas
      // embaixo da célula, então os números 1-5 alinham na mesma linha reta (espelha
      // csatEmail.service.ts/buildCsatStarsHtml).
      return `<td align="center" valign="bottom" height="70" style="padding:0 4px;">
      <span style="display:inline-block;">
        <img src="${CSAT_STAR_DATA_URI}" width="${size}" height="${size}" alt="★" style="display:inline-block;width:${size}px;height:${size}px;border:0;">
        <br>
        <span style="font-size:11px;color:#9AA0AE;">${n}</span>
      </span>
    </td>`;
    })
    .join('\n');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
  <tr><td colspan="5" style="text-align:center;padding:0 0 10px 0;">
    <p style="margin:0;font-size:19px;font-weight:700;color:#272A30;font-family:Arial,sans-serif;">Como foi o seu atendimento?</p>
    <p style="margin:6px 0 16px 0;font-size:16px;color:#9AA0AE;font-family:Arial,sans-serif;">Clique nas estrelas para dar sua nota — de 1 a 5.</p>
  </td></tr>
  <tr>${stars}</tr>
</table>`;
}

/**
 * Linha compacta "Avaliação referente ao protocolo X." — usada no lugar do
 * card grande de "Atendimento" só nos templates de CSAT, espelhando o que
 * o backend gera de verdade (csatEmail.service.ts, buildCsatProtocoloLineHtml).
 */
export function buildCsatProtocoloLinePreviewHtml(protocolo) {
  const safeProtocolo = escapeHtml(protocolo || '0100000001');
  return `<p style="margin:0 0 16px 0;font-size:13px;color:#5A6472;font-family:Arial,sans-serif;">Avaliação referente ao protocolo <strong style="color:${BLUE};">${safeProtocolo}</strong>.</p>`;
}

export function buildFarewellPreviewHtml(farewellHtml) {
  if (farewellHtml && /<[a-z][\s\S]*>/i.test(String(farewellHtml))) {
    return String(farewellHtml);
  }
  const hint = escapeHtml(FAREWELL_REPLY_HINT);
  const text = escapeHtml(FAREWELL_TEXT);
  const signOff = escapeHtml(FAREWELL_SIGN_OFF);
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0 0;border-collapse:separate;border-spacing:0;">
  <tr>
    <td style="background:#EEF2FF;border:1px solid ${BLUE};border-radius:8px;padding:14px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td valign="top" style="padding:1px 10px 0 0;color:${BLUE};font-size:18px;line-height:1.4;font-weight:700;">&#8617;</td>
          <td style="font-family:Arial,sans-serif;font-size:14px;color:${BLUE};line-height:1.5;">${hint}</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<p style="margin:20px 0 8px 0;font-size:14px;color:#333;line-height:1.6;">${text}</p>
<p style="margin:0;font-size:14px;color:#111;font-weight:700;line-height:1.5;">${signOff}</p>`;
}

export function wrapPreviewDocument(innerHtml, headerHtml = '') {
  const headerRow = headerHtml
    ? `<tr><td style="padding:0;">${headerHtml}</td></tr>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;min-height:100%;background:#f4f6fb;font-family:Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;min-height:100%;background:#f4f6fb;padding:16px 0;">
    <tr>
      <td align="center" valign="top" style="padding:0 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-collapse:separate;border-spacing:0;overflow:hidden;">
          ${headerRow}
          <tr>
            <td style="font-family:Arial,sans-serif;line-height:1.6;color:#333;padding:24px;">
              ${innerHtml}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

export function buildOutboundPreviewHtml({
  headerHtml,
  saudacao,
  corpo,
  farewellHtml,
  signatureHtml,
  protocolo,
  titulo,
  showCsatStars = false,
}) {
  const parts = [
    plainTextToPreviewHtml(saudacao),
    // CSAT usa a linha compacta "Avaliação referente ao protocolo X.", igual ao
    // e-mail real — os demais templates mantêm o card grande de "Atendimento".
    showCsatStars ? '' : buildTicketBoxPreviewHtml(protocolo, titulo),
    plainTextToPreviewHtml(corpo),
  ];
  if (showCsatStars) {
    parts.push(buildCsatProtocoloLinePreviewHtml(protocolo));
    parts.push(buildCsatStarsPreviewHtml());
  }
  parts.push(buildFarewellPreviewHtml(farewellHtml));
  if (signatureHtml) {
    parts.push(`<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;">${signatureHtml}</div>`);
  }
  return wrapPreviewDocument(parts.join('\n'), headerHtml || '');
}
