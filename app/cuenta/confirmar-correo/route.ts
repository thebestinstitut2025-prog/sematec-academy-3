import { NextResponse, type NextRequest } from 'next/server';
import { confirmEmailChange } from '@/lib/email-change';
import { createClient } from '@/lib/supabase/server';

/** Enlace del correo «Confirme su nuevo correo»: aplica el cambio y vuelve a «Mi cuenta» (o al inicio de sesión). */
export async function GET(req: NextRequest) {
  const r = await confirmEmailChange(req.nextUrl.searchParams.get('t') ?? '');
  const status = r.ok ? 'ok' : r.error;
  let logged = false;
  try { logged = !!(await (await createClient()).auth.getUser()).data.user; } catch { /* sin sesión */ }
  return NextResponse.redirect(new URL(logged ? `/app/perfil?correo=${status}` : `/login?correo=${status}`, req.nextUrl.origin), { status: 303 });
}
