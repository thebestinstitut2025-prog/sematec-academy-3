import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Badge } from '@/components/ui';
import { ActionForm, TextArea } from '@/components/forms';
import { FileViewer } from '@/components/file-viewer';
import { DownloadMenu } from '@/components/download-menu';
import { OpenInApp } from '@/components/open-in-app';
import { CopyCode } from '@/components/copy-code';
import { FileAccessFields } from '@/components/file-access-form';
import { fmtDateTime } from '@/lib/format';
import { fmtSize } from '@/lib/user-files';
import { VIS_LABEL } from '@/lib/file-share';
import { sharingOptions } from '@/lib/file-people';
import { env } from '@/lib/env';
import { setFileAccess, shareByEmail } from '../../actions';

export const dynamic = 'force-dynamic';

/** 👁 Ver un archivo sin descargarlo (página por página, diapositiva por diapositiva), abrirlo en apps y compartirlo. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const orgId = requireOrg(ctx);
  const { data: f } = await ctx.supabase.from('user_files').select('*, owner:profiles!user_files_owner_id_fkey(full_name)').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!f) notFound();
  const mine = f.owner_id === ctx.user.id || ctx.isOwner;
  const src = `/app/archivos/ver/${id}`;
  let share: Awaited<ReturnType<typeof sharingOptions>> | null = null;
  let current: { users: string[]; groups: string[] } = { users: [], groups: [] };
  let publicToken: string | null = null;
  if (mine) {
    share = await sharingOptions(ctx);
    const { data: sh } = await ctx.supabase.from('file_shares').select('user_id, group_id').eq('file_id', id);
    current = { users: (sh ?? []).filter((x: any) => x.user_id).map((x: any) => x.user_id), groups: (sh ?? []).filter((x: any) => x.group_id).map((x: any) => x.group_id) };
    if (f.visibility === 'public') { const { data: t } = await ctx.supabase.rpc('file_public_token', { p_file: id }); publicToken = (t as string | null) ?? null; }
  }
  return (
    <>
      <PageHeader title={`${f.url ? '🔗' : '📄'} ${f.name}`} subtitle={`${f.url ? 'Enlace' : fmtSize(f.size_bytes)} · ${fmtDateTime(f.created_at)} · Subido por ${f.owner?.full_name ?? ''}`}
        actions={<Link className="btn-secondary" href="/app/archivos">← Archivos</Link>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge color="blue">{VIS_LABEL[f.visibility] ?? f.visibility}</Badge>
        {(current.users.length > 0 || current.groups.length > 0) && <Badge color="gray">+ {current.users.length} persona(s), {current.groups.length} grupo(s)</Badge>}
        {f.url ? <a className="btn-secondary btn-sm" href={f.url} target="_blank" rel="noopener noreferrer">Abrir enlace ↗</a>
          : <DownloadMenu href={`${src}?descargar=1`} name={f.name} mime={f.mime_type} fileId={id} />}
      </div>
      {f.description && <p className="mb-3 text-sm text-slate-600">{f.description}</p>}
      {!f.url && <div className="mb-4"><OpenInApp fileId={id} name={f.name} mime={f.mime_type} href={src} org={orgId} /></div>}
      <Card><FileViewer src={src} name={f.name} mime={f.mime_type} url={f.url} /></Card>
      {mine && share && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="👤 Quién lo puede ver">
            {publicToken && <div className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm" data-testid="enlace-publico"><p className="mb-1 font-semibold text-emerald-900">🌐 Enlace público</p><CopyCode code={`${env.siteUrl()}/archivo/${publicToken}`} /></div>}
            <ActionForm action={setFileAccess} submitLabel="Guardar" resetOnSuccess={false}>
              <input type="hidden" name="id" value={id} />
              <FileAccessFields people={share.people} groups={share.groups} sections={share.sections} initial={{ visibility: f.visibility, section: f.section_id, ...current }} />
            </ActionForm>
          </Card>
          <Card title="✉ Enviar a una persona nueva (sin cuenta)">
            <p className="mb-3 text-sm text-slate-600">Le llega un correo con un enlace para verlo y descargarlo durante 30 días, sin crear una cuenta. Para darle una cuenta, créela en «Usuarios».</p>
            <ActionForm action={shareByEmail} submitLabel="✉ Enviar">
              <input type="hidden" name="id" value={id} />
              <label className="block"><span className="label">Correos (separados por coma)</span>
                <input name="emails" required className="input" placeholder="persona@correo.com, otra@correo.com" data-testid="correos-nuevos" /></label>
              <TextArea label="Mensaje (opcional)" name="note" rows={2} />
            </ActionForm>
          </Card>
        </div>)}
    </>
  );
}
