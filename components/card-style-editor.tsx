'use client';
import { useEffect, useState } from 'react';
import { CARD_COLORS, cardStyle } from '@/lib/card-style';

/**
 * 🎨 Elegir color y fondo de una tarjeta (sala o asignatura) con vista previa.
 * Va dentro de un ActionForm: envía «color», «file» (imagen del dispositivo) y «clear_image».
 */
export function CardStyleEditor({ color, image, title, subtitle, allowCourse }: {
  color: string | null; image: string | null; title: string; subtitle: string; allowCourse: boolean;
}) {
  const [c, setC] = useState<string | null>(color);
  const [img, setImg] = useState<string | null>(null);     // vista previa local de la imagen elegida
  const [clear, setClear] = useState(false);
  useEffect(() => () => { if (img) URL.revokeObjectURL(img); }, [img]);
  const base = cardStyle(c, clear ? null : image);
  const style = img ? { backgroundImage: `linear-gradient(${c ? `${c}b3` : 'rgba(15,23,42,0.55)'}, rgba(15,23,42,0.7)), url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center' } : base.style;
  const light = img ? true : base.light;
  return (
    <div className="space-y-4" data-testid="editor-tarjeta">
      <input type="hidden" name="color" value={c ?? ''} />
      <div className={`rounded-xl border border-slate-200 p-4 ${light ? 'text-white' : ''}`} style={style} data-testid="vista-previa-tarjeta">
        <p className={`text-xs font-bold ${light ? 'text-white/80' : 'text-brand-600'}`}>{subtitle}</p>
        <p className="mt-1 text-lg font-bold">{title}</p>
        <p className={`mt-2 text-sm ${light ? 'text-white/80' : 'text-slate-500'}`}>Así se verá la tarjeta</p>
      </div>
      <div>
        <span className="label">Color</span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setC(null)} className={`h-8 rounded-full border px-3 text-xs ${c ? 'border-slate-300' : 'border-brand-600 ring-2 ring-brand-500'}`}>Sin color</button>
          {CARD_COLORS.map((x) => (
            <button key={x} type="button" aria-label={`Color ${x}`} title={x} onClick={() => setC(x)} data-testid="color-tarjeta"
              className={`h-8 w-8 rounded-full border-2 ${c === x ? 'border-white ring-2 ring-brand-600' : 'border-white/0'}`} style={{ background: x }} />))}
          <label className="flex items-center gap-1 text-xs text-slate-600">Otro:
            <input type="color" value={c ?? '#1d4ed8'} onChange={(e) => setC(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-slate-300" data-testid="color-personalizado" /></label>
        </div>
      </div>
      <label className="block">
        <span className="label">🖼 Imagen de fondo desde su dispositivo (PNG, JPG o WebP, máx. 3 MB)</span>
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" className="block w-full text-sm" data-testid="fondo-tarjeta"
          onChange={(e) => { const f = e.target.files?.[0]; setImg(f ? URL.createObjectURL(f) : null); if (f) setClear(false); }} />
      </label>
      {image && !img && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="clear_image" checked={clear} onChange={(e) => setClear(e.target.checked)} data-testid="quitar-fondo" /> Quitar la imagen de fondo actual</label>)}
      {allowCourse && (
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="whole_course" className="mt-1" data-testid="toda-asignatura" />
          <span>Aplicar a <b>toda la asignatura</b> (todas sus salas que no tengan un estilo propio)</span></label>)}
    </div>
  );
}
