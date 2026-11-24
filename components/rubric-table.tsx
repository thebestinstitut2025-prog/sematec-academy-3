/** 📏 Rúbrica de una tarea (con el puntaje obtenido por criterio, si ya fue calificada). */
export function RubricTable({ rubric, scores }: { rubric: { c: string; max: number; d?: string }[]; scores?: (number | string)[] | null }) {
  const total = rubric.reduce((n, r) => n + Number(r.max), 0);
  const got = scores ? scores.reduce((n: number, v) => n + Number(v || 0), 0) : null;
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200" data-testid="rubrica">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">📏 Criterio</th><th className="px-3 py-2">Descripción</th><th className="px-3 py-2 text-right">Puntos</th></tr></thead>
        <tbody>{rubric.map((r, i) => (
          <tr key={i} className="border-t border-slate-100"><td className="px-3 py-2 font-semibold">{r.c}</td><td className="px-3 py-2 text-slate-600">{r.d}</td>
            <td className="px-3 py-2 text-right tabular-nums">{scores ? <b>{scores[i]}</b> : null}{scores ? ' / ' : ''}{r.max}</td></tr>))}</tbody>
        <tfoot className="border-t border-slate-200 bg-slate-50 font-bold"><tr><td className="px-3 py-2" colSpan={2}>Total</td><td className="px-3 py-2 text-right tabular-nums">{got != null ? `${got} / ` : ''}{total}</td></tr></tfoot>
      </table>
    </div>
  );
}
