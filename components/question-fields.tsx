'use client';
import { useState } from 'react';
import { QUIZ_KINDS } from '@/lib/quiz';
import { AttachFiles } from '@/components/attach-files';

/** Campos de una pregunta: cambian según el tipo elegido (con ayuda y ejemplo). */
export function QuestionFields({ org, d = {} }: {
  org: string;
  d?: { kind?: string; prompt?: string; text?: string; value?: string; tol?: string; feedback?: string | null; points?: string; position?: string };
}) {
  const [kind, setKind] = useState(d.kind ?? 'unica');
  const k = QUIZ_KINDS.find((x) => x.value === kind) ?? QUIZ_KINDS[0];
  const noOptions = kind === 'numerica' || kind === 'completar';
  return (
    <div className="space-y-3" data-testid="campos-pregunta">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm sm:col-span-1"><span className="label">Tipo de pregunta</span>
          <select name="kind" className="input mt-1 w-full" value={kind} onChange={(e) => setKind(e.target.value)} data-testid="tipo-pregunta">
            {QUIZ_KINDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select></label>
        <label className="text-sm"><span className="label">Puntos</span><input name="points" type="number" step="0.5" min="0.5" defaultValue={d.points ?? '1'} className="input mt-1 w-full" /></label>
        <label className="text-sm"><span className="label">Orden</span><input name="position" type="number" defaultValue={d.position ?? ''} className="input mt-1 w-full" /></label>
      </div>
      <label className="block text-sm"><span className="label">Pregunta {kind === 'completar' && <span className="font-normal text-slate-500">(respuestas entre [corchetes])</span>}</span>
        <textarea name="prompt" required rows={3} defaultValue={d.prompt ?? ''} className="input mt-1 w-full"
          placeholder={kind === 'completar' ? 'La capital de Chile es [Santiago] y la de Perú es [Lima].' : 'Escriba la pregunta…'} /></label>
      <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900" data-testid="ayuda-tipo">💡 {k.help}</p>
      {kind === 'numerica' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm"><span className="label">Respuesta correcta</span><input name="num_value" required inputMode="decimal" defaultValue={d.value ?? ''} className="input mt-1 w-full" placeholder="3.14" /></label>
          <label className="text-sm"><span className="label">Margen aceptado (±)</span><input name="num_tol" inputMode="decimal" defaultValue={d.tol ?? '0'} className="input mt-1 w-full" /></label>
        </div>
      ) : !noOptions && (
        <label className="block text-sm"><span className="label">{kind === 'desarrollo' ? 'Pauta de corrección (opcional, solo usted la ve)' : kind === 'corta' ? 'Respuestas aceptadas' : kind === 'ordenar' ? 'Elementos en el orden correcto' : kind === 'unir' ? 'Parejas' : 'Opciones'}</span>
          <textarea name="options" rows={kind === 'vf' ? 1 : 5} required={kind !== 'desarrollo'} defaultValue={d.text ?? ''} placeholder={k.sample} className="input mt-1 w-full font-mono text-sm" /></label>
      )}
      <label className="block text-sm"><span className="label">💬 Retroalimentación (la ve el estudiante en la revisión)</span>
        <textarea name="feedback" rows={2} maxLength={2000} defaultValue={d.feedback ?? ''} className="input mt-1 w-full" placeholder="Explique por qué esa es la respuesta correcta…" /></label>
      <AttachFiles org={org} max={3} label="🖼 Imagen o archivo de la pregunta (opcional)" />
    </div>
  );
}
