'use client';
import { useEffect, useRef, useState } from 'react';
import { uploadUserFile } from '@/components/file-uploader';
import { FILE_ACCEPT, FILE_MAX_LABEL, fmtSize } from '@/lib/user-files';

type Item = { key: string; name: string; size: number; pct: number; id?: string; error?: string };

/**
 * 📎 Adjuntar archivos (fotos, PDF, Word, videos…) a una entrega, examen, evaluación o mensaje.
 * Se suben directo al almacenamiento (sin el límite de 4 MB) y quedan también en «Mis archivos».
 * Dentro de un formulario envía «attachments» (lista de ids); fuera de él avisa con onChange.
 */
export function AttachFiles({ org, label = '📎 Adjuntar archivos', max = 10, onChange }: {
  org: string; label?: string; max?: number; onChange?: (ids: string[], pending: boolean) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const ids = items.filter((i) => i.id).map((i) => i.id!) ;
  const pending = items.some((i) => !i.id && !i.error);
  useEffect(() => { onChange?.(ids, pending); }, [ids.join(','), pending]); // eslint-disable-line react-hooks/exhaustive-deps
  // Al guardar con éxito el formulario se limpia (reset): también la lista de adjuntos
  useEffect(() => {
    const form = holder.current?.closest('form'); if (!form) return;
    const onReset = () => setItems([]);
    form.addEventListener('reset', onReset); return () => form.removeEventListener('reset', onReset);
  }, []);

  const add = async (files: File[]) => {
    const room = Math.max(0, max - items.length);
    const list = files.slice(0, room).map((f) => ({ key: `${f.name}-${f.size}-${Math.random()}`, name: f.name, size: f.size, pct: 0, file: f }));
    setItems((cur) => [...cur, ...list.map(({ file: _f, ...x }) => x)]);
    for (const it of list) {
      try {
        const id = await uploadUserFile(org, it.file, { visibility: 'private' }, (pct) => setItems((cur) => cur.map((x) => x.key === it.key ? { ...x, pct } : x)));
        setItems((cur) => cur.map((x) => x.key === it.key ? { ...x, id, pct: 100 } : x));
      } catch (e) {
        setItems((cur) => cur.map((x) => x.key === it.key ? { ...x, error: (e as Error).message } : x));
      }
    }
    if (input.current) input.current.value = '';
  };

  return (
    <div ref={holder} className="rounded-xl border border-dashed border-slate-300 p-3" data-testid="adjuntar">
      <input type="hidden" name="attachments" value={JSON.stringify(ids)} />
      <input type="hidden" name="attachments_pending" value={pending ? '1' : '0'} />
      <label className="block">
        <span className="label">{label}</span>
        <input ref={input} type="file" multiple accept={FILE_ACCEPT} className="block w-full text-sm" data-testid="adjuntar-input"
          disabled={items.length >= max} onChange={(e) => add([...(e.target.files ?? [])])} />
      </label>
      <p className="mt-1 text-xs text-slate-500">Fotos, PDF, Word, Excel, PowerPoint, audio, video o ZIP · hasta {max} archivos de {FILE_MAX_LABEL} cada uno. Quedan también en «Mis archivos».</p>
      {items.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm" data-testid="adjuntos-lista">{items.map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            <span className={i.error ? 'text-red-700' : i.id ? 'text-emerald-700' : 'text-slate-600'}>
              {i.error ? `✕ ${i.name}: ${i.error}` : i.id ? `✓ ${i.name}` : `⏳ ${i.name} · ${i.pct} %`}
            </span>
            <span className="text-xs text-slate-400">{fmtSize(i.size)}</span>
            {(i.id || i.error) && <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => setItems((cur) => cur.filter((x) => x.key !== i.key))}>Quitar</button>}
          </li>))}</ul>)}
    </div>
  );
}
