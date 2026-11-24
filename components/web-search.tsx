'use client';
import { useState } from 'react';
import { ENGINES } from '@/lib/web-search';

/** 🔎 Buscar en Google (y YouTube, Maps, Noticias, Académico, Wikipedia…) desde la plataforma. */
export function WebSearch({ initial = '', compact = false }: { initial?: string; compact?: boolean }) {
  const [q, setQ] = useState(initial);
  const [eng, setEng] = useState('google');
  const go = (k = eng) => { const t = q.trim(); if (!t) return; const e = ENGINES.find((x) => x.key === k)!; window.open(e.url(t), '_blank', 'noopener,noreferrer'); };
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); go(); }} data-testid="buscar-internet" role="search">
      <div className="flex gap-2">
        <input className="input flex-1 text-base" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔎 Buscar en Google…" aria-label="Buscar en internet" maxLength={300} enterKeyHint="search" data-testid="texto-internet" />
        <button className="btn-primary" type="submit" data-testid="buscar-google">Buscar</button>
      </div>
      {!compact && <div className="flex flex-wrap gap-1">{ENGINES.map((e) => (
        <button key={e.key} type="button" onClick={() => { setEng(e.key); go(e.key); }} data-testid={`motor-${e.key}`}
          className={`rounded-full border px-3 py-1 text-xs ${eng === e.key ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-200 hover:bg-slate-50'}`}>{e.icon} {e.label}</button>))}</div>}
    </form>
  );
}
