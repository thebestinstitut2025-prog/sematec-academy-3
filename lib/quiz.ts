/**
 * ✅ Exámenes «pro»: tipos de pregunta, cómo los escribe el profesor y cómo se guardan.
 * Las respuestas correctas se guardan aparte (quiz_answer_keys): el estudiante nunca las recibe.
 */
export const QUIZ_KINDS = [
  { value: 'unica', label: '🔘 Selección única', help: 'Una opción por línea. Marque la correcta con * al inicio.', sample: '*Santiago\nLima\nBogotá' },
  { value: 'multiple', label: '☑ Selección múltiple', help: 'Una opción por línea. Marque todas las correctas con *.', sample: '*Rojo\n*Azul\nVerde\n*Amarillo' },
  { value: 'vf', label: '⚖ Verdadero / falso', help: 'Escriba *Verdadero si es verdadera, o *Falso si es falsa.', sample: '*Verdadero' },
  { value: 'corta', label: '✍ Respuesta corta', help: 'Respuestas aceptadas, una por línea. No importan mayúsculas, tildes ni espacios.', sample: 'Bernardo O’Higgins\nO’Higgins' },
  { value: 'numerica', label: '🔢 Numérica', help: 'Escriba el valor correcto y cuánto margen acepta (0 = exacto).', sample: '' },
  { value: 'completar', label: '🧩 Completar espacios', help: 'En el enunciado ponga cada respuesta entre corchetes: «La capital de Chile es [Santiago]». Varias aceptadas: [Perú|Peru]. Puntaje parcial por espacio.', sample: '' },
  { value: 'ordenar', label: '↕ Ordenar', help: 'Escriba los elementos en el orden CORRECTO, uno por línea. Al estudiante se le muestran desordenados.', sample: 'Inicio\nDesarrollo\nCierre' },
  { value: 'unir', label: '🔗 Unir parejas', help: 'Una pareja por línea: «izquierda = derecha». Al estudiante la columna derecha se le muestra desordenada.', sample: 'Chile = Santiago\nPerú = Lima\nColombia = Bogotá' },
  { value: 'desarrollo', label: '📝 Desarrollo (lo corrige el profesor)', help: 'Respuesta libre. Opcional: escriba aquí la pauta de corrección (solo la ve usted).', sample: '' },
] as const;
export type QuizKind = (typeof QUIZ_KINDS)[number]['value'];
export const KIND_LABEL: Record<string, string> = Object.fromEntries(QUIZ_KINDS.map((k) => [k.value, k.label]));
export const isKind = (k: string): k is QuizKind => QUIZ_KINDS.some((x) => x.value === k);
export const BLANK = '[___]';

export const QUIZ_THEMES: Record<string, { name: string; grad: string; soft: string; ring: string }> = {
  azul: { name: 'Azul', grad: 'from-blue-700 to-indigo-500', soft: 'bg-blue-50 text-blue-900', ring: 'ring-blue-500' },
  verde: { name: 'Verde', grad: 'from-emerald-700 to-teal-500', soft: 'bg-emerald-50 text-emerald-900', ring: 'ring-emerald-500' },
  morado: { name: 'Morado', grad: 'from-violet-700 to-fuchsia-500', soft: 'bg-violet-50 text-violet-900', ring: 'ring-violet-500' },
  naranjo: { name: 'Naranjo', grad: 'from-orange-600 to-amber-500', soft: 'bg-orange-50 text-orange-900', ring: 'ring-orange-500' },
  rosado: { name: 'Rosado', grad: 'from-pink-600 to-rose-400', soft: 'bg-pink-50 text-pink-900', ring: 'ring-pink-500' },
  gris: { name: 'Gris', grad: 'from-slate-700 to-slate-500', soft: 'bg-slate-100 text-slate-900', ring: 'ring-slate-500' },
  turquesa: { name: 'Turquesa', grad: 'from-cyan-700 to-sky-500', soft: 'bg-cyan-50 text-cyan-900', ring: 'ring-cyan-500' },
  rojo: { name: 'Rojo', grad: 'from-red-700 to-rose-500', soft: 'bg-red-50 text-red-900', ring: 'ring-red-500' },
};
export const themeOf = (t?: string | null) => QUIZ_THEMES[t ?? ''] ?? QUIZ_THEMES.azul;
export const themeKey = (t: unknown) => (typeof t === 'string' && t in QUIZ_THEMES ? t : 'azul');

export type ParsedQuestion = { kind: QuizKind; prompt: string; options: string[]; choices: string[] | null; correct: number[]; answer: Record<string, unknown> | null };

