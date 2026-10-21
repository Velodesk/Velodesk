/**
 * ComposeRichEditor v1.6.2 — remove onFocusChange (o esconder-sem-foco era só pro WhatsApp)
 * VERSION: v1.6.2 | DATE: 2026-10-21
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  applyComposeLink,
  captureComposeLinkContext,
  execComposeFormat,
  getPlainOffset,
  htmlToPlainText,
  insertPlainTextInEditor,
  insertImageInEditor,
  readComposeFormatState,
  readEditorHtml,
  removeComposeLink,
  replacePlainTextInEditor,
  setEditorHtml,
} from '../../../services/desk/composeRichEditor';

function wordsOf(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

/** Caractere logo antes do cursor — usado só pra decidir se falta um espaço antes de inserir. */
function getCaretPrecedingChar(root) {
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0) return '';
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return '';
  const probe = range.cloneRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().slice(-1);
}

function withLeadingSpaceIfNeeded(root, text) {
  const prevChar = getCaretPrecedingChar(root);
  const needsSpace = prevChar !== '' && !/\s/.test(prevChar);
  return (needsSpace ? ' ' : '') + text;
}

const ComposeRichEditor = forwardRef(function ComposeRichEditor({
  id,
  className = '',
  placeholder,
  value,
  onChange,
  onKeyDown,
  onFormatStateChange,
  expandable = false,
  readOnly = false,
}, ref) {
  const editorRef = useRef(null);
  const lastHtmlRef = useRef('');
  const dictationSpanRef = useRef(null);
  // Editor expansível abre grande (220px); o botão diminui para o tamanho compacto.
  const [expanded, setExpanded] = useState(expandable);

  const notifyFormatState = useCallback(() => {
    onFormatStateChange?.(readComposeFormatState(editorRef.current));
  }, [onFormatStateChange]);

  const emitChange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    const html = readEditorHtml(root);
    if (html === lastHtmlRef.current) return;
    lastHtmlRef.current = html;
    onChange?.({
      html,
      plainText: htmlToPlainText(html),
      cursor: getPlainOffset(root),
    });
  }, [onChange]);

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    execFormat: (action) => {
      execComposeFormat(editorRef.current, action);
      emitChange();
      requestAnimationFrame(() => notifyFormatState());
    },
    replacePlainRange: (startIndex, deleteCount, insertText) => {
      const ok = replacePlainTextInEditor(editorRef.current, startIndex, deleteCount, insertText);
      if (ok) emitChange();
      return ok;
    },
    insertPlainText: (text) => {
      insertPlainTextInEditor(editorRef.current, text);
      emitChange();
    },
    beginDictation: () => {
      // Início de uma nova sessão de ditado — garante que não sobrou nenhum span de uma vez
      // anterior que por algum motivo não foi limpo.
      const root = editorRef.current;
      const stale = dictationSpanRef.current;
      if (stale && root?.contains(stale)) stale.remove();
      dictationSpanRef.current = null;
    },
    endDictation: () => {
      // Fim definitivo do ditado (erro, desmontagem, ou onend depois do stop manual): qualquer
      // parcial que não virou final é descartado, nunca vira texto de verdade.
      const root = editorRef.current;
      const span = dictationSpanRef.current;
      if (span && root?.contains(span)) span.remove();
      dictationSpanRef.current = null;
    },
    dictateText: (finalTextRaw, interimTextRaw) => {
      const root = editorRef.current;
      if (!root) return;
      const finalText = String(finalTextRaw || '').trim();
      const interimText = String(interimTextRaw || '').trim();
      const spanBeforeFinal = dictationSpanRef.current && root.contains(dictationSpanRef.current)
        ? dictationSpanRef.current
        : null;

      if (finalText) {
        if (spanBeforeFinal) {
          // Remove o span provisório e recoloca o cursor exatamente onde ele estava, senão o
          // texto final entraria no lugar errado.
          const parent = spanBeforeFinal.parentNode;
          const nextSibling = spanBeforeFinal.nextSibling;
          spanBeforeFinal.remove();
          dictationSpanRef.current = null;
          if (parent) {
            const range = document.createRange();
            if (nextSibling) {
              range.setStartBefore(nextSibling);
            } else {
              range.selectNodeContents(parent);
              range.collapse(false);
            }
            range.collapse(true);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
        }
        root.focus();
        const textToInsert = `${withLeadingSpaceIfNeeded(root, finalText)} `;
        try {
          document.execCommand('insertText', false, textToInsert);
        } catch {
          /* execCommand indisponível */
        }
        emitChange();
      }

      if (interimText) {
        // Se acabamos de confirmar um trecho final agora mesmo, o span antigo já foi removido
        // acima — o parcial desta rodada (se vier junto no mesmo evento) começa um span novo.
        const currentSpan = finalText ? null : spanBeforeFinal;
        const currentWords = currentSpan ? wordsOf(currentSpan.textContent) : [];
        const newWords = wordsOf(interimText);
        const isContinuation = Boolean(currentSpan)
          && interimText.toLowerCase().startsWith((currentSpan.textContent || '').trim().toLowerCase());
        // O Chrome às vezes manda um parcial mais curto no meio da frase (se corrigindo) — só
        // ignora quando não é claramente uma continuação do que já estava na tela, pra não
        // "piscar"/encolher o texto à toa.
        const shouldSkip = Boolean(currentSpan) && newWords.length < currentWords.length && !isContinuation;

        if (!shouldSkip) {
          if (currentSpan) {
            // O espaço inicial (se precisou) foi decidido só na criação do span — reaplica
            // aqui, senão some nas atualizações seguintes (o textContent é todo substituído).
            const leadingSpace = currentSpan.dataset.leadingSpace === '1' ? ' ' : '';
            currentSpan.textContent = leadingSpace + interimText;
            const range = document.createRange();
            range.selectNodeContents(currentSpan);
            range.collapse(false);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
          } else {
            root.focus();
            const span = document.createElement('span');
            span.setAttribute('data-dictation-interim', 'true');
            const prefixed = withLeadingSpaceIfNeeded(root, interimText);
            span.dataset.leadingSpace = prefixed.length > interimText.length ? '1' : '0';
            span.textContent = prefixed;
            const selection = window.getSelection();
            if (selection?.rangeCount) {
              const range = selection.getRangeAt(0);
              if (root.contains(range.commonAncestorContainer)) {
                range.deleteContents();
                range.insertNode(span);
                range.setStartAfter(span);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
              } else {
                root.appendChild(span);
              }
            } else {
              root.appendChild(span);
            }
            dictationSpanRef.current = span;
          }
        }
      }
    },
    insertImage: (src, alt, attrs) => {
      const ok = insertImageInEditor(editorRef.current, src, alt, attrs);
      if (ok) emitChange();
      return ok;
    },
    beginLink: () => captureComposeLinkContext(editorRef.current),
    applyLink: (context, url, label) => {
      const ok = applyComposeLink(editorRef.current, context, url, label);
      if (ok) emitChange();
      return ok;
    },
    removeLink: (context) => {
      const ok = removeComposeLink(editorRef.current, context);
      if (ok) emitChange();
      return ok;
    },
    getPlainText: () => htmlToPlainText(readEditorHtml(editorRef.current)),
    getHtml: () => readEditorHtml(editorRef.current),
    getCursor: () => getPlainOffset(editorRef.current),
    getFormatState: () => readComposeFormatState(editorRef.current),
  }), [emitChange, notifyFormatState]);

  useEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const normalized = value || '';
    if (normalized === lastHtmlRef.current) return;

    const currentHtml = readEditorHtml(root);
    const plainCurrent = htmlToPlainText(currentHtml);
    const plainNext = htmlToPlainText(normalized);
    const focused = document.activeElement === root;

    if (focused && normalized !== '') {
      if (plainCurrent === plainNext) {
        lastHtmlRef.current = normalized;
        return;
      }
      // Pai atrasado em relação ao que já está no editor (re-render/poll).
      if (plainCurrent.length >= plainNext.length) {
        return;
      }
    }

    setEditorHtml(root, normalized);
    lastHtmlRef.current = readEditorHtml(root);
  }, [value]);

  useEffect(() => {
    setExpanded(expandable);
  }, [id, expandable]);

  const wrapClass = 'compose-rich-editor-wrap'
    + (expandable ? ' compose-rich-editor-wrap--expandable' : '')
    + (expanded ? ' compose-rich-editor-wrap--expanded' : '');

  return (
    <div className={wrapClass}>
      <div className="compose-rich-editor__surface">
        <div
          ref={editorRef}
          id={id}
          className={'compose-rich-editor response-textarea '
            + className
            + (expanded ? ' compose-rich-editor--expanded' : '')}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-readonly={readOnly || undefined}
          data-placeholder={placeholder || ''}
          data-ai-skip="true"
          lang="pt-BR"
          onInput={() => {
            if (readOnly) return;
            emitChange();
            notifyFormatState();
          }}
          onKeyUp={readOnly ? undefined : notifyFormatState}
          onMouseUp={readOnly ? undefined : notifyFormatState}
          onFocus={readOnly ? undefined : notifyFormatState}
          onKeyDown={readOnly ? undefined : onKeyDown}
          onBlur={readOnly ? undefined : (() => {
            emitChange();
            onFormatStateChange?.({
              bold: false,
              italic: false,
              underline: false,
              bulletList: false,
              numberedList: false,
            });
          })}
          onSelect={readOnly ? undefined : (() => {
            notifyFormatState();
          })}
          onClick={readOnly ? undefined : ((event) => {
            const link = event.target.closest ? event.target.closest('a[href]') : null;
            if (link && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              window.open(link.getAttribute('href'), '_blank', 'noopener,noreferrer');
              return;
            }
            notifyFormatState();
          })}
        />
        {expandable ? (
          <button
            type="button"
            className="compose-rich-editor__expand-btn"
            aria-label={expanded ? 'Diminuir editor' : 'Expandir editor'}
            title={expanded ? 'Diminuir editor' : 'Expandir editor'}
            aria-pressed={expanded}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setExpanded((value) => !value)}
          >
            <i className={'ti ' + (expanded ? 'ti-arrows-minimize' : 'ti-arrows-maximize')} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
});

export default ComposeRichEditor;
