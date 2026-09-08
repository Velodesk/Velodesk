/**
 * ComposeRichEditor v1.3.0 — remove estado de erros ortográficos legado
 * VERSION: v1.3.0 | DATE: 2026-08-21
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
  const [expanded, setExpanded] = useState(false);

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
    setExpanded(false);
  }, [id]);

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
            aria-label={expanded ? 'Recolher editor' : 'Expandir editor'}
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
