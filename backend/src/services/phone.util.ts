/**
 * phone.util v1.0.0 — normalização única de telefone BR: remove símbolos e o código de país
 * (+55) quando presente, garantindo que o número armazenado comece sempre no DDD.
 */

/** Remove tudo que não for dígito. */
export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Remove o DDI 55 quando presente. Só 12/13 dígitos totais indicam DDI — um número local
 * (DDD + telefone) nunca chega a esse tamanho sozinho — então não há ambiguidade com DDDs que
 * também começam em "55" (ex. Santa Maria/RS, que tem 11 dígitos no total com DDI ausente).
 */
export function stripBrCountryCode(digits: string): string {
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Normaliza um telefone de qualquer fonte (webhook de telefonia, cadastro, formulário) para
 * DDD + número local, descartando o +55 quando presente — indiferente ao formato de entrada
 * ("+55 (15) 99877-6655", "5515998776655", "(15) 99877-6655" etc.).
 */
export function normalizeBrPhoneLocal(value: unknown): string {
  return stripBrCountryCode(normalizePhoneDigits(value));
}
