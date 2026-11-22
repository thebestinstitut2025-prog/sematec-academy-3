/** 📞 Teléfono en formato internacional (Chile por defecto): «9 1234 5678» → «+56912345678». */
export function intlPhone(raw: string | null | undefined, country = '56'): string | null {
  if (!raw) return null;
  const t = raw.trim();
  let d = t.replace(/[^\d]/g, '');
  if (!d || d.length < 7 || d.length > 15) return null;
  if (t.startsWith('+')) return `+${d}`;
  if (d.startsWith('00')) return `+${d.slice(2)}`;
  if (country === '56') {
    if (d.length === 9 && d.startsWith('9')) d = `56${d}`;          // celular chileno
    else if (d.length === 9 && /^[2-8]/.test(d)) d = `56${d}`;      // fijo chileno con código de área
    else if (d.length === 8) d = `569${d}`;                          // celular antiguo sin el 9
  }
  return `+${d}`;
}

export type ContactLinks = { call?: string; whatsapp?: string; sms?: string; telegram?: string; mailto?: string; mail?: string; message?: string };

/** Enlaces para comunicarse con alguien desde cualquier dispositivo (abren la app que corresponda). */
export function contactLinks(p: { phone?: string | null; email?: string | null; userId?: string | null; name?: string | null }, text?: string): ContactLinks {
  const ph = intlPhone(p.phone);
  const msg = text ? `?text=${encodeURIComponent(text)}` : '';
  return {
    ...(ph ? { call: `tel:${ph}`, whatsapp: `https://wa.me/${ph.slice(1)}${msg}`, sms: `sms:${ph}`, telegram: `https://t.me/${ph}` } : {}),
    ...(p.email ? { mailto: `mailto:${p.email}`, mail: `/app/correo?para=${encodeURIComponent(p.email)}` } : {}),
    ...(p.userId ? { message: `/app/mensajes?para=${p.userId}` } : {}),
  };
}
