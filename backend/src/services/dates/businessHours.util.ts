/**
 * businessHours.util v2.0.0 — voltou a contar horas corridas (revertida a janela útil
 * 08:00–21:00 introduzida na v1.0.0: causava contagens inconsistentes de prazo nos gatilhos
 * de e-mail de saída). As âncoras de prazo (data de referência de cada gatilho) e as demais
 * correções de disparo feitas depois continuam valendo — só a fórmula de tempo decorrido
 * deixou de restringir à janela útil.
 * VERSION: v2.0.0 | DATE: 2026-09-08
 */

/** Tempo decorrido em ms entre start e end (horas corridas, sem janela útil). */
export function businessMsBetween(start: Date, end: Date): number {
  if (!(start instanceof Date) || !(end instanceof Date)) return 0;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end <= start) return 0;
  return end.getTime() - start.getTime();
}

/** Mesma coisa que businessMsBetween, mas em horas fracionárias. */
export function businessHoursBetween(start: Date, end: Date): number {
  return businessMsBetween(start, end) / (60 * 60 * 1000);
}
