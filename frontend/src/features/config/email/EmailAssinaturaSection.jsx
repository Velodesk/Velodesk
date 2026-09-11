/**
 * EmailAssinaturaSection v1.3.0 — persiste imagem e prévia integral do e-mail
 * VERSION: v1.3.0 | DATE: 2026-08-20
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { emailOutboundApi } from '../../../api/client';
import { useNotifications } from '../../../context/NotificationContext';
import ComposeRichEditor from '../../desk/components/ComposeRichEditor';
import ComposeFormatToolbar, { useComposeFormat } from '../../desk/components/ComposeFormatToolbar';
import { buildOutboundPreviewHtml } from './emailPreviewHtml';

const MAX_BYTES = 4 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.readAsDataURL(file);
  });
}

function bufferToDataUrl(buffer, contentType) {
  const bytes = buffer instanceof Uint8Array
    ? buffer
    : new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${contentType || 'image/png'};base64,${btoa(binary)}`;
}

function extractImgKey(img) {
  const attr = String(img.getAttribute('data-gcs-key') || '').trim();
  if (attr) return attr;
  const src = String(img.getAttribute('src') || '').trim();
  const desk = src.match(/^desk-sig:([a-zA-Z0-9._-]+)$/i);
  return desk?.[1] || '';
}

async function hydrateSignatureHtml(html, imagens) {
  let next = String(html || '');
  const fromDesk = Array.from(next.matchAll(/desk-sig:([a-zA-Z0-9._-]+)/g)).map((match) => match[1]);
  const fromMeta = (imagens || []).map((item) => item.objectKey).filter(Boolean);
  const unique = Array.from(new Set([...fromDesk, ...fromMeta]));
  for (const key of unique) {
    try {
      const res = await emailOutboundApi.signatureAsset(key);
      const contentType = res?.headers?.['content-type'] || imagens.find((item) => item.objectKey === key)?.contentType || 'image/png';
      const dataUrl = bufferToDataUrl(res.data, contentType);
      next = next.split(`desk-sig:${key}`).join(dataUrl);
      const imgRe = new RegExp(`<img([^>]*data-gcs-key="${key}"[^>]*)>`, 'gi');
      next = next.replace(imgRe, (full) => (
        full.includes('data-gcs-key') ? full : full.replace('<img', `<img data-gcs-key="${key}"`)
      ));
    } catch {
      /* preview parcial se o GCS falhar */
    }
  }
  return next;
}

function persistableHtml(html, imagens) {
  const known = new Set((imagens || []).map((item) => item.objectKey));
  const div = document.createElement('div');
  div.innerHTML = String(html || '');
  div.querySelectorAll('img').forEach((img) => {
    const key = extractImgKey(img);
    if (!key || !known.has(key)) {
      img.remove();
      return;
    }
    img.setAttribute('src', `desk-sig:${key}`);
    img.setAttribute('data-gcs-key', key);
  });
  return {
    html: div.innerHTML,
    imagens: (imagens || []).filter((item) => (
      known.has(item.objectKey) && div.querySelector(`img[data-gcs-key="${item.objectKey}"]`)
    )),
  };
}

