import type { getContext } from '@/lib/context';

type Ctx = Awaited<ReturnType<typeof getContext>>;

/**
 * 👩‍🏫 Secciones donde enseña el usuario: como titular, co-profesor, ayudante o en algún horario.
 * Si la actualización de la base aún no está instalada, usa solo el profesor titular.
 */
export async function myTeachingSectionIds(ctx: Ctx): Promise<string[]> {
  if (!ctx.teacherId) return [];
  const { data, error } = await ctx.supabase.rpc('my_teaching_sections');
  if (!error && Array.isArray(data)) return data.map((x: unknown) => (typeof x === 'string' ? x : (x as { my_teaching_sections: string }).my_teaching_sections)).filter(Boolean);
  const { data: own } = await ctx.supabase.from('sections').select('id').eq('teacher_id', ctx.teacherId);
  return (own ?? []).map((s: { id: string }) => s.id);
}

/** Para usar con .in('id', …) sin que una lista vacía traiga todo. */
export const idsOrNone = (ids: string[]) => (ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);

export const TEACHER_ROLES: Record<string, string> = { titular: 'Titular', coprofesor: 'Co-profesor', ayudante: 'Ayudante' };
