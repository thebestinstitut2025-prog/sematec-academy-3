"""
📁 Archivos: quién puede verlos (personas, grupos, público), persona nueva por correo, enlaces (YouTube),
visor página por página y diapositiva por diapositiva, descargar como PowerPoint y abrir en apps.
"""
import os, sys, io, re, glob, time, zipfile
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
def one(q): return sql(q).split('\n')[0]

def make_pdf(pages=2):
    from reportlab.pdfgen import canvas
    b = io.BytesIO(); c = canvas.Canvas(b)
    for i in range(pages): c.drawString(100, 750, f'Pagina numero {i + 1}'); c.showPage()
    c.save(); return b.getvalue()

def make_pptx(n=3):
    from pptx import Presentation
    p = Presentation()
    for i in range(n):
        s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = f'Diapositiva {i + 1}'; s.placeholders[1].text = f'Contenido {i + 1}'
    b = io.BytesIO(); p.save(b); return b.getvalue()

def upload(page, name, data, mime):
    page.locator('[data-testid=subir-archivos] input[type=file]').set_input_files([{'name': name, 'mimeType': mime, 'buffer': data}])
    page.locator('button:has-text("Subir archivos")').click()
    page.wait_for_selector(f'text=✓ «{name}» guardado', timeout=60000)
    return one(f"select id from user_files where name='{name}' order by created_at desc limit 1")

def wait_for(q, expect=None, secs=20):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if (expect is None and v) or (expect is not None and v == expect): return v
        time.sleep(0.4)
    return v

