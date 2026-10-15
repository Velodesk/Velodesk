/**
 * composeRichEditor v1.0.5 — preserva data-gcs-key e desk-sig nas imagens
 * VERSION: v1.0.5 | DATE: 2026-08-20
 */

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'IMG', 'A']);

const SAFE_LINK_PROTOCOL_RE = /^(https?:|mailto:)/i;

/** Normaliza texto digitado num link (sem protocolo, e-mail, "www.") para uma URL segura. */
export function normalizeComposeLinkUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (SAFE_LINK_PROTOCOL_RE.test(raw)) return raw;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return `mailto:${raw}`;
  return `https://${raw.replace(/^\/+/, '')}`;
}

export const COMPOSE_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

export function isAllowedComposeImageSrc(src) {
  const value = String(src || '').trim();
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(value)
    || /^https:\/\/.+/i.test(value)
    || /^\/api\/uploads\/inbound\/[^\s"'<>]+$/i.test(value)
    || /^desk-sig:[a-zA-Z0-9._-]+$/i.test(value);
}

const FORMAT_COMMANDS = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  bulletList: 'insertUnorderedList',
  numberedList: 'insertOrderedList',
};

export function htmlToPlainText(html) {
  if (!html || !/<[a-z][\s\S]*>/i.test(html)) return String(html || '');
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  return (div.innerText || div.textContent || '').replace(/\u00A0/g, ' ');
}

/** Considera conte\u00FAdo v\u00E1lido texto OU imagem embutida \u2014 innerText ignora <img>, ent\u00E3o uma
 * nota s\u00F3 com imagem colada teria texto puro vazio e ficaria travada como "nota vazia". */
export function htmlHasComposeContent(html) {
  const raw = String(html || '');
  if (!raw) return false;
  if (/<img\b/i.test(raw)) return true;
  return Boolean(htmlToPlainText(raw).trim());
}

/** Texto plano normalizado para comparar compose vs revisão IA (html ou plain). */
export function normalizeComposePlain(value) {
  const raw = String(value ?? '');
  const plain = /<[a-z][\s\S]*>/i.test(raw) ? htmlToPlainText(raw) : raw;
  return plain.replace(/\r\n/g, '\n').replace(/\u00A0/g, ' ').trim();
}

export function composeTextHasFormatting(value) {
  return /(\*\*.+?\*\*|_.+?_|<(?:b|strong|i|em|u)\b)/i.test(String(value || ''));
}

export function normalizePlainToHtml(text) {
  const raw = String(text || '');
  if (!raw) return '';
  if (/<[a-z][\s\S]*>/i.test(raw)) return sanitizeComposeHtml(raw);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br />');
}

export function sanitizeComposeHtml(html) {
  try {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');

    const walk = (node, depth = 0) => {
      if (!node || depth > 48) return;
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          const el = child;
          if (el.tagName === 'A') {
            const href = String(el.getAttribute('href') || '').trim();
            if (!SAFE_LINK_PROTOCOL_RE.test(href)) {
              const parent = el.parentNode;
              if (parent) {
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
              }
              el.remove();
              return;
            }
            [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noopener noreferrer');
            el.className = 'compose-inline-link';
            walk(el, depth + 1);
            return;
          }
          if (el.tagName === 'IMG') {
            const src = el.getAttribute('src') || '';
            if (!isAllowedComposeImageSrc(src)) {
              el.remove();
              return;
            }
            const alt = String(el.getAttribute('alt') || 'Imagem anexada').slice(0, 200);
            const gcsKey = String(el.getAttribute('data-gcs-key') || '').trim();
            [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
            el.setAttribute('src', src);
            el.setAttribute('alt', alt);
            el.className = 'compose-inline-image';
            if (/^[a-zA-Z0-9._-]+$/.test(gcsKey)) {
              el.setAttribute('data-gcs-key', gcsKey);
            } else {
              const fromSrc = src.match(/^desk-sig:([a-zA-Z0-9._-]+)$/i);
              if (fromSrc?.[1]) el.setAttribute('data-gcs-key', fromSrc[1]);
            }
            return;
          }
          if (!ALLOWED_TAGS.has(el.tagName)) {
            const parent = el.parentNode;
            if (parent) {
              while (el.firstChild) parent.insertBefore(el.firstChild, el);
            }
            el.remove();
            return;
          }
          [...el.attributes].forEach((attr) => el.removeAttribute(attr.name));
          walk(el, depth + 1);
          return;
        }
        if (child.nodeType === Node.COMMENT_NODE) {
          child.remove();
        }
      });
    };

    walk(template.content);
    return template.innerHTML.replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, '<br />');
  } catch (err) {
    console.warn('[composeRichEditor] sanitizeComposeHtml falhou', err);
    return '';
  }
}

