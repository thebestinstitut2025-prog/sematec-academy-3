import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card, Empty } from '@/components/ui';
import { searchAll, type SearchHit } from '../buscar-actions';

export const metadata = { title: 'Buscar' };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; tipo?: string }> }) {
  const sp = await searchParams;
  const q = String(sp.q ?? '').slice(0, 500).trim();
  const tipo = String(sp.tipo ?? '');
  requireOrg(await getContext());
  const hits = q ? await searchAll(q, true) : [];
  const groups = hits.reduce<Record<string, SearchHit[]>>((a, h) => { (a[h.kind] ??= []).push(h); return a; }, {});
  const kinds = Object.keys(groups);
  const shown = tipo && groups[tipo] ? [tipo] : kinds;
  const link = (t?: string) => `/app/buscar?q=${encodeURIComponent(q)}${t ? `&tipo=${encodeURIComponent(t)}` : ''}`;
  return (
    <>
      <PageHeader title="🔎 Buscar en todo el sistema" subtitle="Cualquier palabra o número: nombre, RUT, teléfono, correo, código, N° de boleta, monto, producto…" />
      <form className="mb-4 flex gap-2" action="/app/buscar">
        <input name="q" defaultValue={q} autoFocus className="input max-w-xl" placeholder="Escriba lo que busca" data-testid="buscar-pagina-texto" />
        <button className="btn-primary">Buscar</button>
      </form>
      {q && (
        <p className="mb-4 text-sm text-slate-600" data-testid="buscar-total"><b>{hits.length}</b> resultado(s) para «{q}»{kinds.length > 1 && <>: {' '}
          <Link className={!tipo ? 'font-bold' : 'link'} href={link()}>Todos</Link>
          {kinds.map((k) => <span key={k}> · <Link className={tipo === k ? 'font-bold' : 'link'} href={link(k)}>{k} ({groups[k].length})</Link></span>)}</>}</p>)}
      {!q ? <Card><Empty>Escriba una palabra o un número para buscar.</Empty></Card>
        : hits.length === 0 ? <Card><Empty>Sin resultados para «{q}».</Empty></Card>
        : shown.map((k) => (
          <Card key={k} title={`${k} (${groups[k].length})`} className="mb-4">
            <ul className="divide-y divide-slate-100" data-testid="buscar-grupo">{groups[k].map((h) => (
              <li key={`${h.kind}-${h.id}`} className="py-2">
                <Link className="link font-medium" href={h.href}>{h.title}</Link>
                {h.subtitle && <span className="ml-2 text-xs text-slate-500">{h.subtitle}</span>}
              </li>))}</ul>
          </Card>))}
    </>
  );
}
