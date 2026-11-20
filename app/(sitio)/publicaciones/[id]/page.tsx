import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicSite, anonClient } from '@/lib/site';
import { PostMediaView } from '@/components/site-post';
import { POST_KINDS, type SitePost } from '@/lib/site-posts';

export const dynamic = 'force-dynamic';

async function load(id: string): Promise<SitePost | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const site = await getPublicSite();
  if (!site) return null;
  const { data } = await anonClient().rpc('public_site_posts', { p_org: site.organization_id, p_limit: 1, p_id: id });
  return ((data ?? []) as SitePost[])[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const p = await load((await params).id);
  return { title: p?.title ?? 'Publicación', description: p?.body?.slice(0, 160) ?? undefined };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const post = await load((await params).id);
  if (!post) notFound();
  const k = POST_KINDS[post.kind] ?? POST_KINDS.noticia;
  return (
    <article className="mx-auto max-w-4xl px-4 py-12 lg:px-8" data-testid="publicacion-detalle">
      <Link href="/publicaciones" className="link text-sm">← Novedades</Link>
      <p className="mt-6 text-xs font-bold uppercase tracking-wider text-brand-600">{k.icon} {k.label} · {new Date(post.published_at).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <h1 className="mt-2 text-3xl font-black md:text-4xl">{post.title}</h1>
      {post.body && <div className="mt-6 whitespace-pre-line text-lg leading-relaxed text-slate-700" translate="yes">{post.body}</div>}
      <div className="mt-8"><PostMediaView post={post} full /></div>
    </article>
  );
}
