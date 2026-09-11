/** Data civil em America/Sao_Paulo (YYYY-MM-DD). */
export function getBrasiliaDateString(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Converte string vinda do PostgREST/Supabase em Date.
 * Sem sufixo Z ou ±offset, o JS no servidor (UTC) interpretaria o valor como UTC e
 * a exibição em America/Sao_Paulo ficaria 3 h menor — tratamos como horário civil BRT.
 */
export function parseDbTimestampAsInstant(raw: string): Date {
  const s = String(raw).trim().replace(' ', 'T');
  if (!s) return new Date(NaN);
  if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s) || /[+-]\d{4}$/.test(s)) {
    return new Date(s);
  }
  return new Date(`${s}-03:00`);
}

/** Início/fim do dia em BRT como ISO UTC (BRT = UTC−3, sem horário de verão). */
export function brasiliaDayBoundsUtc(dateStr: string): { startIso: string; endIso: string } {
  const startIso = `${dateStr}T03:00:00.000Z`;
  const end = new Date(`${dateStr}T03:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { startIso, endIso: end.toISOString() };
}

/** Início e fim do mês civil em BRT como ISO UTC (BRT = UTC−3). `month`: 1–12. */
export function brasiliaMonthBoundsUtc(year: number, month: number): { fromIso: string; toIso: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const first = `${year}-${pad(month)}-01`;
  const { startIso } = brasiliaDayBoundsUtc(first);
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const nextStart = brasiliaDayBoundsUtc(`${nextY}-${pad(nextM)}-01`).startIso;
  const end = new Date(nextStart);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { fromIso: startIso, toIso: end.toISOString() };
}

export function currentBrasiliaYearMonth(): { year: number; month: number } {
  const d = new Date();
  const ym = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).format(d);
  const [y, m] = ym.split('-');
  return { year: parseInt(y, 10), month: parseInt(m, 10) };
}

const WD_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** 0 = domingo … 6 = sábado (alinhado a operator_weekly_schedules.day_of_week). */
export function weekdayBrazil(dateStr: string): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  }).format(parseDbTimestampAsInstant(`${dateStr}T12:00:00`));
  return WD_MAP[label] ?? 0;
}

export function parseTimeToMinutes(t: string): number {
  const s = String(t).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function formatIsoTimeBr(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parseDbTimestampAsInstant(iso));
}

export function minutesFromIsoBr(iso: string): number {
  const s = formatIsoTimeBr(iso);
  const [h, m] = s.split(':').map((x) => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

/**
 * operator_events (55): o relógio civil de Brasília costuma ser persistido como timestamptz
 * “com Z”, sendo interpretado como UTC — exibir e comparar pelo HH:MM literal do registro.
 */
export function formatEventStoredWallClock(raw: string): string {
  const s = String(raw).trim().replace(' ', 'T');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return formatIsoTimeBr(raw);
  return `${m[2].padStart(2, '0')}:${m[3]}`;
}

export function minutesFromEventStoredWallClock(raw: string): number {
  const s = String(raw).trim().replace(' ', 'T');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
  if (!m) return minutesFromIsoBr(raw);
  return parseInt(m[2], 10) * 60 + parseInt(m[3], 10);
}

/** Ordenar eventos pelo instante literal gravado (data + hora no ISO, sem aplicar fuso). */
export function compareEventWallClock(a: string, b: string): number {
  const norm = (raw: string) =>
    String(raw)
      .trim()
      .replace(' ', 'T')
      .replace(/[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/, '')
      .replace(/\.\d+/, '');
  return norm(a).localeCompare(norm(b));
}

function calendarPartsInTimeZone(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return {
    year: parseInt(m.year, 10),
    month: parseInt(m.month, 10),
    day: parseInt(m.day, 10),
    hour: parseInt(m.hour, 10),
    minute: parseInt(m.minute, 10),
    second: parseInt(m.second, 10),
  };
}

/**
 * Mesmo "dt_local" usado em get_projecoes_* e get_intrahorario_data (mig. 068 / 104):
 * (timestamp AT TIME ZONE 'America/Sao_Paulo')::timestamp + interval '3 hours'.
 * Compensa sync em que o horário civil BRT foi gravado como UTC.
 */
export function callsRawBusinessLocalInstant(d: Date): Date {
  const c = calendarPartsInTimeZone(d, 'America/Sao_Paulo');
  return new Date(Date.UTC(c.year, c.month - 1, c.day, c.hour + 3, c.minute, c.second));
}

export function callsRawBusinessYearMonthFromInstant(d: Date): string {
  const t = callsRawBusinessLocalInstant(d);
  const y = t.getUTCFullYear();
  const mo = t.getUTCMonth() + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

export function callsRawBusinessYearFromInstant(d: Date): number {
  return callsRawBusinessLocalInstant(d).getUTCFullYear();
}

/** Janela UTC ampla para trazer todas as linhas que podem cair no ano civil de negócio (BRT + regra calls_raw). */
export function callsRawUtcRangeForBusinessCalendarYear(ano: number): {
  fromIso: string;
  toIsoExclusive: string;
} {
  return {
    fromIso: `${ano - 1}-12-20T00:00:00.000Z`,
    toIsoExclusive: `${ano + 1}-01-15T00:00:00.000Z`,
  };
}

/** YYYY-MM do relógio civil em Brasília (Octadesk / timestamptz real). */
export function brasiliaYearMonthFromInstant(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  const mo = String(parseInt(m.month, 10)).padStart(2, '0');
  return `${m.year}-${mo}`;
}