/** Serializa nós DOM — DocumentFragment não expõe innerHTML. */
function domNodesToHtml(root) {
  if (!root) return '';
  const wrapper = document.createElement('div');
  while (root.firstChild) {
    wrapper.appendChild(root.firstChild);
  }
  return wrapper.innerHTML;
}

/** Normaliza HTML salvo pelo editor para exibição fiel na thread (listas + parágrafos após lista). */
export function normalizeMessageHtmlForDisplay(html) {
  try {
  const raw = String(html ?? '').trim();
  if (!raw) return '';

  const safe = sanitizeComposeHtml(raw);
  if (!safe) return '';

  const template = document.createElement('template');
  template.innerHTML = safe;

  const root = template.content;
  const blockAfterList = (list) => {
    let next = list.nextSibling;
    while (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'BR') {
      const toRemove = next;
      next = next.nextSibling;
      toRemove.remove();
    }
    if (!next) return;

    if (next.nodeType === Node.TEXT_NODE && String(next.textContent || '').trim()) {
      const p = document.createElement('p');
      p.textContent = next.textContent;
      next.replaceWith(p);
      return;
    }

    if (next.nodeType !== Node.ELEMENT_NODE) return;
    const el = next;
    if (el.tagName === 'DIV' && !el.querySelector('ol, ul, img')) {
      const p = document.createElement('p');
      p.innerHTML = el.innerHTML;
      el.replaceWith(p);
    }
  };

  root.querySelectorAll('ol, ul').forEach(blockAfterList);

  root.querySelectorAll('li').forEach((li) => {
    li.querySelectorAll('div').forEach((div) => {
      if (div.querySelector('ol, ul, img')) return;
      const br = document.createElement('br');
      while (div.firstChild) {
        br.before(div.firstChild);
      }
      div.replaceWith(br);
    });
  });

  return domNodesToHtml(root).replace(/<div>\s*<br\s*\/?>\s*<\/div>/gi, '<br />');
  } catch (err) {
    console.warn('[composeRichEditor] normalizeMessageHtmlForDisplay falhou', err);
    return '';
  }
}

export function execComposeFormat(root, action) {
  if (!root) return;
  root.focus();
  const command = FORMAT_COMMANDS[action];
  if (!command) return;
  try {
    document.execCommand(command, false, null);
  } catch {
    /* execCommand indisponível */
  }
}

/** Estado ativo das formatações na seleção/cursor atual */
export function readComposeFormatState(root) {
  if (!root || document.activeElement !== root) {
    return {
      bold: false,
      italic: false,
      underline: false,
      bulletList: false,
      numberedList: false,
    };
  }
  const query = (command) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };
  return {
    bold: query('bold'),
    italic: query('italic'),
    underline: query('underline'),
    bulletList: query('insertUnorderedList'),
    numberedList: query('insertOrderedList'),
  };
}

export function getPlainOffset(root) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return root ? htmlToPlainText(root.innerHTML).length : 0;
  const range = selection.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

function getRangeAtPlainOffset(root, startIndex, deleteCount) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode = null;
  let startOff = 0;
  let endNode = null;
  let endOff = 0;
  const endIndex = startIndex + deleteCount;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent?.length || 0;
    if (startNode == null && startIndex <= offset + len) {
      startNode = node;
      startOff = startIndex - offset;
    }
    if (endIndex <= offset + len) {
      endNode = node;
      endOff = endIndex - offset;
      break;
    }
    offset += len;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  return range;
}

