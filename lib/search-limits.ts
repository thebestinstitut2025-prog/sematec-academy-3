/** Límites de la búsqueda: números de 1 a 20 dígitos y textos de 1 a 40 letras. */
export const SEARCH_MAX_DIGITS = 20;
export const SEARCH_MAX_CHARS = 40;

/** ¿Es un número (RUT, teléfono, boleta…)? Acepta espacios, puntos, guiones, +, () y la K del RUT. */
export const isNumberSearch = (t: string) => /^[\d\s.\-+()kK]+$/.test(t.trim()) && /\d/.test(t);

/** Recorta lo escrito a los límites: hasta 20 dígitos si es número; si no, hasta 40 letras. */
export function searchLimit(q: string): string {
  const t = String(q ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (isNumberSearch(t)) {
    let n = 0; let out = '';
    for (const ch of t) { if (/\d/.test(ch)) { if (n >= SEARCH_MAX_DIGITS) break; n++; } out += ch; }
    return out.trim();
  }
  return t.slice(0, SEARCH_MAX_CHARS).trim();
}