function shuffled<T>(a: T[]): number[] {
  const idx = a.map((_, i) => i);
  for (let t = 0; t < 8; t++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    if (idx.length < 2 || idx.some((v, i) => v !== i)) break;   // que no quede igual al orden correcto
  }
  return idx;
}
const lines = (raw: string) => raw.split('\n').map((l) => l.trim()).filter(Boolean);
const cut = (s: string, n = 300) => s.slice(0, n);

/** Lee lo que escribió el profesor y lo deja listo para guardar (lanza Error con un mensaje claro). */
export function parseQuestion(kind: string, promptRaw: string, raw: string, extra: { value?: string | null; tol?: string | null } = {}): ParsedQuestion {
  if (!isKind(kind)) throw new Error('Tipo de pregunta inválido.');
  let prompt = promptRaw.trim().slice(0, 4000);
  if (!prompt) throw new Error('Escriba el enunciado de la pregunta.');
  const L = lines(raw ?? '');
  if (kind === 'unica' || kind === 'multiple' || kind === 'vf') {
    let ls = L;
    if (kind === 'vf') { const t = (ls[0] ?? '').replace(/^\*\s*/, '').toLowerCase().startsWith('v'); ls = [t ? '*Verdadero' : 'Verdadero', t ? 'Falso' : '*Falso']; }
    if (ls.length < 2 || ls.length > 8) throw new Error('Escriba entre 2 y 8 opciones, una por línea.');
    const correct = ls.map((l, i) => (l.startsWith('*') ? i : -1)).filter((i) => i >= 0);
    if (!correct.length) throw new Error('Marque la(s) respuesta(s) correcta(s) con * al inicio de la línea.');
    if (kind === 'unica' && correct.length !== 1) throw new Error('En selección única debe haber exactamente una correcta.');
    return { kind, prompt, options: ls.map((l) => cut(l.replace(/^\*\s*/, ''))), choices: null, correct, answer: null };
  }
  if (kind === 'corta') {
    const acc = L.map((l) => cut(l.replace(/^\*\s*/, ''), 200)).slice(0, 12);
    if (!acc.length) throw new Error('Escriba al menos una respuesta aceptada.');
    return { kind, prompt, options: [], choices: null, correct: [], answer: { accept: acc } };
  }
  if (kind === 'numerica') {
    const v = Number(String(extra.value ?? '').replace(',', '.'));
    const tol = Math.abs(Number(String(extra.tol ?? '0').replace(',', '.')) || 0);
    if (extra.value == null || String(extra.value).trim() === '' || !Number.isFinite(v)) throw new Error('Escriba el valor numérico correcto.');
    return { kind, prompt, options: [], choices: null, correct: [], answer: { value: v, tol } };
  }
  if (kind === 'completar') {
    const blanks: string[][] = [];
    prompt = prompt.replace(/\[([^\]]+)\]/g, (_m, inner: string) => {
      if (inner.trim() === '___') return BLANK;
      blanks.push(inner.split('|').map((x) => cut(x.trim(), 200)).filter(Boolean));
      return BLANK;
    });
    if (!blanks.length) throw new Error('Ponga al menos una respuesta entre corchetes en el enunciado, por ejemplo: «El agua hierve a [100] grados».');
    if (blanks.length > 12) throw new Error('Máximo 12 espacios por pregunta.');
    return { kind, prompt, options: [], choices: null, correct: [], answer: { blanks } };
  }
  if (kind === 'ordenar') {
    if (L.length < 2 || L.length > 12) throw new Error('Escriba entre 2 y 12 elementos, uno por línea, en el orden correcto.');
    const order = shuffled(L);                       // order[k] = posición correcta del elemento mostrado en k
    const options = order.map((i) => cut(L[i]));
    const correct = L.map((_, pos) => order.indexOf(pos)); // correct[pos] = índice mostrado que va en esa posición
    return { kind, prompt, options, choices: null, correct, answer: null };
  }
  if (kind === 'unir') {
    const pairs = L.map((l) => { const i = l.indexOf('='); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null; });
    if (pairs.some((p) => !p || !p[0] || !p[1])) throw new Error('Escriba cada pareja así: «izquierda = derecha».');
    if (pairs.length < 2 || pairs.length > 12) throw new Error('Escriba entre 2 y 12 parejas.');
    const ps = pairs as [string, string][];
    const order = shuffled(ps);
    const choices = order.map((i) => cut(ps[i][1]));
    return { kind, prompt, options: ps.map((p) => cut(p[0])), choices, correct: ps.map((_, i) => order.indexOf(i)), answer: null };
  }
  // desarrollo
  return { kind, prompt, options: [], choices: null, correct: [], answer: L.length ? { guide: cut(L.join('\n'), 2000) } : null };
}

