import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requirePerm } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { OfferingFields } from '@/components/offering-form';
import { periodOptions, programOptions } from '@/lib/options';
import { setOfferingSections, updateOffering, uploadCourseImage } from '../../actions';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getContext();
  requirePerm(ctx, 'settings.admin');
  const { data: c } = await ctx.supabase.from('catalog_offerings').select('*').eq('id', id).maybeSingle();
  if (!c) notFound();
  const [programs, periods, { data: secs }] = await Promise.all([programOptions(ctx), periodOptions(ctx),
    ctx.supabase.from('sections').select('id, code, period_id, status, courses(name, code), academic_periods(name)').eq('organization_id', c.organization_id).eq('status', 'active').order('code').limit(400)]);
  const chosen: string[] = c.section_ids ?? [];
  const list = ((secs ?? []) as any[]).sort((a, b) => Number(b.period_id === c.period_id) - Number(a.period_id === c.period_id) || String(a.courses?.name).localeCompare(String(b.courses?.name)));
  return (
    <>
      <PageHeader title={c.title} subtitle="Editar curso del catálogo" actions={<Link className="btn-secondary" href="/app/sitio/cursos">Volver</Link>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Datos del curso" className="xl:col-span-2">
          <ActionForm action={updateOffering} submitLabel="Guardar cambios" resetOnSuccess={false}>
            <input type="hidden" name="id" value={c.id} />
            <OfferingFields d={c} programs={programs} periods={periods} currency={c.currency} />
          </ActionForm>
        </Card>
        <Card title="🎓 Asignaturas donde queda inscrito" className="xl:col-span-2" id="asignaturas">
          <p className="mb-3 text-sm text-slate-600">Quien compre este curso o lo elija en la inscripción web queda matriculado y, además, inscrito en estas asignaturas: las ve en su aula virtual, con notas y asistencia.</p>
          {c.section_ids === undefined ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Falta instalar la actualización «Inscripción cursos» en «⬆ Actualizar sistema».</p> : list.length === 0
            ? <p className="text-sm text-slate-500">Aún no hay secciones. Créelas en <Link className="link" href="/app/secciones">Secciones</Link> y vuelva aquí.</p> : (
            <ActionForm action={setOfferingSections} submitLabel="Guardar asignaturas" resetOnSuccess={false}>
              <input type="hidden" name="id" value={c.id} />
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2" data-testid="secciones-curso">{list.map((x) => (
                <label key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" name="section_ids" value={x.id} defaultChecked={chosen.includes(x.id)} data-testid="seccion-curso" />
                  <span className="font-semibold">{x.courses?.name}</span><span className="text-xs text-slate-500">{x.courses?.code} · sección {x.code} · {x.academic_periods?.name}</span>
                  {x.period_id === c.period_id && <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">mismo periodo</span>}
                </label>))}</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enroll_now" data-testid="inscribir-anteriores" /> Inscribir también ahora a quienes ya compraron o se inscribieron en este curso</label>
            </ActionForm>)}
        </Card>
        <Card title="Imagen">
          {c.image_asset_id && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/media/${c.image_asset_id}`} alt="" className="mb-4 w-full rounded object-cover" />
          )}
          <ActionForm action={uploadCourseImage} submitLabel="Subir imagen">
            <input type="hidden" name="id" value={c.id} />
            <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
