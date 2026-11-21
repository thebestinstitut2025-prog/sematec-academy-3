'use client';
import { useEffect, useRef, useState } from 'react';

type Part = { id: string; n: number; secs: number };

/**
 * ▶ Reproduce todas las partes de una grabación como UN solo video, sin cortes:
 * mientras suena una parte, la siguiente ya está cargada y entra sola al terminar.
 */
export function ContinuousVideo({ parts, start = 0, allowDownload }: { parts: Part[]; start?: number; allowDownload: boolean }) {
  const [cur, setCur] = useState(Math.min(Math.max(0, start), parts.length - 1));
  const [t, setT] = useState(0);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [front, setFront] = useState<'a' | 'b'>('a');
  const src = (i: number) => (i >= 0 && i < parts.length ? `/app/conferencias/grabacion/${parts[i].id}` : '');
  const total = parts.reduce((x, p) => x + (p.secs || 0), 0);
  const before = parts.slice(0, cur).reduce((x, p) => x + (p.secs || 0), 0);
  const vid = (k: 'a' | 'b') => (k === 'a' ? a.current : b.current);

  // Precarga la parte siguiente en el reproductor oculto
  useEffect(() => {
    const back = vid(front === 'a' ? 'b' : 'a');
    const next = src(cur + 1);
    if (back && next && back.dataset.src !== next) { back.dataset.src = next; back.src = next; back.preload = 'auto'; back.load(); }
  }, [cur, front]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number, play = true) => {
    if (i < 0 || i >= parts.length) return;
    const back = vid(front === 'a' ? 'b' : 'a'); const fr = vid(front);
    if (i === cur + 1 && back && back.dataset.src === src(i)) {
      fr?.pause(); back.currentTime = 0; setFront(front === 'a' ? 'b' : 'a'); setCur(i);
      if (play) back.play().catch(() => {});
      return;
    }
    if (fr) { fr.dataset.src = src(i); fr.src = src(i); fr.load(); if (play) fr.play().catch(() => {}); }
    setCur(i);
  };

  const mmss = (x: number) => { x = Math.max(0, Math.round(x)); const h = Math.floor(x / 3600); const m = Math.floor((x % 3600) / 60); const s = x % 60;
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`; };
  const common = {
    controls: true, playsInline: true, className: 'max-h-[70vh] w-full rounded-xl bg-black',
    controlsList: allowDownload ? undefined : 'nodownload', disablePictureInPicture: !allowDownload,
    onContextMenu: allowDownload ? undefined : (e: React.MouseEvent) => e.preventDefault(),
  } as const;
  return (
    <div data-testid="video-continuo">
      <div className="relative">
        {(['a', 'b'] as const).map((k) => (
          <video key={k} ref={k === 'a' ? a : b} {...common} data-testid={front === k ? 'video-protegido' : undefined}
            src={k === 'a' ? src(start) : undefined} data-src={k === 'a' ? src(start) : undefined} preload={k === 'a' ? 'metadata' : 'auto'}
            style={{ display: front === k ? 'block' : 'none' }}
            onTimeUpdate={(e) => { if (front === k) setT(e.currentTarget.currentTime); }}
            onEnded={() => { if (front === k) go(cur + 1); }} />))}
      </div>
      {parts.length > 1 && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold">🎬 Clase completa · {mmss(before + t)} / {mmss(total)}</span>
            <span className="text-xs text-slate-500">Las {parts.length} partes se reproducen seguidas, sin cortes.</span>
          </div>
          <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-slate-200" role="group" aria-label="Partes de la grabación">
            {parts.map((p, i) => (
              <button key={p.id} type="button" title={`Parte ${p.n} · ${mmss(p.secs)}`} onClick={() => go(i)} data-testid="parte-grabacion"
                className={`h-full border-r border-white last:border-r-0 ${i < cur ? 'bg-brand-600' : i === cur ? 'bg-brand-400' : 'bg-slate-300 hover:bg-slate-400'}`}
                style={{ width: `${total ? ((p.secs || 1) / total) * 100 : 100 / parts.length}%` }} />))}
          </div>
          <p className="mt-1 text-xs text-slate-500" data-testid="parte-actual">Parte {cur + 1} de {parts.length}</p>
        </div>)}
    </div>
  );
}
