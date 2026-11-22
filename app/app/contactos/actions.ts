'use server';
import { revalidatePath } from 'next/cache';
import { getContext } from '@/lib/context';
import { fail, guard, ok, reqStr, type ActionResult } from '@/lib/actions';

/** 🔒 Quién ve mi teléfono y correo en «Contactos». */
export async function setContactVisibility(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const v = reqStr(fd, 'vis', 'Opción');
    const { error } = await ctx.supabase.rpc('set_contact_visibility', { p_vis: v });
    if (error) return fail(/set_contact_visibility/.test(error.message) ? 'Falta instalar la actualización «Contactos y apps» en Actualizar base de datos.' : error);
    revalidatePath('/app/contactos');
    return ok(v === 'nadie' ? 'Listo: nadie ve su teléfono ni su correo.' : v === 'personal' ? 'Listo: solo el personal y los profesores ven su teléfono y correo.' : 'Listo: todos sus contactos de la plataforma ven su teléfono y correo.');
  });
}
