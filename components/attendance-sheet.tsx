'use client';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ActionForm } from '@/components/forms';
import { setAttendanceCell, setAttendanceColumn, setSheetCell, updateSheet, addSheetColumn, addSheetColumnsRange, editSheetColumn, deleteSheetColumn, deleteSheet } from '@/app/app/secciones/planilla-actions';

export type Design = {
  theme: string; font: string; density: string; symbols: string; header: string; stripes: boolean; grid: boolean; code: boolean;
  pct: boolean; totals: boolean; colTotals: boolean; highlightLow: boolean; title: string;
};
type Extra = { key: string; label: string; type: 'texto' | 'numero' | 'check' };
type Ses = { id: string; starts_at: string; topic: string | null };
type Stu = { id: string; name: string; code: string };
const ST = ['present', 'absent', 'late', 'excused'] as const;
const SYM: Record<string, Record<string, string>> = {
  letras: { present: 'P', absent: 'A', late: 'T', excused: 'J' },
  iconos: { present: '✓', absent: '✕', late: '⏰', excused: '📝' },
  palabras: { present: 'Presente', absent: 'Ausente', late: 'Atraso', excused: 'Justif.' },
};
const LABEL: Record<string, string> = { present: 'Presente', absent: 'Ausente', late: 'Atrasado', excused: 'Justificado' };
const CELL: Record<string, string> = { present: 'bg-emerald-100 text-emerald-800', absent: 'bg-red-100 text-red-700', late: 'bg-amber-100 text-amber-800', excused: 'bg-sky-100 text-sky-800' };
const XL: Record<string, string> = { present: '#D1FAE5', absent: '#FEE2E2', late: '#FEF3C7', excused: '#E0F2FE' };
export const THEMES: Record<string, { head: string; soft: string; name: string; hex: string }> = {
  azul: { head: 'bg-blue-700 text-white', soft: 'bg-blue-50', name: 'Azul', hex: '#1D4ED8' },
  verde: { head: 'bg-emerald-700 text-white', soft: 'bg-emerald-50', name: 'Verde', hex: '#047857' },
  morado: { head: 'bg-violet-700 text-white', soft: 'bg-violet-50', name: 'Morado', hex: '#6D28D9' },
  naranjo: { head: 'bg-orange-600 text-white', soft: 'bg-orange-50', name: 'Naranjo', hex: '#EA580C' },
  rosado: { head: 'bg-pink-600 text-white', soft: 'bg-pink-50', name: 'Rosado', hex: '#DB2777' },
  turquesa: { head: 'bg-teal-600 text-white', soft: 'bg-teal-50', name: 'Turquesa', hex: '#0D9488' },
  rojo: { head: 'bg-red-700 text-white', soft: 'bg-red-50', name: 'Rojo', hex: '#B91C1C' },
  gris: { head: 'bg-slate-700 text-white', soft: 'bg-slate-50', name: 'Gris', hex: '#334155' },
};
const FONT: Record<string, string> = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };
const PAD: Record<string, string> = { compacta: 'px-1 py-0.5', normal: 'px-2 py-1', amplia: 'px-3 py-2' };

