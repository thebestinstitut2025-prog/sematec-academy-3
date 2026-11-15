import { ActionForm } from '@/components/forms';
import { detachFile } from '@/app/app/adjuntos-actions';
import type { AttachItem } from '@/lib/attachments';

const icon = (m: string) => m.startsWith('image/') ? '🖼' : m.startsWith('video/') ? '🎬' : m.startsWith('audio/') ? '🎧' : m === 'application/pdf' ? '📕' : '📄';
const size = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Lista de adjuntos con «Ver» y «Descargar»; quien lo subió puede quitarlo si todavía se puede cambiar. */
export function AttachmentList({ items, canRemove = false, path, who }: { items?: AttachItem[]; canRemove?: boolean; path?: string; who?: (by: string) => string | undefined }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-sm" data-testid="adjuntos">{items.map((a) => (
      <li key={a.id} className="flex flex-wrap items-center gap-2">
        <span aria-hidden>{icon(a.mime)}</span>
        <a className="link" href={`/api/adjunto/${a.id}`} target="_blank" rel="noopener noreferrer">{a.name}</a>
        <span className="text-xs text-slate-400">{size(a.size)}{who?.(a.created_by) ? ` · ${who(a.created_by)}` : ''}</span>
        <a className="text-xs text-slate-500 hover:underline" href={`/api/adjunto/${a.id}?descargar=1`}>Descargar</a>
        {canRemove && a.mine && (
          <ActionForm action={detachFile} inline submitLabel="Quitar" submitClass="text-xs text-red-700 hover:underline" confirm={`¿Quitar «${a.name}»? Seguirá en «Mis archivos».`}>
            <input type="hidden" name="id" value={a.id} />{path && <input type="hidden" name="path" value={path} />}
          </ActionForm>)}
      </li>))}</ul>
  );
}
