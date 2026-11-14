'use server';
import { redirect } from 'next/navigation';
import { getContext } from '@/lib/context';
import { fail, guard, str, type ActionResult } from '@/lib/actions';

/** 🔑 Abre la sala (sección) con su código: solo si la persona es su profesor, su estudiante o personal con permiso. */
export async function enterRoomByCode(fd: FormData): Promise<ActionResult> {
  return guard(async () => {
    const ctx = await getContext();
    const code = (str(fd, 'code') ?? '').slice(0, 40);
    if (!code) return fail('Escriba el código de la sala.');
    const { data, error } = await ctx.supabase.rpc('find_room_by_code', { p_code: code });
    if (error) return fail(/find_room_by_code/.test(error.message) ? 'Falta instalar la actualización «Código de sala» en Actualizar base de datos.' : error.message);
    redirect(`/app/aula/${data}`);
  });
}
