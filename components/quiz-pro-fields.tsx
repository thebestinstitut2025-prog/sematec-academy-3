import { QUIZ_THEMES } from '@/lib/quiz';

/** 🎨 Color de portada (examen o tarea). */
export function ThemePicker({ value = 'azul' }: { value?: string }) {
  return (
    <fieldset className="text-sm" data-testid="color-portada"><legend className="label">🎨 Color de portada</legend>
      <div className="flex flex-wrap gap-2">{Object.entries(QUIZ_THEMES).map(([k, t]) => (
        <label key={k} className="cursor-pointer">
          <input type="radio" name="theme" value={k} defaultChecked={value === k} className="peer sr-only" data-testid={`portada-${k}`} />
          <span className={`block rounded-lg bg-gradient-to-r ${t.grad} px-3 py-1.5 text-xs font-semibold text-white ring-offset-2 peer-checked:ring-2 peer-checked:ring-slate-700`}>{t.name}</span>
        </label>))}</div>
    </fieldset>
  );
}

/** ✨ Opciones «pro» del examen. */
export function QuizProFields({ q }: { q?: { theme?: string; shuffle_questions?: boolean; shuffle_options?: boolean; one_per_page?: boolean; show_feedback?: boolean; pass_pct?: number | null } }) {
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-3" data-testid="opciones-pro">
      <p className="text-sm font-bold">✨ Presentación y reglas</p>
      <ThemePicker value={q?.theme ?? 'azul'} />
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <label className="flex items-center gap-2"><input type="checkbox" name="shuffle_questions" defaultChecked={q?.shuffle_questions} /> 🔀 Preguntas en orden aleatorio</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="shuffle_options" defaultChecked={q?.shuffle_options} /> 🔀 Alternativas en orden aleatorio</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="one_per_page" defaultChecked={q?.one_per_page} /> 📄 Una pregunta por página</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="show_feedback" defaultChecked={q?.show_feedback ?? true} /> 💬 Mostrar retroalimentación en la revisión</label>
      </div>
      <label className="block text-sm"><span className="label">🎯 % para aprobar (opcional)</span>
        <input name="pass_pct" type="number" min={1} max={100} defaultValue={q?.pass_pct ?? ''} className="input w-32" placeholder="60" /></label>
    </div>
  );
}

/** 📏 Rúbrica de la tarea. */
export function RubricField({ value = '' }: { value?: string }) {
  return (
    <label className="block text-sm" data-testid="rubrica-campo"><span className="label">📏 Rúbrica (opcional): un criterio por línea · «Criterio | puntos | descripción»</span>
      <textarea name="rubric" rows={4} defaultValue={value} className="input mt-1 w-full font-mono text-sm"
        placeholder={'Contenido | 40 | Responde todo lo pedido\nOrtografía | 20 | Sin faltas\nPresentación | 40 | Ordenado y con portada'} />
      <span className="text-xs text-slate-500">Con rúbrica, usted califica cada criterio y el total se ajusta al puntaje máximo de la tarea.</span>
    </label>
  );
}
