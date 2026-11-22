'use client';
import { useState } from 'react';
import { WF_COLORS, type WfStep } from '@/lib/modules';

type Row = WfStep & { uid: number };
let uid = 0;
const DOT: Record<string, string> = { blue: 'bg-blue-500', amber: 'bg-amber-500', green: 'bg-emerald-500', red: 'bg-red-500', violet: 'bg-violet-500', slate: 'bg-slate-400' };

/** 🔄 Estados por los que pasa cada registro (ej.: Recibida → En proceso → Resuelta). Vacío = sin estados. */
export function WorkflowEditor({ initial }: { initial?: WfStep[] }) {
  const [rows, setRows] = useState<Row[]>(() => (initial ?? []).map((w) => ({ ...w, uid: ++uid })));
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const json = JSON.stringify(rows.map(({ uid: _u, ...w }) => w));
  return (
    <div className="space-y-2" data-testid="editor-estados">
      <input type="hidden" name="has_workflow" value="1" /><input type="hidden" name="workflow" value={json} />
      <p className="label">🔄 Estados de cada registro <span className="font-normal text-slate-500">(opcional · el primero es el estado inicial)</span></p>
      {rows.length > 0 && <p className="flex flex-wrap items-center gap-1 text-xs text-slate-600">{rows.map((w, i) => <span key={w.uid} className="flex items-center gap-1">{i > 0 && '→'}<span className={`inline-block h-2 w-2 rounded-full ${DOT[w.color] ?? DOT.blue}`} />{w.label || '…'}{w.final ? ' ✔' : ''}</span>)}</p>}
      {rows.map((w, i) => (
        <div key={w.uid} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2" data-testid="estado">
          <input className="input min-w-[9rem] flex-1" value={w.label} maxLength={40} placeholder="Nombre del estado (ej.: En proceso)" aria-label="Nombre del estado" onChange={(e) => set(i, { label: e.target.value })} />
          <select className="input w-auto" value={w.color} onChange={(e) => set(i, { color: e.target.value })} aria-label="Color">{WF_COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <label className="flex items-center gap-1 text-xs" title="Marca el registro como terminado"><input type="checkbox" checked={!!w.final} onChange={(e) => set(i, { final: e.target.checked })} /> Termina el registro</label>
          <span className="flex gap-1">
            <button type="button" className="rounded px-1.5 hover:bg-slate-200" onClick={() => move(i, -1)} aria-label="Subir">↑</button>
            <button type="button" className="rounded px-1.5 hover:bg-slate-200" onClick={() => move(i, 1)} aria-label="Bajar">↓</button>
            <button type="button" className="rounded px-1.5 text-red-600 hover:bg-red-50" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Quitar estado">✕</button>
          </span>
        </div>))}
      <button type="button" className="btn-secondary text-sm" data-testid="agregar-estado" disabled={rows.length >= 12}
        onClick={() => setRows((r) => [...r, { key: '', label: '', color: r.length ? 'amber' : 'blue', uid: ++uid }])}>➕ Agregar estado</button>
    </div>
  );
}
