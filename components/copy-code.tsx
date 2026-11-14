'use client';
import { useState } from 'react';

/** Muestra un código (p. ej. de sala) con botón para copiarlo. */
export function CopyCode({ code, label = 'Código de sala' }: { code: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-1.5 text-sm ring-1 ring-brand-200" data-testid="codigo-sala">
      <span className="text-slate-600">🔑 {label}:</span>
      <b className="font-mono tracking-wider text-brand-800">{code}</b>
      <button type="button" className="link text-xs" onClick={async () => { await navigator.clipboard?.writeText(code).catch(() => {}); setOk(true); setTimeout(() => setOk(false), 2000); }}>
        {ok ? '✓ Copiado' : 'Copiar'}
      </button>
    </span>
  );
}
