/** gmailAuth v1.0.0 — JWT Gmail API com delegation */
import { google, gmail_v1 } from 'googleapis';
import { env } from '../../config/env';
import {
  getEmailTransportSnapshot,
  isEmailTransportReady,
} from '../emailTransport.service';

export const GMAIL_SCOPE_SEND = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_SCOPE_READONLY = 'https://www.googleapis.com/auth/gmail.readonly';

export async function createGmailClient(scopes: string[]): Promise<gmail_v1.Gmail> {
  if (!isEmailTransportReady()) {
    throw new Error('Gmail API não configurado em desk_config.email_transport');
  }

  const snap = getEmailTransportSnapshot();
  if (!snap) throw new Error('Snapshot de email transport ausente');

  const auth = new google.auth.JWT({
    email: snap.serviceAccountJson.client_email,
    key: snap.serviceAccountJson.private_key,
    scopes,
    subject: snap.delegatedUserEmail,
  });
  await auth.authorize();

  return google.gmail({ version: 'v1', auth });
}

export function getGmailTopicName(): string {
  const projectId = env.gcpProjectId;
  const topic = env.gmailPubsubTopic;
  if (!projectId || !topic) {
    throw new Error('GCP_PROJECT_ID ou GMAIL_PUBSUB_TOPIC ausentes');
  }
  return `projects/${projectId}/topics/${topic}`;
}
