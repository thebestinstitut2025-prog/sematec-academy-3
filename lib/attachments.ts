import 'server-only';
import type { getContext } from '@/lib/context';

type Ctx = Awaited<ReturnType<typeof getContext>>;
export type AttachType = 'submission' | 'quiz_attempt' | 'external_eval' | 'message' | 'assignment' | 'quiz' | 'eval_material' | 'content' | 'quiz_question' | 'transfer_proof';
export type AttachItem = { id: string; entity_id: string; file_id: string; created_by: string; created_at: string; name: string; size: number; mime: string; mine: boolean };
const UUID = /^[0-9a-f-]{36}$/i;

/** Lee los archivos ya subidos del formulario (campo «attachments»). Si alguno todavía se está subiendo, avisa. */
export function readAttachmentIds(fd: FormData): string[] | { error: string } {
  if (fd.get('attachments_pending') === '1') return { error: 'Espere a que terminen de subir los archivos y vuelva a pulsar el botón.' };
  try {
    const ids = JSON.parse(String(fd.get('attachments') ?? '[]'));
    return Array.isArray(ids) ? [...new Set(ids.filter((x) => typeof x === 'string' && UUID.test(x)))].slice(0, 20) : [];
  } catch { return []; }
}

/** Une los archivos subidos a la entrega, examen, evaluación o mensaje (verifica dueño y permisos en la base). */
export async function attachTo(ctx: Ctx, type: AttachType, entity: string, ids: string[]): Promise<string | null> {
  if (!ids.length) return null;
  const { error } = await ctx.supabase.rpc('attach_files', { p_type: type, p_entity: entity, p_files: ids });
  if (!error) return null;
  return /attach_files/.test(error.message) ? 'Falta instalar la actualización «Adjuntos» en Actualizar base de datos.' : error.message;
}

/** Adjuntos visibles para quien mira (RLS), agrupados por entrega / examen / evaluación / mensaje. */
export async function listAttachments(ctx: Ctx, type: AttachType, entities: string[]): Promise<Record<string, AttachItem[]>> {
  const out: Record<string, AttachItem[]> = {};
  const ids = entities.filter((x) => UUID.test(x));
  if (!ids.length) return out;
  const { data: rows, error } = await ctx.supabase.from('attachments').select('id').eq('entity_type', type).in('entity_id', ids);
  if (error || !rows?.length) return out;
  const { data: files } = await ctx.supabase.rpc('attachment_files', { p_ids: rows.map((r) => r.id) });
  for (const f of (files ?? []) as { id: string; entity_id: string; file_id: string; created_by: string; created_at: string; name: string; size_bytes: number; mime_type: string }[]) {
    (out[f.entity_id] ??= []).push({ id: f.id, entity_id: f.entity_id, file_id: f.file_id, created_by: f.created_by, created_at: f.created_at,
      name: f.name, size: Number(f.size_bytes), mime: f.mime_type, mine: f.created_by === ctx.user.id });
  }
  return out;
}

/** Material del profesor: lee los archivos del formulario y los adjunta (devuelve un texto de error o null). */
export async function attachMaterial(ctx: Ctx, fd: FormData, type: 'assignment' | 'quiz' | 'eval_material' | 'content', entity: string): Promise<{ n: number; error: string | null }> {
  const ids = readAttachmentIds(fd);
  if (!Array.isArray(ids)) return { n: 0, error: ids.error };
  const err = await attachTo(ctx, type, entity, ids);
  return { n: err ? 0 : ids.length, error: err };
}
