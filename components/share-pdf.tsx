'use client';
import { useState } from 'react';

/** 📤 Compartir el PDF con las apps del teléfono (WhatsApp, correo, Drive…); si no se puede, comparte el enlace. */
export function SharePdf({ url, filename, text }: { url: string; filename: string; text: string }) {
  const [msg, setMsg] = useState('');
  return (
    <button type="button" className="btn-secondary" data-testid="compartir-boleta" onClick={async () => {
      setMsg('');
      try {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], filename, { type: 'application/pdf' });
        const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
        if (nav.share && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: filename, text }); return; }
        if (nav.share) { await nav.share({ title: filename, text, url: location.href }); return; }
        await navigator.clipboard.writeText(location.href); setMsg('Enlace copiado');
      } catch (e) { if ((e as Error).name !== 'AbortError') setMsg('No se pudo compartir; use Descargar PDF.'); }
    }}>📤 Compartir{msg && <span className="ml-1 text-xs text-slate-500">· {msg}</span>}</button>
  );
}