export function replacePlainTextInEditor(root, startIndex, deleteCount, insertText) {
  if (!root) return false;
  const range = getRangeAtPlainOffset(root, startIndex, deleteCount);
  if (!range) return false;
  range.deleteContents();
  range.insertNode(document.createTextNode(insertText));
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

export function insertPlainTextInEditor(root, text) {
  if (!root) return;
  root.focus();
  const value = String(text || '');
  if (!value) return;
  try {
    document.execCommand('insertText', false, value);
  } catch {
    root.innerHTML = sanitizeComposeHtml((root.innerHTML || '') + normalizePlainToHtml(value));
  }
}

export function insertImageInEditor(root, src, alt = 'Imagem anexada', attrs = {}) {
  if (!root || !isAllowedComposeImageSrc(src)) return false;

  root.focus();
  const img = document.createElement('img');
  img.src = src;
  img.alt = String(alt || 'Imagem anexada').slice(0, 200);
  img.className = 'compose-inline-image';
  const gcsKey = String(attrs?.['data-gcs-key'] || '').trim();
  if (/^[a-zA-Z0-9._-]+$/.test(gcsKey)) {
    img.setAttribute('data-gcs-key', gcsKey);
  }

  const selection = window.getSelection();
  if (selection?.rangeCount) {
    const range = selection.getRangeAt(0);
    if (root.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
  }

  if (root.lastChild && root.lastChild.nodeName !== 'BR') {
    root.appendChild(document.createElement('br'));
  }
  root.appendChild(img);
  return true;
}

/** Captura a seleção/link atual antes de abrir o popover de link — o range é clonado para
 * sobreviver ao foco saindo do editor quando o usuário clica nos campos do popover. */
export function captureComposeLinkContext(root) {
  const empty = { href: '', label: '', range: null, anchor: null };
  if (!root) return empty;
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return empty;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return empty;

  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  const anchor = node?.closest?.('a');
  const validAnchor = anchor && root.contains(anchor) ? anchor : null;

  return {
    href: validAnchor ? (validAnchor.getAttribute('href') || '') : '',
    label: validAnchor ? (validAnchor.textContent || '') : range.toString(),
    range: range.cloneRange(),
    anchor: validAnchor,
  };
}

/** Aplica (insere ou edita) um link a partir do contexto capturado por captureComposeLinkContext. */
export function applyComposeLink(root, context, url, label) {
  if (!root) return false;
  const href = normalizeComposeLinkUrl(url);
  if (!href) return false;
  root.focus();

  const selection = window.getSelection();
  const anchor = context?.anchor && root.contains(context.anchor) ? context.anchor : null;
  const range = !anchor && context?.range && root.contains(context.range.commonAncestorContainer)
    ? context.range
    : null;

  const link = document.createElement('a');
  link.setAttribute('href', href);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  link.textContent = String(label || '').trim() || href;

  if (anchor) {
    anchor.replaceWith(link);
  } else if (range) {
    range.deleteContents();
    range.insertNode(link);
  } else {
    if (root.lastChild && root.lastChild.nodeName !== 'BR') {
      root.appendChild(document.createElement('br'));
    }
    root.appendChild(link);
  }

  const afterRange = document.createRange();
  afterRange.setStartAfter(link);
  afterRange.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(afterRange);
  return true;
}

/** Remove o link do contexto capturado, preservando o texto. */
export function removeComposeLink(root, context) {
  if (!root || !context?.anchor || !root.contains(context.anchor)) return false;
  root.focus();
  const anchor = context.anchor;
  const parent = anchor.parentNode;
  if (!parent) return false;

  const frag = document.createDocumentFragment();
  let lastNode = null;
  while (anchor.firstChild) {
    lastNode = anchor.firstChild;
    frag.appendChild(lastNode);
  }
  parent.replaceChild(frag, anchor);

  const selection = window.getSelection();
  if (selection && lastNode) {
    const range = document.createRange();
    range.setStartAfter(lastNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}

export function setEditorHtml(root, html) {
  if (!root) return;
  const next = sanitizeComposeHtml(normalizePlainToHtml(html));
  if (root.innerHTML !== next) {
    root.innerHTML = next || '';
  }
}

export function readEditorHtml(root) {
  return sanitizeComposeHtml(root?.innerHTML || '');
}
