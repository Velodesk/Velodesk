/** emailAssinatura.service v1.0.0 — singleton + imagens GCS */
import { EMAIL_ASSINATURA_CONFIG_KEY, getEmailAssinaturaModel, type IEmailAssinaturaImagem } from '../models/EmailAssinatura';
import {
  buildSignatureGcsPath,
  isValidSignatureObjectKey,
  makeSignatureObjectKey,
  readSignatureImageFromGcs,
  uploadSignatureImageToGcs,
} from './emailSignatureStorage.service';

const IMG_TAG_RE = /<img\b[^>]*>/gi;
const BASE64_IMG_SRC_RE = /data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)/i;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

function extractObjectKey(tag: string): string {
  const dataKey = tag.match(/\bdata-gcs-key\s*=\s*["']([^"']+)["']/i);
  if (dataKey?.[1] && isValidSignatureObjectKey(dataKey[1])) return dataKey[1].trim();
  const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const value = String(src?.[1] ?? '').trim();
  const desk = value.match(/^desk-sig:([a-zA-Z0-9._-]+)$/i);
  if (desk?.[1]) return desk[1];
  return '';
}

/**
 * Assinaturas prontas (exportadas de um editor externo, com <img> em base64 embutido)
 * coladas direto no editor de "Layout de assinatura" chegam aqui como data: URI — sem
 * isso, persistableAssinaturaHtml removeria toda imagem sem data-gcs-key. Sobe cada
 * imagem embutida pro mesmo armazenamento GCS usado no upload manual (Escolher arquivo)
 * e reescreve o <img> pro formato desk-sig: — o resto da tag (alt/width/height/style)
 * fica como está. Se o armazenamento não estiver disponível (ex.: ambiente sem as
 * credenciais do Gmail configuradas), a tag é deixada como está e persistableAssinaturaHtml
 * vai descartá-la — mesmo comportamento de hoje pra imagem sem GCS.
 */
async function autoUploadInlineBase64Images(
  html: string,
): Promise<{ html: string; uploaded: IEmailAssinaturaImagem[] }> {
  const uploaded: IEmailAssinaturaImagem[] = [];
  const tags = String(html || '').match(IMG_TAG_RE) || [];
  let next = String(html || '');

  for (const tag of tags) {
    if (/\bdata-gcs-key\s*=/i.test(tag)) continue;
    const match = tag.match(BASE64_IMG_SRC_RE);
    if (!match) continue;

    const [fullMatch, ext, base64Data] = match;
    const contentType = `image/${ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase()}`;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Data, 'base64');
    } catch {
      continue;
    }
    if (!buffer.length) continue;

    const objectKey = makeSignatureObjectKey(contentType, 'assinatura.png');
    const ok = await uploadSignatureImageToGcs(objectKey, buffer, contentType);
    if (!ok) continue;

    uploaded.push({
      objectKey,
      gcsPath: buildSignatureGcsPath(objectKey),
      contentType,
      filename: objectKey,
    });

    const newTag = tag
      .replace(fullMatch, `desk-sig:${objectKey}`)
      .replace('<img ', `<img data-gcs-key="${objectKey}" `);
    next = next.replace(tag, newTag);
  }

  return { html: next, uploaded };
}

