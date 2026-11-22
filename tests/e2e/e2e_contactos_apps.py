"""📇 Contactos (llamar, WhatsApp, SMS, correo, mensaje) con privacidad, y 📱 apps y accesos con quién los ve."""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'
def one(q): return sql(q).split('\n')[0]
def wait_for(q, expect=None, secs=20):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if (expect is None and v) or (expect is not None and v == expect): return v
        time.sleep(0.4)
    return v

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email in ('estudiante1.a@demo.sematec.test') on conflict do nothing")
    sql(f"update sections set teacher_id = (select id from teachers where email='profesor1.a@demo.sematec.test') where id='{A}'")
    sql("update profiles set phone = '9 1234 5678' where email = 'estudiante1.a@demo.sematec.test'")
    sql("update profiles set phone = '+56 9 8765 4321' where email = 'profesor1.a@demo.sematec.test'")
    e1 = one("select id from profiles where email='estudiante1.a@demo.sematec.test'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        p = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'profesor1.a@demo.sematec.test')
        p.on('dialog', lambda d: d.accept())
        s1 = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'estudiante1.a@demo.sematec.test')

        # ---------- Contactos del profesor ----------
        go(p, f'{BASE}/app/contactos')
        c = p.locator('[data-testid=contacto]', has_text='Estudiante Uno').first
        check(c.locator('[data-testid=whatsapp]').get_attribute('href') == 'https://wa.me/56912345678' and c.locator('[data-testid=llamar]').get_attribute('href') == 'tel:+56912345678',
              '📞 El profesor puede llamar o escribir por WhatsApp a su estudiante (número chileno completado)')
        check(c.locator('[data-testid=sms]').get_attribute('href') == 'sms:+56912345678' and f'/app/mensajes?para={e1}' in c.locator('[data-testid=mensaje-interno]').get_attribute('href'),
              'También SMS y mensaje dentro de la plataforma')
        c.locator('input[type=checkbox]').check()
        href = p.locator('[data-testid=correo-elegidos]').get_attribute('href')
        check('estudiante1.a%40demo.sematec.test' in href, '📧 Correo a varios contactos elegidos')

        # ---------- Privacidad: el estudiante no ve el teléfono del profesor hasta que él lo permita ----------
        go(s1, f'{BASE}/app/contactos')
        cp = s1.locator('[data-testid=contacto]', has_text='Profesor Uno').first
        check(cp.count() == 1 and cp.locator('[data-testid=whatsapp]').count() == 0 and cp.locator('[data-testid=mensaje-interno]').count() == 1,
              '🔒 Por defecto el estudiante no ve el teléfono del profesor (sí puede enviarle mensajes)')
        go(p, f'{BASE}/app/contactos')
        p.locator('select[name=vis]').select_option('contactos'); p.locator('button:has-text("Guardar")').click(); status_msg(p)
        go(s1, f'{BASE}/app/contactos')
        cp = s1.locator('[data-testid=contacto]', has_text='Profesor Uno').first
        check(cp.locator('[data-testid=whatsapp]').get_attribute('href') == 'https://wa.me/56987654321', 'Cuando el profesor lo permite, el estudiante puede escribirle por WhatsApp')
        go(s1, f'{BASE}/app/aula/{A}')
        box = s1.locator('[data-testid=contactar-profesores]'); box.locator('summary').click()
        check(box.locator('[data-testid=whatsapp]').count() == 1, 'En el Aula, «📞 Contactar al profesor» con WhatsApp, llamada y mensaje')
        go(s1, f'{BASE}/app/contactos')
        s1.locator('select[name=vis]').select_option('nadie'); s1.locator('button:has-text("Guardar")').click(); status_msg(s1)
        go(p, f'{BASE}/app/contactos')
        c = p.locator('[data-testid=contacto]', has_text='Estudiante Uno').first
        check(c.locator('[data-testid=whatsapp]').count() == 0 and c.locator('[data-testid=mensaje-interno]').count() == 1, 'Si el estudiante elige «Nadie», su teléfono queda oculto (solo mensajes)')

        # ---------- Apps y accesos ----------
        go(p, f'{BASE}/app/apps')
        f = p.locator('form:has(button:has-text("Agregar"))')
        f.locator('[data-testid=app-conocida]').select_option('youtube')
        f.locator('input[name=title]').fill('Canal del curso')
        f.locator('[data-testid=visibilidad]').select_option('section')
        f.locator('button:has-text("Agregar")').click(); m = status_msg(p)
        yt = wait_for("select visibility||'|'||url from app_links where title='Canal del curso'")
        check(yt == 'section|https://www.youtube.com/', f'📱 El profesor agrega YouTube para su curso ({m[:40]})')
        go(p, f'{BASE}/app/apps')
        f = p.locator('form:has(button:has-text("Agregar"))')
        f.locator('input[name=title]').fill('Mi Kahoot'); f.locator('[data-testid=url-app]').fill('kahoot.it')
        f.locator('button:has-text("Agregar")').click(); status_msg(p)
        check(wait_for("select visibility||'|'||url from app_links where title='Mi Kahoot'") == 'private|https://kahoot.it', 'Agrega un enlace propio privado (completa https://)')
        go(s1, f'{BASE}/app/apps')
        shared = s1.locator('[data-testid=accesos-compartidos]').inner_text() if s1.locator('[data-testid=accesos-compartidos]').count() else ''
        check('Canal del curso' in shared and 'Mi Kahoot' not in shared, 'El estudiante del curso ve el acceso del curso, pero no el privado')
        check(s1.locator('[data-testid=abrir-acceso]', has_text='Canal del curso').get_attribute('href') == 'https://www.youtube.com/', 'Un toque abre YouTube (en el celular, la app)')
        # El estudiante crea su acceso privado (por ejemplo, llamar a su apoderado)
        f = s1.locator('form:has(button:has-text("Agregar"))')
        f.locator('input[name=title]').fill('Llamar a mi mamá'); f.locator('[data-testid=url-app]').fill('tel:+56 9 1111 2222'); f.locator('input[name=icon]').fill('📞')
        f.locator('button:has-text("Agregar")').click(); status_msg(s1)
        check(wait_for("select url from app_links where title='Llamar a mi mamá'") == 'tel:+56911112222', 'El estudiante agrega su propio acceso para llamar (tel:)')
        # Un estudiante no puede publicar para toda la institución
        go(s1, f'{BASE}/app/apps')
        f = s1.locator('form:has(button:has-text("Agregar"))')
        f.locator('input[name=title]').fill('Para todos'); f.locator('[data-testid=url-app]').fill('https://example.com')
        f.locator('[data-testid=visibilidad]').select_option('org')
        f.locator('button:has-text("Agregar")').click(); m = status_msg(s1)
        check('Solo profesores y personal' in m and one("select count(*) from app_links where title='Para todos'") == '0', f'Un estudiante no puede publicar accesos para toda la institución ({m[:50]})')
        # Eliminar
        go(p, f'{BASE}/app/apps')
        p.locator('[data-testid=acceso]', has_text='Mi Kahoot').locator('button:has-text("Eliminar")').click(); status_msg(p)
        check(wait_for("select count(*) from app_links where title='Mi Kahoot'", '0') == '0', 'Elimina un acceso')

        # ---------- Ficha del estudiante (personal) ----------
        o = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'propietario.a@demo.sematec.test', mfa=True)
        sid = one("select id from students where email='estudiante1.a@demo.sematec.test'")
        sql(f"update students set phone='+56 9 3333 4444' where id='{sid}'")
        go(o, f'{BASE}/app/estudiantes/{sid}')
        check(o.locator('[data-testid=contactar-estudiante] [data-testid=whatsapp]').get_attribute('href') == 'https://wa.me/56933334444', 'La ficha del estudiante tiene botones para llamarlo o escribirle por WhatsApp')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
