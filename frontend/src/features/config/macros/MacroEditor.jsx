/**
 * MacroEditor v1.0.0 — criar/editar macro de resposta rápida (compose completo, com link)
 * VERSION: v1.0.0 | DATE: 2026-09-03
 */
import React, { useEffect, useRef, useState } from 'react';
import { macrosApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import { htmlHasComposeContent } from '../../../services/desk/composeRichEditor';
import { invalidateMacrosCache } from '../../../services/desk/macrosCache';
import ComposeRichEditor from '../../desk/components/ComposeRichEditor';
import ComposeFormatToolbar, { useComposeFormat } from '../../desk/components/ComposeFormatToolbar';
import ConfigAtivoToggle from '../components/ConfigAtivoToggle';
import { MACRO_PLACEHOLDER_CATALOG } from '../../../services/desk/macroPlaceholders';

export default function MacroEditor({ macroId, onClose, onSaved }) {
  const { showNotification } = useNotifications();
  const editorRef = useRef(null);
  const [nome, setNome] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(Boolean(macroId));
  const [saving, setSaving] = useState(false);

  const format = useComposeFormat({ richEditorRef: editorRef, mode: 'rich' });

  useEffect(() => {
    if (!macroId) return;
    setLoading(true);
    macrosApi.get(macroId)
      .then((data) => {
        setNome(data.nome || '');
        setAtivo(data.ativo !== false);
        setTexto(data.texto || '');
      })
      .catch(() => showNotification('Erro ao carregar macro.', 'error'))
      .finally(() => setLoading(false));
  }, [macroId, showNotification]);

  const handleEditorChange = ({ html }) => setTexto(html);

  const insertPlaceholder = (token) => {
    editorRef.current?.focus();
    editorRef.current?.insertPlainText(token);
    setTexto(editorRef.current?.getHtml() ?? texto);
  };

  const save = async () => {
    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      showNotification('Informe o nome da macro.', 'error');
      return;
    }
    const html = editorRef.current?.getHtml() ?? texto;
    if (!htmlHasComposeContent(html)) {
      showNotification('Informe o texto da macro.', 'error');
      return;
    }
    const payload = { nome: nomeTrim, texto: html, ativo };
    setSaving(true);
    try {
      if (macroId) {
        await macrosApi.update(macroId, payload);
      } else {
        await macrosApi.create(payload);
      }
      invalidateMacrosCache();
      showNotification('Macro salva.', 'success');
      onSaved?.();
      onClose?.();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao salvar macro.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="config-section-body">
        <div className="config-loading" role="status">
          <i className="ti ti-loader-2 config-loading__icon" aria-hidden="true" />
          <span>Carregando macro…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="config-section-body config-editor">
      <button type="button" className="config-action-btn config-action-btn--edit forms-editor-back" onClick={onClose}>
        <i className="ti ti-arrow-left" aria-hidden="true" /> Voltar à lista
      </button>

      <div className="config-subsection config-subsection--product">
        <div className="config-form-grid config-form-grid--product">
          <label className="config-field config-field--produto">
            <span className="config-field__label">Nome da macro</span>
            <input
              type="text"
              className="config-field__input"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Pagamento Antecipado"
            />
          </label>
          <div className="config-field config-field--ativo-toggle">
            <ConfigAtivoToggle ativo={ativo} onChange={setAtivo} />
          </div>
        </div>
      </div>

      <div className="config-subsection">
        <div className="config-subsection__head">
          <h5>Texto da macro</h5>
        </div>
        <p className="config-field__hint">
          Use a barra de formatação para negrito, listas e links clicáveis — o texto é inserido
          no compose do ticket exatamente como aparece aqui, incluindo os links.
        </p>
        <div className="config-macro-placeholders">
          <span className="config-field__label">Inserir placeholder:</span>
          {MACRO_PLACEHOLDER_CATALOG.map((item) => (
            <button
              key={item.key}
              type="button"
              className="config-action-btn config-action-btn--edit config-macro-placeholder-btn"
              title={`Inserir ${item.token} — substituído por "${item.label}" ao usar a macro`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertPlaceholder(item.token)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="desk-crm-ticket-scope crm-compose-editor-zone config-macro-editor-zone">
          <ComposeRichEditor
            ref={editorRef}
            id="macroEditorTexto"
            className="response-textarea config-macro-editor"
            placeholder="Digite o texto da macro…"
            value={texto}
            onFormatStateChange={format.handleFormatStateChange}
            onChange={handleEditorChange}
            onKeyDown={format.handleKeyDown}
          />
          <ComposeFormatToolbar
            applyAction={format.applyAction}
            activeFormats={format.activeFormats}
            variant="public"
            beginLink={format.beginLink}
            applyLink={format.applyLink}
            removeLink={format.removeLink}
          />
        </div>
      </div>

      <div className="config-subsection__head config-macro-editor__footer">
        <button type="button" className="config-action-btn config-action-btn--edit" onClick={onClose} disabled={saving}>
          Cancelar
        </button>
        <button type="button" className="config-action-btn config-action-btn--create" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar macro'}
        </button>
      </div>
    </div>
  );
}