export default function EmailAssinaturaSection() {
  const { showNotification } = useNotifications();
  const editorRef = useRef(null);
  const [html, setHtml] = useState('');
  const [imagens, setImagens] = useState([]);
  const [layout, setLayout] = useState({ headerHtml: '', farewellHtml: '', signatureHtml: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pastedHtml, setPastedHtml] = useState('');

  const format = useComposeFormat({
    richEditorRef: editorRef,
    mode: 'rich',
    value: html,
    onValueChange: setHtml,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [assinatura, nextLayout] = await Promise.all([
        emailOutboundApi.getAssinatura(),
        emailOutboundApi.layout(),
      ]);
      setImagens(assinatura.imagens || []);
      const hydrated = await hydrateSignatureHtml(
        assinatura.previewHtml || assinatura.html || '',
        assinatura.imagens || [],
      );
      setHtml(hydrated);
      setLayout({
        headerHtml: nextLayout.headerHtml || '',
        farewellHtml: nextLayout.farewellHtml || '',
        signatureHtml: nextLayout.signatureHtml || hydrated,
      });
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Erro ao carregar a assinatura.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImageSelected = async (file) => {
    if (!file?.type?.startsWith('image/')) {
      showNotification('Selecione um arquivo de imagem (PNG, JPG, GIF ou WebP).', 'warning');
      return;
    }
    if (file.size > MAX_BYTES) {
      showNotification('Imagem muito grande. Tamanho máximo: 4 MB.', 'warning');
      return;
    }
    try {
      const uploaded = await emailOutboundApi.uploadAssinaturaImagem(file);
      const dataUrl = await fileToDataUrl(file);
      const inserted = editorRef.current?.insertImage?.(dataUrl, file.name, {
        'data-gcs-key': uploaded.objectKey,
      });
      if (!inserted) {
        showNotification('Não foi possível inserir a imagem no editor.', 'warning');
        return;
      }
      setImagens((prev) => [...prev, uploaded]);
      setHtml(editorRef.current?.getHtml?.() || html);
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível enviar a imagem.', 'error');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let saved;
      if (pasteMode) {
        // HTML colado (ex.: assinatura pronta exportada de um editor externo, com <img>
        // em base64) vai direto pro backend sem o filtro client-side de imagens — o
        // backend sobe cada imagem embutida pro armazenamento e reescreve as tags.
        saved = await emailOutboundApi.saveAssinatura({ html: pastedHtml });
      } else {
        const currentHtml = editorRef.current?.getHtml?.() || html;
        const payload = persistableHtml(currentHtml, imagens);
        if (/<img\b/i.test(currentHtml) && payload.imagens.length === 0) {
          showNotification('A imagem da assinatura não pôde ser gravada. Insira de novo e salve.', 'warning');
          return;
        }
        saved = await emailOutboundApi.saveAssinatura(payload);
      }
      showNotification(
        saved?.imagens?.length
          ? `Assinatura salva com ${saved.imagens.length} imagem(ns).`
          : 'Assinatura salva.',
        'success',
      );
      setPasteMode(false);
      setPastedHtml('');
      await load();
    } catch (err) {
      showNotification(err?.response?.data?.message || 'Não foi possível salvar a assinatura.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const previewHtml = buildOutboundPreviewHtml({
    headerHtml: layout.headerHtml,
    saudacao: 'Olá,',
    corpo: 'Prévia da assinatura como ela entra no e-mail ao cliente.',
    farewellHtml: layout.farewellHtml,
    signatureHtml: html || layout.signatureHtml,
    protocolo: '0100000001',
    titulo: 'Exemplo de assunto do atendimento',
  });

  if (loading) return <p className="config-placeholder-msg">Carregando assinatura…</p>;

  return (
    <div className="config-email-assinatura">
      <div className="config-email-assinatura__editor">
        <p className="config-placeholder-msg">A assinatura entra no final de todos os e-mails ao cliente. Imagens vão para o armazenamento da operação.</p>
        <button
          type="button"
          className="btn btn-link config-email-assinatura__paste-toggle"
          onClick={() => setPasteMode((prev) => !prev)}
        >
          {pasteMode ? '‹ Voltar pro editor visual' : 'Colar HTML pronto (assinatura exportada com links/ícones) ›'}
        </button>
        {pasteMode ? (
          <textarea
            className="config-email-assinatura__paste-area"
            rows={16}
            placeholder="Cole aqui o HTML completo da assinatura (com <img> em base64 e links)…"
            value={pastedHtml}
            onChange={(e) => setPastedHtml(e.target.value)}
          />
        ) : (
          <>
            <ComposeFormatToolbar
              applyAction={format.applyAction}
              activeFormats={format.activeFormats}
              embedded
              onImageSelected={handleImageSelected}
              beginLink={format.beginLink}
              applyLink={format.applyLink}
              removeLink={format.removeLink}
            />
            <ComposeRichEditor
              id="emailAssinaturaEditor"
              ref={editorRef}
              value={html}
              placeholder="Digite a assinatura…"
              onChange={(next) => setHtml(next.html)}
              onKeyDown={format.handleKeyDown}
              onFormatStateChange={format.handleFormatStateChange}
            />
          </>
        )}
        <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSave}>
          {saving ? 'Salvando…' : 'Salvar assinatura'}
        </button>
      </div>
      <div className="config-email-assinatura__preview">
        <h4>Como aparece no e-mail</h4>
        <iframe
          title="Prévia da assinatura"
          className="config-email-preview-frame"
          sandbox=""
          srcDoc={previewHtml}
        />
      </div>
    </div>
  );
}
