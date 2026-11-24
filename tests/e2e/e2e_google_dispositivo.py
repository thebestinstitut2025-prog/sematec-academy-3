"""🔎 Buscar en Google desde la plataforma, 🧩 catálogo de apps (PracticaTest…) y 📲 compartir desde el dispositivo."""
import os, sys, io, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

def one(q): return sql(q).split('\n')[0]
def wait_for(q, expect=None, secs=20):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if (expect is None and v) or (expect is not None and v == expect): return v
        time.sleep(0.4)
    return v

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        ctx = b.new_context(viewport={'width': 1300, 'height': 900})
        s = login(ctx, 'estudiante1.a@demo.sematec.test')
        # ---------- Google desde la plataforma ----------
        go(s, f'{BASE}/app/apps')
        # (este entorno de pruebas no tiene internet: se registra la pestaña que se abriría)
        s.evaluate("window.__abiertas = []; window.open = function (u) { if (u) window.__abiertas.push(String(u)); return null; }")
        s.locator('[data-testid=texto-internet]').fill('examen teórico clase B')
        s.locator('[data-testid=buscar-google]').click()
        s.locator('[data-testid=motor-youtube]').click()
        urls = s.evaluate("window.__abiertas")
        check(urls and urls[0].startswith('https://www.google.com/search?q=examen') , f'🔎 Busca en Google desde la plataforma ({urls[0][:60] if urls else ""})')
        check(len(urls) > 1 and urls[1].startswith('https://www.youtube.com/results?search_query='), 'También en YouTube, Maps, Noticias, Académico y Wikipedia')
        # Buscador general: opción «Buscar en Google»
        go(s, f'{BASE}/app')
        s.keyboard.press('Control+k'); time.sleep(0.5)
        if s.locator('input[aria-label="Texto a buscar"]').count() == 0:
            s.locator('[data-testid=abrir-buscador], button[aria-label*="Buscar"]').first.click()
        s.locator('input[aria-label="Texto a buscar"]').fill('licencia de conducir')
        g = s.locator('[data-testid=buscar-en-google]')
        g.wait_for(timeout=10000)
        check('google.com/search?q=licencia' in (g.get_attribute('href') or ''), 'El buscador de la plataforma ofrece «Buscar en Google»')

        # ---------- Catálogo: PracticaTest con un toque ----------
        go(s, f'{BASE}/app/apps')
        cat = s.locator('[data-testid=catalogo-apps]')
        check('Conducir' in cat.text_content() and 'PracticaTest' in cat.text_content(), '🧩 El catálogo trae apps por categoría (Conducir: PracticaTest, CONASET…)')
        cat.locator('button:has-text("PracticaTest — examen teórico")').click(); status_msg(s)
        v = wait_for("select url||'|'||visibility from app_links where title like 'PracticaTest — examen%'")
        check(v == 'https://practicatest.cl/|private', f'Agrega «Práctica test municipalidad» a sus accesos con un toque ({v})')
        go(s, f'{BASE}/app/apps')
        check(s.locator('[data-testid=abrir-acceso]', has_text='PracticaTest').get_attribute('href') == 'https://practicatest.cl/' and
              s.locator('[data-testid=catalogo-apps] span:has-text("✓ 🚗 PracticaTest")').count() == 1, 'Aparece en «Mis accesos» y el catálogo lo marca como agregado')
        check(s.locator('[data-testid=instalar-app]').get_attribute('href') == '/descargar', '📲 Opción para instalar la plataforma en el dispositivo')

        # ---------- Manifiesto: la app instalada aparece en «Compartir» ----------
        m = s.request.get(f'{BASE}/manifest.webmanifest').json()
        st = m.get('share_target', {})
        check(st.get('action') == '/app/compartir' and st.get('method', '').lower() == 'post' and st['params'].get('files'), 'La app instalada aparece en el menú «Compartir» del dispositivo (enlaces y archivos)')

        # ---------- Compartir un enlace desde el dispositivo ----------
        r = s.request.post(f'{BASE}/app/compartir', multipart={'title': 'Video de señales de tránsito', 'text': 'Mira esto', 'url': 'https://www.youtube.com/watch?v=abc123XYZ00'},
                           headers={'Sec-Fetch-Site': 'none'}, max_redirects=0)
        loc = r.headers.get('location', '')
        check(r.status == 303 and '/app/compartir/recibido' in loc, f'Recibe un enlace compartido desde otra app ({r.status})')
        go(s, loc if loc.startswith('http') else BASE + loc)
        check('youtube.com/watch?v=abc123XYZ00' in s.locator('[data-testid=enlace-recibido]').inner_text() and 'youtube-nocookie.com/embed/abc123XYZ00' in (s.locator('[data-testid=visor-enlace] iframe').get_attribute('src') or ''),
              'Muestra lo compartido (el video se ve dentro)')
        s.locator('button:has-text("Guardar enlace")').click(); status_msg(s)
        check(wait_for("select url from user_files where name='Video de señales de tránsito'") == 'https://www.youtube.com/watch?v=abc123XYZ00', 'Lo guarda en «Mis archivos» con un toque')
        # Compartir una foto desde la galería
        png = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000''1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
        r = s.request.post(f'{BASE}/app/compartir', multipart={'files': {'name': 'foto-pizarra.png', 'mimeType': 'image/png', 'buffer': png}}, headers={'Sec-Fetch-Site': 'none'}, max_redirects=0)
        check('saved=1' in r.headers.get('location', '') and wait_for("select count(*) from user_files where name='foto-pizarra.png'", '1') == '1', '📷 Una foto compartida desde la galería queda en «Mis archivos»')
        # Otra página web no puede enviar cosas a su cuenta
        r = s.request.post(f'{BASE}/app/compartir', multipart={'url': 'https://malo.example'}, headers={'Sec-Fetch-Site': 'cross-site'}, max_redirects=0)
        check(r.status == 403, 'Otra página web no puede enviar cosas a su cuenta')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
