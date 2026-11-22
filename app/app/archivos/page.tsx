import { DownloadMenu } from '@/components/download-menu';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge, Tabs } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { FileUploader } from '@/components/file-uploader';
import { fmtDateTime } from '@/lib/format';
import { fileKind, fmtSize } from '@/lib/user-files';
import { deleteFile, restoreFile, purgeFile, createFolder, renameFolder, deleteFolder, moveFile, renameFile, addLink, saveGroup, deleteGroup } from './actions';
import { sharingOptions } from '@/lib/file-people';
import { FileAccessFields } from '@/components/file-access-form';
import { PeoplePicker } from '@/components/people-picker';
import { VIS_LABEL } from '@/lib/file-share';
import Link from 'next/link';
import { idsOrNone, myTeachingSectionIds } from '@/lib/teaching';


export const dynamic = 'force-dynamic';

const VIS: Record<string, string> = VIS_LABEL;
type F = { id: string; url?: string | null; name: string; description: string | null; mime_type: string; size_bytes: number; visibility: string; created_at: string;
  deleted_at: string | null; owner_id: string; deleted_by: string | null; folder_id: string | null; owner: { full_name: string } | null; remover: { full_name: string } | null;
  sections: { code: string; courses: { name: string } | null } | null };

type Folder = { id: string; name: string; parent_id: string | null; color: string };
const FCOLOR: Record<string, string> = { amber: 'text-amber-500', blue: 'text-blue-500', green: 'text-emerald-500', red: 'text-red-500', purple: 'text-purple-500', slate: 'text-slate-500' };
const SORTS: Record<string, [string, boolean]> = { recientes: ['created_at', false], antiguos: ['created_at', true], nombre: ['name', true], tamano: ['size_bytes', false] };

