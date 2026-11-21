import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ContinuousVideo } from '@/components/continuous-video';

export const dynamic = 'force-dynamic';

/** Ver la grabación: los participantes la ven; descargar, enviar y cortar es solo para personas autorizadas. */
export default async function VerGrabacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const { data: r } = await ctx.supabase.from('conference_recordings').select('id, session_id, filename, group_id, duration_sec').eq('id', id).maybeSingle();
  if (!r) notFound();
  const { data: allowed } = await ctx.supabase.rpc('can_manage_recordings', { p_session: r.session_id });
  // Todas las partes de la misma grabación: se ven como un solo video continuo
  const { data: group } = r.group_id
    ? await ctx.supabase.from('conference_recordings').select('id, part_no, duration_sec').eq('group_id', r.group_id).eq('status', 'available').order('part_no')
    : { data: null };
  const parts = (group?.length ? group : [{ id: r.id, part_no: 1, duration_sec: r.duration_sec }]).map((p: any, i: number) => ({ id: p.id, n: p.part_no ?? i + 1, secs: Number(p.duration_sec) || 0 }));
  const start = Math.max(0, parts.findIndex((p) => p.id === r.id));
  const name = parts.length > 1 ? String(r.filename ?? 'Grabación').replace(/ - parte \d+(\.\w+)?$/, '$1').replace(/\.webm$|\.mp4$/, '') + ' (clase completa)' : r.filename ?? 'Grabación';
  return (
    <div>
      <PageHeader title={`▶ ${name}`} actions={<span className="flex gap-2">
        {allowed && <Link className="btn-primary" href={`/app/conferencias/grabacion/${id}/editar`}>✂ Cortar, descargar o enviar</Link>}
        <Link className="btn-secondary" href={`/app/conferencias/${r.session_id}`}>← Volver</Link></span>} />
      <Card><ContinuousVideo parts={parts} start={start} allowDownload={!!allowed} /></Card>
    </div>
  );
}
