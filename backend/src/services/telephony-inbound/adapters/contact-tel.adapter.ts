/**
 * contact-tel.adapter v1.1.0 — datas externas parseadas como horário civil BRT
 */
import type { TelephonyCallInput, TelephonyTranscriptTurn } from '../types';
import { parseExternalTimestampToDate } from '../../dates/brDateTime.util';
import { normalizeBrPhoneLocal } from '../../phone.util';

const NO_TRANSCRIPT_STATUSES = new Set([
  'no_answer',
  'no_answer_timeout',
  'busy',
  'failed',
  'voicemail',
  'invalid_number',
  'cancelled',
  'declined',
  'unreachable',
  'congestion',
  'transfer_unanswered',
  'no_interaction',
  'config_error',
  'timeout',
  'api_timeout',
  'capacity_timeout',
  'operating_window_timeout',
]);

function pickString(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = body[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function pickDate(body: Record<string, unknown>, keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = body[key];
    if (!value) continue;
    const date = parseExternalTimestampToDate(value);
    if (date) return date;
  }
  return undefined;
}

function pickNumber(body: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = body[key];
    if (raw == null || raw === '') continue;
    const num = Number(raw);
    if (Number.isFinite(num) && num >= 0) return Math.round(num);
  }
  return undefined;
}

function pickBoolean(body: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const raw = body[key];
    if (typeof raw === 'boolean') return raw;
  }
  return undefined;
}

function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isContactTelPayload(body: Record<string, unknown>): boolean {
  const id = pickString(body, ['id', 'externalCallId', 'external_call_id']);
  if (!id) return false;
  return Boolean(
    body.call_type
    || body.direction
    || body.segments
    || body.agent_name
    || body.canonical_url,
  );
}

function resolveClientPhone(body: Record<string, unknown>): string {
  const direction = pickString(body, ['direction']).toLowerCase();
  const toNumber = normalizeBrPhoneLocal(pickString(body, ['to_number', 'toNumber']));
  const fromNumber = normalizeBrPhoneLocal(pickString(body, ['from_number', 'fromNumber']));
  if (direction === 'inbound') return fromNumber || toNumber;
  return toNumber || fromNumber;
}

function extractFromVariables(variables: Record<string, unknown>): { name: string; cpf: string } {
  let name = '';
  let cpf = '';
  for (const [key, raw] of Object.entries(variables)) {
    const value = raw == null ? '' : String(raw).trim();
    if (!value) continue;
    const lower = key.toLowerCase();
    if (!name && /nome|name|cliente/.test(lower)) name = value;
    if (!cpf && /cpf|documento|doc/.test(lower)) cpf = normalizeCpf(value);
  }
  return { name, cpf };
}

function extractFromDataCollected(dataCollected: Record<string, unknown>): { name: string; cpf: string; intent: string } {
  let name = '';
  let cpf = '';
  let intent = '';
  for (const [key, raw] of Object.entries(dataCollected)) {
    if (!isRecord(raw)) continue;
    const value = raw.value == null ? '' : String(raw.value).trim();
    if (!value) continue;
    const lower = key.toLowerCase();
    if (!name && /nome|name|cliente/.test(lower)) name = value;
    if (!cpf && /cpf|documento|doc/.test(lower)) cpf = normalizeCpf(value);
    if (!intent && /motivo|intenc|intent|assunto|canal/.test(lower)) intent = value;
  }
  return { name, cpf, intent };
}

function parseTranscriptFull(segment: Record<string, unknown>): TelephonyTranscriptTurn[] {
  const raw = segment.transcript_full;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => isRecord(item))
    .map((item) => ({
      role: pickString(item, ['role']) || 'unknown',
      message: pickString(item, ['message']),
      originalMessage: item.original_message == null ? null : String(item.original_message),
      timeInCallSecs: pickNumber(item, ['time_in_call_secs', 'timeInCallSecs']),
    }))
    .filter((item) => item.message);
}

function joinSegmentTexts(segments: Record<string, unknown>[], field: 'transcript' | 'conversation_summary'): string {
  const parts = segments
    .map((segment) => pickString(segment, field === 'transcript' ? ['transcript', 'transcricao'] : ['conversation_summary', 'summary', 'resumo']))
    .filter(Boolean);
  return parts.join('\n\n').trim();
}

function collectSegments(body: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(body.segments)) return [];
  return body.segments.filter((item) => isRecord(item));
}

