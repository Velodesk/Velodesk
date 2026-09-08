/**
 * telecom55B2c.adapter v1.1.0 — payload do webhook "55" (call center humano) para
 * abertura de ticket em /api/inbound/telephony/inbound_b2c. Distinto do adapter Contact
 * Tel (partner.adapter.ts) e do parser do painel ao vivo (realtime/telecom55/webhookPayload.ts)
 * — mesmo provedor, propósito e payload diferentes.
 */
import { normalizeBrPhoneLocal } from '../../phone.util';

export interface Telecom55B2cEvent {
  callType: string;
  callStatus: string;
  callTransferId: string;
  callTerminal: string;
  callUrlAudio: string;
  callUra: string;
  callDocument: string;
  callNumber: string;
  branchEmail: string;
}

function pickString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

export function parseTelecom55B2cPayload(body: Record<string, unknown>): Telecom55B2cEvent {
  return {
    callType: pickString(body, 'call_type').toLowerCase(),
    callStatus: pickString(body, 'call_status').toLowerCase(),
    callTransferId: pickString(body, 'call_transfer_id'),
    callTerminal: normalizePhone(pickString(body, 'call_terminal')),
    callUrlAudio: pickString(body, 'call_url_audio'),
    callUra: pickString(body, 'call_ura'),
    callDocument: normalizeCpf(pickString(body, 'call_document')),
    callNumber: normalizeBrPhoneLocal(pickString(body, 'call_number')),
    branchEmail: pickString(body, 'branch_email').toLowerCase(),
  };
}
