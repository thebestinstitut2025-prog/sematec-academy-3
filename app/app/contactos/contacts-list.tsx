'use client';
import { useMemo, useState } from 'react';
import { contactLinks } from '@/lib/contact';

type C = { user_id: string; full_name: string; role_name: string; email: string | null; phone: string | null };

/** 📇 Lista de contactos con buscador, filtro por rol y acciones para uno o para varios a la vez. */
export function ContactsList({ contacts, groups }: { contacts: C[]; groups: { id: string; name: string; members: string[] }[] }) {
  const [q, setQ] = useState(''); const [role, setRole] = useState(''); const [grp, setGrp] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const roles = useMemo(() => [...new Set(contacts.map((c) => c.role_name))].sort(), [contacts]);
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const g = groups.find((x) => x.id === grp);
  const shown = contacts.filter((c) => (!role || c.role_name === role) && (!g || g.members.includes(c.user_id)) && (!q || norm(`${c.full_name} ${c.email ?? ''} ${c.phone ?? ''}`).includes(norm(q))));
  const chosen = contacts.filter((c) => sel.has(c.user_id));
  const emails = chosen.map((c) => c.email).filter(Boolean) as string[];
  const allOn = shown.length > 0 && shown.every((c) => sel.has(c.user_id));
  const toggle = (id: string, on: boolean) => setSel((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <div className="space-y-3" data-testid="contactos">
      <div className="flex flex-wrap items-center gap-2">
        <input className="input min-w-[12rem] flex-1" placeholder="🔎 Buscar por nombre, correo o teléfono" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar contactos" />
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filtrar por rol"><option value="">Todos los roles</option>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        {groups.length > 0 && <select className="input w-auto" value={grp} onChange={(e) => setGrp(e.target.value)} aria-label="Filtrar por grupo"><option value="">Todos los grupos</option>{groups.map((x) => <option key={x.id} value={x.id}>👥 {x.name}</option>)}</select>}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2 text-sm">
        <label className="flex items-center gap-1"><input type="checkbox" checked={allOn} onChange={(e) => shown.forEach((c) => toggle(c.user_id, e.target.checked))} data-testid="elegir-todos-contactos" /> Elegir todos ({shown.length})</label>
        <span className="text-slate-500" data-testid="contactos-elegidos">{sel.size} elegido(s)</span>
        {emails.length > 0 && <a className="btn-primary btn-sm" href={`/app/correo?para=${encodeURIComponent(emails.join(', '))}`} data-testid="correo-elegidos">📧 Correo a los elegidos ({emails.length})</a>}
        {sel.size > 0 && emails.length < sel.size && <span className="text-xs text-slate-500">{sel.size - emails.length} sin correo visible: use ✉ Mensaje.</span>}
      </div>
      <ul className="divide-y divide-slate-100">{shown.map((c) => {
        const l = contactLinks({ phone: c.phone, email: c.email, userId: c.user_id });
        return (
          <li key={c.user_id} className="flex flex-wrap items-center gap-3 py-2" data-testid="contacto">
            <input type="checkbox" checked={sel.has(c.user_id)} onChange={(e) => toggle(c.user_id, e.target.checked)} aria-label={`Elegir a ${c.full_name}`} />
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 font-bold text-brand-700">{c.full_name[0]}</span>
            <span className="min-w-[10rem] flex-1"><b>{c.full_name}</b><span className="block text-xs text-slate-500">{c.role_name}{c.phone ? ` · ${c.phone}` : ''}{c.email ? ` · ${c.email}` : ''}</span></span>
            <span className="flex flex-wrap gap-1">
              {l.call && <a className="btn-secondary btn-sm" href={l.call} data-testid="llamar">📞</a>}
              {l.whatsapp && <a className="btn-secondary btn-sm !text-emerald-800" href={l.whatsapp} target="_blank" rel="noopener noreferrer" data-testid="whatsapp" title="Chat, llamada o videollamada">🟢 WhatsApp</a>}
              {l.sms && <a className="btn-secondary btn-sm" href={l.sms} data-testid="sms">💬 SMS</a>}
              <a className="btn-secondary btn-sm" href={l.message} data-testid="mensaje-interno">✉ Mensaje</a>
              {l.mail && <a className="btn-secondary btn-sm" href={l.mail} data-testid="correo">📧</a>}
            </span>
          </li>); })}</ul>
      {!shown.length && <p className="p-4 text-center text-sm text-slate-500">Nadie coincide con la búsqueda.</p>}
    </div>
  );
}
