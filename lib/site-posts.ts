/** Publicaciones del sitio: tipos y enlaces de video incrustables (YouTube / Vimeo). */
export const POST_KINDS: Record<string, { label: string; icon: string }> = {
  noticia: { label: 'Noticia', icon: '📰' }, foto: { label: 'Fotos', icon: '📷' }, video: { label: 'Video', icon: '🎬' },
  mensaje: { label: 'Mensaje', icon: '💬' }, evento: { label: 'Evento', icon: '📅' },
};
export type PostMedia = { id: string; name: string; mime: string };
export type SitePost = { id: string; kind: string; title: string; body: string | null; video_url: string | null; pinned: boolean; published_at: string; media: PostMedia[] };

/** Convierte un enlace de YouTube o Vimeo en la dirección para mostrarlo dentro de la página; otros enlaces → null. */
export function embedUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\.|^m\./, '');
    let yt: string | null = null;
    if (h === 'youtu.be') yt = u.pathname.slice(1);
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      yt = u.searchParams.get('v') ?? (u.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1] ?? null);
    }
    if (yt && /^[\w-]{6,20}$/.test(yt)) return `https://www.youtube-nocookie.com/embed/${yt}`;
    if (h === 'vimeo.com' || h === 'player.vimeo.com') {
      const v = u.pathname.match(/(\d{5,})/)?.[1];
      if (v) return `https://player.vimeo.com/video/${v}`;
    }
  } catch { /* enlace no válido */ }
  return null;
}
export const mediaSrc = (id: string) => `/media-sitio/${id}`;
