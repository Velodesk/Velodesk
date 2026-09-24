/** gmailInbound.service v1.5.0 — resolve imagens CID/inline no corpo do e-mail */
import { env } from '../../config/env';
import {
  findChamadoForEmailReply,
  processInboundEmail,
} from '../email-inbound.service';
import { collectChamadoAttachmentFingerprints } from '../attachmentFilter.util';
import type { InboundEmailProcessResult } from '../inbound-email/types';
import { createGmailClient, GMAIL_SCOPE_READONLY } from './gmailAuth';
import { gmailMessageToInboundPayload, shouldSkipGmailMessage } from './gmailMessageParser';
import {
  downloadAndRewriteGmailInlineImages,
  downloadGmailAttachments,
} from './gmailAttachment.service';
import {
  getStoredHistoryId,
  updateStoredHistoryId,
} from './gmailWatch.service';
import { getDelegatedUserEmail } from '../emailTransport.service';

export interface GmailPubSubPushBody {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

export interface GmailPushNotification {
  emailAddress?: string;
  historyId?: string;
}

export interface GmailHistoryProcessResult {
  results: InboundEmailProcessResult[];
  hasMore: boolean;
  latestHistoryId: string;
  /** true quando o Gmail já expirou o startHistoryId (retenção de 7 dias) */
  expired?: boolean;
}

export function decodePubSubMessage(body: GmailPubSubPushBody): GmailPushNotification | null {
  const dataB64 = body.message?.data;
  if (!dataB64) return null;
  try {
    const json = Buffer.from(dataB64, 'base64').toString('utf8');
    return JSON.parse(json) as GmailPushNotification;
  } catch {
    return null;
  }
}

/** Orçamento conta apenas trabalho real (ticket criado ou mensagem anexada) */
function isRealWork(action: InboundEmailProcessResult['action']): boolean {
  return action === 'created' || action === 'replied';
}

function budgetExceeded(startedAt: number, workCount: number): boolean {
  if (workCount >= env.gmailInboundMaxMessagesPerPush) return true;
  return Date.now() - startedAt >= env.gmailInboundBudgetMs;
}

export async function processGmailHistory(
  startHistoryId: string,
): Promise<GmailHistoryProcessResult> {
  const gmail = await createGmailClient([GMAIL_SCOPE_READONLY]);
  const delegated = getDelegatedUserEmail();
  const results: InboundEmailProcessResult[] = [];
  let pageToken: string | undefined;
  let latestHistoryId = startHistoryId;
  /** Último record de history integralmente concluído — base do avanço garantido do ponteiro */
  let cursorHistoryId = startHistoryId;
  let completedRecords = 0;
  let workCount = 0;
  let hasMore = false;
  const startedAt = Date.now();

  try {
    do {
      const historyRes = await gmail.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
        pageToken,
      });

      if (historyRes.data.historyId) {
        latestHistoryId = String(historyRes.data.historyId);
      }

      for (const record of historyRes.data.history ?? []) {
        // Corta somente em fronteira de record e só depois de concluir pelo menos um,
        // garantindo que todo push avance o ponteiro.
        if (completedRecords > 0 && budgetExceeded(startedAt, workCount)) {
          hasMore = true;
          break;
        }

        for (const added of record.messagesAdded ?? []) {
          const msgRef = added.message;
          if (!msgRef?.id) continue;

          const full = await gmail.users.messages.get({
            userId: 'me',
            id: msgRef.id,
            format: 'full',
          });

          if (shouldSkipGmailMessage(full.data, delegated)) continue;

          const payload = gmailMessageToInboundPayload(full.data);
          if (!payload) continue;

          const existingForThread = await findChamadoForEmailReply(payload);
          const knownFingerprints = collectChamadoAttachmentFingerprints(existingForThread);
          const inboundAttachments = await downloadGmailAttachments(
            gmail,
            full.data,
            payload.messageId,
            knownFingerprints,
          );
          const { htmlBody: rewrittenHtml, inlineAttachments } = await downloadAndRewriteGmailInlineImages(
            gmail,
            full.data,
            payload.messageId,
            String(payload.htmlBody ?? ''),
          );
          if (rewrittenHtml) {
            payload.htmlBody = rewrittenHtml;
          }
          const merged = [...inboundAttachments];
          for (const inline of inlineAttachments) {
            if (!merged.some((a) => a.url && a.url === inline.url)) {
              merged.push(inline);
            }
          }
          if (merged.length) {
            payload.attachments = merged;
          }

          try {
            const result = await processInboundEmail(payload);
            results.push(result);
            if (isRealWork(result.action)) workCount += 1;
            console.info('[gmailInbound] mensagem processada', {
              historyRecordId: record.id,
              messageId: payload.messageId,
              action: result.action,
              protocolo: result.chamadoProtocolo ?? null,
              anexos: merged.length,
            });
          } catch (err) {
            console.error('[gmailInbound] processInboundEmail falhou:', {
              historyRecordId: record.id,
              messageId: payload.messageId,
              erro: (err as Error).message,
            });
          }
        }

        if (record.id) cursorHistoryId = String(record.id);
        completedRecords += 1;
      }

      if (hasMore) break;
      pageToken = historyRes.data.nextPageToken ?? undefined;
    } while (pageToken);
  } catch (err) {
    const message = (err as Error).message || String(err);
    if (/historyId|404|not found/i.test(message)) {
      console.warn('[gmailInbound] historyId inválido/expirado — realinhamento necessário:', message);
      return { results, hasMore: false, latestHistoryId: startHistoryId, expired: true };
    }
    throw err;
  }

  const nextHistoryId = hasMore ? cursorHistoryId : (latestHistoryId || cursorHistoryId);
  const advanced = await updateStoredHistoryId(nextHistoryId);

  console.info('[gmailInbound] history concluído', {
    startHistoryId,
    nextHistoryId,
    ponteiroAvancou: advanced,
    records: completedRecords,
    trabalhoReal: workCount,
    resultados: results.length,
    hasMore,
    duracaoMs: Date.now() - startedAt,
  });

  return { results, hasMore, latestHistoryId };
}

export async function handleGmailPubSubPush(
  body: GmailPubSubPushBody,
): Promise<{ processed: number; results: InboundEmailProcessResult[]; hasMore: boolean }> {
  if (!env.gmailInboundEnabled) {
    return { processed: 0, results: [], hasMore: false };
  }

  const notification = decodePubSubMessage(body);
  if (!notification?.historyId) {
    console.warn('[gmailInbound] notificação Pub/Sub sem historyId');
    return { processed: 0, results: [], hasMore: false };
  }

  const stored = await getStoredHistoryId();
  const startId = stored ?? String(notification.historyId);

  console.info('[gmailInbound] push recebido', {
    storedHistoryId: stored,
    notificationHistoryId: String(notification.historyId),
    startId,
  });

  const { results, hasMore, expired } = await processGmailHistory(startId);

  if (expired) {
    const target = String(notification.historyId);
    const realigned = await updateStoredHistoryId(target);
    console.warn('[gmailInbound] ponteiro realinhado após expiração do history', {
      de: startId,
      para: target,
      realigned,
    });
  }

  return { processed: results.length, results, hasMore };
}
