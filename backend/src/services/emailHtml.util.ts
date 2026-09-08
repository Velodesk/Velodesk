/** emailHtml.util v1.2.0 — preserva hyperlinks (<a href>) no HTML do e-mail outbound */
const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li', 'img', 'a']);

export function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainTextForEmail(raw: string): string {
  const text = String(raw ?? '');
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;

  return decodeBasicHtmlEntities(
    text
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeComposeHtmlForEmail(html: string): string {
  let result = String(html ?? '');
  result = result.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, '');
  result = result.replace(/<\s*br\s*\/?>/gi, '<br>');

  const imgs: string[] = [];
  result = result.replace(/<\s*img\b[^>]*>/gi, (full) => {
    const srcMatch = full.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const src = String(srcMatch?.[1] ?? '').trim();
    if (!src) return '';
    // cid: após extractComposeInlineImages; data:image não deve sobrar no e-mail
    if (/^cid:[^\s"']+$/i.test(src)) {
      const token = `__EMAIL_IMG_${imgs.length}__`;
      imgs.push(`<img src="${src}" alt="imagem" style="max-width:100%;height:auto" />`);
      return token;
    }
    return '';
  });

  result = result.replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>/gi, (_full, slash, name, attrs) => {
    const tag = String(name).toLowerCase();
    if (!ALLOWED_TAGS.has(tag) || tag === 'img') return '';
    if (tag === 'br' && slash) return '';
    if (tag === 'a') {
      if (slash) return '</a>';
      const hrefMatch = String(attrs ?? '').match(/\bhref\s*=\s*["']([^"']+)["']/i);
      const href = String(hrefMatch?.[1] ?? '').trim();
      if (!/^https?:\/\//i.test(href)) return '';
      return `<a href="${escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${slash ? '/' : ''}${tag}>`;
  });

  imgs.forEach((img, i) => {
    result = result.replace(`__EMAIL_IMG_${i}__`, img);
  });

  return result.replace(/(<br>){3,}/gi, '<br><br>').trim();
}

function markdownToEmailHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

export function composeHtmlToEmailHtml(raw: string): string {
  const input = String(raw ?? '').trim();
  if (!input) return '';

  const html = /<[a-z][\s\S]*>/i.test(input)
    ? sanitizeComposeHtmlForEmail(input)
    : markdownToEmailHtml(input);

  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#333">${html}</div>`;
}

export function escapeHtmlAttribute(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
