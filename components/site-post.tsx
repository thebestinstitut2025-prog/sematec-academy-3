import Link from 'next/link';
import { POST_KINDS, embedUrl, mediaSrc, type SitePost } from '@/lib/site-posts';

const fmt = (d: string) => new Date(d).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });

/** Galería: fotos y videos subidos + video de YouTube/Vimeo. */
export function PostMediaView({ post, full = false }: { post: SitePost; full?: boolean }) {
  const emb = embedUrl(post.video_url);
  const items = full ? post.media : post.media.slice(0, 1);
  return (
    <div className="space-y-3">
      {emb && (!items.length || full) && (
        <div className="aspect-video overflow-hidden rounded-2xl bg-black">
          <iframe src={emb} title={post.title} className="h-full w-full" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
        </div>)}
      {post.video_url && !emb && full && <a className="link" href={post.video_url} target="_blank" rel="noopener noreferrer">▶ Ver el video</a>}
      {items.length > 0 && (
        <div className={full && items.length > 1 ? 'grid gap-3 sm:grid-cols-2' : ''}>
          {items.map((m) => m.mime.startsWith('video/')
            ? <video key={m.id} src={mediaSrc(m.id)} controls preload="metadata" playsInline className="aspect-video w-full rounded-2xl bg-black" data-testid="post-video" />
            : m.mime.startsWith('image/')
              ? (full ? <a key={m.id} href={mediaSrc(m.id)} target="_blank" rel="noopener noreferrer"><img src={mediaSrc(m.id)} alt={m.name} loading="lazy" className="w-full rounded-2xl object-cover" data-testid="post-foto" /></a>
                : <img key={m.id} src={mediaSrc(m.id)} alt={m.name} loading="lazy" className="aspect-video w-full rounded-2xl object-cover" data-testid="post-foto" />)
              : <a key={m.id} className="link block" href={`${mediaSrc(m.id)}?descargar=1`}>📄 {m.name}</a>)}
        </div>)}
    </div>
  );
}

/** Tarjeta de una publicación (lista y portada). */
export function PostCard({ post }: { post: SitePost }) {
  const k = POST_KINDS[post.kind] ?? POST_KINDS.noticia;
  const more = post.media.length > 1 ? ` · ${post.media.length} archivos` : '';
  return (
    <article className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md" data-testid="publicacion">
      {(post.media.length > 0 || embedUrl(post.video_url)) && <div className="p-3 pb-0"><PostMediaView post={post} /></div>}
      <div className="flex flex-1 flex-col p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-600">{post.pinned && '📌 '}{k.icon} {k.label} · {fmt(post.published_at)}{more}</p>
        <h3 className="mt-2 text-lg font-black leading-snug">{post.title}</h3>
        {post.body && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-slate-600" translate="yes">{post.body}</p>}
        <Link href={`/publicaciones/${post.id}`} className="link mt-auto pt-4 text-sm font-semibold">Ver publicación →</Link>
      </div>
    </article>
  );
}
