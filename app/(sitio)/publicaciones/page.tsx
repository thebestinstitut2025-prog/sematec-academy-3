import Link from 'next/link';
import { getPublicSite, anonClient } from '@/lib/site';
import { PostCard } from '@/components/site-post';
import { POST_KINDS, type SitePost } from '@/lib/site-posts';

export const metadata = { title: 'Novedades' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const site = await getPublicSite();
  const { tipo } = await searchParams;
  const kind = tipo && POST_KINDS[tipo] ? tipo : null;
  const { data } = site ? await anonClient().rpc('public_site_posts', { p_org: site.organization_id, p_limit: 120, p_kind: kind }) : { data: [] };
  const posts = (data ?? []) as SitePost[];
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
      <h1 className="text-3xl font-black md:text-4xl">Novedades</h1>
      <p className="mt-2 text-slate-600">Noticias, fotos, videos, mensajes y eventos de {site?.site_name ?? 'la institución'}.</p>
      <nav className="mt-6 flex flex-wrap gap-2 text-sm" data-testid="filtro-publicaciones">
        <Link href="/publicaciones" className={`rounded-full px-4 py-1.5 ${!kind ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}>Todo</Link>
        {Object.entries(POST_KINDS).map(([k, v]) => (
          <Link key={k} href={`/publicaciones?tipo=${k}`} className={`rounded-full px-4 py-1.5 ${kind === k ? 'bg-brand-600 text-white' : 'bg-slate-100'}`}>{v.icon} {v.label}</Link>))}
      </nav>
      {posts.length ? <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{posts.map((p) => <PostCard key={p.id} post={p} />)}</div>
        : <p className="mt-10 rounded-2xl bg-slate-50 p-8 text-center text-slate-500">Todavía no hay publicaciones.</p>}
    </div>
  );
}
