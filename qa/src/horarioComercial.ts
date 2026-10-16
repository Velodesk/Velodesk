/**
 * horarioComercial v1.0.0 — horário de atendimento humano (8h–19h, America/Sao_Paulo)
 *
 * Usado pelo X07 ("tickets parados em novo"): fora desse horário, ninguém está de plantão
 * tratando a fila, então backlog da madrugada é esperado e nunca deve virar alerta. Dentro do
 * horário, um ticket que já existia da madrugada só começa a "contar" a partir da abertura do
 * expediente (8h) — não do horário real de criação — senão ele já nasceria "parado há várias
 * horas" assim que o primeiro agente loga, antes de qualquer chance real de ser tratado.
 *
 * Brasil não tem mais horário de verão desde 2019 — America/Sao_Paulo é sempre UTC-3, fixo, sem
 * variação sazonal. Por isso dá pra construir o instante das 8h de hoje com o offset "-03:00"
 * direto, sem precisar de uma lib de timezone.
 */

const TIMEZONE = 'America/Sao_Paulo';
const OFFSET_BRT = '-03:00';

export const HORA_INICIO_EXPEDIENTE = 8;
export const HORA_FIM_EXPEDIENTE = 19;

function horaAtualBrt(agora: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hour: 'numeric', hour12: false }).formatToParts(agora);
  return Number(partes.find((p) => p.type === 'hour')?.value ?? '0');
}

export function estaEmHorarioComercial(agora: Date = new Date()): boolean {
  const hora = horaAtualBrt(agora);
  return hora >= HORA_INICIO_EXPEDIENTE && hora < HORA_FIM_EXPEDIENTE;
}

/** Instante UTC correspondente às 8h de hoje em America/Sao_Paulo. */
export function inicioExpedienteHoje(agora: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const ano = partes.find((p) => p.type === 'year')!.value;
  const mes = partes.find((p) => p.type === 'month')!.value;
  const dia = partes.find((p) => p.type === 'day')!.value;
  return new Date(`${ano}-${mes}-${dia}T${String(HORA_INICIO_EXPEDIENTE).padStart(2, '0')}:00:00${OFFSET_BRT}`);
}

/** Ticket criado antes da abertura do expediente de hoje (ex.: da madrugada). */
export function eraDaMadrugada(createdAt: Date, agora: Date = new Date()): boolean {
  return createdAt.getTime() < inicioExpedienteHoje(agora).getTime();
}

/**
 * "Tempo parado" ajustado: para um ticket da madrugada, conta a partir da abertura do
 * expediente (8h), não da criação real — ex.: criado às 20h de ontem, visto às 10h de hoje,
 * conta como 2h parado (10h − 8h), não como 14h.
 */
export function tempoParadoMs(createdAt: Date, agora: Date = new Date()): number {
  const inicio = inicioExpedienteHoje(agora);
  const base = createdAt.getTime() > inicio.getTime() ? createdAt : inicio;
  return Math.max(0, agora.getTime() - base.getTime());
}

export function formatarHoraBrt(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
