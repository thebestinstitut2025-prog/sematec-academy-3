import { NextResponse, type NextRequest } from 'next/server';
import { getContext } from '@/lib/context';
import { createAdminClient } from '@/lib/supabase/admin';
import { FILE_TYPES } from '@/lib/user-files';

// Límite de una petición en el servidor: los archivos más grandes se suben desde «Archivos»
const MAX_SHARE = 4 * 1024 * 1024;

/**
 * 📲 «Compartir con SEMATEC» desde el celular o el computador (la app instalada aparece en el menú Compartir
 * de YouTube, Galería, Chrome, WhatsApp…): guarda los archivos en «Mis archivos» o muestra el enlace recibido.
 */
export async function POST(req: NextRequest) {
  // Solo lo envía el propio dispositivo (no otra página web)
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'none' && site !== 'same-origin') return new NextResponse('No permitido', { status: 403 });
  const ctx = await getContext();
  const back = (q: Record<string, string>) => NextResponse.redirect(new URL(`/app/compartir/recibido?${new URLSearchParams(q)}`, req.url), 303);
  if (!ctx.orgId) return back({ error: 'Elija una institución primero.' });
  let fd: FormData;
  try { fd = await req.formData(); } catch { return back({ error: 'No se pudo leer lo compartido (puede ser demasiado grande).' }); }
  const title = String(fd.get('title') ?? '').slice(0, 200);
  const text = String(fd.get('text') ?? '').slice(0, 2000);
  let url = String(fd.get('url') ?? '').slice(0, 2000);
  if (!url) url = text.match(/https?:\/\/[^\s<>"]+/)?.[0] ?? '';
  const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
  let saved = 0; const errors: string[] = [];
  for (const f of files) {
    const mime = (f.type || '').split(';')[0].toLowerCase();
    const ext = FILE_TYPES[mime];
    if (!ext) { errors.push(`«${f.name}»: tipo no permitido`); continue; }
    if (f.size > MAX_SHARE) { errors.push(`«${f.name}» pesa más de 4 MB: súbalo desde Archivos`); continue; }
    const path = `${ctx.orgId}/${ctx.user.id}/${crypto.randomUUID()}.${ext}`;
    const admin = createAdminClient();
    const up = await admin.storage.from('user-files').upload(path, f, { contentType: mime, upsert: false });
    if (up.error) { errors.push(`«${f.name}»: ${up.error.message}`); continue; }
    const { error } = await ctx.supabase.rpc('register_user_file', {
      p_org: ctx.orgId, p_name: (f.name || `compartido.${ext}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 200), p_mime: mime, p_size: f.size, p_path: path,
      p_visibility: 'private', p_section: null, p_description: title || null,
    });
    if (error) { await admin.storage.from('user-files').remove([path]); errors.push(`«${f.name}»: ${error.message}`); continue; }
    saved++;
  }
  return back({ ...(title ? { title } : {}), ...(text && text !== url ? { text: text.slice(0, 500) } : {}), ...(url ? { url } : {}),
    ...(saved ? { saved: String(saved) } : {}), ...(errors.length ? { error: errors.join(' · ').slice(0, 600) } : {}) });
}

/** Algunos navegadores comparten con GET: se muestra lo recibido. */
export async function GET(req: NextRequest) {
  const u = new URL('/app/compartir/recibido', req.url);
  req.nextUrl.searchParams.forEach((v, k) => { if (['title', 'text', 'url'].includes(k)) u.searchParams.set(k, v.slice(0, 2000)); });
  return NextResponse.redirect(u, 303);
}
