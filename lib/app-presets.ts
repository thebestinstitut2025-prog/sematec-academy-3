/** 📱 Apps conocidas para agregar con un toque (abren la app en el celular si está instalada). */
export type AppPreset = { key: string; title: string; icon: string; url: string; cat: string; hint?: string };
export const APP_CATS = ['Estudio', 'Conducir', 'Trámites (Chile)', 'Comunicación', 'Clases en línea', 'Oficina y archivos', 'Buscar e investigar', 'Redes y música'];
export const APP_PRESETS: AppPreset[] = [
  // Estudio
  { key: 'youtube', title: 'YouTube', icon: '▶️', url: 'https://www.youtube.com/', cat: 'Estudio' },
  { key: 'classroom', title: 'Google Classroom', icon: '🏫', url: 'https://classroom.google.com/', cat: 'Estudio' },
  { key: 'khan', title: 'Khan Academy', icon: '🎓', url: 'https://es.khanacademy.org/', cat: 'Estudio' },
  { key: 'duolingo', title: 'Duolingo', icon: '🦉', url: 'https://www.duolingo.com/', cat: 'Estudio' },
  { key: 'kahoot', title: 'Kahoot!', icon: '🎮', url: 'https://kahoot.it/', cat: 'Estudio' },
  { key: 'canva', title: 'Canva', icon: '🎨', url: 'https://www.canva.com/', cat: 'Estudio' },
  // Conducir
  { key: 'practicatest', title: 'PracticaTest — examen teórico de la municipalidad', icon: '🚗', url: 'https://practicatest.cl/', cat: 'Conducir', hint: 'Test de práctica para licencia de conducir (clase B, C, A1–A5, D, E)' },
  { key: 'practicatest-b', title: 'PracticaTest — Clase B', icon: '🚙', url: 'https://practicatest.cl/examen-teorico/clase-B', cat: 'Conducir' },
  { key: 'conaset', title: 'CONASET (libro del nuevo conductor)', icon: '🚦', url: 'https://www.conaset.cl/', cat: 'Conducir' },
  { key: 'waze', title: 'Waze', icon: '🧭', url: 'https://www.waze.com/', cat: 'Conducir' },
  { key: 'maps', title: 'Google Maps', icon: '🗺', url: 'https://maps.google.com/', cat: 'Conducir' },
  // Trámites
  { key: 'claveunica', title: 'ClaveÚnica', icon: '🔑', url: 'https://claveunica.gob.cl/', cat: 'Trámites (Chile)' },
  { key: 'chileatiende', title: 'ChileAtiende', icon: '🏛', url: 'https://www.chileatiende.gob.cl/', cat: 'Trámites (Chile)' },
  { key: 'registrocivil', title: 'Registro Civil', icon: '🪪', url: 'https://www.registrocivil.cl/', cat: 'Trámites (Chile)' },
  { key: 'sii', title: 'SII', icon: '🧾', url: 'https://www.sii.cl/', cat: 'Trámites (Chile)' },
  { key: 'mineduc', title: 'Mineduc', icon: '📘', url: 'https://www.mineduc.cl/', cat: 'Trámites (Chile)' },
  // Comunicación
  { key: 'whatsapp', title: 'WhatsApp', icon: '🟢', url: 'https://web.whatsapp.com/', cat: 'Comunicación', hint: 'En el celular abre la app' },
  { key: 'telegram', title: 'Telegram', icon: '✈', url: 'https://web.telegram.org/', cat: 'Comunicación' },
  { key: 'gmail', title: 'Gmail', icon: '📧', url: 'https://mail.google.com/', cat: 'Comunicación' },
  { key: 'outlook', title: 'Outlook', icon: '📨', url: 'https://outlook.live.com/', cat: 'Comunicación' },
  // Clases en línea
  { key: 'meet', title: 'Google Meet', icon: '📹', url: 'https://meet.google.com/', cat: 'Clases en línea' },
  { key: 'zoom', title: 'Zoom', icon: '🎦', url: 'https://zoom.us/join', cat: 'Clases en línea' },
  { key: 'teams', title: 'Microsoft Teams', icon: '👥', url: 'https://teams.microsoft.com/', cat: 'Clases en línea' },
  // Oficina
  { key: 'drive', title: 'Google Drive', icon: '🗂', url: 'https://drive.google.com/', cat: 'Oficina y archivos' },
  { key: 'docs', title: 'Google Docs', icon: '📝', url: 'https://docs.google.com/', cat: 'Oficina y archivos' },
  { key: 'onedrive', title: 'OneDrive', icon: '☁', url: 'https://onedrive.live.com/', cat: 'Oficina y archivos' },
  { key: 'office', title: 'Microsoft 365 (Word, Excel, PowerPoint)', icon: '📊', url: 'https://www.office.com/', cat: 'Oficina y archivos' },
  // Buscar
  { key: 'google', title: 'Google', icon: '🔎', url: 'https://www.google.com/', cat: 'Buscar e investigar' },
  { key: 'scholar', title: 'Google Académico', icon: '🎓', url: 'https://scholar.google.com/', cat: 'Buscar e investigar' },
  { key: 'translate', title: 'Google Traductor', icon: '🌐', url: 'https://translate.google.com/', cat: 'Buscar e investigar' },
  { key: 'wikipedia', title: 'Wikipedia', icon: '📚', url: 'https://es.wikipedia.org/', cat: 'Buscar e investigar' },
  // Redes
  { key: 'facebook', title: 'Facebook', icon: '📘', url: 'https://www.facebook.com/', cat: 'Redes y música' },
  { key: 'instagram', title: 'Instagram', icon: '📸', url: 'https://www.instagram.com/', cat: 'Redes y música' },
  { key: 'tiktok', title: 'TikTok', icon: '🎵', url: 'https://www.tiktok.com/', cat: 'Redes y música' },
  { key: 'spotify', title: 'Spotify', icon: '🎧', url: 'https://open.spotify.com/', cat: 'Redes y música' },
];
export const APP_VIS: [string, string][] = [
  ['private', '🔒 Solo yo'], ['people', '👤 Personas o grupos que yo elija'], ['section', '👥 Un curso'],
  ['students', '🎒 Todos los estudiantes'], ['staff', '🏢 Profesores y personal'], ['org', '🏛 Toda la institución'],
];
