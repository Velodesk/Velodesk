/**
 * useTextFieldDictationTarget — adapta um <textarea>/<input> comum (value + onChange) para o
 * mesmo contrato { focus(), beginDictation(), dictateText(finalText, interimText),
 * endDictation() } que o ref de ComposeRichEditor já expõe, para que
 * useVoiceDictation/VoiceDictationButton possam ser plugados em qualquer campo de texto
 * simples, não só no editor rich-text do compose.
 */
import { useMemo, useRef } from 'react';

function moveCaret(fieldRef, pos) {
  requestAnimationFrame(() => {
    const field = fieldRef?.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(pos, pos);
  });
}

export function useTextFieldDictationTarget({ fieldRef, value, onValueChange }) {
  const latestRef = useRef({ value, onValueChange });
  latestRef.current = { value, onValueChange };
  const dictationRef = useRef(null);

  return useMemo(() => ({
    current: {
      focus: () => fieldRef?.current?.focus(),
      beginDictation: () => {
        const field = fieldRef?.current;
        const pos = field?.selectionStart ?? (latestRef.current.value || '').length;
        dictationRef.current = { anchor: pos, length: 0 };
      },
      endDictation: () => {
        dictationRef.current = null;
      },
      dictateText: (finalTextRaw, interimTextRaw) => {
        const finalText = String(finalTextRaw || '').trim();
        const interimText = String(interimTextRaw || '').trim();

        if (finalText) {
          const chunk = `${finalText} `;
          const tracked = dictationRef.current
            || { anchor: (latestRef.current.value || '').length, length: 0 };
          const current = latestRef.current.value || '';
          const next = current.slice(0, tracked.anchor) + chunk + current.slice(tracked.anchor + tracked.length);
          latestRef.current.onValueChange?.(next);
          const caret = tracked.anchor + chunk.length;
          dictationRef.current = { anchor: caret, length: 0 };
          moveCaret(fieldRef, caret);
        }

        if (interimText) {
          const tracked = dictationRef.current
            || { anchor: (latestRef.current.value || '').length, length: 0 };
          const current = latestRef.current.value || '';
          const next = current.slice(0, tracked.anchor) + interimText + current.slice(tracked.anchor + tracked.length);
          latestRef.current.onValueChange?.(next);
          dictationRef.current = { anchor: tracked.anchor, length: interimText.length };
          moveCaret(fieldRef, tracked.anchor + interimText.length);
        }
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [fieldRef]);
}

export default useTextFieldDictationTarget;
