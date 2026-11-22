/** 📱 Apps conocidas para agregar con un toque (abren la app en el celular si está instalada). */
export const APP_PRESETS: { key: string; title: string; icon: string; url: string; hint?: string }[] = [
  { key: 'youtube', title: 'YouTube', icon: '▶️', url: 'https://www.youtube.com/' },
  { key: 'whatsapp', title: 'WhatsApp', icon: '🟢', url: 'https://web.whatsapp.com/', hint: 'En el celular abre la app' },
  { key: 'meet', title: 'Google Meet', icon: '📹', url: 'https://meet.google.com/' },
  { key: 'zoom', title: 'Zoom', icon: '🎦', url: 'https://zoom.us/join' },
  { key: 'teams', title: 'Microsoft Teams', icon: '👥', url: 'https://teams.microsoft.com/' },
  { key: 'classroom', title: 'Google Classroom', icon: '🏫', url: 'https://classroom.google.com/' },
  { key: 'gmail', title: 'Gmail', icon: '📧', url: 'https://mail.google.com/' },
  { key: 'outlook', title: 'Outlook', icon: '📨', url: 'https://outlook.live.com/' },
  { key: 'drive', title: 'Google Drive', icon: '🗂', url: 'https://drive.google.com/' },
  { key: 'onedrive', title: 'OneDrive', icon: '☁', url: 'https://onedrive.live.com/' },
  { key: 'office', title: 'Microsoft 365 (Word, Excel, PowerPoint)', icon: '📊', url: 'https://www.office.com/' },
  { key: 'docs', title: 'Google Docs', icon: '📝', url: 'https://docs.google.com/' },
  { key: 'maps', title: 'Google Maps', icon: '🗺', url: 'https://maps.google.com/' },
  { key: 'canva', title: 'Canva', icon: '🎨', url: 'https://www.canva.com/' },
  { key: 'kahoot', title: 'Kahoot!', icon: '🎮', url: 'https://kahoot.it/' },
  { key: 'wikipedia', title: 'Wikipedia', icon: '📚', url: 'https://es.wikipedia.org/' },
  { key: 'telegram', title: 'Telegram', icon: '✈', url: 'https://web.telegram.org/' },
  { key: 'facebook', title: 'Facebook', icon: '📘', url: 'https://www.facebook.com/' },
  { key: 'instagram', title: 'Instagram', icon: '📸', url: 'https://www.instagram.com/' },
  { key: 'tiktok', title: 'TikTok', icon: '🎵', url: 'https://www.tiktok.com/' },
  { key: 'spotify', title: 'Spotify', icon: '🎧', url: 'https://open.spotify.com/' },
];
export const APP_VIS: [string, string][] = [
  ['private', '🔒 Solo yo'], ['people', '👤 Personas o grupos que yo elija'], ['section', '👥 Un curso'],
  ['students', '🎒 Todos los estudiantes'], ['staff', '🏢 Profesores y personal'], ['org', '🏛 Toda la institución'],
];
