import 'server-only';
import { sendNotice } from '@/lib/notify';

type Sb = { rpc: (fn: string, args?: Record<string, unknown>) => any };
const UUID = /^[0-9a-f-]{36}$/i;
export const FILE_VIS = ['private', 'section', 'staff', 'org', 'public', 'people'] as const;
export const VIS_LABEL: Record<string, string> = {
  private: '🔒 Solo yo', section: '👥 Curso', staff: '🏢 Personal', org: '🏛 Institución', public: '🌐 Público (cualquiera con el enlace)', people: '👤 Personas o grupos elegidos',
};
export const cleanIds = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter((x) => UUID.test(x)).slice(0, 500);
export const cleanEmails = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[\s,;]+/)).map((x) => String(x).trim().toLowerCase())
  .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x) && x.length <= 254))].slice(0, 20);

/** Aplica quién puede ver un archivo. Devuelve la clave del enlace público (si es público). */
export async function applyAccess(sb: Sb, fileId: string, a: { visibility: string; section?: string | null; users?: string[]; groups?: string[] }) {
  const vis = (FILE_VIS as readonly string[]).includes(a.visibility) ? a.visibility : 'private';
  const { data, error } = await sb.rpc('set_file_access', {
    p_file: fileId, p_visibility: vis, p_section: vis === 'section' ? a.section ?? null : null, p_users: a.users ?? [], p_groups: a.groups ?? [],
  });
  if (error) throw new Error(/set_file_access/.test(error.message) ? 'Falta instalar la actualización «Archivos compartir» en Actualizar base de datos.' : error.message);
  return (data as string | null) ?? null;
}

/** Envía el archivo por correo a personas nuevas (sin cuenta): enlace con clave, válido 30 días. */
export async function sendToEmails(sb: Sb, f: { id: string; name: string; org: string }, emails: string[], by: string, origin: string, note?: string | null) {
  let sent = 0; const errors: string[] = [];
  for (const email of emails) {
    const { data: token, error } = await sb.rpc('create_file_token', { p_file: f.id, p_kind: 'email', p_email: email });
    if (error || !token) { errors.push(`${email}: ${error?.message ?? 'no se pudo crear el enlace'}`); continue; }
    const r = await sendNotice({
      to: email, org: f.org, by, kind: 'archivo', subject: `Le compartieron «${f.name}»`, title: 'Le compartieron un archivo',
      text: `Le compartieron el archivo «${f.name}».${note ? `\n\n${note}` : ''}\n\nPuede verlo en línea o descargarlo durante 30 días, sin crear una cuenta.`,
      link: { path: `/archivo/${token}`, label: 'Ver el archivo' },
    });
    if (r.ok) sent++; else errors.push(`${email}: ${r.error}`);
  }
  void origin;
  return { sent, errors };
}
