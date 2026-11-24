/** 🔎 Buscadores de internet (se abren en una pestaña nueva; en el celular, en la app si está instalada). */
export const ENGINES: { key: string; label: string; icon: string; url: (q: string) => string }[] = [
  { key: 'google', label: 'Google', icon: '🔎', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { key: 'imagenes', label: 'Imágenes', icon: '🖼', url: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}` },
  { key: 'youtube', label: 'YouTube', icon: '▶️', url: (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` },
  { key: 'maps', label: 'Maps', icon: '🗺', url: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}` },
  { key: 'noticias', label: 'Noticias', icon: '📰', url: (q) => `https://news.google.com/search?q=${encodeURIComponent(q)}&hl=es-419` },
  { key: 'academico', label: 'Académico', icon: '🎓', url: (q) => `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}` },
  { key: 'wikipedia', label: 'Wikipedia', icon: '📚', url: (q) => `https://es.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}` },
  { key: 'traducir', label: 'Traducir', icon: '🌐', url: (q) => `https://translate.google.com/?sl=auto&tl=es&text=${encodeURIComponent(q)}` },
];
