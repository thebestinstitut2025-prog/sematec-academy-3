"""
Publicaciones del sitio web: noticias con fotos y videos, video de YouTube, borradores, fijar, editar y eliminar.
"""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
MP4 = b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom' + b'\x00' * 64

def upload(scope, files):
    scope.locator('[data-testid=adjuntar-input]').set_input_files([{'name': n, 'mimeType': m, 'buffer': b} for n, m, b in files])
    end = time.time() + 30
    while time.time() < end:
        t = scope.locator('[data-testid=adjuntos-lista]').inner_text() if scope.locator('[data-testid=adjuntos-lista]').count() else ''
        if t.count('✓') >= len(files): return True
        if '✕' in t: print('ERR', t); return False
        time.sleep(0.4)
    return False

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'propietario.a@demo.sematec.test', mfa=True)
        p.on('dialog', lambda d: d.accept())
        go(p, f'{BASE}/app/sitio/publicaciones')
        f = p.locator('form:has(button:has-text("Publicar"))').first
        f.locator('select[name=kind]').select_option('foto'); f.locator('input[name=title]').fill('Ceremonia de titulación 2026')
        f.locator('textarea[name=body]').fill('Felicitamos a nuestros egresados.')
        check(upload(f, [('ceremonia1.png', 'image/png', PNG), ('ceremonia2.png', 'image/png', PNG), ('discurso.mp4', 'video/mp4', MP4)]), 'Sube 2 fotos y 1 video a la publicación')
        f.locator('button:has-text("Publicar")').click(); m = status_msg(p)
        check('Publicada' in m and sql("select count(*) from site_post_media") == '3', f'Publicación creada con sus 3 archivos ({m[:50]})')
        go(p, f'{BASE}/app/sitio/publicaciones')
        f = p.locator('form:has(button:has-text("Publicar"))').first
        f.locator('select[name=kind]').select_option('video'); f.locator('input[name=title]').fill('Clase abierta en video')
        f.locator('input[name=video_url]').fill('https://youtu.be/dQw4w9WgXcQ'); f.locator('input[name=published]').uncheck()
        f.locator('button:has-text("Publicar")').click(); m = status_msg(p)
        check('borrador' in m, 'Video de YouTube guardado como borrador')
        c2 = b.new_context(); v = c2.new_page()
        go(v, f'{BASE}/')
        check('Ceremonia de titulación 2026' in v.locator('[data-testid=novedades]').inner_text(), 'Portada: muestra la novedad')
        check(v.locator('a[href="/publicaciones"]').count() >= 1, 'Menú del sitio: enlace «Novedades»')
        go(v, f'{BASE}/publicaciones')
        check(v.locator('[data-testid=publicacion]').count() == 1, 'Novedades: el borrador no se ve')
        pid = sql("select id from site_posts where title='Ceremonia de titulación 2026'")
        go(v, f'{BASE}/publicaciones/{pid}')
        check(v.locator('[data-testid=post-foto]').count() == 2 and v.locator('[data-testid=post-video]').count() == 1, 'Detalle: galería con 2 fotos y el video')
        mid = sql(f"select id from site_post_media where post_id='{pid}' limit 1")
        check(v.request.get(f'{BASE}/media-sitio/{mid}', max_redirects=0).status == 302, 'Los visitantes pueden ver las fotos y videos publicados')
        vid = sql("select id from site_posts where title='Clase abierta en video'")
        check(v.request.get(f'{BASE}/publicaciones/{vid}').status == 404, 'El borrador no se puede abrir desde afuera')
        # Publicar el video y fijarlo arriba
        go(p, f'{BASE}/app/sitio/publicaciones')
        row = p.locator('[data-testid=fila-publicacion]', has_text='Clase abierta en video')
        row.locator('button:has-text("Publicar")').click(); status_msg(p)
        go(p, f'{BASE}/app/sitio/publicaciones'); row = p.locator('[data-testid=fila-publicacion]', has_text='Clase abierta en video')
        row.locator('button:has-text("Fijar")').click(); status_msg(p)
        go(v, f'{BASE}/publicaciones')
        first = v.locator('[data-testid=publicacion]').first
        check('Clase abierta en video' in first.inner_text() and first.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]').count() == 1, 'Publicado y fijado arriba, con el video de YouTube dentro de la página')
        # Editar y eliminar
        go(p, f'{BASE}/app/sitio/publicaciones'); row = p.locator('[data-testid=fila-publicacion]', has_text='Ceremonia de titulación 2026')
        row.locator('[data-testid=editar-publicacion] summary').click(); row.locator('[data-testid=editar-publicacion] input[name=title]').fill('Ceremonia de titulación 2026 · Galería')
        row.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(sql(f"select title from site_posts where id='{pid}'") == 'Ceremonia de titulación 2026 · Galería', '✏ Editar publicación')
        go(p, f'{BASE}/app/sitio/publicaciones'); row = p.locator('[data-testid=fila-publicacion]', has_text='Clase abierta en video')
        row.locator('button:has-text("Eliminar")').click(); status_msg(p)
        check(sql("select count(*) from site_posts") == '1', '🗑 Eliminar publicación')
        c2.close(); c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
