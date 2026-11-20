import Link from 'next/link';
import { getContext, requirePerm, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty, Badge } from '@/components/ui';
import { ActionForm, Field, SelectField, TextArea, Grid } from '@/components/forms';
import { AttachFiles } from '@/components/attach-files';
import { SiteTabs } from '../tabs';
import { POST_KINDS, embedUrl, mediaSrc } from '@/lib/site-posts';
import { fmtDateTime } from '@/lib/format';
import { createPost, deletePost, removePostMedia, togglePost, updatePost } from './actions';

export const metadata = { title: 'Publicaciones del sitio' };
const KIND_OPTS = Object.entries(POST_KINDS).map(([value, v]) => ({ value, label: `${v.icon} ${v.label}` }));
const local = (d: string) => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function PostFields({ p }: { p?: any }) {
  return (
    <>
      <Grid>
        <SelectField label="Tipo" name="kind" required defaultValue={p?.kind ?? 'noticia'} options={KIND_OPTS} />
        <Field label="Título" name="title" required defaultValue={p?.title} placeholder="Ej.: Ceremonia de titulación 2026" />
      </Grid>
      <TextArea label="Texto o mensaje" name="body" rows={5} defaultValue={p?.body ?? ''} placeholder="Escriba la noticia, el mensaje o la descripción de las fotos y videos" />
      <Grid>
        <Field label="Enlace de video (YouTube o Vimeo, opcional)" name="video_url" type="url" defaultValue={p?.video_url ?? ''} placeholder="https://www.youtube.com/watch?v=…" />
        <Field label="Fecha de publicación" name="published_at" type="datetime-local" defaultValue={p ? local(p.published_at) : undefined} />
      </Grid>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="published" defaultChecked={p ? p.published : true} /> Publicar en el sitio (si no, queda como borrador)</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="pinned" defaultChecked={p?.pinned ?? false} /> 📌 Fijar arriba</label>
      </div>
    </>
  );
}

export default async function Page() {
  const ctx = await getContext();
  requirePerm(ctx, 'settings.admin');
  const orgId = requireOrg(ctx);
  const { data: posts, error } = await ctx.supabase.from('site_posts')
    .select('*, site_post_media(id, position, user_files(name, mime_type))').eq('organization_id', orgId)
    .order('pinned', { ascending: false }).order('published_at', { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title="Sitio web y marca" subtitle="Publique noticias, fotos, videos, mensajes y eventos en su sitio" />
      <SiteTabs current="publicaciones" />
      {error ? <Card><p className="text-sm text-amber-800">⚠ Falta instalar la actualización <b>«Publicaciones sitio»</b> en <Link className="link" href="/app/actualizar">Actualizar base de datos</Link>.</p></Card> : (<>
      <Card title="📰 Nueva publicación" className="mb-6">
        <ActionForm action={createPost} submitLabel="Publicar">
          <PostFields />
          <AttachFiles org={orgId} max={30} label="📷 Fotos y 🎬 videos (puede elegir varios a la vez)" />
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500">Se ven en <Link className="link" href="/publicaciones" target="_blank">«Novedades» del sitio</Link> y las 3 más recientes en la portada.</p>
      </Card>
      <Card title={`Publicaciones (${posts?.length ?? 0})`}>
        {posts?.length ? (
          <ul className="divide-y divide-slate-100" data-testid="lista-publicaciones">{posts.map((p: any) => {
            const media = [...(p.site_post_media ?? [])].sort((a: any, b: any) => a.position - b.position);
            const k = POST_KINDS[p.kind] ?? POST_KINDS.noticia;
            return (
              <li key={p.id} className="py-4" data-testid="fila-publicacion">
                <div className="flex flex-wrap items-center gap-2">
                  <b>{p.pinned && '📌 '}{k.icon} {p.title}</b>
                  {p.published ? <Badge color="green">Publicada</Badge> : <Badge color="gray">Borrador</Badge>}
                  <span className="text-xs text-slate-500">{fmtDateTime(p.published_at)} · {media.length} archivo(s){embedUrl(p.video_url) ? ' · video enlazado' : ''}</span>
                  {p.published && <Link className="link text-xs" href={`/publicaciones/${p.id}`} target="_blank">Ver en el sitio ↗</Link>}
                </div>
                {p.body && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{p.body}</p>}
                {media.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{media.map((m: any) => (
                    <div key={m.id} className="relative">
                      {m.user_files?.mime_type?.startsWith('image/') ? <img src={mediaSrc(m.id)} alt={m.user_files?.name} className="h-20 w-28 rounded-lg object-cover" />
                        : <div className="flex h-20 w-28 items-center justify-center rounded-lg bg-slate-100 text-center text-xs">🎬 {m.user_files?.name}</div>}
                      <ActionForm action={removePostMedia} inline submitLabel="✕" submitClass="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 text-xs text-red-700" confirm="¿Quitar este archivo de la publicación?">
                        <input type="hidden" name="id" value={m.id} /></ActionForm>
                    </div>))}</div>)}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <ActionForm action={togglePost} inline submitLabel={p.published ? '👁 Ocultar' : '👁 Publicar'} submitClass="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="what" value="pub" /><input type="hidden" name="value" value={p.published ? '0' : '1'} /></ActionForm>
                  <ActionForm action={togglePost} inline submitLabel={p.pinned ? 'Desfijar' : '📌 Fijar'} submitClass="btn-secondary btn-sm">
                    <input type="hidden" name="id" value={p.id} /><input type="hidden" name="what" value="pin" /><input type="hidden" name="value" value={p.pinned ? '0' : '1'} /></ActionForm>
                  <ActionForm action={deletePost} inline submitLabel="🗑 Eliminar" submitClass="btn-danger btn-sm" confirm={`¿Eliminar «${p.title}» del sitio?`}>
                    <input type="hidden" name="id" value={p.id} /></ActionForm>
                </div>
                <details className="mt-2" data-testid="editar-publicacion"><summary className="link cursor-pointer text-sm">✏ Editar</summary>
                  <ActionForm action={updatePost} submitLabel="Guardar cambios" resetOnSuccess={false} className="mt-3">
                    <input type="hidden" name="id" value={p.id} />
                    <PostFields p={p} />
                    <AttachFiles org={orgId} max={30} label="Agregar más fotos o videos" />
                  </ActionForm>
                </details>
              </li>);
          })}</ul>
        ) : <Empty>Todavía no hay publicaciones. Cree la primera arriba.</Empty>}
      </Card></>)}
    </>
  );
}
