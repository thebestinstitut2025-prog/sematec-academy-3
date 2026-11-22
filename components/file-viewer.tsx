'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { kindOf } from '@/components/download-menu';

/** Datos del enlace: YouTube, Vimeo, Google Drive/Docs se ven dentro de la plataforma. */
export function embedOf(url: string): string | null {
  try {
    const u = new URL(url); const h = u.hostname.replace(/^www\.|^m\./, '');
    if (h === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1).split('/')[0]}`;
    if (h.endsWith('youtube.com')) {
      const id = u.searchParams.get('v') ?? u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    if (h === 'vimeo.com') { const id = u.pathname.match(/\/(\d+)/)?.[1]; return id ? `https://player.vimeo.com/video/${id}` : null; }
    if (h === 'drive.google.com') { const id = u.pathname.match(/\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get('id'); return id ? `https://drive.google.com/file/d/${id}/preview` : null; }
    if (h === 'docs.google.com') return url.replace(/\/(edit|view)(\?.*)?$/, '/preview');
    return null;
  } catch { return null; }
}

type Pager = { n: number; total: number; go: (i: number) => void; label: string };
function PagerBar({ p, extra }: { p: Pager; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-2 text-sm" data-testid="paginador">
      <button type="button" className="btn-secondary btn-sm" onClick={() => p.go(0)} disabled={p.n <= 0} aria-label="Primera">⏮</button>
      <button type="button" className="btn-secondary btn-sm" onClick={() => p.go(p.n - 1)} disabled={p.n <= 0} data-testid="anterior">◀ Anterior</button>
      <span className="min-w-[9rem] text-center font-semibold" data-testid="pagina-actual">{p.label} {p.n + 1} de {p.total}</span>
      <button type="button" className="btn-secondary btn-sm" onClick={() => p.go(p.n + 1)} disabled={p.n >= p.total - 1} data-testid="siguiente">Siguiente ▶</button>
      <button type="button" className="btn-secondary btn-sm" onClick={() => p.go(p.total - 1)} disabled={p.n >= p.total - 1} aria-label="Última">⏭</button>
      {extra}
    </div>
  );
}

/**
 * 👁 Visor dentro de la plataforma, sin descargar: PDF página por página, PowerPoint diapositiva por diapositiva,
 * Word como páginas, Excel hoja por hoja, imágenes, video, audio y enlaces (YouTube, Drive…).
 */
export function FileViewer({ src, name, mime, url }: { src: string; name: string; mime: string; url?: string | null }) {
  if (url) {
    const emb = embedOf(url);
    return emb ? (
      <div className="aspect-video w-full overflow-hidden rounded-xl bg-black" data-testid="visor-enlace">
        <iframe src={emb} title={name} className="h-full w-full" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    ) : (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center" data-testid="visor-enlace">
        <p className="text-4xl">🔗</p><p className="mt-2 break-all text-sm text-slate-600">{url}</p>
        <a className="btn-primary mt-3 inline-block" href={url} target="_blank" rel="noopener noreferrer">Abrir enlace ↗</a>
      </div>
    );
  }
  const kind = kindOf(name, mime);
  if (kind === 'image') return <ImageView src={src} name={name} />;
  if (kind === 'video') return <video src={src} controls playsInline className="max-h-[75vh] w-full rounded-xl bg-black" data-testid="visor-video" />;
  if (kind === 'audio') return <audio src={src} controls className="w-full" data-testid="visor-audio" />;
  if (kind === 'pdf' || kind === 'doc') return <PdfView src={src} name={name} kind={kind} />;
  if (kind === 'slides') return <SlidesView src={src} />;
  if (kind === 'sheet') return <SheetView src={src} name={name} />;
  if (mime.startsWith('text/')) return <TextView src={src} />;
  return <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-600" data-testid="visor-no-disponible">Este tipo de archivo no se puede mostrar aquí. Use «⬇ Descargar».</p>;
}

