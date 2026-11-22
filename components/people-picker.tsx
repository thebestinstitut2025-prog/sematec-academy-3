'use client';
import { useMemo, useState } from 'react';

export type PickOpt = { value: string; label: string; hint?: string; group?: string };

/**
 * 👥 Elegir varias personas (profesores, estudiantes, usuarios…) con buscador,
 * «Elegir todos» y filtro por grupo. Envía un campo «name» por cada persona marcada.
 */
export function PeoplePicker({ name, options, initial = [], label, testid, height = 'max-h-60' }: {
  name: string; options: PickOpt[]; initial?: string[]; label?: string; testid?: string; height?: string;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(initial));
  const [q, setQ] = useState('');
  const [grp, setGrp] = useState('');
  const groups = useMemo(() => [...new Set(options.map((o) => o.group).filter(Boolean))] as string[], [options]);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const shown = options.filter((o) => (!grp || o.group === grp) && (!q || norm(`${o.label} ${o.hint ?? ''}`).includes(norm(q))));
  const allOn = shown.length > 0 && shown.every((o) => sel.has(o.value));
  const toggle = (v: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(v); else n.delete(v); return n; });
  return (
    <div className="space-y-2" data-testid={testid}>
      {label && <span className="label">{label}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <input className="input min-w-[10rem] flex-1 py-1 text-sm" placeholder="🔎 Buscar por nombre o correo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar personas" />
        {groups.length > 1 && <select className="input w-auto py-1 text-sm" value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="Filtrar">
          <option value="">Todos</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select>}
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={allOn} onChange={(e) => shown.forEach((o) => toggle(o.value, e.target.checked))} data-testid="elegir-todos" /> Elegir todos ({shown.length})</label>
      </div>
      <div className={`${height} overflow-auto rounded-lg border border-slate-200 bg-white p-1`}>
        {shown.length ? shown.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" className="mt-1" checked={sel.has(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} />
            <span><span className="font-medium">{o.label}</span>{o.hint && <span className="block text-xs text-slate-500">{o.hint}</span>}</span>
          </label>)) : <p className="p-2 text-sm text-slate-500">Nadie coincide con la búsqueda.</p>}
      </div>
      <p className="text-xs text-slate-500" data-testid="elegidos">{sel.size} elegido(s)</p>
      {[...sel].map((v) => <input key={v} type="hidden" name={name} value={v} />)}
    </div>
  );
}
