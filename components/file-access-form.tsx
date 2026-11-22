'use client';
import { useState } from 'react';
import { PeoplePicker, type PickOpt } from '@/components/people-picker';

export const VIS_OPTIONS: [string, string][] = [
  ['private', '🔒 Solo yo (privado)'],
  ['people', '👤 Personas o grupos que yo elija'],
  ['section', '👥 Un curso (profesores y estudiantes)'],
  ['staff', '🏢 Personal y profesores de la institución'],
  ['org', '🏛 Toda la institución'],
  ['public', '🌐 Público: cualquiera con el enlace, sin cuenta'],
];

/**
 * 👤 Elegir quién puede ver algo: privado, público, personas, grupos, un curso, el personal o toda la institución.
 * También se puede compartir con personas y grupos aunque se elija otra opción.
 * Va dentro de un formulario: envía «visibility», «section», «users» y «groups».
 */
export function FileAccessFields({ people, groups, sections, initial, options = VIS_OPTIONS, extraPeople = true }: {
  people: PickOpt[]; groups: { id: string; name: string; count: number }[]; sections: { value: string; label: string }[];
  initial?: { visibility?: string; section?: string | null; users?: string[]; groups?: string[] }; options?: [string, string][]; extraPeople?: boolean;
}) {
  const [vis, setVis] = useState(initial?.visibility ?? 'private');
  const [more, setMore] = useState(vis === 'people' || !!initial?.users?.length || !!initial?.groups?.length);
  const showPeople = vis === 'people' || (more && extraPeople);
  return (
    <div className="space-y-3" data-testid="quien-puede-ver">
      <label className="block"><span className="label">¿Quién lo puede ver?</span>
        <select className="input" name="visibility" value={vis} onChange={(e) => setVis(e.target.value)} data-testid="visibilidad">
          {options.filter(([v]) => v !== 'section' || sections.length).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      {vis === 'section' && <label className="block"><span className="label">Curso</span>
        <select className="input" name="section" defaultValue={initial?.section ?? sections[0]?.value}>{sections.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>}
      {vis === 'public' && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">🌐 Cualquier persona que tenga el enlace lo podrá ver y descargar, aunque no tenga cuenta. Al guardar aparece el enlace para copiar.</p>}
      {vis !== 'people' && extraPeople && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} /> Además, compartir con personas o grupos</label>}
      {showPeople && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          {groups.length > 0 && <div><span className="label">👥 Mis grupos</span>
            <div className="flex flex-wrap gap-2" data-testid="elegir-grupos">{groups.map((g) => (
              <label key={g.id} className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-sm">
                <input type="checkbox" name="groups" value={g.id} defaultChecked={initial?.groups?.includes(g.id)} /> {g.name} <span className="text-xs text-slate-500">({g.count})</span></label>))}</div></div>}
          <PeoplePicker name="users" options={people} initial={initial?.users} label="👤 Personas" testid="elegir-personas" height="max-h-48" />
        </div>)}
    </div>
  );
}
