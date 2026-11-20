import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

/** Foto o video de una publicación del sitio: público si está publicada; la administración ve también los borradores. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 });
  const admin = createAdminClient();
  type Row = { storage_path: string; mime_type: string; name: string };
  let row: Row | undefined = ((await admin.rpc('public_site_media', { p_media: id })).data as Row[] | null)?.[0];
  let isPublic = !!row;
  if (!row) {
    const sb = await createClient();
    row = ((await sb.rpc('staff_site_media', { p_media: id })).data as Row[] | null)?.[0];
    isPublic = false;
  }
  if (!row) return new NextResponse(null, { status: 404 });
  const { data, error } = await admin.storage.from('user-files').createSignedUrl(row.storage_path, 3600,
    req.nextUrl.searchParams.get('descargar') === '1' ? { download: row.name } : undefined);
  if (error || !data) return new NextResponse(null, { status: 502 });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'Cache-Control': isPublic ? 'public, max-age=1800' : 'private, no-store' } });
}