/** Para «Editar»: vuelve a escribir la pregunta como la escribió el profesor. */
export function toTeacherText(x: { kind: string; prompt: string; options: string[]; choices?: string[] | null }, correct: number[], answer: any) {
  const k = x.kind;
  let prompt = x.prompt, text = '', value = '', tol = '';
  if (k === 'unica' || k === 'multiple') text = x.options.map((o, i) => (correct.includes(i) ? '*' : '') + o).join('\n');
  else if (k === 'vf') text = correct.includes(0) ? '*Verdadero' : '*Falso';
  else if (k === 'corta') text = (answer?.accept ?? []).join('\n');
  else if (k === 'numerica') { value = String(answer?.value ?? ''); tol = String(answer?.tol ?? '0'); }
  else if (k === 'completar') { let n = 0; prompt = x.prompt.split(BLANK).reduce((acc, part, i) => (i === 0 ? part : `${acc}[${(answer?.blanks?.[n++] ?? []).join('|')}]${part}`), ''); }
  else if (k === 'ordenar') text = correct.map((i) => x.options[i]).join('\n');
  else if (k === 'unir') text = x.options.map((o, i) => `${o} = ${x.choices?.[correct[i]] ?? ''}`).join('\n');
  else if (k === 'desarrollo') text = answer?.guide ?? '';
  return { prompt, text, value, tol };
}

/** Respuesta correcta, en palabras (para el profesor y la revisión). */
export function correctText(x: { kind: string; options: string[]; choices?: string[] | null }, correct: number[] | null, answer: any): string {
  const k = x.kind;
  if (k === 'unica' || k === 'multiple' || k === 'vf') return (correct ?? []).map((i) => x.options[i]).join(' · ');
  if (k === 'corta') return (answer?.accept ?? []).join(' / ');
  if (k === 'numerica') return answer ? `${answer.value}${Number(answer.tol) ? ` (± ${answer.tol})` : ''}` : '';
  if (k === 'completar') return (answer?.blanks ?? []).map((b: string[], i: number) => `${i + 1}) ${b.join(' / ')}`).join('  ');
  if (k === 'ordenar') return (correct ?? []).map((i) => x.options[i]).join(' → ');
  if (k === 'unir') return x.options.map((o, i) => `${o} = ${x.choices?.[(correct ?? [])[i]] ?? '?'}`).join(' · ');
  if (k === 'desarrollo') return answer?.guide ? `Pauta: ${answer.guide}` : 'La corrige el profesor';
  return '';
}

/** Respuesta del estudiante, en palabras. */
export function givenText(x: { kind: string; options: string[]; choices?: string[] | null }, given: any): string {
  if (given == null || (Array.isArray(given) && !given.length) || given === '') return '— sin responder —';
  const k = x.kind;
  if (k === 'unica' || k === 'multiple' || k === 'vf') return (Array.isArray(given) ? given : []).map((i: number) => x.options[i] ?? '?').join(' · ');
  if (k === 'corta' || k === 'numerica' || k === 'desarrollo') return String(given);
  if (k === 'completar') return (Array.isArray(given) ? given : []).map((g: string, i: number) => `${i + 1}) ${g || '—'}`).join('  ');
  if (k === 'ordenar') return (Array.isArray(given) ? given : []).map((i: number) => x.options[i] ?? '?').join(' → ');
  if (k === 'unir') return x.options.map((o, i) => `${o} = ${Array.isArray(given) && given[i] != null ? x.choices?.[given[i]] ?? '?' : '—'}`).join(' · ');
  return String(given);
}

/** Respuestas del estudiante: solo formas válidas (el servidor corrige igual). */
export function cleanAnswers(raw: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 300)) {
    if (!/^[0-9a-f-]{36}$/i.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 20000);
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map((x) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 100 ? x : typeof x === 'string' ? x.slice(0, 300) : null));
  }
  return out;
}

/** Rúbrica: «Criterio | puntos | descripción» por línea. */
export function parseRubric(raw: string | null): { c: string; max: number; d: string }[] | null {
  const ls = lines(raw ?? '');
  if (!ls.length) return null;
  if (ls.length > 15) throw new Error('La rúbrica puede tener hasta 15 criterios.');
  return ls.map((l) => {
    const [c, p, ...d] = l.split('|').map((x) => x.trim());
    const max = Number((p ?? '').replace(',', '.'));
    if (!c || !Number.isFinite(max) || max <= 0) throw new Error(`Rúbrica: escriba cada criterio así «Criterio | puntos | descripción» (revise: «${l.slice(0, 40)}»).`);
    return { c: c.slice(0, 120), max, d: d.join(' | ').slice(0, 400) };
  });
}
export const rubricText = (r: { c: string; max: number; d?: string }[] | null) => (r ?? []).map((x) => `${x.c} | ${x.max}${x.d ? ` | ${x.d}` : ''}`).join('\n');
