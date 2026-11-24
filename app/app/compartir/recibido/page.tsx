import Link from 'next/link';
import { getContext, requireOrg } from '@/lib/context';
import { PageHeader, Card } from '@/components/ui';
import { ActionForm } from '@/components/forms';
import { WebSearch } from '@/components/web-search';
import { FileViewer } from '@/components/file-viewer';
import { addLink } from '../../archivos/actions';
import { saveAppLink } from '../../apps/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Compartido con la plataforma' };

/** Lo que se compartió desde el dispositivo: guardarlo como enlace, agregarlo a Apps o buscarlo en Google. */
export default async function Page({ searchParams }: { searchParams: Promise<{ title?: string; text?: string; url?: string; saved?: string; error?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  requireOrg(ctx);
  const url = sp.url && /^https:\/\/[^\s<>"]+$/.test(sp.url) ? sp.url : sp.url && /^http:\/\//.test(sp.url) ? sp.url.replace(/^http:/, 'https:') : null;
  const name = (sp.title || (url ? (() => { try { return new URL(url).hostname; } catch { return 'Enlace'; } })() : '')).slice(0, 200);
  return (
    <>
      <PageHeader title="📲 Compartido con la plataforma" subtitle="Lo que envió desde su dispositivo" actions={<Link className="btn-secondary" href="/app/apps">📱 Apps y accesos</Link>} />
      {sp.saved && <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="compartido-guardado">✓ Se guardaron {sp.saved} archivo(s) en <Link className="link" href="/app/archivos">Mis archivos</Link> (privados: allí puede abrirlos y compartirlos).</p>}
      {sp.error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{sp.error}</p>}
      {url ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`🔗 ${name}`}>
            <p className="mb-3 break-all text-xs text-slate-500" data-testid="enlace-recibido">{url}</p>
            {sp.text && <p className="mb-3 whitespace-pre-line text-sm text-slate-600">{sp.text}</p>}
            <FileViewer src="" name={name} mime="text/x-uri" url={url} />
          </Card>
          <div className="space-y-6">
            <Card title="📁 Guardar en mis archivos">
              <ActionForm action={addLink} submitLabel="Guardar enlace"><input type="hidden" name="url" value={url} /><input type="hidden" name="visibility" value="private" />
                <label className="block"><span className="label">Nombre</span><input name="name" defaultValue={name} maxLength={200} className="input" /></label></ActionForm>
            </Card>
            <Card title="📱 Agregar a Apps y accesos">
              <ActionForm action={saveAppLink} submitLabel="Agregar"><input type="hidden" name="url" value={url} /><input type="hidden" name="visibility" value="private" />
                <label className="block"><span className="label">Nombre</span><input name="title" defaultValue={name.slice(0, 80)} maxLength={80} className="input" /></label></ActionForm>
            </Card>
          </div>
        </div>
      ) : !sp.saved && (
        <Card title="🔎 Buscar en internet"><WebSearch initial={sp.text ?? sp.title ?? ''} /></Card>)}
    </>
  );
}
