/**
 * WhatsappMensagensSection — registro de modelos de mensagem (templates) exigidos pela
 * Meta pra iniciar uma conversa com o cliente ou reativar uma janela de 24h já encerrada.
 */
import React, { useEffect, useState } from 'react';
import WhatsappTemplateEditor from './WhatsappTemplateEditor';

export default function WhatsappMensagensSection({ onNestedViewChange }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    onNestedViewChange?.(creating);
    return () => onNestedViewChange?.(false);
  }, [creating, onNestedViewChange]);

  if (creating) {
    return <WhatsappTemplateEditor onClose={() => setCreating(false)} />;
  }

  return (
    <div className="config-whatsapp-templates">
      <div className="config-whatsapp-templates__head">
        <p className="config-placeholder-msg">
          Modelos aprovados pela Meta, usados pra iniciar uma conversa com o cliente ou
          reativar uma conversa cuja janela de 24h já encerrou.
        </p>
        <button type="button" className="config-action-btn config-action-btn--create" onClick={() => setCreating(true)}>
          Criar modelo
        </button>
      </div>

      <label className="config-whatsapp-templates__search">
        <i className="ti ti-search" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar modelo pelo nome…"
        />
      </label>

      <div className="config-whatsapp-templates__list">
        <p className="config-placeholder-msg">Nenhum modelo cadastrado ainda.</p>
      </div>
    </div>
  );
}
