import Link from 'next/link';
import { getContext, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { OfferingFields } from '@/components/offering-form';
import { periodOptions, programOptions } from '@/lib/options';
import { PriceTag } from '@/components/price-tag';
import { KIND_LABEL } from '@/lib/pricing';
import { OwnerActions } from '@/components/owner-actions';
import { SiteTabs } from '../tabs';
import { createOffering } from '../actions';

export const metadata = { title: 'Cursos y precios' };

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'settings.admin');
  const orgId = requireOrg(ctx);
  const [{ data }, programs, periods, { data: org }] = await Promise.all([
    ctx.supabase.from('catalog_offerings').select('*').eq('organization_id', orgId).order('sort_order').order('created_at'),
    programOptions(ctx), periodOptions(ctx), ctx.supabase.from('organizations').select('base_currency').eq('id', orgId).single(),
  ]);
  const { data: regCfg } = await ctx.supabase.from('organization_settings').select('value').eq('organization_id', orgId).eq('key', 'inscripcion.general').maybeSingle();
  const regOn = !!(regCfg?.value as any)?.enabled;
  const { data: sold } = await ctx.supabase.from('checkout_orders').select('offering_id').eq('organization_id', orgId).eq('status', 'paid');
  return (
    <>
      <PageHeader title="Sitio web y marca" subtitle="Cursos y carreras disponibles: precio normal, descuento y ahorro" />
      <SiteTabs current="cursos" />
      <div className={`mb-4 rounded-xl p-3 text-sm ${regOn ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`} data-testid="estado-inscripcion-web">
        {regOn ? <>📝 La <b>inscripción web</b> está activa: aparece en el menú del sitio y cada curso tiene su botón para inscribirse. <Link className="link" href="/inscripcion" target="_blank">Ver la inscripción</Link></>
          : <>📝 La <b>inscripción web general</b> está desactivada, por eso no aparece «Inscripción» en el menú del sitio. <Link className="link font-semibold" href="/app/inscripciones#inscripcion-web">Activarla aquí</Link>. (Cada curso publicado igual tiene su botón para inscribirse y pagar.)</>}
      </div>
      <details className="card mb-6">
        <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-brand-700">+ Nuevo curso o carrera disponible (con precio y descuento)</summary>
        <div className="border-t border-slate-100 p-5">
          {programs.length && periods.length ? (
            <ActionForm action={createOffering} submitLabel="Crear curso"><OfferingFields programs={programs} periods={periods} currency={org?.base_currency ?? 'CLP'} /></ActionForm>
          ) : <Empty>Primero cree un programa y un periodo en Oferta académica: al comprar, el alumno queda matriculado allí.</Empty>}
        </div>
      </details>
      <Card>{data?.length ? <table className="table"><thead><tr><th>Curso o carrera</th><th>Precio</th><th>Ingreso</th><th>Asignaturas</th><th>Vendidos</th><th>Estado</th><th></th></tr></thead>
        <tbody>{data.map((c: any) => (
          <tr key={c.id}><td><b>{c.title}</b> <Badge>{KIND_LABEL[c.kind] ?? 'Curso'}</Badge><br /><span className="text-xs text-slate-500">/cursos/{c.slug}</span></td><td><PriceTag c={c} /></td>
            <td>{c.admission_mode === 'direct' ? 'Pago inmediato' : 'Con postulación'}</td>
            <td>{(c.section_ids ?? []).length ? <Badge color="green">🎓 {(c.section_ids ?? []).length}</Badge> : <Link href={`/app/sitio/cursos/${c.id}#asignaturas`} className="text-xs font-semibold text-amber-700 hover:underline" data-testid="sin-asignaturas">⚠ Asociar asignaturas</Link>}</td>
            <td>{(sold ?? []).filter((s: any) => s.offering_id === c.id).length}{c.capacity ? ` / ${c.capacity}` : ''}</td>
            <td>{c.is_published ? <Badge color="green">Publicado</Badge> : <Badge>Borrador</Badge>}</td>
            <td className="space-x-2 space-y-1 text-right"><Link className="btn-secondary btn-sm" href={`/app/sitio/cursos/${c.id}`}>Editar</Link>{c.is_published && <Link className="btn-secondary btn-sm" href={`/cursos/${c.slug}`} target="_blank">Ver</Link>}
              {ctx.isOwner && <OwnerActions table="catalog_offerings" id={c.id} active={c.is_published} path="/app/sitio/cursos" name={c.title} />}</td></tr>))}</tbody></table>
        : <Empty>Aún no hay cursos en el catálogo.</Empty>}</Card>
    </>
  );
}
