import type { CSSProperties } from 'react';

/** Colores sugeridos para las tarjetas de asignatura y sala. */
export const CARD_COLORS = ['#1d4ed8', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#db2777', '#9333ea', '#4f46e5', '#334155', '#0f172a'];

type Styled = { card_color?: string | null; card_image?: string | null } | null | undefined;

/** La sala manda; si no tiene, se usa la de la asignatura. */
export function pickCard(section: Styled, course: Styled) {
  return { color: section?.card_color ?? course?.card_color ?? null, image: section?.card_image ?? course?.card_image ?? null };
}

/** ¿El color es oscuro? (para escribir en blanco encima) */
export function isDark(hex: string) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45;
}

/** Estilo de fondo de una tarjeta (imagen con velo para que el texto se lea, o color). */
export function cardStyle(color: string | null, image: string | null): { style?: CSSProperties; light: boolean } {
  if (image) {
    const tint = color ? `${color}b3` : 'rgba(15,23,42,0.55)';
    return { light: true, style: { backgroundImage: `linear-gradient(${tint}, rgba(15,23,42,0.7)), url(/media/${image})`, backgroundSize: 'cover', backgroundPosition: 'center' } };
  }
  if (color) return { light: isDark(color), style: { background: `linear-gradient(135deg, ${color}, ${color}cc)` } };
  return { light: false };
}