def main():
    sql("insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '0a000000-0000-4000-8000-00000000ad01', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email in ('estudiante1.a@demo.sematec.test','estudiante2.a@demo.sematec.test') on conflict do nothing")
    sql("update sections set teacher_id = (select id from teachers where email='profesor1.a@demo.sematec.test') where id='0a000000-0000-4000-8000-00000000ad01'")
    e1u = one("select user_id from students where email='estudiante1.a@demo.sematec.test'")
    e2u = one("select user_id from students where email='estudiante2.a@demo.sematec.test'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        pc = b.new_context(viewport={'width': 1300, 'height': 900}, accept_downloads=True)
        p = login(pc, 'profesor1.a@demo.sematec.test')
        p.on('dialog', lambda d: d.accept())

        # ---------- Compartir con una persona al subir ----------
        go(p, f'{BASE}/app/archivos')
        up = p.locator('[data-testid=subir-archivos]')
        up.locator('[data-testid=visibilidad]').select_option('people')
        up.locator('[data-testid=elegir-personas] input[aria-label="Buscar personas"]').fill('Uno')
        up.locator('[data-testid=elegir-personas] label:has-text("Estudiante") input[type=checkbox]').first.check()
        chosen = up.locator('[data-testid=elegir-personas] [data-testid=elegidos]').inner_text()
        f1 = upload(p, 'guia-2-paginas.pdf', make_pdf(2), 'application/pdf')
        check(one(f"select visibility from user_files where id='{f1}'") == 'people' and one(f"select count(*) from file_shares where file_id='{f1}' and user_id='{e1u}'") == '1',
              f'Sube un archivo compartido solo con una persona elegida ({chosen})')
        s1 = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'estudiante1.a@demo.sematec.test')
        go(s1, f'{BASE}/app/archivos?t=compartidos')
        check(s1.locator('[data-testid=archivo]', has_text='guia-2-paginas.pdf').count() == 1, 'La persona elegida lo ve en «Compartidos conmigo»')
        s2c = b.new_context(viewport={'width': 1300, 'height': 900}); s2 = login(s2c, 'estudiante2.a@demo.sematec.test')
        go(s2, f'{BASE}/app/archivos?t=compartidos')
        check(s2.locator('[data-testid=archivo]', has_text='guia-2-paginas.pdf').count() == 0 and s2.request.get(f'{BASE}/app/archivos/ver/{f1}', max_redirects=0).status == 404,
              'Otra persona no lo ve ni lo puede abrir')

        # ---------- Visor PDF página por página ----------
        go(s1, f'{BASE}/app/archivos/abrir/{f1}')
        s1.wait_for_selector('[data-testid=pagina-actual]', timeout=30000)
        check('Página 1 de 2' in s1.locator('[data-testid=pagina-actual]').first.inner_text(), '👁 Lee el PDF página por página sin descargar (Página 1 de 2)')
        s1.locator('[data-testid=siguiente]').first.click()
        check('Página 2 de 2' in s1.locator('[data-testid=pagina-actual]').first.inner_text(), 'Pasa a la página siguiente')
        check(s1.locator('[data-testid=abrir-powerpoint]').count() == 1 and s1.locator('[data-testid=abrir-word]').count() == 1, 'Ofrece abrirlo en PowerPoint y en Word aunque sea PDF')

        # ---------- Descargar un PDF como PowerPoint ----------
        go(p, f'{BASE}/app/archivos/abrir/{f1}')
        p.locator('[data-testid=descargar-como]').first.click()
        with p.expect_download(timeout=90000) as dl:
            p.locator('[data-testid=formato-pptx-any]').click()
        path = dl.value.path(); data = open(path, 'rb').read()
        z = zipfile.ZipFile(io.BytesIO(data)); slides = [n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)]
        check(dl.value.suggested_filename.endswith('.pptx') and len(slides) == 2, f'⬇ Descarga el PDF como PowerPoint: una diapositiva por página ({len(slides)})')

        # ---------- PowerPoint diapositiva por diapositiva ----------
        go(p, f'{BASE}/app/archivos')
        f2 = upload(p, 'clase-3.pptx', make_pptx(3), 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
        go(p, f'{BASE}/app/archivos/abrir/{f2}')
        p.wait_for_selector('[data-testid=diapositiva]', timeout=40000)
        check('Diapositiva 1 de 3' in p.locator('[data-testid=pagina-actual]').first.inner_text(), '👁 Ve el PowerPoint diapositiva por diapositiva')
        p.locator('[data-testid=siguiente]').first.click()
        check('Diapositiva 2 de 3' in p.locator('[data-testid=pagina-actual]').first.inner_text(), 'Avanza a la diapositiva siguiente')
        check(p.locator('[data-testid=ver-office-online]').count() == 1, 'Ofrece ver con Office en línea')
        # Enlace para abrir en la app (PowerPoint/Word): con clave temporal
        tok = one(f"""select public.create_file_token('{f2}', 'open') from (select set_config('request.jwt.claims', '{{"sub":"{one("select user_id from teachers where email='profesor1.a@demo.sematec.test'")}","role":"authenticated"}}', true)) x""")
        r = b.new_context().request.get(f'{BASE}/archivo/{tok}/raw/clase-3.pptx', max_redirects=0)
        check(r.status in (302, 307) and 'user-files' in r.headers.get('location', ''), f'📊 El enlace temporal para PowerPoint funciona sin sesión ({r.status})')

        # ---------- Word página por página ----------
        import docx as _docx
        d = _docx.Document(); d.add_heading('Informe de prueba', 1)
        for i in range(60): d.add_paragraph(f'Párrafo {i + 1}: texto de ejemplo para llenar varias páginas del documento.')
        bio = io.BytesIO(); d.save(bio)
        go(p, f'{BASE}/app/archivos')
        f3 = upload(p, 'informe.docx', bio.getvalue(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        go(p, f'{BASE}/app/archivos/abrir/{f3}')
        p.wait_for_selector('[data-testid=pagina-actual]', timeout=40000)
        txt = p.locator('[data-testid=pagina-actual]').first.inner_text()
        check(re.search(r'Página 1 de [2-9]', txt) is not None, f'👁 Lee un Word página por página ({txt})')

        # ---------- Grupos ----------
        go(p, f'{BASE}/app/archivos?t=grupos')
        p.locator('[data-testid=nombre-grupo]').fill('Grupo E2E')
        p.locator('[data-testid=integrantes] input[aria-label="Buscar personas"]').fill('Dos')
        p.locator('[data-testid=integrantes] label:has-text("Estudiante") input[type=checkbox]').first.check()
        p.locator('button:has-text("Crear grupo")').click(); m = status_msg(p)
        gid = wait_for("select id from people_groups where name='Grupo E2E'")
        check(gid and one(f"select count(*) from people_group_members where group_id='{gid}' and user_id='{e2u}'") == '1', f'👥 Crea un grupo y elige a sus integrantes ({m[:40]})')
        go(p, f'{BASE}/app/archivos/abrir/{f1}')
        acc = p.locator('[data-testid=quien-puede-ver]')
        acc.locator('[data-testid=elegir-grupos] label:has-text("Grupo E2E") input').check()
        p.locator('button:has-text("Guardar")').first.click(); status_msg(p)
        go(s2, f'{BASE}/app/archivos?t=compartidos')
        check(s2.locator('[data-testid=archivo]', has_text='guia-2-paginas.pdf').count() == 1, 'Compartido con el grupo: sus integrantes lo ven')

        # ---------- Público ----------
        acc = p.locator('[data-testid=quien-puede-ver]')
        acc.locator('[data-testid=visibilidad]').select_option('public')
        p.locator('button:has-text("Guardar")').first.click(); m = status_msg(p)
        tok = wait_for(f"select token from file_tokens where file_id='{f1}' and kind='public'")
        check(tok and '/archivo/' in m, f'🌐 Lo hace público y entrega el enlace ({m[:60]})')
        anon = b.new_context(viewport={'width': 1300, 'height': 900}).new_page()
        anon.goto(f'{BASE}/archivo/{tok}'); anon.wait_for_selector('[data-testid=pagina-actual]', timeout=30000)
        check('guia-2-paginas.pdf' in anon.content() and 'Página 1 de 2' in anon.locator('[data-testid=pagina-actual]').first.inner_text(), 'Cualquiera con el enlace lo ve, sin cuenta, página por página')
        acc.locator('[data-testid=visibilidad]').select_option('private'); p.locator('button:has-text("Guardar")').first.click(); status_msg(p)
        anon.goto(f'{BASE}/archivo/{tok}')
        check('venció' in anon.content(), 'Al volverlo privado, el enlace público deja de funcionar')

        # ---------- Persona nueva por correo ----------
        before = set(glob.glob('/tmp/mails/*.eml'))
        go(p, f'{BASE}/app/archivos/abrir/{f2}')
        p.locator('[data-testid=correos-nuevos]').fill('invitado.nuevo@example.com')
        p.locator('button:has-text("Enviar")').click(); m = status_msg(p)
        mail = ''
        for _ in range(40):
            new = [x for x in glob.glob('/tmp/mails/*.eml') if x not in before]
            mail = next((open(x, encoding='utf-8', errors='ignore').read() for x in new if 'invitado.nuevo@example.com' in open(x, encoding='utf-8', errors='ignore').read()), '')
            if mail: break
            time.sleep(0.5)
        link = re.search(r'/archivo/([0-9a-f]{48})', mail.replace('=\n', ''))
        check(link is not None, f'✉ Envía el archivo por correo a una persona nueva ({m[:50]})')
        anon.goto(f'{BASE}/archivo/{link.group(1)}'); anon.wait_for_selector('[data-testid=diapositiva]', timeout=40000)
        check('clase-3.pptx' in anon.content(), 'La persona nueva lo ve sin crear cuenta, diapositiva por diapositiva')

        # ---------- Enlaces (YouTube) ----------
        go(p, f'{BASE}/app/archivos')
        p.locator('[data-testid=url-enlace]').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
        p.locator('input[name=name][placeholder*="Clase 3"]').fill('Video de la clase')
        p.locator('button:has-text("Guardar enlace")').click(); status_msg(p)
        lid = wait_for("select id from user_files where name='Video de la clase'")
        check(one(f"select url from user_files where id='{lid}'") == 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '🔗 Guarda un enlace de YouTube como un archivo más')
        go(p, f'{BASE}/app/archivos/abrir/{lid}')
        check('youtube-nocookie.com/embed/dQw4w9WgXcQ' in (p.locator('[data-testid=visor-enlace] iframe').get_attribute('src') or ''), 'El video de YouTube se ve dentro de la plataforma')

        # ---------- Seguridad ----------
        bad = b.new_context().request.get(f'{BASE}/archivo/{"0" * 48}/raw/x.pdf', max_redirects=0)
        check(bad.status == 404, 'Una clave inventada no abre nada')
        sql(f"update user_files set deleted_at = now() where id='{f2}'")
        anon.goto(f'{BASE}/archivo/{link.group(1)}')
        check('venció' in anon.content(), 'Si el archivo se elimina, su enlace deja de funcionar')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