export default async function ArchivosPage({ searchParams }: { searchParams: Promise<{ t?: string; c?: string; q?: string; orden?: string }> }) {
  const { t = 'mios', c: rawC, q: rawQ = '', orden = 'recientes' } = await searchParams;
  const qtext = rawQ.trim().slice(0, 200);
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const sel = 'id, url, name, description, mime_type, size_bytes, visibility, created_at, deleted_at, owner_id, deleted_by, folder_id, owner:profiles!user_files_owner_id_fkey(full_name), remover:profiles!user_files_deleted_by_fkey(full_name), sections(code, courses(name))';
  // 📂 Carpetas propias (para «Mis archivos»)
  const { data: fdata } = await ctx.supabase.from('file_folders').select('id, name, parent_id, color').eq('owner_id', ctx.user.id).order('name');
  const folders = (fdata ?? []) as Folder[];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cur = rawC && byId.has(rawC) ? byId.get(rawC)! : null;
  const trail: Folder[] = []; for (let x = cur; x && trail.length < 50; x = x.parent_id ? byId.get(x.parent_id) ?? null : null) trail.unshift(x);
  const pathOf = (f: Folder) => { const p: string[] = []; for (let x: Folder | null | undefined = f; x && p.length < 50; x = x.parent_id ? byId.get(x.parent_id) : null) p.unshift(x.name); return p.join(' / '); };
  const children = folders.filter((f) => (f.parent_id ?? null) === (cur?.id ?? null));
  const [col, asc] = SORTS[orden] ?? SORTS.recientes;
  let q = ctx.supabase.from('user_files').select(sel).eq('organization_id', orgId).order(col, { ascending: asc }).limit(500);
  if (qtext) q = q.ilike('name', `%${qtext.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (t === 'mios') { q = q.eq('owner_id', ctx.user.id).is('deleted_at', null); if (!qtext) q = cur ? q.eq('folder_id', cur.id) : q.is('folder_id', null); }
  else if (t === 'compartidos') q = q.neq('owner_id', ctx.user.id).is('deleted_at', null);
  else if (t === 'eliminados' && ctx.isOwner) q = q.not('deleted_at', 'is', null);
  else if (t === 'todos' && ctx.isOwner) q = q.is('deleted_at', null);
  const { data, error } = await q;
  const files = (data ?? []) as unknown as F[];
  // 👤 Con quién puede compartir: personas, sus grupos y sus cursos
  const share = await sharingOptions(ctx);
  const secs = share.sections;
  const tabs = [['mios', 'Mis archivos'], ['compartidos', 'Compartidos conmigo'], ['grupos', '👥 Mis grupos'], ...(ctx.isOwner ? [['todos', 'Todos'], ['eliminados', '🗂 Historial de eliminados']] : [])]
    .map(([key, label]) => ({ key, label, href: `/app/archivos?t=${key}` }));

  return (
    <div>
      <PageHeader title="📁 Archivos" subtitle="Suba fotos, videos, audio y documentos. Quedan guardados en el almacenamiento privado de la institución." />
      <div className="mb-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card title={cur ? `⬆ Subir archivos a «${cur.name}»` : '⬆ Subir archivos'}><FileUploader org={orgId} sections={secs} people={share.people} groups={share.groups} folder={t === 'mios' ? cur?.id : undefined} folderName={t === 'mios' ? cur?.name : undefined} /></Card>
        <Card title="🔗 Subir un enlace (YouTube, Drive, cualquier página)">
          <ActionForm action={addLink} submitLabel="Guardar enlace">
            {t === 'mios' && cur && <input type="hidden" name="folder" value={cur.id} />}
            <label className="block"><span className="label">Enlace</span><input name="url" required className="input" placeholder="https://www.youtube.com/watch?v=…" data-testid="url-enlace" /></label>
            <label className="block"><span className="label">Nombre</span><input name="name" maxLength={200} className="input" placeholder="Ej.: Clase 3 en video" /></label>
            <FileAccessFields people={share.people} groups={share.groups} sections={secs} />
          </ActionForm>
        </Card>
      </div>
      <Tabs items={tabs} current={t} />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get" data-testid="buscar-archivos">
        <input type="hidden" name="t" value={t} />{cur && <input type="hidden" name="c" value={cur.id} />}
        <input name="q" defaultValue={qtext} placeholder="🔍 Buscar por nombre…" className="input w-64" />
        <select name="orden" defaultValue={orden} className="input w-auto" aria-label="Ordenar">
          <option value="recientes">Más recientes</option><option value="antiguos">Más antiguos</option><option value="nombre">Nombre (A-Z)</option><option value="tamano">Más pesados</option></select>
        <button className="btn-secondary">Aplicar</button>
      </form>
      {t === 'mios' && !qtext && (
        <div className="mb-6 space-y-3" data-testid="carpetas">
          <nav className="flex flex-wrap items-center gap-1 text-sm" aria-label="Ubicación" data-testid="ruta-carpeta">
            <Link className="link" href="/app/archivos?t=mios">📁 Mis archivos</Link>
            {trail.map((f) => <span key={f.id}> / <Link className="link" href={`/app/archivos?t=mios&c=${f.id}`}>{f.name}</Link></span>)}
          </nav>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {children.map((f) => (
              <div key={f.id} className="card p-3" data-testid="carpeta">
                <Link href={`/app/archivos?t=mios&c=${f.id}`} className="flex items-center gap-2 font-semibold hover:underline"><span className={`text-3xl ${FCOLOR[f.color]}`}>📁</span><span className="break-all">{f.name}</span></Link>
                <details className="mt-1 text-xs"><summary className="cursor-pointer text-slate-500">Opciones</summary>
                  <ActionForm action={renameFolder} inline submitLabel="Renombrar" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                    <input type="hidden" name="id" value={f.id} /><input name="name" defaultValue={f.name} maxLength={80} required className="input py-1 text-xs" aria-label="Nuevo nombre" /></ActionForm>
                  <ActionForm action={deleteFolder} inline submitLabel="🗑 Eliminar carpeta" submitClass="mt-1 text-xs text-red-600 hover:underline" confirm={`¿Eliminar la carpeta «${f.name}»? Sus archivos NO se borran: vuelven a «Mis archivos».`}>
                    <input type="hidden" name="id" value={f.id} /></ActionForm>
                </details>
              </div>))}
            <details className="card p-3" data-testid="nueva-carpeta"><summary className="cursor-pointer font-semibold text-brand-700">➕ Nueva carpeta</summary>
              <ActionForm action={createFolder} submitLabel="Crear" submitClass="btn-primary btn-sm">
                {cur && <input type="hidden" name="parent_id" value={cur.id} />}
                <input name="name" required maxLength={80} placeholder="Ej.: Boletas 2026" className="input" aria-label="Nombre de la carpeta" />
                <select name="color" className="input" aria-label="Color" defaultValue="amber"><option value="amber">🟡 Amarillo</option><option value="blue">🔵 Azul</option><option value="green">🟢 Verde</option><option value="red">🔴 Rojo</option><option value="purple">🟣 Morado</option><option value="slate">⚪ Gris</option></select>
              </ActionForm></details>
          </div>
        </div>)}
      {t === 'grupos' && (
        <div className="mb-6 grid gap-6 xl:grid-cols-2" data-testid="grupos">
          <Card title="➕ Nuevo grupo">
            <p className="mb-3 text-sm text-slate-600">Arme grupos (por ejemplo «4° medio A», «Apoderados», «Equipo de matemática») y compártales archivos con un clic.</p>
            <ActionForm action={saveGroup} submitLabel="Crear grupo">
              <label className="block"><span className="label">Nombre del grupo</span><input name="name" required maxLength={80} className="input" data-testid="nombre-grupo" /></label>
              <PeoplePicker name="members" options={share.people} label="Integrantes" testid="integrantes" />
            </ActionForm>
          </Card>
          <Card title={`👥 Mis grupos (${share.groups.length})`}>
            {share.groups.length ? <ul className="divide-y divide-slate-100">{share.groups.map((g) => (
              <li key={g.id} className="py-3 text-sm" data-testid="grupo">
                <div className="flex items-center justify-between gap-2"><b>{g.name}</b><span className="text-xs text-slate-500">{g.count} persona(s)</span></div>
                <details className="mt-1"><summary className="link cursor-pointer text-xs">✏ Editar integrantes o nombre</summary>
                  <ActionForm action={saveGroup} submitLabel="Guardar" resetOnSuccess={false}>
                    <input type="hidden" name="group_id" value={g.id} />
                    <input name="name" required defaultValue={g.name} maxLength={80} className="input" aria-label="Nombre del grupo" />
                    <PeoplePicker name="members" options={share.people} initial={g.members} />
                  </ActionForm></details>
                <ActionForm action={deleteGroup} inline submitLabel="🗑 Eliminar grupo" submitClass="mt-1 text-xs text-red-600 hover:underline" confirm={`¿Eliminar el grupo «${g.name}»?`}><input type="hidden" name="group_id" value={g.id} /></ActionForm>
              </li>))}</ul> : <Empty>Aún no tiene grupos.</Empty>}
          </Card>
        </div>)}
      {t === 'eliminados' && <p className="mb-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Aquí está todo lo que los usuarios eliminaron. Puede <b>restaurarlo</b> (vuelve a su dueño) o <b>eliminarlo definitivamente</b> (se borra el archivo; queda solo el registro en la Auditoría).</p>}
      {t === 'grupos' ? null : error ? <Card><p className="text-sm text-red-700">{error.message}</p></Card> : files.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((f) => (
            <div key={f.id} className="card overflow-hidden" data-testid="archivo">
              {f.url ? (
                <a href={`/app/archivos/abrir/${f.id}`} className="flex h-24 flex-col items-center justify-center bg-slate-50 text-sm text-slate-600"><span className="text-4xl">{/youtu/.test(f.url) ? '▶️' : '🔗'}</span>{(() => { try { return new URL(f.url).hostname; } catch { return ''; } })()}</a>
              ) : f.mime_type.startsWith('image/') && !f.deleted_at ? (
                // eslint-disable-next-line @next/next/no-img-element
                <a href={`/app/archivos/ver/${f.id}`} target="_blank" rel="noopener noreferrer"><img src={`/app/archivos/ver/${f.id}`} alt={f.name} className="h-40 w-full bg-slate-100 object-cover" loading="lazy" /></a>
              ) : f.mime_type.startsWith('video/') && !f.deleted_at ? (
                <video src={`/app/archivos/ver/${f.id}`} controls preload="metadata" className="h-40 w-full bg-black" />
              ) : <div className="flex h-24 items-center justify-center bg-slate-50 text-4xl">{fileKind(f.mime_type)}</div>}
              <div className="space-y-1 p-4 text-sm">
                <p className="break-words font-semibold">{f.name}</p>
                {qtext && f.folder_id && byId.has(f.folder_id) && <p className="text-xs text-amber-700">📁 {pathOf(byId.get(f.folder_id)!)}</p>}
                {f.description && <p className="text-xs text-slate-600">{f.description}</p>}
                <p className="text-xs text-slate-500">{fmtSize(f.size_bytes)} · {fmtDateTime(f.created_at)}{f.owner_id !== ctx.user.id && ` · ${f.owner?.full_name ?? ''}`}</p>
                <p className="flex flex-wrap gap-1"><Badge color="blue">{VIS[f.visibility]}{f.sections ? ` ${f.sections.courses?.name ?? ''}` : ''}</Badge>
                  {f.deleted_at && <Badge color="red">Eliminado {fmtDateTime(f.deleted_at)}{f.remover ? ` por ${f.remover.full_name}` : ''}</Badge>}</p>
                <div className="flex flex-wrap gap-1 pt-2">
                  {!f.deleted_at && <Link className="btn-primary btn-sm" href={`/app/archivos/abrir/${f.id}`} data-testid="abrir-archivo">👁 Abrir{f.owner_id === ctx.user.id ? ' y compartir' : ''}</Link>}
                  {f.url ? null : <DownloadMenu href={`/app/archivos/ver/${f.id}?descargar=1`} name={f.name} mime={f.mime_type} fileId={f.deleted_at ? undefined : f.id} />}
                  {!f.deleted_at && f.owner_id === ctx.user.id && (
                    <details className="w-full text-xs"><summary className="cursor-pointer text-slate-500" data-testid="opciones-archivo">📂 Mover o renombrar</summary>
                      <ActionForm action={moveFile} inline submitLabel="Mover" submitClass="btn-secondary btn-sm" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={f.id} />
                        <select name="folder_id" defaultValue={f.folder_id ?? ''} className="input py-1 text-xs" aria-label="Carpeta destino">
                          <option value="">📁 Mis archivos (sin carpeta)</option>{folders.map((d) => <option key={d.id} value={d.id}>📁 {pathOf(d)}</option>)}</select></ActionForm>
                      <ActionForm action={renameFile} inline submitLabel="Renombrar" submitClass="btn-secondary btn-sm mt-1" resetOnSuccess={false}>
                        <input type="hidden" name="id" value={f.id} /><input name="name" defaultValue={f.name} maxLength={200} required className="input py-1 text-xs" aria-label="Nuevo nombre del archivo" /></ActionForm>
                    </details>)}
                  {!f.deleted_at && (f.owner_id === ctx.user.id || ctx.isOwner) && (
                    <ActionForm action={deleteFile} inline submitLabel="🗑 Eliminar" submitClass="btn-secondary btn-sm text-red-700" confirm={`¿Eliminar «${f.name}»?`}>
                      <input type="hidden" name="id" value={f.id} /></ActionForm>)}
                  {f.deleted_at && ctx.isOwner && <>
                    <ActionForm action={restoreFile} inline submitLabel="♻ Restaurar" submitClass="btn-secondary btn-sm"><input type="hidden" name="id" value={f.id} /></ActionForm>
                    <ActionForm action={purgeFile} inline submitLabel="✖ Eliminar definitivamente" submitClass="btn-secondary btn-sm text-red-700"
                      confirm={`¿Eliminar DEFINITIVAMENTE «${f.name}»? No se puede recuperar.`}><input type="hidden" name="id" value={f.id} /></ActionForm>
                  </>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty>{t === 'eliminados' ? 'No hay archivos eliminados.' : t === 'compartidos' ? 'Nadie ha compartido archivos con usted todavía.' : cur ? 'Esta carpeta está vacía. Suba archivos arriba o mueva archivos aquí.' : qtext ? 'Ningún archivo coincide con la búsqueda.' : 'Aún no hay archivos.'}</Empty>}
    </div>
  );
}
