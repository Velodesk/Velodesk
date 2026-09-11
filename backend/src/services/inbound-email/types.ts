/** inbound-email/types v1.4.0 — scanStatus opcional no anexo */
export interface InboundEmailAttachment {
  filename: string;
  contentType: string;
  url?: string;
  gcsUri?: string;
  storageKey?: string;
  contentHash?: string;
  bytes?: number;
  scanStatus?: string;
}

export interface InboundEmailPayload {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  from: { email: string; name?: string };
  to: string[];
  subject: string;
  textBody: string;
  htmlBody?: string;
  attachments?: InboundEmailAttachment[];
  receivedAt: Date;
  autoSubmitted?: string;
}

export type InboundEmailProcessAction = 'created' | 'replied' | 'duplicate' | 'skipped';

export interface InboundEmailProcessResult {
  action: InboundEmailProcessAction;
  chamadoProtocolo?: string;
  ticketId?: string;
  reason?: 'spam' | 'ignored' | 'bounce';
  messageId?: string;
}
