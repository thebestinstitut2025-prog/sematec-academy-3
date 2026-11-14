'use server';
import { getContext } from '@/lib/context';
import { searchLimit } from '@/lib/search-limits';

export type SearchHit = { kind: string; id: string; title: string; subtitle: string; href: string };

/**
 * 🔍 Búsqueda en todo el sistema: solo devuelve lo que el usuario tiene permiso de ver (RLS).
 * Acepta textos largos y varias palabras en cualquier orden («perez juan 12.345.678»): primero busca la frase
 * completa y además cada palabra; los resultados que coinciden con más palabras salen primero. Nunca falla:
 * si una parte de la búsqueda da error, se muestran las demás. Desde 1 letra o número; `full` trae todos los resultados.
 */
export async function searchAll(q: string, full = false): Promise<SearchHit[]> {
  try {
    const text = searchLimit(q);
    if (text.length < 1) return [];
    const ctx = await getContext();
    if (!ctx.orgId) return [];
    const words = [...new Set(text.split(' ').map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter((w) => w.length >= 2))]
      .sort((a, b) => b.length - a.length).slice(0, 6);
    const terms = [...new Set([text.slice(0, 120), ...(words.length > 1 ? words : [])])];
    const run = async (t: string) => {
      const [g, s] = await Promise.allSettled([
        ctx.supabase.rpc('global_search', { p_org: ctx.orgId, p_q: t, p_limit: full ? 5000 : 60, p_per: full ? 2000 : 8 }),
        ctx.supabase.rpc('store_search', { p_org: ctx.orgId, p_q: t, p_per: full ? 2000 : 6 }),
      ]);
      const rows: any[] = [];
      for (const r of [s, g]) if (r.status === 'fulfilled') { if (r.value.error) console.error('[buscar]', r.value.error.message); else rows.push(...(r.value.data ?? [])); }
      return rows;
    };
    const results = await Promise.all(terms.map(run));
    const score = new Map<string, { hit: SearchHit; n: number; order: number }>();
    let order = 0;
    results.forEach((rows, i) => rows.forEach((r) => {
      const key = `${r.kind}:${r.id}`;
      const cur = score.get(key) ?? { hit: { kind: r.kind, id: r.id, title: r.title ?? '', subtitle: r.subtitle ?? '', href: r.href }, n: 0, order: order++ };
      cur.n += i === 0 ? 100 : 1; // la frase completa vale más
      score.set(key, cur);
    }));
    return [...score.values()].sort((a, b) => b.n - a.n || a.order - b.order).slice(0, full ? 10000 : 60).map((x) => x.hit);
  } catch (e) {
    console.error('[buscar]', (e as Error).message);
    return [];
  }
}
