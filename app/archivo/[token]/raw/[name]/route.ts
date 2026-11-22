import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Archivo por su enlace con clave (público, enviado por correo o para abrir en una app).
 * No requiere sesión: la clave es larga, aleatoria y puede vencer. Redirige a un enlace firmado de 1 hora.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{48}$/.test(token)) return new NextResponse('Enlace no válido', { status: 404 });
  const admin = createAdminClient();
  const { data } = await admin.rpc('file_by_token', { p_token: token });
  const f = (data as any[] | null)?.[0];
  if (!f) return new NextResponse('El enlace venció o el archivo ya no está disponible.', { status: 404 });
  if (f.url) return NextResponse.redirect(f.url, { headers: { 'Cache-Control': 'no-store' } });
  const download = req.nextUrl.searchParams.has('descargar');
  const { data: s, error } = await admin.storage.from('user-files').createSignedUrl(f.storage_path, 3600, download ? { download: f.name } : undefined);
  if (error || !s) return new NextResponse('Archivo no disponible', { status: 404 });
  return NextResponse.redirect(s.signedUrl, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
