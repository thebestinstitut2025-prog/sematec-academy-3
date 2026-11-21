"""
1) La grabación de la clase NO se corta: sigue al cerrar el menú «Más» del celular y al cambiar el tamaño
   de la ventana; las partes quedan seguidas y se ven como UN solo video continuo.
2) Tarjetas de la sala con color y fondo subido desde el dispositivo.
3) El profesor sube archivos a tareas, exámenes, evaluaciones con enlace y contenidos; el estudiante los ve.
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'
T1 = '00000000-0000-4000-8000-000000000020'
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

def one(q): return sql(q).split('\n')[0]

def upload(scope, name, data, mime):
    scope.locator('[data-testid=adjuntar-input]').set_input_files([{'name': name, 'mimeType': mime, 'buffer': data}])
    end = time.time() + 30
    while time.time() < end:
        l = scope.locator('[data-testid=adjuntos-lista]')
        if l.count() and '✓' in l.inner_text(): return True
        time.sleep(0.3)
    return False

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test' on conflict do nothing")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
                               '--auto-accept-this-tab-capture', '--no-sandbox'])
        tc = b.new_context(viewport={'width': 1300, 'height': 900}); t = login(tc, 'profesor1.a@demo.sematec.test')
        t.on('dialog', lambda d: d.accept())

        # ================= 1. Grabación sin cortes =================
        room = one(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Sala grabación E2E', 'class', '{A}', 50, '{T1}') returning id")
        sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase sin cortes', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]
        t.set_viewport_size({'width': 390, 'height': 844})   # celular: los controles están en «⋯ Más»
        go(t, f'{BASE}/app/conferencias/sala/{sess}'); t.click('button:has-text("Entrar a la sala")'); t.wait_for_selector('.lk-video-conference', timeout=30000)
        t.evaluate("window.__sematecSegmentMs = 5000")
        t.locator('[data-testid=boton-mas]').click()
        t.locator('[data-testid=mas-opciones] [data-testid=boton-grabar]').click(); t.locator('button:has-text("Empezar a grabar")').click()
        t.wait_for_selector('[data-testid=detener-grabacion]', timeout=20000)
        started = time.time()
        t.locator('[data-testid=boton-mas]').click()   # cierra el menú «Más»
        t.wait_for_selector('[data-testid=grabacion-flotante] [data-testid=detener-grabacion]', timeout=5000)
        check(t.locator('[data-testid=mas-opciones]').count() == 0, 'Celular: al cerrar «Más» la grabación sigue (botón flotante ⏹)')
        time.sleep(7)
        t.set_viewport_size({'width': 1300, 'height': 900})   # pasa a pantalla grande
        t.wait_for_selector('footer [data-testid=detener-grabacion]', timeout=5000)
        check(True, 'Al cambiar el tamaño de la ventana la grabación sigue (⏹ en la barra)')
        time.sleep(7)
        t.locator('[data-testid=detener-grabacion]').click()
        elapsed = time.time() - started
        t.wait_for_selector('[data-testid=grabacion-lista] a:has-text("Ver la clase completa")', timeout=60000)
        rows = sql(f"select part_no||':'||coalesce(duration_sec,0) from conference_recordings where session_id = '{sess}' order by part_no").splitlines()
        nums = [int(x.split(':')[0]) for x in rows]; total = sum(int(x.split(':')[1]) for x in rows)
        check(len(rows) >= 3 and nums == list(range(1, len(rows) + 1)), f'Partes seguidas y completas, sin huecos: {nums}')
        check(abs(total - elapsed) <= 4, f'La suma de las partes ({total} s) cubre todo lo grabado ({elapsed:.0f} s)')
        first = one(f"select id from conference_recordings where session_id = '{sess}' order by part_no limit 1")
        go(t, f'{BASE}/app/conferencias/sala/{sess}')   # sale de la sala
        go(t, f'{BASE}/app/conferencias/{sess}')
        check(t.locator('[data-testid=grabacion]').count() == 1 and 'Clase completa' in t.locator('[data-testid=grabacion]').first.inner_text(),
              'La sesión muestra UNA grabación «Clase completa» (no partes sueltas)')
        t.goto(f'{BASE}/app/conferencias/grabacion/{first}/ver', wait_until='domcontentloaded'); t.wait_for_selector('[data-testid=video-continuo]')
        check(t.locator('[data-testid=parte-grabacion]').count() == len(rows), 'El reproductor junta todas las partes en un solo video continuo')
        t.locator('[data-testid=parte-grabacion]').nth(1).click()
        check('Parte 2 de' in t.locator('[data-testid=parte-actual]').inner_text(), 'Se puede saltar a cualquier tramo de la clase')
        # La parte siguiente queda precargada para que no haya pausa al cambiar
        t.wait_for_timeout(800)
        pre = t.evaluate("() => [...document.querySelectorAll('[data-testid=video-continuo] video')].map(v => v.dataset.src || '')")
        check(any(first not in p and p for p in pre), 'La parte siguiente se precarga (cambio sin pausa)')

        # ================= 2. Tarjetas con color y fondo =================
        t.goto('about:blank'); go(t, f'{BASE}/app/aula/{A}')
        box = t.locator('[data-testid=personalizar-tarjeta]'); box.locator('summary').click()
        box.locator('[data-testid=color-tarjeta]').nth(8).click()
        box.locator('button:has-text("Guardar estilo")').click(); status_msg(t)
        check(one(f"select card_color from sections where id='{A}'") == '#9333ea', 'Elige un color para la tarjeta de la sala')
        go(t, f'{BASE}/app/aula')
        card = t.locator('[data-testid=tarjeta-curso]', has_text='SALA-').first
        check('147, 51, 234' in (card.get_attribute('style') or '') or '9333ea' in (card.get_attribute('style') or ''), 'La tarjeta del aula se ve con ese color')
        go(t, f'{BASE}/app/aula/{A}')
        box = t.locator('[data-testid=personalizar-tarjeta]'); box.locator('summary').click()
        box.locator('[data-testid=fondo-tarjeta]').set_input_files([{'name': 'fondo.png', 'mimeType': 'image/png', 'buffer': PNG}])
        check('blob:' in (box.locator('[data-testid=vista-previa-tarjeta]').get_attribute('style') or ''), 'Vista previa de la imagen antes de guardar')
        box.locator('button:has-text("Guardar estilo")').click(); m = status_msg(t)
        img = one(f"select coalesce(card_image::text,'') from sections where id='{A}'")
        check(img != '' and one(f"select kind from media_assets where id='{img}'") == 'card', f'Sube una imagen de fondo desde el dispositivo ({m[:40]})')
        go(t, f'{BASE}/app/aula/{A}')
        check(f'/media/{img}' in (t.locator('[data-testid=portada-curso]').get_attribute('style') or ''), 'El curso muestra la portada con el fondo')
        box = t.locator('[data-testid=personalizar-tarjeta]'); box.locator('summary').click()
        box.locator('[data-testid=fondo-tarjeta]').set_input_files([{'name': 'malo.png', 'mimeType': 'image/png', 'buffer': b'<svg onload=alert(1)>'}])
        box.locator('button:has-text("Guardar estilo")').click(); m = status_msg(t)
        check('Formato' in m or 'no permitido' in m, f'Rechaza archivos que no son imágenes reales ({m[:50]})')
        go(t, f'{BASE}/app/aula/{A}')
        box = t.locator('[data-testid=personalizar-tarjeta]'); box.locator('summary').click()
        box.locator('[data-testid=quitar-fondo]').check(); box.locator('button:has-text("Guardar estilo")').click(); status_msg(t)
        check(one(f"select coalesce(card_image::text,'-') from sections where id='{A}'") == '-', 'Quita la imagen de fondo')

        # ================= 3. Archivos del profesor =================
        go(t, f'{BASE}/app/aula/{A}?t=tareas')
        t.click('summary:has-text("Nueva tarea")')
        form = t.locator('details:has(summary:has-text("Nueva tarea"))')
        form.locator('input[name=title]').fill('Tarea con guía'); form.locator('input[name=due_at]').fill('2030-01-10T18:00')
        check(upload(form, 'guia.pdf', PDF, 'application/pdf'), 'El profesor sube la guía al crear la tarea')
        form.locator('button:has-text("Publicar tarea")').click(); m = status_msg(t)
        tid = one("select id from assignments where title='Tarea con guía'")
        check('1 archivo' in m and one(f"select count(*) from attachments where entity_type='assignment' and entity_id='{tid}'") == '1', f'Tarea publicada con su archivo ({m[:50]})')
        go(t, f'{BASE}/app/aula/{A}?t=tareas')
        card = t.locator('.card', has_text='Tarea con guía').first
        eb = card.locator('[data-testid=editar-tarea]'); eb.locator('summary').click()
        check(upload(eb, 'pauta.png', PNG, 'image/png'), 'Agrega otro archivo al editar la tarea')
        eb.locator('button:has-text("Guardar cambios")').click(); status_msg(t)
        check(one(f"select count(*) from attachments where entity_type='assignment' and entity_id='{tid}'") == '2', 'La tarea queda con 2 archivos del profesor')
        # Examen y evaluación con enlace
        go(t, f'{BASE}/app/aula/{A}?t=examenes')
        t.click('summary:has-text("Nuevo examen")')
        form = t.locator('details:has(summary:has-text("Nuevo examen"))')
        form.locator('input[name=title]').fill('Examen con lectura'); form.locator('input[name=opens_at]').fill('2026-01-01T08:00'); form.locator('input[name=closes_at]').fill('2030-01-01T08:00')
        check(upload(form, 'lectura.pdf', PDF, 'application/pdf'), 'Sube la lectura del examen')
        form.locator('button:has-text("Crear examen")').click(); status_msg(t)
        qid = one("select id from quizzes where title='Examen con lectura'")
        sql(f"update quizzes set published = true where id='{qid}'")
        go(t, f'{BASE}/app/aula/{A}?t=examenes')
        t.click('summary:has-text("Nueva evaluación con enlace")')
        form = t.locator('[data-testid=nueva-evaluacion-externa]')
        form.locator('input[name=title]').fill('Forms con plantilla'); form.locator('input[name=url]').fill('https://forms.gle/xyz')
        form.locator('input[name=opens_at]').fill('2026-01-01T08:00'); form.locator('input[name=closes_at]').fill('2030-01-01T08:00')
        check(upload(form, 'plantilla.pdf', PDF, 'application/pdf'), 'Sube la plantilla de la evaluación con enlace')
        form.locator('button:has-text("Crear evaluación")').click(); m = status_msg(t)
        check('1 archivo' in m, f'Evaluación con enlace creada con su archivo ({m[:50]})')
        # Contenido con varios archivos
        go(t, f'{BASE}/app/aula/{A}')
        t.click('summary:has-text("Agregar contenido")')
        form = t.locator('details:has(summary:has-text("Agregar contenido"))')
        form.locator('select[name=kind]').select_option('texto'); form.locator('input[name=title]').fill('Apunte con anexos')
        check(upload(form, 'anexo.pdf', PDF, 'application/pdf'), 'Sube anexos a un contenido')
        form.locator('button:has-text("Publicar")').click(); m = status_msg(t)
        check('1 archivo' in m, f'Contenido publicado con anexos ({m[:50]})')

        # El estudiante ve y abre los archivos del profesor
        sc = b.new_context(viewport={'width': 1300, 'height': 900}); s = login(sc, 'estudiante1.a@demo.sematec.test')
        go(s, f'{BASE}/app/aula/{A}?t=tareas')
        card = s.locator('.card', has_text='Tarea con guía').first
        check(card.locator('[data-testid=material-tarea] [data-testid=adjuntos] li').count() == 2, 'El estudiante ve los 2 archivos de la tarea')
        href = card.locator('[data-testid=material-tarea] a:has-text("guia.pdf")').get_attribute('href')
        r = s.request.get(BASE + href, max_redirects=0)
        check(r.status in (200, 302, 303, 307), f'El estudiante puede abrir la guía ({r.status})')
        check(card.locator('[data-testid=material-tarea] button:has-text("Quitar")').count() == 0, 'El estudiante no puede quitar archivos del profesor')
        go(s, f'{BASE}/app/aula/{A}?t=examenes')
        check(s.locator('[data-testid=material-examen] a:has-text("lectura.pdf")').count() == 1 and s.locator('[data-testid=material-evaluacion] a:has-text("plantilla.pdf")').count() == 1,
              'Ve la lectura del examen y la plantilla de la evaluación')
        go(s, f'{BASE}/app/aula/{A}/examen/{qid}/rendir')
        check(s.locator('a:has-text("lectura.pdf")').count() == 1, 'Al rendir el examen tiene a mano la lectura')
        go(s, f'{BASE}/app/aula/{A}')
        check(s.locator('a:has-text("anexo.pdf")').count() == 1, 'Ve los anexos del contenido')
        # Estudiante de otra sala no puede abrirlos
        oc = b.new_context(); o = login(oc, 'estudiante2.a@demo.sematec.test')
        att = one(f"select id from attachments where entity_type='assignment' and entity_id='{tid}' limit 1")
        r = o.request.get(f'{BASE}/api/adjunto/{att}', max_redirects=0)
        check(r.status in (403, 404), f'Un estudiante de otra sala no puede abrir el archivo ({r.status})')
        # Al eliminar la tarea se quitan sus adjuntos
        sql(f"delete from assignments where id='{tid}'")
        check(one(f"select count(*) from attachments where entity_type='assignment' and entity_id='{tid}'") == '0', 'Eliminar la tarea quita sus adjuntos')
        b.close()

if __name__ == '__main__':
    try:
        main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
