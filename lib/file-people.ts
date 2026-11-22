import 'server-only';
import type { getContext } from '@/lib/context';
import type { PickOpt } from '@/components/people-picker';
import { idsOrNone, myTeachingSectionIds } from '@/lib/teaching';

type Ctx = Awaited<ReturnType<typeof getContext>>;

/** Personas con quienes el usuario puede compartir (las mismas a quienes puede escribir), sus grupos y sus cursos. */
export async function sharingOptions(ctx: Ctx) {
  const orgId = ctx.orgId!;
  const [{ data: rec }, { data: grp }] = await Promise.all([
    ctx.supabase.rpc('message_recipients', { p_org: orgId }),
    ctx.supabase.from('people_groups').select('id, name, people_group_members(user_id)').eq('owner_id', ctx.user.id).order('name'),
  ]);
  const people: PickOpt[] = ((rec ?? []) as { user_id: string; full_name: string; role_name: string }[])
    .map((r) => ({ value: r.user_id, label: r.full_name, hint: r.role_name, group: r.role_name }));
  const groups = ((grp ?? []) as { id: string; name: string; people_group_members: { user_id: string }[] }[])
    .map((g) => ({ id: g.id, name: g.name, count: g.people_group_members?.length ?? 0, members: g.people_group_members.map((m) => m.user_id) }));
  const sections: { value: string; label: string }[] = [];
  if (ctx.teacherId) {
    const { data: s } = await ctx.supabase.from('sections').select('id, code, courses(name)').in('id', idsOrNone(await myTeachingSectionIds(ctx))).eq('status', 'active');
    for (const x of (s ?? []) as any[]) sections.push({ value: x.id, label: `${x.courses?.name ?? ''} (${x.code})` });
  }
  if (ctx.studentId) {
    const { data: s } = await ctx.supabase.from('section_enrollments').select('sections(id, code, courses(name))').eq('student_id', ctx.studentId).neq('status', 'dropped');
    for (const x of (s ?? []) as any[]) if (x.sections && !sections.some((y) => y.value === x.sections.id)) sections.push({ value: x.sections.id, label: `${x.sections.courses?.name ?? ''} (${x.sections.code})` });
  }
  return { people, groups, sections };
}