function useBlob(src: string) {
  const [blob, setBlob] = useState<Blob | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    fetch(src, { credentials: 'same-origin' }).then((r) => { if (!r.ok) throw new Error('No se pudo abrir el archivo.'); return r.blob(); })
      .then((b) => on && setBlob(b)).catch((e) => on && setErr(e.message));
    return () => { on = false; };
  }, [src]);
  return { blob, err };
}
const Loading = ({ text = 'Abriendo…' }: { text?: string }) => <p className="py-10 text-center text-sm text-slate-500" role="status">⏳ {text}</p>;
const Err = ({ e }: { e: string }) => <p className="py-6 text-center text-sm text-red-700">{e}</p>;

function useFullscreen() {
  const box = useRef<HTMLDivElement>(null);
  const toggle = () => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen?.());
  return { box, toggle };
}

function ImageView({ src, name }: { src: string; name: string }) {
  const [z, setZ] = useState(1);
  return (
    <div data-testid="visor-imagen">
      <div className="flex justify-center gap-2 py-2"><button type="button" className="btn-secondary btn-sm" onClick={() => setZ((x) => Math.max(0.25, x - 0.25))}>➖</button>
        <span className="text-sm">{Math.round(z * 100)} %</span><button type="button" className="btn-secondary btn-sm" onClick={() => setZ((x) => Math.min(4, x + 0.25))}>➕</button></div>
      <div className="max-h-[75vh] overflow-auto rounded-xl bg-slate-100 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={name} style={{ width: `${z * 100}%` }} className="inline-block max-w-none" />
      </div>
    </div>
  );
}

/** PDF (y Word convertido a PDF) página por página. */
function PdfView({ src, name, kind }: { src: string; name: string; kind: 'pdf' | 'doc' }) {
  const { blob, err } = useBlob(src);
  const [doc, setDoc] = useState<any>(null);
  const [n, setN] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [fail, setFail] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { box, toggle } = useFullscreen();
  useEffect(() => {
    if (!blob) return;
    (async () => {
      try {
        let pdf = blob;
        if (kind === 'doc') { const a = await import('@/lib/convert/any'); pdf = await a.anyToPdf(blob, name, 'doc'); }
        const { getDocumentProxy } = await import('unpdf');
        setDoc(await getDocumentProxy(new Uint8Array(await pdf.arrayBuffer())));
      } catch (e) { setFail((e as Error).message || 'No se pudo leer el documento.'); }
    })();
  }, [blob, kind, name]);
  const render = useCallback(async () => {
    if (!doc || !canvas.current) return;
    const page = await doc.getPage(n + 1);
    const width = Math.min(box.current?.clientWidth ?? 900, 1100) - 8;
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (width / v1.width) * zoom * (window.devicePixelRatio || 1) });
    const c = canvas.current; c.width = vp.width; c.height = vp.height; c.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
  }, [doc, n, zoom, box]);
  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (!doc) return; if (e.key === 'ArrowRight' || e.key === 'PageDown') setN((x) => Math.min(doc.numPages - 1, x + 1)); if (e.key === 'ArrowLeft' || e.key === 'PageUp') setN((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [doc]);
  if (err || fail) return <Err e={err ?? fail!} />;
  if (!doc) return <Loading text={kind === 'doc' ? 'Preparando las páginas…' : 'Abriendo el PDF…'} />;
  const p: Pager = { n, total: doc.numPages, go: (i) => setN(Math.max(0, Math.min(doc.numPages - 1, i))), label: 'Página' };
  return (
    <div ref={box} className="bg-slate-100 p-1" data-testid="visor-pdf">
      <PagerBar p={p} extra={<>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Alejar">➖</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} aria-label="Acercar">➕</button>
        <button type="button" className="btn-secondary btn-sm" onClick={toggle}>⛶ Pantalla completa</button></>} />
      <div className="overflow-auto text-center"><canvas ref={canvas} className="inline-block bg-white shadow" data-testid="pagina-pdf" /></div>
      <PagerBar p={p} />
    </div>
  );
}

