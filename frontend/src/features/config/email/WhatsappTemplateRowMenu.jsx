/**
 * WhatsappTemplateRowMenu — menu "..." de ações por linha (Visualizar/Editar/Arquivar/Excluir),
 * no lugar dos botões fixos antigos.
 */
import React, { useEffect, useRef, useState } from 'react';

export default function WhatsappTemplateRowMenu({ onVisualizar, onEditar, isArquivado, onToggleArquivar, onExcluir }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const runAndClose = (fn) => () => {
    setOpen(false);
    fn?.();
  };

  return (
    <div className="config-whatsapp-row-menu" ref={rootRef}>
      <button
        type="button"
        className="config-whatsapp-row-menu__trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="Mais ações"
      >
        <i className="ti ti-dots" aria-hidden="true" />
      </button>

      {open && (
        <div className="config-whatsapp-row-menu__dropdown" role="menu">
          <button type="button" role="menuitem" onClick={runAndClose(onVisualizar)}>
            Visualizar
          </button>
          <button type="button" role="menuitem" onClick={runAndClose(onEditar)}>
            Editar
          </button>
          <button type="button" role="menuitem" onClick={runAndClose(onToggleArquivar)}>
            {isArquivado ? 'Desarquivar' : 'Arquivar'}
          </button>
          <button type="button" role="menuitem" className="config-whatsapp-row-menu__item--delete" onClick={runAndClose(onExcluir)}>
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}
