/** mailgun.adapter v1.0.0 */
import { parseGenericInboundEmail } from './generic.adapter';
import type { InboundEmailPayload } from '../types';

export function parseMailgunInboundEmail(body: Record<string, unknown>): InboundEmailPayload {
  const payload = parseGenericInboundEmail(body);
  const count = parseInt(String(body['attachment-count'] ?? '0'), 10);
  const attachments = [...(payload.attachments ?? [])];

  for (let i = 1; i <= count; i += 1) {
    const key = `attachment-${i}`;
    const file = body[key];
    if (file && typeof file === 'object' && 'originalname' in (file as object)) {
      const f = file as { originalname?: string; mimetype?: string; buffer?: Buffer };
      attachments.push({
        filename: String(f.originalname ?? `anexo-${i}`).trim(),
        contentType: String(f.mimetype ?? 'application/octet-stream').trim(),
        buffer: Buffer.isBuffer(f.buffer) ? f.buffer : undefined,
      });
    }
  }

  return { ...payload, attachments: attachments.length ? attachments : undefined };
}
