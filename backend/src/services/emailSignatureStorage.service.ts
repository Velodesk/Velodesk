/** emailSignatureStorage v1.0.0 — imagens em gs://velodesk_resources/mail_signature_img */
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import { google } from 'googleapis';
import { env } from '../config/env';
import { getEmailTransportSnapshot } from './emailTransport.service';

const GCS_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';
const OBJECT_KEY_RE = /^[a-zA-Z0-9._-]+$/;

function normalizePrefix(prefix: string): string {
  return String(prefix || '').trim().replace(/^\/+|\/+$/g, '');
}

export function getEmailResourcesBucket(): string {
  return String(env.gcpEmailResourcesBucket || '').trim();
}

export function getEmailSignaturePrefix(): string {
  return normalizePrefix(env.gcpEmailSignaturePrefix || 'mail_signature_img');
}

/**
 * Só depende do bucket estar configurado: o acesso ao GCS vem da identidade do runtime
 * (ADC), não da conta do transporte de e-mail — exigir isEmailTransportReady() aqui
 * bloqueava o upload da assinatura sempre que o Gmail ainda não tivesse subido, mesmo
 * com o armazenamento perfeitamente acessível. Se nem ADC nem o fallback JWT existirem,
 * createStorageClient() falha e o upload/leitura já retorna false/null de forma segura.
 */
export function isEmailSignatureStorageConfigured(): boolean {
  return Boolean(getEmailResourcesBucket());
}

export function isValidSignatureObjectKey(key: string): boolean {
  return OBJECT_KEY_RE.test(String(key || '').trim());
}

export function buildSignatureGcsPath(objectKey: string): string {
  return `${getEmailSignaturePrefix()}/${String(objectKey || '').trim()}`;
}

/**
 * Autenticação no GCS pela identidade do próprio runtime (Application Default Credentials):
 * no Cloud Run isso resolve pra service account anexada ao serviço
 * (278491073220-compute@developer.gserviceaccount.com), que é quem tem permissão de escrita
 * no bucket de recursos. A conta do transporte de e-mail (email-service@...) é só de
 * leitura/envio de e-mail via Gmail API — usá-la aqui resultava em "upload falhou" por
 * falta de permissão no bucket. Mantém fallback pro JWT antigo se ADC não estiver
 * disponível (ex.: execução local fora do GCP), preservando o comportamento anterior.
 */
async function createStorageClient() {
  try {
    const auth = new google.auth.GoogleAuth({ scopes: [GCS_SCOPE] });
    await auth.getClient(); // falha cedo se não houver ADC no ambiente
    return google.storage({ version: 'v1', auth });
  } catch (err) {
    console.warn(
      '[emailSignatureStorage] ADC indisponível, usando service account do transporte:',
      (err as Error).message,
    );
  }

  const snap = getEmailTransportSnapshot();
  if (!snap) throw new Error('Service account indisponível para GCS');

  const auth = new google.auth.JWT({
    email: snap.serviceAccountJson.client_email,
    key: snap.serviceAccountJson.private_key,
    scopes: [GCS_SCOPE],
  });
  await auth.authorize();
  return google.storage({ version: 'v1', auth });
}

function extensionFromContentType(contentType: string, originalName: string): string {
  const fromName = String(originalName || '').split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  return map[String(contentType || '').toLowerCase()] || 'png';
}

export function makeSignatureObjectKey(contentType: string, originalName: string): string {
  return `${randomUUID()}.${extensionFromContentType(contentType, originalName)}`;
}

export async function uploadSignatureImageToGcs(
  objectKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<boolean> {
  if (!isEmailSignatureStorageConfigured()) return false;
  if (!isValidSignatureObjectKey(objectKey)) return false;

  try {
    const storage = await createStorageClient();
    const name = buildSignatureGcsPath(objectKey);
    await storage.objects.insert({
      bucket: getEmailResourcesBucket(),
      requestBody: {
        name,
        contentType: String(contentType || 'image/png').trim(),
      },
      media: {
        mimeType: String(contentType || 'image/png').trim(),
        body: Readable.from(buffer),
      },
    });
    return true;
  } catch (err) {
    console.error('[emailSignatureStorage] upload falhou:', {
      objectKey,
      bucket: getEmailResourcesBucket(),
      error: (err as Error).message,
    });
    return false;
  }
}

export async function readSignatureImageFromGcs(
  objectKey: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!isEmailSignatureStorageConfigured()) return null;
  if (!isValidSignatureObjectKey(objectKey)) return null;

  try {
    const storage = await createStorageClient();
    const res = await storage.objects.get(
      {
        bucket: getEmailResourcesBucket(),
        object: buildSignatureGcsPath(objectKey),
        alt: 'media',
      },
      { responseType: 'stream' },
    );
    const stream = res.data as unknown as Readable;
    if (!stream) return null;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const contentType = String(res.headers?.['content-type'] || 'image/png').trim();
    return { buffer: Buffer.concat(chunks), contentType };
  } catch (err) {
    const message = (err as Error).message || '';
    if (!/404|not found|no such object/i.test(message)) {
      console.warn('[emailSignatureStorage] leitura falhou:', { objectKey, error: message });
    }
    return null;
  }
}
