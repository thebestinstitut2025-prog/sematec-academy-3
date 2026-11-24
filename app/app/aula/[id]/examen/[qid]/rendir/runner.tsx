'use client';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { startQuiz, submitQuiz } from '../../../../actions';
import { AttachFiles } from '@/components/attach-files';
import { BLANK, themeOf } from '@/lib/quiz';

export type RunnerQ = {
  id: string; prompt: string; kind: string; options: string[]; choices: string[] | null; points: number;
  images?: { id: string; name: string; mime: string }[];
};

export function StartQuiz({ quizId }: { quizId: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div>
      <button className="btn-primary px-6 py-3 text-base" data-testid="comenzar-prueba" disabled={pending} onClick={() => start(async () => {
        const fd = new FormData(); fd.set('quiz_id', quizId);
        const r = await startQuiz(fd);
        if (r.ok) router.refresh(); else setErr(r.error ?? 'Error');
      })}>{pending ? 'Entrando…' : '▶ Entrar a la prueba'}</button>
      {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
    </div>
  );
}

// Orden aleatorio, pero siempre el mismo para este intento (si recarga, no cambia)
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
}
function perm(n: number, r: () => number) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const LETTERS = 'ABCDEFGHIJKL';

export function QuizRunner({ attemptId, deadline, startedAt, questions, back, org, title = '', theme, shuffleQ = false, shuffleO = false, onePerPage = false, reviewHref, preview = false }: {
  attemptId: string; deadline: string; startedAt?: string; questions: RunnerQ[]; back: string; org?: string; title?: string; theme?: string;
  shuffleQ?: boolean; shuffleO?: boolean; onePerPage?: boolean; reviewHref?: string; preview?: boolean;
}) {
  const th = themeOf(theme);
  const KEY = `sematec-quiz-${attemptId}`;
  const { order, optOrder } = useMemo(() => {
    const r = rng(attemptId);
    const order = shuffleQ ? perm(questions.length, r).map((i) => questions[i]) : questions;
    const optOrder: Record<string, number[]> = {};
    for (const q of questions) optOrder[q.id] = shuffleO && (q.kind === 'unica' || q.kind === 'multiple') ? perm(q.options.length, r) : q.options.map((_, i) => i);
    return { order, optOrder };
  }, [attemptId, questions, shuffleQ, shuffleO]);

  const [files, setFiles] = useState<{ ids: string[]; pending: boolean }>({ ids: [], pending: false });
  const [ans, setAns] = useState<Record<string, unknown>>({});
  const [flags, setFlags] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - Date.now());
  const [res, setRes] = useState<{ ok: boolean; message?: string; error?: string; data?: any } | null>(null);
  const [pending, start] = useTransition();
  const sent = useRef(false);
  const router = useRouter();

  // 💾 Guarda las respuestas en este equipo mientras responde (si se corta la luz o recarga, no se pierden)
  useEffect(() => { if (preview) return; try { const s = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (s?.ans) setAns(s.ans); if (s?.flags) setFlags(s.flags); } catch { /* sin almacenamiento */ } }, [KEY]);
  useEffect(() => { if (preview) return; try { localStorage.setItem(KEY, JSON.stringify({ ans, flags })); } catch { /* sin almacenamiento */ } }, [KEY, ans, flags]);

  const send = () => {
    if (sent.current || preview) return;
    if (files.pending && new Date(deadline).getTime() > Date.now()) { setRes({ ok: false, error: 'Espere a que terminen de subir sus archivos.' }); return; }
    sent.current = true;
    start(async () => {
      try {
        const r = await submitQuiz(attemptId, ans, files.ids); setRes(r);
        if (!r.ok) sent.current = false; else { try { localStorage.removeItem(KEY); } catch { /* */ } }
      } catch { sent.current = false; setRes({ ok: false, error: 'Sin conexión: el examen NO se envió. Sus respuestas siguen guardadas en este equipo; reintente.' }); }
    });
  };
  useEffect(() => {
    const t = setInterval(() => { const l = new Date(deadline).getTime() - Date.now(); setLeft(l); if (l <= 0) { clearInterval(t); if (!preview) send(); } }, 1000);
    return () => clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const answered = (q: RunnerQ) => {
    const v = ans[q.id];
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (!Array.isArray(v)) return false;
    if (q.kind === 'completar') return v.some((x) => typeof x === 'string' && x.trim());
    if (q.kind === 'unir') return v.length === q.options.length && v.every((x) => x != null);
    return v.length > 0;
  };
  const nDone = order.filter(answered).length;

  if (res?.ok) {
    const d = res.data ?? {};
    return (
      <div className="card overflow-hidden text-center" data-testid="resultado-examen">
        <div className={`bg-gradient-to-r ${th.grad} px-6 py-8 text-white`}>
          <p className="text-4xl">{d.pass === false ? '📘' : '🎉'}</p>
          <p className="mt-2 text-xl font-bold">✓ {res.message}</p>
          {d.show && d.max > 0 && <div className="mx-auto mt-4 h-3 max-w-sm overflow-hidden rounded-full bg-white/30"><div className="h-full rounded-full bg-white" style={{ width: `${Math.round((d.score / d.max) * 100)}%` }} /></div>}
        </div>
        <div className="p-6">
          {d.show && d.pass != null && <p className={`mb-3 inline-block rounded-full px-4 py-1 text-sm font-bold ${d.pass ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`} data-testid="aprobado">{d.pass ? '✅ Aprobado' : '📘 No alcanzó el puntaje para aprobar'}</p>}
          {d.review && <p className="mb-3 text-sm text-slate-600">📝 Hay respuestas de desarrollo: el profesor las corregirá y su puntaje se actualizará.</p>}
          <div className="flex flex-wrap justify-center gap-2">
            {reviewHref && d.show && <a className="btn-secondary" href={reviewHref} data-testid="ver-revision">🔍 Ver mis respuestas</a>}
            <button className="btn-primary" onClick={() => router.push(back)}>Volver</button>
          </div>
        </div>
      </div>);
  }

  const mm = Math.max(0, Math.floor(left / 60000)), ss = Math.max(0, Math.floor((left % 60000) / 1000));
  const total = startedAt ? new Date(deadline).getTime() - new Date(startedAt).getTime() : 0;
  const timePct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 100;
  const set = (id: string, v: unknown) => setAns((a) => ({ ...a, [id]: v }));
  const toggle = (q: RunnerQ, i: number) => {
    const cur = Array.isArray(ans[q.id]) ? (ans[q.id] as number[]) : [];
    set(q.id, q.kind === 'multiple' ? (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]) : [i]);
  };
  const flag = (id: string) => setFlags((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  const shown = onePerPage ? [order[Math.min(page, order.length - 1)]] : order;
  const goTo = (i: number) => { if (onePerPage) setPage(i); else document.getElementById(`p-${order[i].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  const missing = order.length - nDone;

  return (
    <div className="space-y-4">
      {/* Encabezado fijo: portada de color, tiempo, avance y mapa de preguntas */}
      <div className="sticky top-2 z-10 overflow-hidden rounded-2xl shadow-lg" data-testid="barra-examen">
        <div className={`bg-gradient-to-r ${left < 120000 ? 'from-red-700 to-red-500' : th.grad} px-4 py-3 text-white`}>
          <div className="flex flex-wrap items-center gap-3">
            {title && <p className="min-w-0 flex-1 truncate font-bold">{title}</p>}
            <p className="rounded-full bg-white/20 px-3 py-1 text-sm font-bold tabular-nums" data-testid="tiempo">⏱ Tiempo restante: {mm}:{String(ss).padStart(2, '0')}</p>
            <p className="text-sm font-semibold" data-testid="avance">Respondidas {nDone} de {order.length}</p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/25" title="Avance"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${order.length ? (nDone / order.length) * 100 : 0}%` }} data-testid="barra-avance" /></div>
          {total > 0 && <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/20" title="Tiempo"><div className="h-full bg-amber-300 transition-all" style={{ width: `${timePct}%` }} /></div>}
        </div>
        <div className="flex flex-wrap gap-1 bg-white px-3 py-2" data-testid="mapa-preguntas">
          {order.map((q, i) => (
            <button key={q.id} type="button" onClick={() => goTo(i)} data-testid="mapa-pregunta"
              className={`h-8 w-8 rounded-lg text-xs font-bold ${flags.includes(q.id) ? 'bg-amber-400 text-white' : answered(q) ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'} ${onePerPage && i === page ? `ring-2 ring-offset-1 ${th.ring}` : ''}`}
              title={flags.includes(q.id) ? 'Marcada para revisar' : answered(q) ? 'Respondida' : 'Sin responder'}>{i + 1}</button>))}
          <span className="ml-auto self-center text-[11px] text-slate-500">🟩 respondida · 🟨 para revisar · ⬜ sin responder</span>
        </div>
      </div>

      {shown.map((q) => {
        const n = order.indexOf(q);
        const v = ans[q.id];
        return (
          <div key={q.id} id={`p-${q.id}`} className="card card-pad scroll-mt-40" data-testid="pregunta">
            <div className="flex flex-wrap items-start gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${th.grad} text-sm font-bold text-white`}>{n + 1}</span>
              <div className="min-w-0 flex-1">
                {q.kind === 'completar' ? (
                  <p className="leading-9">{q.prompt.split(BLANK).map((part, i, arr) => (
                    <span key={i}><span className="whitespace-pre-line">{part}</span>{i < arr.length - 1 && (
                      <input className="mx-1 inline-block w-36 rounded-md border-b-2 border-slate-400 bg-slate-50 px-2 py-0.5 text-center" data-testid="espacio"
                        value={(Array.isArray(v) ? (v as string[])[i] : '') ?? ''} aria-label={`Espacio ${i + 1}`}
                        onChange={(e) => { const cur = Array.isArray(v) ? [...(v as string[])] : Array(arr.length - 1).fill(''); cur[i] = e.target.value; set(q.id, cur); }} />)}</span>))}</p>
                ) : <p className="whitespace-pre-line font-semibold">{q.prompt}</p>}
                <p className="mt-0.5 text-xs text-slate-500">{q.points} pt{q.kind === 'multiple' ? ' · puede marcar varias' : q.kind === 'ordenar' ? ' · ordene con las flechas' : q.kind === 'unir' ? ' · una pareja para cada uno' : q.kind === 'desarrollo' ? ' · la corrige el profesor' : ''}</p>
              </div>
              <button type="button" onClick={() => flag(q.id)} className={`rounded-lg px-2 py-1 text-xs ${flags.includes(q.id) ? 'bg-amber-100 text-amber-800' : 'text-slate-400 hover:bg-slate-100'}`} data-testid="marcar-revisar">🚩 {flags.includes(q.id) ? 'Marcada' : 'Revisar después'}</button>
            </div>
            {q.images?.length ? <div className="mt-3 flex flex-wrap gap-2">{q.images.map((im) => im.mime.startsWith('image/')
              ? <a key={im.id} href={`/api/adjunto/${im.id}`} target="_blank" rel="noopener noreferrer"><img src={`/api/adjunto/${im.id}`} alt={im.name} className="max-h-72 rounded-lg border" data-testid="imagen-pregunta" /></a>
              : <a key={im.id} className="link text-sm" href={`/api/adjunto/${im.id}`} target="_blank" rel="noopener noreferrer">📎 {im.name}</a>)}</div> : null}

            <div className="mt-3">
              {(q.kind === 'unica' || q.kind === 'multiple' || q.kind === 'vf') && <div className="space-y-2">{optOrder[q.id].map((i, pos) => (
                <label key={i} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                  <input type={q.kind === 'multiple' ? 'checkbox' : 'radio'} name={q.id} checked={Array.isArray(v) && (v as number[]).includes(i)} onChange={() => toggle(q, i)} />
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-600">{LETTERS[pos]}</span>{q.options[i]}
                </label>))}</div>}
              {q.kind === 'corta' && <input className="input w-full" placeholder="Escriba su respuesta" value={(v as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} data-testid="resp-corta" maxLength={300} />}
              {q.kind === 'numerica' && <input className="input w-48" inputMode="decimal" placeholder="Número" value={(v as string) ?? ''} onChange={(e) => set(q.id, e.target.value.replace(/[^0-9.,-]/g, ''))} data-testid="resp-numerica" />}
              {q.kind === 'desarrollo' && <div><textarea className="input w-full" rows={6} placeholder="Desarrolle su respuesta…" value={(v as string) ?? ''} onChange={(e) => set(q.id, e.target.value)} data-testid="resp-desarrollo" maxLength={20000} />
                <p className="text-right text-xs text-slate-400">{((v as string) ?? '').trim().split(/\s+/).filter(Boolean).length} palabras</p></div>}
              {q.kind === 'ordenar' && (() => {
                const cur = Array.isArray(v) ? (v as number[]) : q.options.map((_, i) => i);
                const move = (a: number, b: number) => { if (b < 0 || b >= cur.length) return; const x = [...cur]; [x[a], x[b]] = [x[b], x[a]]; set(q.id, x); };
                return <ol className="space-y-2" data-testid="ordenar">{cur.map((i, pos) => (
                  <li key={i} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2" data-testid="item-ordenar">
                    <span className="w-6 text-center text-sm font-bold text-slate-400">{pos + 1}</span><span className="flex-1">{q.options[i]}</span>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => move(pos, pos - 1)} disabled={pos === 0} aria-label="Subir" data-testid="subir">↑</button>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => move(pos, pos + 1)} disabled={pos === cur.length - 1} aria-label="Bajar" data-testid="bajar">↓</button>
                  </li>))}</ol>;
              })()}
              {q.kind === 'unir' && <div className="space-y-2" data-testid="unir">{q.options.map((o, i) => {
                const cur = Array.isArray(v) ? (v as (number | null)[]) : [];
                return (
                  <div key={i} className="grid items-center gap-2 rounded-xl border border-slate-200 p-2 sm:grid-cols-[1fr_auto_1fr]">
                    <span className="font-medium">{o}</span><span className="hidden text-slate-400 sm:block">🔗</span>
                    <select className="input" value={cur[i] ?? ''} data-testid="pareja" onChange={(e) => {
                      const x = q.options.map((_, j) => (cur[j] ?? null)); x[i] = e.target.value === '' ? null : Number(e.target.value); set(q.id, x);
                    }}><option value="">Elegir…</option>{(q.choices ?? []).map((c, j) => <option key={j} value={j}>{c}</option>)}</select>
                  </div>);
              })}</div>}
            </div>
          </div>);
      })}

      {onePerPage && (
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)} data-testid="anterior">← Anterior</button>
          <span className="text-sm text-slate-500">Pregunta {page + 1} de {order.length}</span>
          <button type="button" className="btn-primary" disabled={page >= order.length - 1} onClick={() => setPage((p) => p + 1)} data-testid="siguiente">Siguiente →</button>
        </div>)}

      {(!onePerPage || page >= order.length - 1) && <>
        {org && !preview && <div className="card card-pad"><AttachFiles org={org} label="📎 Adjuntar archivos al examen (desarrollo, fotos de su hoja, PDF…)" onChange={(ids, p) => setFiles({ ids, pending: p })} /></div>}
        {missing > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" data-testid="sin-responder">⚠ Le falta{missing > 1 ? 'n' : ''} {missing} pregunta{missing > 1 ? 's' : ''} por responder.</p>}
        {preview ? <p className="rounded-lg bg-blue-50 p-3 text-center text-sm text-blue-900" data-testid="vista-previa-envio">👁 Vista previa: puede responder para probar, pero no se envía ni se guarda.</p> :
        <button className="btn-primary w-full py-3 text-base" disabled={pending} onClick={() => {
          if (window.confirm(`¿Enviar el examen?${missing ? ` Tiene ${missing} pregunta(s) sin responder.` : ''} No podrá cambiar sus respuestas.`)) send();
        }}>{pending ? 'Enviando…' : 'Enviar examen'}</button>}
      </>}
      {res && !res.ok && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{res.error}</p>}
    </div>
  );
}