export function parseContactTelPayload(body: Record<string, unknown>): TelephonyCallInput {
  const externalCallId = pickString(body, ['id', 'externalCallId', 'external_call_id']);
  const status = pickString(body, ['status']);
  const initiatedAt = pickDate(body, ['initiated_at', 'initiatedAt']);
  const answeredAt = pickDate(body, ['answered_at', 'answeredAt']);
  const endedAt = pickDate(body, ['ended_at', 'endedAt']);
  const createdAt = pickDate(body, ['created_at', 'createdAt']);

  if (!externalCallId) {
    throw new Error('id é obrigatório');
  }
  if (!initiatedAt && !answeredAt && !endedAt && !createdAt && !status) {
    throw new Error('Informe status ou ao menos um timestamp da chamada');
  }

  const segments = collectSegments(body);
  const transcript = joinSegmentTexts(segments, 'transcript')
    || pickString(body, ['transcript', 'transcricao']);
  const summary = joinSegmentTexts(segments, 'conversation_summary')
    || pickString(body, ['summary', 'resumo', 'conversation_summary']);

  const hasUsefulContent = Boolean(transcript || summary || status);
  if (!hasUsefulContent) {
    throw new Error('Payload sem conteúdo útil (transcript, summary ou status)');
  }
  if (!transcript && !summary && status && !NO_TRANSCRIPT_STATUSES.has(status)) {
    throw new Error('Informe transcript ou conversation_summary para chamadas atendidas');
  }

  const variables = isRecord(body.variables) ? body.variables : undefined;
  const dataCollected = isRecord(body.data_collected) ? body.data_collected : undefined;
  const fromVariables = variables ? extractFromVariables(variables) : { name: '', cpf: '' };
  const fromCollected = dataCollected ? extractFromDataCollected(dataCollected) : { name: '', cpf: '', intent: '' };

  const clientPhone = resolveClientPhone(body);
  const clientName = pickString(body, ['campaign_contact_display_name', 'clientName', 'client_name', 'nome'])
    || fromVariables.name
    || fromCollected.name;
  const clientCpf = normalizeCpf(pickString(body, ['clientCpf', 'client_cpf', 'cpf']))
    || fromVariables.cpf
    || fromCollected.cpf;

  let durationSeconds = pickNumber(body, ['duration', 'durationSeconds', 'duration_seconds']);
  const startedAt = initiatedAt ?? answeredAt ?? createdAt;
  if (durationSeconds == null && startedAt && endedAt) {
    durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  }

  const transcriptFull = segments.flatMap((segment) => parseTranscriptFull(segment));
  const transferStarted = pickDate(body, ['telephony_transfer_started_at']);
  const transferAnswered = pickDate(body, ['interaction_answered_at', 'telephony_transfer_connected_at']);

  return {
    externalCallId,
    provider: 'contact-tel',
    canonicalUrl: pickString(body, ['canonical_url', 'canonicalUrl']) || undefined,
    direction: pickString(body, ['direction']) || undefined,
    origin: pickString(body, ['origin']) || undefined,
    callType: pickString(body, ['call_type', 'callType']) || undefined,
    status: status || undefined,
    initiatedAt,
    answeredAt,
    startedAt,
    endedAt: endedAt ?? startedAt,
    durationSeconds,
    ringDuration: pickNumber(body, ['ring_duration', 'ringDuration']),
    clientPhone,
    clientCpf,
    clientName,
    isConverted: pickBoolean(body, ['is_converted', 'isConverted']),
    isOptout: pickBoolean(body, ['is_optout', 'isOptout']),
    isMismatch: pickBoolean(body, ['is_mismatch', 'isMismatch']),
    terminationOrigin: pickString(body, ['termination_origin', 'terminationOrigin']) || undefined,
    agentId: pickString(body, ['agent_id', 'agentId']) || undefined,
    agentName: pickString(body, ['agent_name', 'agentName']) || undefined,
    campaignId: pickString(body, ['campaign_id', 'campaignId']) || undefined,
    campaignName: pickString(body, ['campaign_name', 'campaignName']) || undefined,
    variables,
    dataCollected,
    transcript,
    summary,
    transcriptFull: transcriptFull.length ? transcriptFull : undefined,
    transfer: transferStarted || transferAnswered || pickString(body, ['transfer_destination_type'])
      ? {
          destinationType: pickString(body, ['transfer_destination_type']) || undefined,
          destinationValue: pickString(body, ['transfer_destination_value']) || undefined,
          targetUserName: pickString(body, ['transfer_target_user_name', 'interaction_answered_by_name']) || undefined,
          targetUserExtension: pickString(body, ['transfer_target_user_extension', 'interaction_answered_extension']) || undefined,
          waitMs: pickNumber(body, ['telephony_transfer_wait_ms']),
          answeredByName: pickString(body, ['interaction_answered_by_name']) || undefined,
          answeredAt: transferAnswered,
        }
      : undefined,
    outcome: status || undefined,
    intent: fromCollected.intent || undefined,
  };
}
