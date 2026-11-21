'use server';
import { revalidatePath } from 'next/cache';
import { getContext, can } from '@/lib/context';
import { fail, guard, ok, reqStr, str, type ActionResult } from '@/lib/actions';
import { saveImage } from '@/lib/media';
import { createAdminClient } from '@/lib/supabase/admin';

/** 🎨 Guarda el color y/o la imagen de fondo de la tarjeta de una sala (o de toda la asignatura). */
export async function setCardStyle(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    if (!ctx.orgId) return fail('Elija una institución.');
    const section = reqStr(fd, 'section_id', 'sala');
    const color = str(fd, 'color');
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return fail('Color no válido.');
    const whole = fd.get('whole_course') === 'on';
    const clear = fd.get('clear_image') === 'on';
    let course: string | null = null;
    if (whole) {
      if (!can(ctx, 'academic.edit')) return fail('Solo quien administra la oferta académica puede cambiar toda la asignatura.');
      const { data: s } = await ctx.supabase.from('sections').select('course_id').eq('id', section).maybeSingle();
      if (!s) return fail('Sala no encontrada.');
      course = s.course_id;
    }
    // Imagen del dispositivo (opcional): se valida por su contenido real (PNG, JPG o WebP)
    let image: string | null = null;
    const file = fd.get('file');
    if (file instanceof File && file.size > 0) {
      const r = await saveImage(file, { kind: 'card', organizationId: ctx.orgId, userId: ctx.user.id, isPublic: false });
      if ('error' in r) return fail(r.error ?? 'No se pudo guardar la imagen.');
      image = r.id;
    }
    const { error } = await ctx.supabase.rpc('set_card_style', {
      p_kind: course ? 'course' : 'section', p_id: course ?? section, p_color: color, p_image: image, p_clear_image: clear && !image,
    });
    if (error) {
      if (image) await createAdminClient().from('media_assets').delete().eq('id', image);
      return fail(/set_card_style/.test(error.message) ? 'Falta instalar la actualización «Tarjetas materiales» en Actualizar base de datos.' : error);
    }
    // Al aplicar a toda la asignatura, esta sala deja su estilo propio para seguir el de la asignatura
    if (course) await ctx.supabase.rpc('set_card_style', { p_kind: 'section', p_id: section, p_color: null, p_image: null, p_clear_image: true });
    revalidatePath('/app/aula'); revalidatePath(`/app/aula/${section}`);
    return ok(course ? 'Listo: la tarjeta de toda la asignatura quedó actualizada.' : 'Listo: la tarjeta de esta sala quedó actualizada.');
  });
}
