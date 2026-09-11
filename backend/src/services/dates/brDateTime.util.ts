/**
 * brDateTime.util v1.0.0 — parse/persistência e bounds de dia civil em America/Sao_Paulo
 * VERSION: v1.0.0 | DATE: 2026-08-18
 */
import { brasiliaDayBoundsUtc, parseDbTimestampAsInstant } from './brasilDay';

export const BRT_OFFSET = '-03:00';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Converte dd/mm/yyyy ou yyyy-mm-dd em Date com horário civil BRT explícito. */
export function parseBrCivilDateToDate(
  value: string,
  options: { endOfDay?: boolean; hour?: number; minute?: number; second?: number; ms?: number } = {},
): Date | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  const slash = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3]);
    const endOfDay = options.endOfDay === true;
    const hour = options.hour ?? (endOfDay ? 23 : 12);
    const minute = options.minute ?? (endOfDay ? 59 : 0);
    const second = options.second ?? (endOfDay ? 59 : 0);
    const ms = options.ms ?? (endOfDay ? 999 : 0);
    const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}.${String(ms).padStart(3, '0')}${BRT_OFFSET}`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const { startIso, endIso } = brasiliaDayBoundsUtc(raw);
    const date = new Date(options.endOfDay ? endIso : startIso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  return undefined;
}

/** Converte dd/mm/yyyy [hh:mm] em ISO UTC (instante real). */
export function parseBrCivilDateTimeToIso(value: string): string | undefined {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = match[4] != null ? Number(match[4]) : 12;
  const minute = match[5] != null ? Number(match[5]) : 0;
  const iso = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00${BRT_OFFSET}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/** Alias legível para parsers inbound (retorna ISO). */
export function parseBrSlashDateToIso(value: string, endOfDay = false): string | undefined {
  const date = parseBrCivilDateToDate(value, { endOfDay });
  return date?.toISOString();
}

/** Filtro/busca: YYYY-MM-DD como bounds do dia civil BRT. */
export function parseDateOnlyBrBound(raw: string, endOfDay = false): Date | null {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const { startIso, endIso } = brasiliaDayBoundsUtc(s);
  const date = new Date(endOfDay ? endIso : startIso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Soma dias civis em BRT e fixa horário (default 18:00 BRT para prazos). */
export function addBrCivilDaysIso(
  iso: string,
  days: number,
  options: { hour?: number; minute?: number } = {},
): string {
  const base = new Date(iso);
  if (Number.isNaN(base.getTime())) return iso;
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
  const [y, m, d] = dayKey.split('-').map(Number);
  const target = new Date(`${y}-${pad2(m)}-${pad2(d)}T12:00:00${BRT_OFFSET}`);
  target.setUTCDate(target.getUTCDate() + days);
  const targetKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);
  const hour = options.hour ?? 18;
  const minute = options.minute ?? 0;
  return new Date(`${targetKey}T${pad2(hour)}:${pad2(minute)}:00${BRT_OFFSET}`).toISOString();
}

/**
 * Timestamp de payload externo → Date.
 * Com offset/Z: instante real. Sem offset: horário civil BRT.
 */
export function parseExternalTimestampToDate(value: unknown): Date | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const date = parseDbTimestampAsInstant(raw.replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Início/fim do dia civil BRT como Date (queries Mongo). */
export function brDayBoundsAsDates(dateStr: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const { startIso, endIso } = brasiliaDayBoundsUtc(dateStr);
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

/** Início do dia civil BRT para um instante (Date). */
export function startOfBrDay(date: Date): Date {
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return new Date(brasiliaDayBoundsUtc(dayKey).startIso);
}

/** Fim do dia civil BRT para um instante (Date). */
export function endOfBrDay(date: Date): Date {
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return new Date(brasiliaDayBoundsUtc(dayKey).endIso);
}
