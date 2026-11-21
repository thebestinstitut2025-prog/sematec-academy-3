'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';
import { readAttachmentIds } from '@/lib/attachments';
import { mailEnabled, mailLayout, sendMail } from '@/lib/mailer';
import { brandOf, textToMailHtml } from '@/lib/notify';

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;
const MAX_FILES_BYTES = 20 * 1024 * 1024; // Gmail acepta hasta 25 MB por correo

/** ✉ Escribir un correo a una o varias direcciones (dentro o fuera de la plataforma), con archivos. */
export async function composeMail(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!mailEnabled()) return fail('El correo de la plataforma no está configurado. Avise a la administración.');
    const to = [...new Set(String(fd.get('to') ?? '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
    if (!to.length) return fail('Escriba al menos un destinatario.');
    if (to.length > 20) return fail('Máximo 20 destinatarios por correo.');
    const bad = to.filter((x) => !EMAIL.test(x));
    if (bad.length) return fail(`Revise estos correos: ${bad.join(', ')}`);
    const subject = reqStr(fd, 'subject', 'Asunto').slice(0, 200);
    const body = reqStr(fd, 'body', 'Mensaje').slice(0, 20000);
    const ids = readAttachmentIds(fd); if (!Array.isArray(ids)) return fail(ids.error);

    const { data: allow, error: e0 } = await ctx.supabase.rpc('mail_compose_allowed', { p_recipients: to.length });
    if (e0) return fail(/mail_compose_allowed/.test(e0.message) ? 'Falta instalar la actualización «Correo usuarios» en Actualizar base de datos.' : e0.message);
    const a = allow as { ok: boolean; used: number; limit: number };
    if (!a.ok) return fail(`Llegó al límite de ${a.limit} correos por día (lleva ${a.used}). Inténtelo mañana.`);

    // Archivos: se adjuntan de verdad al correo (para que también los abra quien no está en la plataforma)
    let attachments: { filename: string; content: Uint8Array; contentType?: string }[] | undefined;
    if (ids.length) {
      const { data: files } = await ctx.supabase.rpc('my_file_paths', { p_ids: ids });
      const list = (files ?? []) as { name: string; mime_type: string; size_bytes: number; storage_path: string }[];
      const total = list.reduce((s, f) => s + Number(f.size_bytes), 0);
      if (total > MAX_FILES_BYTES) return fail('Los archivos suman más de 20 MB: envíe menos archivos o compártalos desde «Mis archivos» con un enlace.');
      const { createAdminClient } = await import('@/lib/supabase/admin');
      const st = createAdminClient().storage.from('user-files');
      attachments = [];
      for (const f of list) {
        const { data, error } = await st.download(f.storage_path);
        if (error || !data) return fail(`No se pudo leer el archivo «${f.name}».`);
        attachments.push({ filename: f.name, content: new Uint8Array(await data.arrayBuffer()), contentType: f.mime_type });
      }
    }

    const brand = await brandOf(ctx.orgId);
    const name = ctx.profile?.full_name ?? ctx.user.email ?? 'Usuario';
    const html = mailLayout(brand, subject, textToMailHtml(body) + `<p style="font-size:13px;color:#475569">— ${name}${ctx.user.email ? ` (${ctx.user.email})` : ''}</p>`);
    const text = `${body}\n\n— ${name}${ctx.user.email ? ` (${ctx.user.email})` : ''}`;
    let sent = 0; let lastErr = '';
    for (const r of to) {
      try {
        await sendMail(r, subject, html, text, attachments, { org: ctx.orgId, kind: 'correo', by: ctx.user.id, fromName: name, replyTo: ctx.user.email ?? null });
        sent++;
      } catch (e) { lastErr = (e as Error).message; }
    }
    revalidatePath('/app/correo');
    if (!sent) return fail(`No se pudo enviar: ${lastErr}${attachments?.length ? '' : ' Quedó guardado y se enviará cuando el correo funcione.'}`);
    return ok(`✉ Correo enviado a ${sent} destinatario(s)${attachments?.length ? ` con ${attachments.length} archivo(s)` : ''}.${sent < to.length ? ` ⚠ ${to.length - sent} no se pudo(eron) enviar: ${lastErr}` : ''}`);
  });
}
