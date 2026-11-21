import type { ReactNode } from 'react';

/** ✏ Caja plegable para editar un elemento en su lugar (el formulario dentro trae «Cancelar» automáticamente). */
export function EditBox({ label = '✏ Editar', testid, children, className = 'mt-3' }: { label?: string; testid?: string; children: ReactNode; className?: string }) {
  return (
    <details className={`${className} rounded-lg border border-slate-200 bg-white text-sm`} data-testid={testid}>
      <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-brand-700">{label}</summary>
      <div className="space-y-3 border-t border-slate-100 p-3">{children}</div>
    </details>
  );
}
