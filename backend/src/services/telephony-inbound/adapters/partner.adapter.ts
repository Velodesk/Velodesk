/**
 * partner.adapter v1.2.0 — datas externas parseadas como horário civil BRT
 */
import { isContactTelPayload, parseContactTelPayload } from './contact-tel.adapter';
import type { TelephonyCallInput } from '../types';
import { parseExternalTimestampToDate } from '../../dates/brDateTime.util';
import { normalizeBrPhoneLocal } from '../../phone.util';

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

function normalizeCpf(value: string): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 11);
}

function parseLegacyPayload(body: Record<string, unknown>): TelephonyCallInput {
  const nested = (body.call && typeof body.call === 'object' && !Array.isArray(body.call))
    ? body.call as Record<string, unknown>
    : {};
  const client = (body.cliente && typeof body.cliente === 'object' && !Array.isArray(body.cliente))
    ? body.cliente as Record<string, unknown>
    : (body.client && typeof body.client === 'object' && !Array.isArray(body.client))
      ? body.client as Record<string, unknown>
      : {};

  const externalCallId = pickString(body, [
    'externalCallId', 'external_call_id', 'callId', 'call_id', 'id', 'ligacaoId', 'ligacao_id',
  ]) || pickString(nested, ['id', 'callId', 'externalCallId']);

  const startedAt = pickDate(body, ['startedAt', 'started_at', 'inicio', 'startTime', 'dataInicio'])
    ?? pickDate(nested, ['startedAt', 'started_at']);
  const endedAt = pickDate(body, ['endedAt', 'ended_at', 'fim', 'endTime', 'dataFim', 'data', 'dataHora'])
    ?? pickDate(nested, ['endedAt', 'ended_at']);

  let durationSeconds = pickNumber(body, ['durationSeconds', 'duration_seconds', 'duracao', 'duration'])
    ?? pickNumber(nested, ['durationSeconds', 'duration']);
  if (durationSeconds == null && startedAt && endedAt) {
    durationSeconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  }

  const clientPhone = normalizeBrPhoneLocal(pickString(body, ['clientPhone', 'client_phone', 'telefone', 'phone'])
    || pickString(client, ['telefone', 'phone', 'clientPhone']));
  const clientCpf = normalizeCpf(pickString(body, ['clientCpf', 'client_cpf', 'cpf'])
    || pickString(client, ['cpf', 'clientCpf']));
  const clientName = pickString(body, ['clientName', 'client_name', 'nome', 'nomeCliente'])
    || pickString(client, ['nome', 'name', 'clientName']);

  const transcript = pickString(body, ['transcript', 'transcricao', 'transcription', 'texto', 'text'])
    || pickString(nested, ['transcript', 'transcricao']);
  const summary = pickString(body, ['summary', 'resumo', 'synopsis'])
    || pickString(nested, ['summary', 'resumo']);
  const status = pickString(body, ['status', 'outcome', 'resultado']);

  if (!externalCallId) {
    throw new Error('externalCallId é obrigatório');
  }
  if (!startedAt && !endedAt && !status) {
    throw new Error('Informe startedAt, endedAt ou status');
  }
  if (!transcript && !summary && !status) {
    throw new Error('Informe transcript, summary ou status');
  }

  return {
    externalCallId,
    provider: 'telephony-partner',
    startedAt,
    endedAt,
    durationSeconds,
    clientPhone,
    clientCpf,
    clientName,
    transcript,
    summary,
    status: status || undefined,
    outcome: status || pickString(body, ['outcome', 'resultado']) || undefined,
    intent: pickString(body, ['intent', 'intencao', 'motivo']) || undefined,
    sentiment: pickString(body, ['sentiment', 'sentimento']) || undefined,
  };
}

export function parsePartnerTelephonyPayload(body: Record<string, unknown>): TelephonyCallInput {
  if (isContactTelPayload(body)) {
    return parseContactTelPayload(body);
  }
  return parseLegacyPayload(body);
}
