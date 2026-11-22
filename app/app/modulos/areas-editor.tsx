'use client';
import { useState } from 'react';
import { AREA_COLORS, AREA_ICONS, type AreaDef } from '@/lib/areas';

type Row = AreaDef & { uid: number; new?: boolean };
type Opt = { href: string; label: string; icon: string };
let uid = 0;
const KIND: Record<string, string> = { base: 'Opciones base', sistemas: 'Sistemas', propia: 'Propia' };

/**
 * 🗂 Editor de áreas: crear, renombrar, ícono, color, descripción, orden, ocultar y eliminar;
 * y en qué área aparece cada opción del menú. Va dentro de un ActionForm (envía «config»).
 */
export function AreasEditor({ initial, place, defaults, options, counts, defaultPlace }: {
  initial: AreaDef[]; place: Record<string, string>; defaults: AreaDef[]; options: Opt[]; defaultPlace: Record<string, string>; counts: Record<string, number>;
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((a) => ({ ...a, uid: ++uid })));
  const [pl, setPl] = useState<Record<string, string>>(place);
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const def = new Map(defaults.map((d) => [d.key, d]));
  const json = JSON.stringify({ areas: rows.map(({ uid: _u, ...a }) => a), place: pl });
  return (
    <div className="space-y-4" data-testid="editor-areas">
      <input type="hidden" name="config" value={json} />
      <div className="space-y-2">
        {rows.map((a, i) => (
          <div key={a.uid} className={`rounded-xl border p-3 ${a.hidden ? 'border-dashed border-slate-300 bg-slate-50 opacity-70' : 'border-slate-200 bg-white'}`} data-testid="area">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${a.color} text-xl text-white`} aria-hidden>{a.icon}</span>
              <select className="input w-auto text-lg" value={a.icon} onChange={(e) => set(i, { icon: e.target.value })} aria-label="Ícono del área">
                {[...new Set([a.icon, ...AREA_ICONS])].map((x) => <option key={x} value={x}>{x}</option>)}</select>
              <input className="input min-w-[12rem] flex-1 font-semibold" value={a.title} maxLength={60} onChange={(e) => set(i, { title: e.target.value })} aria-label="Nombre del área" placeholder="Nombre del área" />
              <select className="input w-auto" value={a.color} onChange={(e) => set(i, { color: e.target.value })} aria-label="Color del área">
                {AREA_COLORS.map((c) => <option key={c.value} value={c.value}>{c.name}</option>)}</select>
              <span className="flex gap-1">
                <button type="button" className="rounded px-1.5 hover:bg-slate-200" onClick={() => move(i, -1)} aria-label="Subir">↑</button>
                <button type="button" className="rounded px-1.5 hover:bg-slate-200" onClick={() => move(i, 1)} aria-label="Bajar">↓</button>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
              <span className="rounded bg-slate-100 px-1.5 py-0.5">{KIND[a.kind]}</span>
              <span>{counts[a.key] ?? 0} sistema(s)</span>
              <input className="input min-w-[12rem] flex-1 py-1 text-xs" value={a.text} maxLength={200} onChange={(e) => set(i, { text: e.target.value })} placeholder="Descripción (opcional)" aria-label="Descripción del área" />
              {a.key !== 'otros' && <label className="flex items-center gap-1"><input type="checkbox" checked={!!a.hidden} onChange={(e) => set(i, { hidden: e.target.checked })} data-testid="ocultar-area" /> Ocultar</label>}
              {a.kind !== 'propia' && def.get(a.key) && <button type="button" className="link" onClick={() => { const d = def.get(a.key)!; set(i, { title: d.title, icon: d.icon, color: d.color, text: d.text, hidden: false }); }}>↺ Original</button>}
              {a.kind === 'propia' && <button type="button" className="text-red-600 hover:underline" data-testid="eliminar-area"
                onClick={() => { if (confirm(`¿Eliminar el área «${a.title}»? Sus sistemas pasarán a «Módulos propios».`)) { setRows((r) => r.filter((_, j) => j !== i)); setPl((p) => Object.fromEntries(Object.entries(p).filter(([, k]) => k !== a.key))); } }}>🗑 Eliminar</button>}
            </div>
          </div>))}
        <button type="button" className="btn-secondary" data-testid="nueva-area" disabled={rows.length >= 80}
          onClick={() => setRows((r) => [...r, { key: '', new: true, title: 'Nueva área', icon: '🗂', color: AREA_COLORS[r.length % AREA_COLORS.length].value, text: '', kind: 'propia', uid: ++uid }])}>➕ Nueva área</button>
      </div>
      <details className="rounded-xl border border-slate-200 p-3">
        <summary className="cursor-pointer font-semibold" data-testid="opciones-por-area">📍 En qué área aparece cada opción del menú</summary>
        <p className="mt-2 text-xs text-slate-500">Mueva cualquier opción a otra área (también a las que usted creó). Los sistemas se mueven desde «Módulos y sistemas».</p>
        <table className="mt-2 w-full text-sm"><tbody>{options.map((o) => (
          <tr key={o.href} className="border-t border-slate-100">
            <td className="py-1 pr-2">{o.icon} {o.label}</td>
            <td className="py-1"><select className="input py-1 text-sm" value={pl[o.href] ?? '__def'} aria-label={`Área de ${o.label}`} data-testid="area-de-opcion"
              onChange={(e) => setPl((p) => { const n = { ...p }; if (e.target.value === '__def') delete n[o.href]; else n[o.href] = e.target.value; return n; })}>
              <option value="__def">Original ({rows.find((r) => r.key === defaultPlace[o.href])?.title ?? 'Módulos propios'})</option>
              {rows.filter((r) => !r.new).map((r) => <option key={r.key} value={r.key}>{r.icon} {r.title}</option>)}
            </select></td>
          </tr>))}</tbody></table>
      </details>
    </div>
  );
}
