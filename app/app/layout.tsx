import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { aulaExcluded } from '@/lib/platform-mode';
import { getContext } from '@/lib/context';
import { SiteLogo } from '@/components/site-chrome';
import { brandStyle } from '@/lib/site';
import { Nav } from '@/components/nav';
import { buildNav } from '@/lib/nav-items';
import { switchOrg, switchBranch, setMyLocale } from './actions';
import { PageTranslator } from '@/components/page-translator';
import { prefsOf } from '@/lib/prefs';
import { BranchSelect } from '@/components/branch-select';
import { MobileMenu } from '@/components/mobile-menu';
import { OfflineBar, LogoutButton } from '@/components/offline-bar';
import { UndoBar } from '@/components/undo-bar';
import { ResultToast } from '@/components/result-toast';
import { VersionWatcher } from '@/components/version-watcher';
import { GlobalSearch } from '@/components/global-search';
import { ConferenceHost } from '@/components/conference/host';
import { WindowBar } from '@/components/window-bar';
import { cardThemeAttrs, resolveCardTheme } from '@/lib/card-theme';
import { canBypassMaint, hrefInMaint, isActive, loadMaint, maintFor } from '@/lib/maintenance';
import { areaOfHref, loadAreas } from '@/lib/areas';
import { fmtDateTime, fmtMoney } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  if (ctx.needsMfa) redirect('/mfa');
  if (ctx.profile && ctx.profile.status !== 'active') redirect('/login');

  let items = await buildNav(ctx);
  const locale = prefsOf(ctx.profile).locale ?? 'es';
  const [{ data: site }, { data: cardSetting }] = ctx.orgId
    ? await Promise.all([
      ctx.supabase.from('site_settings').select('site_name, tagline, logo_asset_id, primary_color, accent_color').eq('organization_id', ctx.orgId).maybeSingle(),
      ctx.supabase.from('organization_settings').select('value').eq('organization_id', ctx.orgId).eq('key', 'ui.cards').maybeSingle(),
    ])
    : [{ data: null }, { data: null }];
  const cards = cardThemeAttrs(resolveCardTheme((ctx.profile?.preferences as { cards?: unknown } | null)?.cards, cardSetting?.value));
  const path = (await headers()).get('x-sematec-path') ?? '';
  const blocked = ctx.orgMode === 'aula' && aulaExcluded(path);
  // 🛠 Mantención: toda la plataforma o algunas opciones, sistemas o áreas
  // 💳 Aviso de deuda vencida para el estudiante (con botón para pagar)
  let debt: { amount: number; currency: string } | null = null;
  if (ctx.studentId && !path.startsWith('/app/pagar')) {
    const { data: od } = await ctx.supabase.from('installment_balances').select('outstanding, currency').eq('student_id', ctx.studentId).eq('cancelled', false).gt('outstanding', 0).gt('days_overdue', 0).limit(100);
    const sum = (od ?? []).reduce((a: number, r: any) => a + Number(r.outstanding), 0);
    if (sum > 0) debt = { amount: sum, currency: (od as any[])[0].currency };
  }
  let maintHit: ReturnType<typeof maintFor> = null; let maintBanner = '';
  if (ctx.orgId) {
    const [maint, areasCfg, { data: modAreas }] = await Promise.all([
      loadMaint(ctx.supabase, ctx.orgId), loadAreas(ctx.supabase, ctx.orgId),
      ctx.supabase.from('custom_modules').select('slug, area').eq('organization_id', ctx.orgId),
    ]);
    const anyOn = (maint.global.on && isActive(maint.global)) || Object.values(maint.items).some((v) => isActive(v));
    if (anyOn) {
      const modArea = new Map(((modAreas ?? []) as { slug: string; area: string | null }[]).map((m) => [m.slug, m.area ?? 'otros']));
      const areaOf = (h: string) => (h.startsWith('/app/m/') ? modArea.get(h.slice(7)) ?? 'otros' : areaOfHref(areasCfg, h));
      items = items.map((i) => (hrefInMaint(maint, i.href, areaOf(i.href)) ? { ...i, label: `${i.label} · 🛠` } : i));
      if (canBypassMaint(ctx)) maintBanner = maint.global.on && isActive(maint.global) ? 'Toda la plataforma está en mantención: solo el propietario puede entrar.' : 'Hay partes de la plataforma en mantención (marcadas con 🛠).';
      else maintHit = maintFor(maint, path, items.map((i) => i.href), areaOf);
    }
  }
  const avatar = ctx.profile?.avatar_asset_id ? `/media/${ctx.profile.avatar_asset_id}` : null;

  return (
    <ConferenceHost>
    <div className="lg:flex" data-cards={cards['data-cards']} data-card-panels={cards['data-card-panels']} style={{ ...brandStyle(site?.primary_color, site?.accent_color), ...cards.style } as React.CSSProperties}>
      <aside className="app-aside sticky top-0 z-30 flex max-h-screen flex-col overflow-y-auto bg-gradient-to-b from-ink via-ink to-[#0f2352] px-4 py-3 shadow-xl lg:fixed lg:inset-y-0 lg:w-72 lg:py-6">
        <MobileMenu header={<div className="px-2"><SiteLogo site={site} light /></div>} top={ctx.orgId ? <GlobalSearch items={items} /> : undefined}>
        {ctx.orgs.length > 0 && (
          <form action={switchOrg} className="mt-5 px-1">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-sky-200/70">Institución</label>
            <select name="org" defaultValue={ctx.orgId ?? ''} className="w-full rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 text-sm text-white"
              onChange={undefined}>
              {ctx.orgs.map((o) => <option key={o.organization_id} value={o.organization_id} className="text-ink">{o.display_name}</option>)}
            </select>
            {ctx.orgs.length > 1 && <button className="mt-1 text-xs text-sky-200 hover:underline">Cambiar</button>}
          </form>
        )}
        {ctx.orgId && <BranchSelect action={switchBranch} campuses={ctx.campuses} current={ctx.campusId} fixed={ctx.campusFixed} />}
        <div className="mt-5 flex-1 lg:overflow-y-auto"><Nav items={items} /></div>
        <div className="mt-4 border-t border-white/10 px-2 pt-4 text-xs text-sky-100/70">
          <div className="flex items-center gap-2">
            {avatar
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
              : <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 font-bold text-white">{(ctx.profile?.full_name || '?')[0]}</span>}
            <p className="truncate font-semibold text-white">{ctx.profile?.full_name || ctx.user.email}</p>
          </div>
          <p className="truncate">{ctx.org?.roles.join(', ') ?? (ctx.isPlatformAdmin ? 'Superadministrador' : 'Sin rol')}</p>
          <p className="mt-1">{ctx.aal === 'aal2' ? '🔒 Sesión con MFA' : 'Sesión estándar'}</p>
          <LogoutButton className="mt-2 text-sky-200 hover:underline" />
        </div>
        </MobileMenu>
      </aside>
      <main data-density={(ctx.profile?.preferences as { density?: string } | null)?.density === 'compacta' ? 'compacta' : undefined} className="app-main min-w-0 flex-1 px-3 pb-16 pt-4 lg:ml-72 lg:px-10 lg:pt-6">
        <PageTranslator locale={locale} />
        <WindowBar items={items} locale={locale} setLocale={setMyLocale} />
        <OfflineBar userId={ctx.user.id} warmUrls={items.map((i) => i.href)} />
        <VersionWatcher />
        {ctx.orgId && <UndoBar />}
        <ResultToast />
        {debt && <a href="/app/pagar" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200 print:hidden" data-testid="aviso-deuda">⚠ Tiene cuotas vencidas por {fmtMoney(debt.amount, debt.currency)}. <span className="ml-auto rounded-lg bg-red-600 px-3 py-1 text-white">💳 Pagar ahora</span></a>}
        {maintBanner && <a href="/app/mantencion" className="mb-3 block rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900" data-testid="aviso-mantencion">🛠 {maintBanner} Ir a Mantención →</a>}
        {!ctx.org && !ctx.isPlatformAdmin ? (
          <div className="card card-pad max-w-xl">
            <h1 className="text-xl font-bold">Cuenta sin institución asignada</h1>
            <p className="mt-2 text-sm text-slate-600">Su cuenta está activa, pero aún no tiene un rol en ninguna institución. Solicite acceso a la administración.</p>
          </div>
        ) : maintHit ? (
          <div className="card card-pad mx-auto mt-6 max-w-xl text-center" data-testid="en-mantencion">
            <p className="text-6xl" aria-hidden>🛠</p>
            <h1 className="mt-3 text-2xl font-bold">{maintHit.what} está en mantención</h1>
            <p className="mt-2 whitespace-pre-line text-slate-600">{maintHit.message || 'Estamos haciendo mejoras para usted. Vuelva a intentar en un rato.'}</p>
            {maintHit.until && <p className="mt-3 text-sm font-semibold text-brand-700">Vuelve a estar disponible: {fmtDateTime(maintHit.until)}</p>}
            <div className="mt-5 flex flex-wrap justify-center gap-2"><a className="btn-primary" href="/app">🏠 Ir al inicio</a><a className="btn-secondary" href="/app/perfil">👤 Mi cuenta</a></div>
          </div>
        ) : blocked ? (
          <div className="card card-pad max-w-xl" data-testid="modulo-no-disponible">
            <h1 className="text-xl font-bold">Módulo no disponible en esta plataforma</h1>
            <p className="mt-2 text-sm text-slate-600">{ctx.org?.display_name} usa la plataforma de <b>aula virtual</b>. Este módulo administrativo no forma parte de ella.</p>
            <a className="btn-primary mt-4 inline-block" href="/app/conferencias">🎥 Ir a las aulas virtuales</a>
          </div>
        ) : children}
      </main>
    </div>
    </ConferenceHost>
  );
}