/** PowerPoint diapositiva por diapositiva (con modo presentación). */
function SlidesView({ src }: { src: string }) {
  const { blob, err } = useBlob(src);
  const [deck, setDeck] = useState<any>(null);
  const [n, setN] = useState(0);
  const [img, setImg] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const { box, toggle } = useFullscreen();
  useEffect(() => { if (blob) import('@/lib/office/deck').then((d) => d.readPptx(blob)).then((x) => setDeck({ ...x, pages: x.pages.filter((p: any) => !p.hidden) })).catch((e) => setFail(e.message || 'No se pudo leer la presentación.')); }, [blob]);
  useEffect(() => {
    if (!deck?.pages?.[n]) return;
    let on = true;
    import('@/lib/office/deck').then((d) => d.renderPage(deck, deck.pages[n], 2)).then((c) => on && setImg(c.toDataURL('image/png')));
    return () => { on = false; };
  }, [deck, n]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (!deck) return; if (['ArrowRight', 'PageDown', ' '].includes(e.key)) setN((x) => Math.min(deck.pages.length - 1, x + 1)); if (['ArrowLeft', 'PageUp'].includes(e.key)) setN((x) => Math.max(0, x - 1)); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [deck]);
  if (err || fail) return <Err e={err ?? fail!} />;
  if (!deck) return <Loading text="Abriendo la presentación…" />;
  const p: Pager = { n, total: deck.pages.length, go: (i) => setN(Math.max(0, Math.min(deck.pages.length - 1, i))), label: 'Diapositiva' };
  return (
    <div ref={box} className="bg-slate-900 p-1" data-testid="visor-diapositivas">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {img ? <img src={img} alt={`Diapositiva ${n + 1}`} className="inline-block max-h-[80vh] max-w-full bg-white" onClick={() => p.go(n + 1)} data-testid="diapositiva" /> : <Loading />}
      </div>
      <div className="rounded bg-white"><PagerBar p={p} extra={<button type="button" className="btn-primary btn-sm" onClick={toggle}>▶ Presentar</button>} /></div>
      {deck.pages[n]?.notes && <p className="mt-1 rounded bg-white p-2 text-xs text-slate-600">📝 {deck.pages[n].notes}</p>}
    </div>
  );
}

/** Excel hoja por hoja (como tabla). */
function SheetView({ src, name }: { src: string; name: string }) {
  const { blob, err } = useBlob(src);
  const [wb, setWb] = useState<any>(null);
  const [n, setN] = useState(0);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (blob) import('@/lib/office/sheet').then((s) => s.readWorkbook(blob, name)).then((w) => setWb({ ...w, sheets: w.sheets.filter((x: any) => !x.hidden) })).catch((e) => setFail(e.message || 'No se pudo leer la planilla.')); }, [blob, name]);
  if (err || fail) return <Err e={err ?? fail!} />;
  if (!wb) return <Loading text="Abriendo la planilla…" />;
  const sh = wb.sheets[n];
  const cols = Math.min(sh.cols, 40), rows = Math.min(sh.rows, 500);
  const col = (i: number) => { let s = ''; for (let x = i + 1; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
  const val = (r: number, c: number) => { const cell = sh.cells[`${col(c)}${r + 1}`]; return cell ? String(cell.v ?? cell.value ?? cell.f ?? '') : ''; };
  let last = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (val(r, c)) last = r;
  return (
    <div data-testid="visor-planilla">
      <div className="mb-2 flex flex-wrap gap-1">{wb.sheets.map((x: any, i: number) => (
        <button key={i} type="button" className={i === n ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => setN(i)}>{x.name}</button>))}</div>
      <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-200">
        <table className="min-w-full border-collapse text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="border px-2" />{Array.from({ length: cols }, (_, c) => <th key={c} className="border px-2 font-semibold">{col(c)}</th>)}</tr></thead>
          <tbody>{Array.from({ length: last + 1 }, (_, r) => (
            <tr key={r}><td className="border bg-slate-50 px-2 text-slate-500">{r + 1}</td>{Array.from({ length: cols }, (_, c) => <td key={c} className="whitespace-nowrap border px-2 py-0.5">{val(r, c)}</td>)}</tr>))}</tbody></table>
      </div>
    </div>
  );
}

function TextView({ src }: { src: string }) {
  const { blob, err } = useBlob(src);
  const [t, setT] = useState<string | null>(null);
  useEffect(() => { blob?.text().then(setT); }, [blob]);
  if (err) return <Err e={err} />;
  return t == null ? <Loading /> : <pre className="max-h-[75vh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm">{t}</pre>;
}