function fmtHead(s: Ses, mode: string, i: number, tz: string) {
  const d = new Date(s.starts_at);
  const f = new Intl.DateTimeFormat('es-CL', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(d);
  return mode === 'numero' ? `Clase ${i + 1}` : f;
}


const DOW = [['1', 'Lu'], ['2', 'Ma'], ['3', 'Mi'], ['4', 'Ju'], ['5', 'Vi'], ['6', 'Sá'], ['0', 'Do']];
/** 📅 Crear columnas de una vez (una por día de clases) */
function RangeColumns({ sectionId, from, to }: { sectionId: string; from: string; to: string }) {
  return (
    <ActionForm action={addSheetColumnsRange} submitLabel="📅 Crear columnas" submitClass="btn-primary btn-sm">
      <input type="hidden" name="section_id" value={sectionId} />
      <p className="text-sm font-semibold">📅 Crear una columna por cada día de clases</p>
      <div className="grid gap-2 sm:grid-cols-4">
        <label><span className="label">Desde</span><input type="date" name="from" required defaultValue={from} className="input" data-testid="rango-desde" /></label>
        <label><span className="label">Hasta</span><input type="date" name="to" required defaultValue={to} className="input" data-testid="rango-hasta" /></label>
        <label><span className="label">Inicio</span><input type="time" name="start" defaultValue="08:00" className="input" /></label>
        <label><span className="label">Término</span><input type="time" name="end" defaultValue="09:30" className="input" /></label>
      </div>
      <div className="flex flex-wrap gap-1" data-testid="dias-clase">{DOW.map(([v, l]) => (
        <label key={v} className="cursor-pointer"><input type="checkbox" name="dow" value={v} defaultChecked={v !== '6' && v !== '0'} className="peer sr-only" />
          <span className="block rounded-lg border border-slate-300 px-3 py-1 text-sm peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-checked:text-white">{l}</span></label>))}</div>
    </ActionForm>
  );
}

/**
 * 📊 Planilla de asistencia: filas = estudiantes, columnas = clases (y columnas propias).
 * Marcar con un toque, pincel P/A/T/J, columnas y tablas editables, diseño, totales, Excel, PDF e impresión.
 */
export function AttendanceSheet({ sheet, sessions, students, records, cells, canWrite, sectionId, minPct, tz }: {
  sheet: { id: string; name: string; design: Design; extra_cols: Extra[]; from_date: string | null; to_date: string | null };
  sessions: Ses[]; students: Stu[]; records: Record<string, string>; cells: Record<string, string>;
  canWrite: boolean; sectionId: string; minPct: number; tz: string;
}) {
  const router = useRouter();
  const [rec, setRec] = useState(records);
  const [cel, setCel] = useState(cells);
  const [d, setD] = useState<Design>(sheet.design);
  const [extra, setExtra] = useState<Extra[]>(sheet.extra_cols);
  const [brush, setBrush] = useState<string>('ciclo');
  const [panel, setPanel] = useState<'' | 'diseno' | 'columna' | 'propia' | 'tabla'>('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const th = THEMES[d.theme] ?? THEMES.azul;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'America/Santiago' }).format(new Date());
  const sym = SYM[d.symbols] ?? SYM.letras;
  const pad = PAD[d.density] ?? PAD.normal;
  const bd = d.grid ? 'border border-slate-200' : 'border-b border-slate-100';

  const stats = useMemo(() => {
    const row: Record<string, { p: number; a: number; t: number; j: number; n: number; pct: number | null }> = {};
    for (const s of students) {
      const c = { p: 0, a: 0, t: 0, j: 0, n: 0, pct: null as number | null };
      for (const x of sessions) { const v = rec[`${x.id}|${s.id}`]; if (!v) continue; c.n++; if (v === 'present') c.p++; else if (v === 'absent') c.a++; else if (v === 'late') c.t++; else c.j++; }
      c.pct = c.n ? Math.round(((c.p + c.t + c.j) / c.n) * 100) : null; row[s.id] = c;
    }
    const col: Record<string, number | null> = {};
    for (const x of sessions) { let n = 0, ok = 0; for (const s of students) { const v = rec[`${x.id}|${s.id}`]; if (v) { n++; if (v !== 'absent') ok++; } } col[x.id] = n ? Math.round((ok / n) * 100) : null; }
    return { row, col };
  }, [rec, sessions, students]);

  const mark = (ses: string, stu: string) => {
    if (!canWrite) return;
    const k = `${ses}|${stu}`; const cur = rec[k] ?? null;
    const next = brush === 'ciclo' ? (cur === null ? 'present' : cur === 'excused' ? null : ST[ST.indexOf(cur as typeof ST[number]) + 1]) : brush === 'borrar' ? null : brush;
    setRec((r) => { const n = { ...r }; if (next) n[k] = next; else delete n[k]; return n; });
    start(async () => { const r = await setAttendanceCell(ses, stu, next); if (!r.ok) { setErr(r.error ?? 'No se pudo guardar'); setRec((x) => { const n = { ...x }; if (cur) n[k] = cur; else delete n[k]; return n; }); } else setErr(null); });
  };
  const markCol = (ses: string, st: string) => {
    if (!canWrite) return;
    setRec((r) => { const n = { ...r }; for (const s of students) n[`${ses}|${s.id}`] = st; return n; });
    start(async () => { const r = await setAttendanceColumn(ses, students.map((s) => s.id), st); if (!r.ok) setErr(r.error ?? 'No se pudo guardar'); else router.refresh(); });
  };
  const setExtraCell = (stu: string, key: string, v: string) => {
    setCel((c) => ({ ...c, [`${stu}|${key}`]: v }));
    start(async () => { const r = await setSheetCell(sheet.id, stu, key, v); if (!r.ok) setErr(r.error ?? 'No se pudo guardar'); });
  };
  const saveSheet = (patch: Record<string, string>) => start(async () => {
    const fd = new FormData(); fd.set('sheet_id', sheet.id); for (const [k, v] of Object.entries(patch)) fd.set(k, v);
    const r = await updateSheet(fd); if (!r.ok) setErr(r.error ?? r.message ?? 'No se pudo guardar'); else { setErr(null); router.refresh(); }
  });

  const exportAs = async (fmt: 'xlsx' | 'pdf') => {
    const s = await import('@/lib/office/sheet');
    const head = ['N°', 'Estudiante', ...(d.code ? ['Código'] : []), ...sessions.map((x, i) => fmtHead(x, d.header, i, tz)), ...extra.map((e) => e.label), ...(d.pct ? ['% Asist.'] : []), ...(d.totals ? ['P', 'A', 'T', 'J'] : [])];
    const sh = s.newSheet(sheet.name.slice(0, 31), students.length + 4, head.length);
    const put = (r: number, c: number, v: string, st?: Record<string, unknown>) => { sh.cells[s.addr(r, c)] = { v, ...(st ? { s: st as never } : {}) }; };
    put(0, 0, d.title || sheet.name, { b: true, size: 14 });
    head.forEach((h, c) => put(1, c, h, { b: true, bg: th.hex, color: '#FFFFFF', align: 'center' }));
    students.forEach((stu, i) => {
      let c = 0; const r = i + 2; const st = stats.row[stu.id];
      put(r, c++, String(i + 1)); put(r, c++, stu.name); if (d.code) put(r, c++, stu.code);
      for (const x of sessions) { const v = rec[`${x.id}|${stu.id}`]; put(r, c++, v ? sym[v] : '', v ? { bg: XL[v], align: 'center' } : undefined); }
      for (const e of extra) put(r, c++, cel[`${stu.id}|${e.key}`] ?? '');
      if (d.pct) put(r, c++, st.pct == null ? '' : `${st.pct}%`, st.pct != null && st.pct < minPct ? { color: '#B91C1C', b: true } : undefined);
      if (d.totals) { put(r, c++, String(st.p)); put(r, c++, String(st.a)); put(r, c++, String(st.t)); put(r, c++, String(st.j)); }
    });
    sh.widths = { 1: 220 };
    const blob = await s.exportWorkbook({ sheets: [sh] }, sheet.name, fmt);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${sheet.name}.${fmt}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const Toggle = ({ k, label }: { k: keyof Design; label: string }) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!d[k]} onChange={(e) => setD({ ...d, [k]: e.target.checked })} /> {label}</label>);

  return (
    <div className={`space-y-3 ${FONT[d.font] ?? 'text-sm'}`} data-testid="planilla">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {canWrite && <>
          <span className="text-xs text-slate-500">Marcar con:</span>
          {(['ciclo', ...ST, 'borrar'] as const).map((b) => (
            <button key={b} type="button" onClick={() => setBrush(b)} data-testid={`pincel-${b}`} title={b === 'ciclo' ? 'Cada toque cambia: P → A → T → J → vacío' : b === 'borrar' ? 'Dejar vacía' : LABEL[b]}
              className={`rounded-lg border px-2 py-1 text-xs font-bold ${brush === b ? 'border-slate-900 ring-2 ring-slate-400' : 'border-slate-200'} ${b in CELL ? CELL[b] : 'bg-white'}`}>
              {b === 'ciclo' ? '🔁 Ciclo' : b === 'borrar' ? '⌫ Vacía' : `${sym[b]} ${LABEL[b]}`}</button>))}
        </>}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {canWrite && <button type="button" className="btn-secondary btn-sm" onClick={() => setPanel(panel === 'columna' ? '' : 'columna')} data-testid="agregar-columna">➕ Columna (clase)</button>}
        {canWrite && <button type="button" className="btn-secondary btn-sm" onClick={() => setPanel(panel === 'propia' ? '' : 'propia')} data-testid="columna-propia">➕ Columna propia</button>}
        <button type="button" className="btn-secondary btn-sm" onClick={() => setPanel(panel === 'diseno' ? '' : 'diseno')} data-testid="diseno">🎨 Diseño</button>
        {canWrite && <button type="button" className="btn-secondary btn-sm" onClick={() => setPanel(panel === 'tabla' ? '' : 'tabla')} data-testid="ajustes-tabla">⚙ Tabla</button>}
        <button type="button" className="btn-secondary btn-sm" onClick={() => exportAs('xlsx')} data-testid="exportar-excel">⬇ Excel</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => exportAs('pdf')}>⬇ PDF</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => window.print()}>🖨 Imprimir</button>
        {saving && <span className="text-xs text-slate-500" role="status">Guardando…</span>}
        {err && <span className="text-xs text-red-700" role="alert">{err}</span>}
      </div>

      {panel === 'columna' && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 print:hidden">
          <ActionForm action={addSheetColumn} submitLabel="Agregar columna">
            <input type="hidden" name="section_id" value={sectionId} />
            <div className="grid gap-2 sm:grid-cols-4">
              <label><span className="label">Fecha</span><input type="date" name="date" required className="input" defaultValue={today} /></label>
              <label><span className="label">Inicio</span><input type="time" name="start" defaultValue="08:00" className="input" /></label>
              <label><span className="label">Término</span><input type="time" name="end" defaultValue="09:30" className="input" /></label>
              <label><span className="label">Tema (opcional)</span><input name="topic" maxLength={200} className="input" /></label>
            </div>
            <p className="text-xs text-slate-500">Cada columna es una clase del libro de clases: la asistencia que marque aquí es la oficial.</p>
          </ActionForm>
          <div className="mt-3 border-t border-slate-200 pt-3"><RangeColumns sectionId={sectionId} from={sheet.from_date ?? today} to={sheet.to_date ?? today} /></div>
        </div>)}

      {panel === 'propia' && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 print:hidden" data-testid="panel-propias">
          <p className="text-sm text-slate-600">Columnas propias de esta tabla (observaciones, puntaje, ✓ entregó…):</p>
          {extra.map((e, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input className="input w-48" value={e.label} maxLength={40} onChange={(ev) => setExtra(extra.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x)))} aria-label="Nombre de la columna" />
              <select className="input w-auto" value={e.type} onChange={(ev) => setExtra(extra.map((x, j) => (j === i ? { ...x, type: ev.target.value as Extra['type'] } : x)))}>
                <option value="texto">Texto</option><option value="numero">Número</option><option value="check">✓ Sí / no</option></select>
              <button type="button" className="text-xs text-red-600" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>🗑 Quitar</button>
            </div>))}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setExtra([...extra, { key: `col_${Date.now().toString(36)}`, label: 'Observación', type: 'texto' }])} data-testid="nueva-propia">➕ Agregar</button>
            <button type="button" className="btn-primary btn-sm" onClick={() => saveSheet({ extra_cols: JSON.stringify(extra) })} data-testid="guardar-propias">Guardar columnas</button>
          </div>
        </div>)}

      {panel === 'diseno' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 print:hidden" data-testid="panel-diseno">
          <div className="flex flex-wrap gap-2">{Object.entries(THEMES).map(([k, t]) => (
            <button key={k} type="button" onClick={() => setD({ ...d, theme: k })} className={`rounded-lg px-3 py-1 text-xs font-semibold ${t.head} ${d.theme === k ? 'ring-4 ring-slate-400' : ''}`} data-testid={`tema-${k}`}>{t.name}</button>))}</div>
          <div className="grid gap-2 sm:grid-cols-4">
            <label><span className="label">Letra</span><select className="input" value={d.font} onChange={(e) => setD({ ...d, font: e.target.value })}><option value="sm">Pequeña</option><option value="md">Normal</option><option value="lg">Grande</option></select></label>
            <label><span className="label">Espacio</span><select className="input" value={d.density} onChange={(e) => setD({ ...d, density: e.target.value })}><option value="compacta">Compacta</option><option value="normal">Normal</option><option value="amplia">Amplia</option></select></label>
            <label><span className="label">Símbolos</span><select className="input" value={d.symbols} onChange={(e) => setD({ ...d, symbols: e.target.value })} data-testid="simbolos"><option value="letras">P A T J</option><option value="iconos">✓ ✕ ⏰ 📝</option><option value="palabras">Palabras</option></select></label>
            <label><span className="label">Encabezado</span><select className="input" value={d.header} onChange={(e) => setD({ ...d, header: e.target.value })}><option value="fecha">Fecha</option><option value="fecha_tema">Fecha y tema</option><option value="numero">Clase 1, 2, 3…</option></select></label>
          </div>
          <label className="block"><span className="label">Título para imprimir (opcional)</span><input className="input" value={d.title} maxLength={120} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
          <div className="grid gap-1 sm:grid-cols-3">
            <Toggle k="stripes" label="Filas alternadas" /><Toggle k="grid" label="Líneas de cuadrícula" /><Toggle k="code" label="Columna código" />
            <Toggle k="pct" label="% de asistencia" /><Toggle k="totals" label="Totales P / A / T / J" /><Toggle k="colTotals" label="% por clase (abajo)" />
            <Toggle k="highlightLow" label={`Marcar bajo ${minPct} %`} />
          </div>
          {canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => saveSheet({ design: JSON.stringify(d) })} data-testid="guardar-diseno">Guardar diseño</button>
            : <p className="text-xs text-slate-500">El diseño se aplica solo en su pantalla.</p>}
        </div>)}

      {panel === 'tabla' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 print:hidden">
          <ActionForm action={updateSheet} submitLabel="Guardar" resetOnSuccess={false}>
            <input type="hidden" name="sheet_id" value={sheet.id} />
            <div className="grid gap-2 sm:grid-cols-3">
              <label><span className="label">Nombre de la tabla</span><input name="name" defaultValue={sheet.name} required maxLength={80} className="input" data-testid="nombre-tabla" /></label>
              <label><span className="label">Clases desde</span><input type="date" name="from_date" defaultValue={sheet.from_date ?? ''} className="input" /></label>
              <label><span className="label">Hasta</span><input type="date" name="to_date" defaultValue={sheet.to_date ?? ''} className="input" /></label>
            </div>
          </ActionForm>
          <ActionForm action={deleteSheet} inline submitLabel="🗑 Eliminar esta tabla" submitClass="text-sm text-red-600 hover:underline" confirm={`¿Eliminar la tabla «${sheet.name}»? La asistencia de las clases se conserva.`}>
            <input type="hidden" name="sheet_id" value={sheet.id} /></ActionForm>
        </div>)}

      {d.title && <h3 className="hidden text-lg font-bold print:block">{d.title}</h3>}
      <div className="overflow-auto rounded-xl border border-slate-200 bg-white" data-testid="tabla-asistencia">
        <table className="min-w-full border-collapse">
          <thead><tr className={th.head}>
            <th className={`${pad} ${bd} sticky left-0 z-10 ${th.head} text-left`}>N°</th>
            <th className={`${pad} ${bd} sticky left-8 z-10 ${th.head} min-w-[11rem] text-left`}>Estudiante</th>
            {d.code && <th className={`${pad} ${bd}`}>Código</th>}
            {sessions.map((x, i) => (
              <th key={x.id} className={`${pad} ${bd} min-w-[3.5rem] align-top`} data-testid="columna-clase">
                <span className="block whitespace-nowrap">{fmtHead(x, d.header, i, tz)}</span>
                {d.header === 'fecha_tema' && x.topic && <span className="block max-w-[8rem] truncate text-[10px] font-normal opacity-80">{x.topic}</span>}
                {canWrite && <details className="relative text-left font-normal print:hidden"><summary className="cursor-pointer list-none text-center text-[10px] opacity-80">⋯</summary>
                  <div className="absolute left-0 z-20 mt-1 w-56 space-y-1 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 shadow-lg">
                    <p className="font-semibold">Toda la columna:</p>
                    <div className="flex flex-wrap gap-1">{ST.map((st) => <button key={st} type="button" className={`rounded px-2 py-0.5 ${CELL[st]}`} onClick={() => markCol(x.id, st)} data-testid={`columna-${st}`}>{sym[st]}</button>)}</div>
                    <ActionForm action={editSheetColumn} submitLabel="Guardar tema" resetOnSuccess={false}><input type="hidden" name="session_id" value={x.id} />
                      <input name="topic" defaultValue={x.topic ?? ''} maxLength={200} placeholder="Tema de la clase" className="input py-1 text-xs" /></ActionForm>
                    <ActionForm action={deleteSheetColumn} inline submitLabel="🗑 Eliminar columna" submitClass="text-red-600 hover:underline" confirm="¿Eliminar esta clase y su asistencia? No se puede deshacer.">
                      <input type="hidden" name="session_id" value={x.id} /><input type="hidden" name="section_id" value={sectionId} /></ActionForm>
                  </div></details>}
              </th>))}
            {extra.map((e) => <th key={e.key} className={`${pad} ${bd} min-w-[7rem]`}>{e.label}</th>)}
            {d.pct && <th className={`${pad} ${bd}`}>%</th>}
            {d.totals && ['P', 'A', 'T', 'J'].map((h) => <th key={h} className={`${pad} ${bd}`}>{h}</th>)}
          </tr></thead>
          <tbody>{students.map((s, i) => {
            const st = stats.row[s.id]; const low = d.highlightLow && st.pct != null && st.pct < minPct;
            const rowBg = low ? 'bg-red-50' : d.stripes && i % 2 ? th.soft : 'bg-white';
            return (
              <tr key={s.id} className={rowBg} data-testid="fila-estudiante">
                <td className={`${pad} ${bd} sticky left-0 ${rowBg} text-slate-500`}>{i + 1}</td>
                <td className={`${pad} ${bd} sticky left-8 ${rowBg} whitespace-nowrap font-medium`}>{s.name}</td>
                {d.code && <td className={`${pad} ${bd} text-slate-500`}>{s.code}</td>}
                {sessions.map((x) => { const v = rec[`${x.id}|${s.id}`]; return (
                  <td key={x.id} className={`${bd} p-0 text-center`}>
                    <button type="button" disabled={!canWrite} onClick={() => mark(x.id, s.id)} data-testid="celda" data-estado={v ?? ''}
                      className={`h-full min-h-[2rem] w-full font-bold ${v ? CELL[v] : 'text-slate-300 hover:bg-slate-50'} ${canWrite ? 'cursor-pointer' : 'cursor-default'}`}
                      aria-label={`${s.name}: ${v ? LABEL[v] : 'sin marcar'}`}>{v ? sym[v] : '·'}</button>
                  </td>); })}
                {extra.map((e) => { const v = cel[`${s.id}|${e.key}`] ?? ''; return (
                  <td key={e.key} className={`${bd} p-0`}>
                    {e.type === 'check'
                      ? <label className="flex justify-center"><input type="checkbox" disabled={!canWrite} checked={v === '1'} onChange={(ev) => setExtraCell(s.id, e.key, ev.target.checked ? '1' : '')} /></label>
                      : <input className={`w-full bg-transparent ${pad} outline-none focus:bg-yellow-50`} disabled={!canWrite} defaultValue={v} inputMode={e.type === 'numero' ? 'decimal' : 'text'}
                          onBlur={(ev) => { if (ev.target.value !== v) setExtraCell(s.id, e.key, ev.target.value); }} aria-label={`${e.label} de ${s.name}`} data-testid="celda-propia" />}
                  </td>); })}
                {d.pct && <td className={`${pad} ${bd} text-center font-semibold ${low ? 'text-red-700' : ''}`} data-testid="porcentaje">{st.pct == null ? '—' : `${st.pct}%`}</td>}
                {d.totals && [st.p, st.a, st.t, st.j].map((n, k) => <td key={k} className={`${pad} ${bd} text-center`}>{n}</td>)}
              </tr>); })}
          </tbody>
          {d.colTotals && sessions.length > 0 && <tfoot><tr className="bg-slate-100 font-semibold">
            <td className={`${pad} ${bd} sticky left-0 bg-slate-100`} /><td className={`${pad} ${bd} sticky left-8 bg-slate-100`}>% asistencia</td>{d.code && <td className={bd} />}
            {sessions.map((x) => <td key={x.id} className={`${pad} ${bd} text-center`}>{stats.col[x.id] == null ? '—' : `${stats.col[x.id]}%`}</td>)}
            {extra.map((e) => <td key={e.key} className={bd} />)}{d.pct && <td className={bd} />}{d.totals && [0, 1, 2, 3].map((k) => <td key={k} className={bd} />)}
          </tr></tfoot>}
        </table>
        {!sessions.length && (
          <div className="space-y-3 p-4 text-center" data-testid="sin-clases">
            <p className="text-sm text-slate-600">Para marcar asistencia, primero cree las <b>columnas</b>: cada columna es un día de clases.</p>
            {canWrite && <>
              <button type="button" className="btn-primary" disabled={saving} data-testid="clase-hoy" onClick={() => start(async () => {
                const fd = new FormData(); fd.set('section_id', sectionId); fd.set('date', today); fd.set('start', '08:00'); fd.set('end', '09:30');
                const r = await addSheetColumn(fd); if (r.ok) { setErr(null); router.refresh(); } else setErr(r.error ?? 'Error');
              })}>➕ Agregar la clase de hoy y marcar</button>
              <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-3 text-left"><RangeColumns sectionId={sectionId} from={sheet.from_date ?? today} to={sheet.to_date ?? today} /></div>
            </>}
          </div>)}
        {!students.length && <p className="p-4 text-center text-sm text-slate-500">Sin estudiantes inscritos.</p>}
      </div>
      <p className="text-xs text-slate-500 print:hidden">P = presente · A = ausente · T = atrasado · J = justificado. Toque una celda para marcar. Se guarda solo.</p>
    </div>
  );
}
