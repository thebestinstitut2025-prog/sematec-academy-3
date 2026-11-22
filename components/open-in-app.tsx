'use client';
import { useState } from 'react';
import { kindOf, convertFile } from '@/components/download-menu';
import { uploadUserFile } from '@/components/file-uploader';
import { openLink } from '@/app/app/archivos/actions';

type App = { id: 'powerpoint' | 'word' | 'excel'; label: string; scheme: string; ext: string; mime: string; fmt: string; native: string[] };
const APPS: App[] = [
  { id: 'powerpoint', label: '📊 Abrir en PowerPoint', scheme: 'ms-powerpoint', ext: 'pptx', fmt: 'pptx-any', native: ['slides'],
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  { id: 'word', label: '📝 Abrir en Word', scheme: 'ms-word', ext: 'docx', fmt: 'docx', native: ['doc'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { id: 'excel', label: '📈 Abrir en Excel', scheme: 'ms-excel', ext: 'xlsx', fmt: 'xlsx', native: ['sheet'],
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
];
const OFFICE_EXT = /\.(pptx|ppt|docx|doc|xlsx|xls)$/i;

/**
 * 📱 Abrir el archivo en las apps del dispositivo: PowerPoint, Word o Excel (aunque el original sea de otro tipo:
 * se convierte y se guarda una copia), visor de Microsoft en línea, o «Compartir / abrir con…» cualquier app del celular.
 */
export function OpenInApp({ fileId, name, mime, href, org }: { fileId: string; name: string; mime: string; href: string; org: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const kind = kindOf(name, mime);
  const convertible = ['doc', 'pdf', 'image', 'sheet', 'slides'].includes(kind);

  const linkFor = async (id: string) => {
    const r = await openLink(id);
    if (!r.url) throw new Error(r.error ?? 'No se pudo preparar el archivo.');
    return r.url;
  };
  const open = async (app: App) => {
    setMsg(null);
    try {
      let id = fileId;
      if (!app.native.includes(kind)) {
        // Se convierte en este equipo y se guarda como copia en «Mis archivos»
        setBusy(`Convirtiendo a .${app.ext}…`);
        const src = await (await fetch(href, { credentials: 'same-origin' })).blob();
        const out = await convertFile(src, name, mime, app.fmt);
        const copy = new File([out], `${name.replace(/\.[a-z0-9]+$/i, '')}.${app.ext}`, { type: app.mime });
        setBusy('Guardando la copia…');
        id = await uploadUserFile(org, copy, { visibility: 'private' });
      }
      setBusy('Abriendo…');
      const url = await linkFor(id);
      window.location.href = `${app.scheme}:ofv|u|${url}`;
      setMsg(app.native.includes(kind) ? `Si no se abrió, instale ${app.label.replace(/^\S+ Abrir en /, '')} en este dispositivo.`
        : `Se guardó una copia .${app.ext} en «Mis archivos». Si no se abrió la app, instálela en este dispositivo.`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(null); }
  };
  const viewOnline = async () => {
    setMsg(null); setBusy('Preparando…');
    try { window.open(`https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(await linkFor(fileId))}`, '_blank', 'noopener'); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(null); }
  };
  const shareTo = async () => {
    setMsg(null); setBusy('Preparando…');
    try {
      const blob = await (await fetch(href, { credentials: 'same-origin' })).blob();
      const file = new File([blob], name, { type: mime || blob.type });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: name });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setMsg('Este navegador no permite elegir la app: se descargó el archivo para abrirlo con la app que quiera.'); }
    } catch (e) { if ((e as Error).name !== 'AbortError') setMsg((e as Error).message); }
    finally { setBusy(null); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="abrir-en-app">
      {convertible && APPS.filter((a) => a.native.includes(kind) || a.id !== 'excel' || kind === 'sheet').map((a) => (
        <button key={a.id} type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => open(a)} data-testid={`abrir-${a.id}`}>{a.label}</button>))}
      {OFFICE_EXT.test(name) && <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={viewOnline} data-testid="ver-office-online">🌐 Ver con Office en línea</button>}
      <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={shareTo} data-testid="compartir-app">📤 Abrir con otra app / compartir</button>
      {busy && <span className="text-xs text-slate-500" role="status">⏳ {busy}</span>}
      {msg && <span className="w-full text-xs text-slate-600" role="status">{msg}</span>}
    </div>
  );
}
