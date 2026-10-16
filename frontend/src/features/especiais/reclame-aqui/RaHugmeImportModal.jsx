/**
 * RaHugmeImportModal v1.2.0 — import em background; contador por ticket
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNotifications } from '../../../context/NotificationContext';
import {
  HUGME_ACCEPT,
  downloadErrorReport,
  getActiveHugmeImportJob,
  parseHugmeFile,
  resumeHugmeImportJobIfAny,
  startHugmeImportJob,
  subscribeHugmeImportJob,
} from '../../../services/especiais/hugmeImportService';
import { refreshServerCounts } from '../../../services/especiais/reclameAquiStore';

const STEPS = { upload: 'upload', preview: 'preview', importing: 'importing', done: 'done' };

function StatusBadge({ status }) {
  const map = {
    valid: { label: 'Pronto', cls: 'ra-hugme-badge--valid' },
    invalid: { label: 'Inválido', cls: 'ra-hugme-badge--invalid' },
    duplicate: { label: 'Duplicado', cls: 'ra-hugme-badge--duplicate' },
    created: { label: 'Criado', cls: 'ra-hugme-badge--valid' },
    failed: { label: 'Erro', cls: 'ra-hugme-badge--invalid' },
  };
  const item = map[status] || { label: status, cls: '' };
  return <span className={`ra-hugme-badge ${item.cls}`}>{item.label}</span>;
}

function jobToResult(job) {
  return {
    batchId: job.batchId,
    created: job.created ?? 0,
    stored: job.stored ?? 0,
    inserted: job.inserted ?? 0,
    updated: job.updated ?? 0,
    skipped: job.skipped ?? 0,
    failed: job.failed ?? 0,
    errors: job.errors || [],
  };
}

export default function RaHugmeImportModal({ open, onClose, onComplete }) {
  const { showNotification } = useNotifications();
  const fileInputRef = useRef(null);
  const fileRef = useRef(null);
  const completedBatchRef = useRef('');
  const [step, setStep] = useState(STEPS.upload);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [importResult, setImportResult] = useState(null);
  const stepRef = useRef(step);
  const openRef = useRef(open);
  stepRef.current = step;
  openRef.current = open;

  const reset = useCallback(() => {
    setStep(STEPS.upload);
    setFileName('');
    setPreview(null);
    setParseError('');
    setParsing(false);
    setProgress({ current: 0, total: 0 });
    setElapsedSec(0);
    setImportResult(null);
    fileRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  useEffect(() => {
    if (!open) return;
    const job = getActiveHugmeImportJob();
    if (job?.running) {
      setStep(STEPS.importing);
      setProgress({ current: job.current || 0, total: job.total || 0 });
      return;
    }
    reset();
  }, [open, reset]);

  useEffect(() => {
    resumeHugmeImportJobIfAny();
    return subscribeHugmeImportJob((job) => {
      if (!job) return;
      if (job.running) {
        setProgress({ current: job.current || 0, total: job.total || 0 });
        if (openRef.current) setStep(STEPS.importing);
        return;
      }
      if (!job.justFinished || !job.batchId || completedBatchRef.current === job.batchId) return;
      completedBatchRef.current = job.batchId;
      const result = jobToResult(job);
      setImportResult(result);
      setProgress({ current: job.current || 0, total: job.total || 0 });
      if (openRef.current) setStep(STEPS.done);
      try {
        // Sem baixar a base inteira: atualiza só os cards e pede à lista para refazer a página atual.
        void refreshServerCounts();
        window.dispatchEvent(new CustomEvent('velodesk:ra-sync'));
      } catch {
        // fail-soft na atualização da lista
      }
      onComplete?.(result);
      const msg = `${result.stored} registro(s) processado(s), ${result.created} ticket(s) criado(s)${result.failed ? `, ${result.failed} erro(s)` : ''}.`;
      showNotification(msg, result.failed ? 'warning' : 'success');
    });
  }, [onComplete, showNotification]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (step !== STEPS.importing) return undefined;
    setElapsedSec(0);
    const timer = setInterval(() => setElapsedSec((sec) => sec + 1), 1000);
    return () => clearInterval(timer);
  }, [step]);

  const handleFile = async (file) => {
    if (!file) return;
    fileRef.current = file;
    setParsing(true);
    setParseError('');
    setFileName(file.name);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = await parseHugmeFile(file);
      if (!result?.rows?.length) {
        throw new Error('Nenhuma reclamação encontrada na planilha. Verifique se é o export Hugme "Base Completa".');
      }
      setPreview(result);
      setStep(STEPS.preview);
      if (result.missingColumns.length) {
        showNotification(
          `Colunas não identificadas: ${result.missingColumns.join(', ')}. Verifique o cabeçalho da planilha.`,
          'warning',
        );
      }
    } catch (err) {
      setParseError(err?.message || 'Não foi possível ler a planilha.');
      setPreview(null);
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer?.files?.[0];
    handleFile(file);
  };

  const handleImport = async () => {
    const file = fileRef.current;
    if (!file || !preview?.rows?.length) return;
    const validRows = preview.rows.filter((r) => r.status === 'valid');
    if (!validRows.length) {
      showNotification('Nenhuma linha válida para importar.', 'error');
      return;
    }

    setStep(STEPS.importing);
    setProgress({ current: 0, total: validRows.length });

    try {
      await startHugmeImportJob(file, 'incremental');
    } catch (err) {
      showNotification(err?.response?.data?.message || err?.message || 'Falha na importação.', 'error');
      setStep(STEPS.preview);
    }
  };

  const handleDownloadErrors = () => {
    const failed = importResult?.errors?.length
      ? importResult.errors.map((item) => ({
        rowIndex: item.rowIndex,
        consumidor: item.idOrigem,
        status: 'failed',
        errors: [item.message],
      }))
      : preview?.rows?.filter((r) => r.status !== 'valid') || [];
    if (!failed.length) return;
    downloadErrorReport(failed);
  };

  if (!open) return null;

  const previewRows = preview?.rows?.slice(0, 50) || [];
  const hasMorePreview = (preview?.rows?.length || 0) > 50;
  const progressPct = progress.total
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return createPortal(
    <>
      <button
        type="button"
        className="queue-box-modal__backdrop"
        aria-label="Fechar importação"
        onClick={onClose}
      />
      <div
        className="queue-box-modal queue-box-modal--wide ra-hugme-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="raHugmeModalTitle"
      >
        <header className="queue-box-modal__header">
          <div className="queue-box-modal__head-main">
            <span className="queue-box-modal__icon" aria-hidden="true">
              <i className="ti ti-file-spreadsheet" />
            </span>
            <div>
              <h2 className="queue-box-modal__title" id="raHugmeModalTitle">
                Importar planilha Hugme
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="queue-box-modal__close"
            onClick={onClose}
            aria-label="Fechar"
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </header>

        <div className="queue-box-modal__body ra-hugme-modal__body">
          {step === STEPS.upload && (
            <>
              <div
                className="upload-area ra-hugme-upload"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
              >
                <i className="ti ti-cloud-upload ra-hugme-upload__icon" aria-hidden="true" />
                <p className="ra-hugme-upload__title">
                  {parsing ? 'Lendo planilha…' : 'Arraste a planilha ou clique para selecionar'}
                </p>
                <p className="ra-hugme-upload__hint">Formatos: .xlsx, .xls, .csv</p>
                {fileName ? <p className="ra-hugme-upload__file">{fileName}</p> : null}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept={HUGME_ACCEPT}
                className="ra-hugme-upload__input"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              {parseError ? <p className="ra-hugme-error">{parseError}</p> : null}
            </>
          )}

          {step === STEPS.preview && preview && (
            <>
              <div className="ra-hugme-stats">
                <span><strong>{preview.stats.total}</strong> linhas</span>
                <span className="ra-hugme-stats__valid"><strong>{preview.stats.valid}</strong> prontas</span>
                <span className="ra-hugme-stats__warn"><strong>{preview.stats.duplicate}</strong> duplicadas</span>
                <span className="ra-hugme-stats__err"><strong>{preview.stats.invalid}</strong> inválidas</span>
              </div>

              <div className="ra-hugme-preview-wrap">
                <table className="ra-hugme-preview">
                  <thead>
                    <tr>
                      <th>Linha</th>
                      <th>Status</th>
                      <th>Consumidor</th>
                      <th>Assunto</th>
                      <th>ID RA</th>
                      <th>Obs.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row) => (
                      <tr key={row.rowIndex} className={`ra-hugme-preview__row--${row.status}`}>
                        <td>{row.rowIndex}</td>
                        <td><StatusBadge status={row.status} /></td>
                        <td>{row.form.consumidor || '—'}</td>
                        <td>{row.form.assunto || row.form.descricao || '—'}</td>
                        <td>{row.form.idReclamacaoRa || row.form.protocoloRa || '—'}</td>
                        <td>{row.errors?.join('; ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMorePreview ? (
                <p className="ra-hugme-preview-more">
                  Exibindo 50 de {preview.rows.length} linhas.
                </p>
              ) : null}
            </>
          )}

          {step === STEPS.importing && (
            <div className="ra-hugme-progress">
              <p className="ra-hugme-progress__label">
                {progress.current} / {progress.total}
              </p>
              <div className="ra-hugme-progress__track">
                <div
                  className="ra-hugme-progress__bar"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="ra-hugme-progress__hint">{elapsedSec}s</p>
            </div>
          )}

          {step === STEPS.done && importResult && (
            <div className="ra-hugme-result">
              <div className="ra-hugme-stats">
                <span className="ra-hugme-stats__valid">
                  <strong>{importResult.stored ?? importResult.created}</strong> processados
                </span>
                <span className="ra-hugme-stats__valid">
                  <strong>{importResult.created}</strong> tickets novos
                </span>
                <span className="ra-hugme-stats__warn">
                  <strong>{importResult.skipped}</strong> ignorados
                </span>
                <span className="ra-hugme-stats__err">
                  <strong>{importResult.failed}</strong> erros
                </span>
              </div>
              {(importResult.errors?.length > 0) ? (
                <button
                  type="button"
                  className="btn-secondary ra-hugme-download-btn"
                  onClick={handleDownloadErrors}
                >
                  <i className="ti ti-download" aria-hidden="true" /> Baixar relatório de erros
                </button>
              ) : null}
            </div>
          )}
        </div>

        <footer className="queue-box-modal__footer">
          {step === STEPS.upload && (
            <button type="button" className="btn-secondary queue-box-modal__btn" onClick={onClose}>
              Cancelar
            </button>
          )}

          {step === STEPS.preview && (
            <>
              <button
                type="button"
                className="btn-secondary queue-box-modal__btn"
                onClick={() => { reset(); }}
              >
                Trocar arquivo
              </button>
              <button
                type="button"
                className="btn-primary queue-box-modal__btn"
                onClick={handleImport}
                disabled={!preview?.stats?.valid}
              >
                Importar {preview.stats.valid} linha(s)
              </button>
            </>
          )}

          {step === STEPS.importing && (
            <button type="button" className="btn-secondary queue-box-modal__btn" onClick={onClose}>
              Fechar
            </button>
          )}

          {step === STEPS.done && (
            <button type="button" className="btn-primary queue-box-modal__btn" onClick={onClose}>
              Fechar
            </button>
          )}
        </footer>
      </div>
    </>,
    document.body,
  );
}
