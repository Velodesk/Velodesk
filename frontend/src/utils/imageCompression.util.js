/**
 * imageCompression.util v1.0.0 — redimensiona/recomprime fotos grandes antes do upload
 */

/** Fotos abaixo disso já são leves o bastante — recomprimir só perderia qualidade à toa. */
const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.82;

/** GIF fica de fora (recomprimir perderia a animação); demais formatos comuns de foto entram. */
const COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function loadDecodableImage(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Reduz resolução/qualidade de uma foto grande antes do upload — mesma ideia que o próprio
 * WhatsApp já aplica quando você manda uma foto por lá. Continua sendo uma imagem normal
 * (JPEG), só mais leve; nunca vira zip/arquivo compactado. Falha ao decodificar (ex.: HEIC sem
 * suporte no navegador) devolve o arquivo original — a compressão nunca deve bloquear o envio.
 */
export async function compressImageFileIfNeeded(file, options = {}) {
  const maxDimension = options.maxDimension || DEFAULT_MAX_DIMENSION;
  const quality = options.quality || DEFAULT_QUALITY;

  if (!file || !COMPRESSIBLE_TYPES.has(file.type)) return file;
  if (file.size <= SKIP_BELOW_BYTES) return file;

  let source;
  try {
    source = await loadDecodableImage(file);
    const width = source.width || source.naturalWidth || 0;
    const height = source.height || source.naturalHeight || 0;
    if (!width || !height) return file;

    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.\w+$/, '') || 'imagem';
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    if (source?.close) source.close();
  }
}

/** Aplica a compressão em cada arquivo da lista — uma falha isolada não afeta os demais. */
export async function compressImageFilesIfNeeded(files, options = {}) {
  return Promise.all((files || []).map((file) => compressImageFileIfNeeded(file, options)));
}
