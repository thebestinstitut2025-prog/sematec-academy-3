import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** 📎 Abre o descarga un adjunto: solo si quien lo pide puede verlo (RLS de «attachments»). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('No encontrado', { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL('/login', req.nextUrl.origin));
  const { data: rows } = await supabase.rpc('attachment_files', { p_ids: [id] });
  const f = (rows as { storage_path: string; name: string }[] | null)?.[0];
  if (!f) return new NextResponse('No encontrado o sin permiso', { status: 404 });
  const admin = createAdminClient();
  const download = req.nextUrl.searchParams.get('descargar') === '1';
  const { data: s, error } = await admin.storage.from('user-files').createSignedUrl(f.storage_path, 120, download ? { download: f.name } : undefined);
  if (error || !s) return new NextResponse('El almacenamiento no está disponible', { status: 502 });
  return NextResponse.redirect(s.signedUrl, { status: 302, headers: { 'Cache-Control': 'no-store' } });
}
