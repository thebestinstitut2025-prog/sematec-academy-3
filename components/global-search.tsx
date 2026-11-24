'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { searchAll, type SearchHit } from '@/app/app/buscar-actions';
import { SEARCH_MAX_CHARS, SEARCH_MAX_DIGITS, isNumberSearch, searchLimit } from '@/lib/search-limits';
import type { NavItem } from '@/components/nav';

const ICONS: Record<string, string> = {
  Página: '📄', Estudiante: '🎓', Profesor: '🧑‍🏫', Funcionario: '🧾', Programa: '🏛', Asignatura: '📘', Sección: '📝', Matrícula: '🗂',
  Boleta: '🧾', Gasto: '💸', 'Clase o reunión': '🎥', Biblioteca: '📖', Archivo: '📁', Certificado: '🏅', Anuncio: '📢', Soporte: '🛟', Producto: '🛒', Venta: '🧾',
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** 🔍 Buscador de todo el sistema (botón en el menú y atajo Ctrl + K / ⌘ + K). */
export function GlobalSearch({ items }: { items: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [sel, setSel] = useState(0);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v); }
      else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 20); else { setQ(''); setHits([]); setSel(0); } }, [open]);

  // Busca 250 ms después de dejar de escribir
  useEffect(() => {
    const text = q.trim();
    if (text.length < 1) { setHits([]); return; }
    const n = ++seq.current;
    const t = setTimeout(() => start(async () => { const r = await searchAll(text); if (n === seq.current) { setHits(r); setSel(0); } }), 250);
    return () => clearTimeout(t);
  }, [q]);

  const pages = useMemo(() => {
    const t = norm(q.trim());
    if (t.length < 1) return [];
    const ws = t.split(/\s+/).filter(Boolean);
    return items.filter((i) => { const l = norm(i.label); return l.includes(t) || ws.some((w) => w.length >= 3 && l.includes(w)); }).slice(0, 5)
      .map((i) => ({ kind: 'Página', id: i.href, title: `${i.icon} ${i.label}`, subtitle: 'Ir a la sección', href: i.href }));
  }, [q, items]);
  const all = [...pages, ...hits];

  const go = useCallback((h: SearchHit) => { setOpen(false); router.push(h.href); }, [router]);
  const goAll = useCallback(() => { setOpen(false); router.push(`/app/buscar?q=${encodeURIComponent(q.trim())}`); }, [router, q]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="buscar"
        className="flex w-full items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-sm text-sky-100/80 hover:bg-white/10">
        <span aria-hidden>🔍</span><span className="flex-1">Buscar…</span>
        <kbd className="hidden rounded border border-white/20 px-1.5 text-[10px] lg:inline">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/50 p-3 pt-[10vh] backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white text-ink shadow-2xl" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Buscar en el sistema">
            <div className="flex items-center gap-3 border-b border-slate-100 px-4">
              <span aria-hidden className="text-lg">🔍</span>
              <input ref={input} value={q} onChange={(e) => { const v = e.target.value; setQ(isNumberSearch(v) && (v.match(/\d/g) ?? []).length > SEARCH_MAX_DIGITS ? searchLimit(v) : v.slice(0, SEARCH_MAX_CHARS)); }} data-testid="buscar-texto" maxLength={SEARCH_MAX_CHARS}
                placeholder="Nombre, RUT, producto, código de barras, sección, N° de boleta o venta…" aria-label="Texto a buscar"
                className="w-full py-4 text-base outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, all.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && q.trim()) { e.preventDefault(); goAll(); }
                  else if (e.key === 'Enter' && all[sel]) { e.preventDefault(); go(all[sel]); }
                  else if (e.key === 'Enter' && q.trim()) { e.preventDefault(); goAll(); }
                }} />
              {pending && <span className="animate-pulse text-xs text-slate-400">Buscando…</span>}
              {q.trim() && <span className="shrink-0 text-[11px] text-slate-400" data-testid="buscar-contador">{isNumberSearch(q) ? `${(q.match(/\d/g) ?? []).length}/${SEARCH_MAX_DIGITS} dígitos` : `${q.trim().length}/${SEARCH_MAX_CHARS}`}</span>}
              <button className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>Esc</button>
            </div>
            <ul className="max-h-[60vh] overflow-y-auto p-2" data-testid="buscar-resultados">
              {q.trim().length < 1 && <li className="px-3 py-6 text-center text-sm text-slate-500">Escriba un número (1 a {SEARCH_MAX_DIGITS} dígitos) o un texto (1 a {SEARCH_MAX_CHARS} letras). Use ↑ ↓ para moverse y Enter para abrir.</li>}
              {q.trim().length >= 1 && !pending && all.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">Sin resultados para «{q.trim()}».</li>}
              {all.map((h, i) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left ${i === sel ? 'bg-brand-50' : ''}`}>
                    <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-lg">{ICONS[h.kind] ?? '•'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.title}</span>
                      {h.subtitle && <span className="block truncate text-xs text-slate-500">{h.subtitle}</span>}
                    </span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{h.kind}</span>
                  </button>
                </li>))}
            </ul>
            {q.trim().length >= 1 && (
              <a href={`https://www.google.com/search?q=${encodeURIComponent(q.trim())}`} target="_blank" rel="noopener noreferrer" data-testid="buscar-en-google"
                className="flex w-full items-center justify-between border-t border-slate-100 px-5 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
                <span>🌐 Buscar «{q.trim()}» en Google</span><span className="text-[11px] font-normal text-slate-400">se abre en otra pestaña</span>
              </a>)}
            {q.trim().length >= 1 && (
              <button type="button" onClick={goAll} data-testid="buscar-ver-todos"
                className="flex w-full items-center justify-between border-t border-slate-100 px-5 py-3 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50">
                <span>🔎 Ver todos los resultados de «{q.trim()}»</span><kbd className="hidden text-[10px] text-slate-400 sm:inline">Ctrl + Enter</kbd>
              </button>)}
          </div>
        </div>)}
    </>
  );
}
