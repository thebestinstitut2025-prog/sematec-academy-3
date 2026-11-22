import { contactLinks } from '@/lib/contact';

/** Botones para comunicarse: llamar, WhatsApp (chat, llamada o video), SMS, Telegram, correo y mensaje interno. */
export function ContactButtons({ phone, email, userId, name, size = 'sm', text }: {
  phone?: string | null; email?: string | null; userId?: string | null; name?: string | null; size?: 'sm' | 'md'; text?: string;
}) {
  const l = contactLinks({ phone, email, userId, name }, text);
  const cls = size === 'sm' ? 'btn-secondary btn-sm' : 'btn-secondary';
  const any = Object.keys(l).length > 0;
  if (!any) return <span className="text-xs text-slate-400">Sin datos de contacto visibles</span>;
  return (
    <span className="flex flex-wrap gap-1" data-testid="contactar">
      {l.call && <a className={cls} href={l.call} data-testid="llamar" aria-label={`Llamar a ${name ?? ''}`}>📞 Llamar</a>}
      {l.whatsapp && <a className={`${cls} !border-emerald-300 !text-emerald-800`} href={l.whatsapp} target="_blank" rel="noopener noreferrer" data-testid="whatsapp" title="Chat, llamada o videollamada">🟢 WhatsApp</a>}
      {l.sms && <a className={cls} href={l.sms} data-testid="sms">💬 SMS</a>}
      {l.message && <a className={cls} href={l.message} data-testid="mensaje-interno">✉ Mensaje</a>}
      {l.mail && <a className={cls} href={l.mail} data-testid="correo">📧 Correo</a>}
      {l.telegram && <a className={cls} href={l.telegram} target="_blank" rel="noopener noreferrer">✈ Telegram</a>}
    </span>
  );
}