export function persistableAssinaturaHtml(html: string, imagens: IEmailAssinaturaImagem[]): string {
  const known = new Set(imagens.map((item) => item.objectKey));
  return String(html || '').replace(IMG_TAG_RE, (tag) => {
    const key = extractObjectKey(tag);
    if (!key || !known.has(key)) return '';
    const altMatch = tag.match(/\balt\s*=\s*["']([^"']*)["']/i);
    const alt = altMatch?.[1] || 'assinatura';
    // Preserva width/height/style originais quando existem (assinaturas com ícones em
    // tamanho fixo, ex. 20x20) — só cai no genérico "max-width:100%" quando a tag não
    // trazia nenhum dimensionamento próprio (caso do upload manual via "Escolher arquivo").
    const widthMatch = tag.match(/\bwidth\s*=\s*["']?(\d+)["']?/i);
    const heightMatch = tag.match(/\bheight\s*=\s*["']?(\d+)["']?/i);
    const styleMatch = tag.match(/\bstyle\s*=\s*["']([^"']*)["']/i);
    const width = widthMatch ? ` width="${widthMatch[1]}"` : '';
    const height = heightMatch ? ` height="${heightMatch[1]}"` : '';
    const style = styleMatch?.[1] || 'max-width:100%;height:auto;';
    return `<img data-gcs-key="${key}" src="desk-sig:${key}" alt="${alt}"${width}${height} style="${style}" />`;
  });
}

export function collectAssinaturaKeys(html: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  String(html || '').replace(IMG_TAG_RE, (tag) => {
    const key = extractObjectKey(tag);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
    return tag;
  });
  return keys;
}

export function serializeAssinatura(doc: {
  html?: string;
  imagens?: IEmailAssinaturaImagem[];
  updatedBy?: string;
  updatedAt?: Date;
}) {
  return {
    html: doc.html || '',
    imagens: (doc.imagens || []).map((item) => ({
      objectKey: item.objectKey,
      gcsPath: item.gcsPath,
      contentType: item.contentType,
      filename: item.filename,
    })),
    updatedBy: doc.updatedBy || '',
    updatedAt: doc.updatedAt,
  };
}

export async function getEmailAssinatura() {
  const Model = getEmailAssinaturaModel();
  const doc = await Model.findOne({ configKey: EMAIL_ASSINATURA_CONFIG_KEY }).lean().exec();
  if (!doc) {
    return serializeAssinatura({ html: '', imagens: [] });
  }
  return serializeAssinatura(doc);
}

export async function saveEmailAssinatura(payload: { html?: string; imagens?: IEmailAssinaturaImagem[] }, actor: string) {
  const { html: htmlWithUploads, uploaded } = await autoUploadInlineBase64Images(String(payload.html || ''));
  const incoming = [...(Array.isArray(payload.imagens) ? payload.imagens : []), ...uploaded];
  const keysInHtml = collectAssinaturaKeys(htmlWithUploads);
  const imagens = incoming.filter((item) => keysInHtml.includes(item.objectKey));
  for (const key of keysInHtml) {
    if (!imagens.some((item) => item.objectKey === key)) {
      imagens.push({
        objectKey: key,
        gcsPath: buildSignatureGcsPath(key),
        contentType: 'image/png',
        filename: key,
      });
    }
  }
  const html = persistableAssinaturaHtml(htmlWithUploads, imagens);
  const Model = getEmailAssinaturaModel();
  const doc = await Model.findOneAndUpdate(
    { configKey: EMAIL_ASSINATURA_CONFIG_KEY },
    {
      $set: {
        html,
        imagens,
        updatedBy: actor,
      },
      $setOnInsert: { configKey: EMAIL_ASSINATURA_CONFIG_KEY },
    },
    { new: true, upsert: true },
  ).lean().exec();
  return serializeAssinatura(doc || { html, imagens, updatedBy: actor });
}

export async function uploadAssinaturaImagem(file: { buffer: Buffer; mimetype?: string; originalname?: string }) {
  const contentType = String(file.mimetype || 'image/png').toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw new Error('Envie uma imagem PNG, JPG, GIF ou WebP.');
  }
  if (!file.buffer?.length) {
    throw new Error('Arquivo de imagem vazio.');
  }
  if (file.buffer.length > 4 * 1024 * 1024) {
    throw new Error('Imagem muito grande. Tamanho máximo: 4 MB.');
  }
  const objectKey = makeSignatureObjectKey(contentType, file.originalname || 'assinatura.png');
  const ok = await uploadSignatureImageToGcs(objectKey, file.buffer, contentType);
  if (!ok) {
    throw new Error('Não foi possível enviar a imagem para o armazenamento.');
  }
  return {
    objectKey,
    gcsPath: buildSignatureGcsPath(objectKey),
    contentType,
    filename: file.originalname || objectKey,
  };
}

export async function loadAssinaturaImageBuffer(objectKey: string) {
  if (!isValidSignatureObjectKey(objectKey)) return null;
  return readSignatureImageFromGcs(objectKey);
}

export async function buildAssinaturaPreviewHtml(html: string): Promise<string> {
  const keys = collectAssinaturaKeys(html);
  let next = String(html || '');
  for (const key of keys) {
    const loaded = await readSignatureImageFromGcs(key);
    if (!loaded) continue;
    const dataUrl = `data:${loaded.contentType};base64,${loaded.buffer.toString('base64')}`;
    next = next.replace(new RegExp(`desk-sig:${key}`, 'g'), dataUrl);
  }
  return next;
}
