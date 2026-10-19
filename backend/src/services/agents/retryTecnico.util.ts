/**
 * retryTecnico.util v1.0.0 — repete uma etapa da IA quando ela falha por motivo técnico
 * VERSION: v1.0.0 | DATE: 2026-10-19
 */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Executa `fn` até `tentativas` vezes enquanto devolver `success: false` ou lançar; devolve o último resultado. */
export async function retryTecnico<T extends { success: boolean }>(
  fn: () => Promise<T>,
  tentativas = 3,
  esperaMs = 1500,
): Promise<T> {
  let ultimo: T | undefined;
  for (let i = 0; i < tentativas; i += 1) {
    if (i > 0) await sleep(esperaMs * i);
    try {
      ultimo = await fn();
      if (ultimo.success) return ultimo;
    } catch (err) {
      if (i === tentativas - 1) throw err;
    }
  }
  return ultimo as T;
}
