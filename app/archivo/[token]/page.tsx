import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { FileViewer } from '@/components/file-viewer';
import { DownloadMenu } from '@/components/download-menu';
import { fmtSize } from '@/lib/user-files';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Archivo compartido', robots: { index: false, follow: false } };

/** 🌐 Archivo compartido por enlace (público o enviado por correo): se ve sin cuenta, página por página. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{48}$/.test(token)) notFound();
  const admin = createAdminClient();
  const { data } = await admin.rpc('file_by_token', { p_token: token });
  const f = (data as any[] | null)?.[0];
  if (!f) return (
    <main className="mx-auto max-w-xl p-8 text-center"><p className="text-5xl">⌛</p><h1 className="mt-3 text-xl font-bold">El enlace venció o el archivo ya no está disponible</h1>
      <p className="mt-2 text-sm text-slate-600">Pídale a quien se lo compartió que se lo envíe de nuevo.</p></main>);
  const { data: org } = await admin.from('organizations').select('name').eq('id', f.organization_id).maybeSingle();
  const src = `/archivo/${token}/raw/${encodeURIComponent(f.name)}`;
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{org?.name ?? ''} · Archivo compartido</p>
      <h1 className="mt-1 break-words text-2xl font-bold">{f.url ? '🔗' : '📄'} {f.name}</h1>
      <p className="mb-3 text-sm text-slate-500">{f.url ? 'Enlace' : fmtSize(f.size_bytes)}</p>
      {f.description && <p className="mb-3 text-sm text-slate-600">{f.description}</p>}
      {!f.url && <div className="mb-4"><DownloadMenu href={`${src}?descargar=1`} name={f.name} mime={f.mime_type} className="btn-primary" /></div>}
      <div className="card card-pad"><FileViewer src={src} name={f.name} mime={f.mime_type} url={f.url} /></div>
    </main>
  );
}
