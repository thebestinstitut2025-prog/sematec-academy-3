import { NextResponse } from 'next/server';
import { getContext } from '@/lib/context';
import { blueprintOf } from '@/lib/modules';
import { loadAreas } from '@/lib/areas';

/**
 * ⬇ Exporta módulos (estructura, sin registros) y las áreas como un archivo .json
 * para reutilizarlos en esta u otra institución con «⬆ Importar».
 * ?id=<módulo> exporta uno; sin id exporta todos.
 */
export async function GET(req: Request) {
  const ctx = await getContext();
  if (!ctx.orgId || !ctx.isOwner) return new NextResponse('Solo el propietario puede exportar módulos.', { status: 403 });
  const id = new URL(req.url).searchParams.get('id');
  let q = ctx.supabase.from('custom_modules').select('*').eq('organization_id', ctx.orgId).order('name');
  if (id) { if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Módulo no válido', { status: 400 }); q = q.eq('id', id); }
  const { data } = await q;
  if (!data?.length) return new NextResponse('No hay módulos para exportar.', { status: 404 });
  const areas = await loadAreas(ctx.supabase, ctx.orgId);
  const pkg = {
    formato: 'sematec.modulos', version: 1, exportado: new Date().toISOString(),
    modulos: data.map((m: any) => blueprintOf(m)),
    areas: { areas: areas.areas.filter((a) => a.kind === 'propia' || data.some((m: any) => m.area === a.key)) },
  };
  const name = id ? `modulo-${data[0].slug}` : 'modulos-institucion';
  return new NextResponse(JSON.stringify(pkg, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${name}.json"`, 'cache-control': 'no-store' },
  });
}
