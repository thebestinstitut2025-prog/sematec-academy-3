"""🎓 Inscripción web asociada a los cursos: cada curso del sitio indica sus asignaturas; quien paga en línea o se inscribe
desde la web queda matriculado e inscrito en ellas (aula virtual, notas y asistencia)."""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
S1, S3 = '0a000000-0000-4000-8000-00000000ad01', '0a000000-0000-4000-8000-00000000ad03'
def one(q): return sql(q).split('\n')[0]
def rut(n):
    s, m = 0, 2
    for d in reversed(str(n)): s += int(d) * m; m = 2 if m == 7 else m + 1
    dv = 11 - s % 11
    body = f'{n:,}'.replace(',', '.')
    return f"{body}-{'0' if dv == 11 else 'K' if dv == 10 else dv}"
def secs_of(email):
    return one(f"select count(*) from section_enrollments se join students s on s.id=se.student_id where lower(s.email)='{email}' and se.section_id in ('{S1}','{S3}') and se.status='enrolled'")

def buy(b, email, n):
    c = b.new_context(viewport={'width': 1366, 'height': 900}); p = c.new_page()
    go(p, f'{BASE}/cursos/sql-desde-cero/inscripcion')
    p.fill('input[name=name]', 'Comprador Cursos'); p.fill('input[name=email]', email); p.fill('input[name=doc_number]', rut(n))
    p.check('input[name=provider][value=webpay]'); p.check('input[name=consent]')
    p.click('button:has-text("Ir a pagar")'); p.wait_for_selector('#provider', timeout=20000); p.click('#approve')
    p.wait_for_url(re.compile(r'/pago/resultado/'), timeout=30000); p.wait_for_load_state('networkidle')
    try: p.wait_for_selector('text=¡Pago aprobado!', timeout=15000)
    except Exception: pass
    c.close()

def main():
    off = one("select id from catalog_offerings where slug='sql-desde-cero'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        o = login(b.new_context(viewport={'width': 1400, 'height': 900}), 'propietario.a@demo.sematec.test', mfa=True)
        # 1) Alguien compra antes de asociar asignaturas
        buy(b, 'antes.cursos@demo.sematec.test', 14141414)
        check(one("select status from checkout_orders where buyer_email='antes.cursos@demo.sematec.test'") == 'paid' and secs_of('antes.cursos@demo.sematec.test') == '0',
              'Compra previa: matriculado, todavía sin asignaturas')
        # 2) Asociar asignaturas al curso del sitio
        go(o, f'{BASE}/app/sitio/cursos')
        check('desactivada' in o.locator('[data-testid=estado-inscripcion-web]').inner_text() and o.locator('[data-testid=sin-asignaturas]').count() >= 1,
              '⚠ Avisa que la inscripción web general está apagada y qué cursos no tienen asignaturas')
        go(o, f'{BASE}/app/sitio/cursos/{off}')
        for sid in (S1, S3): o.locator(f'[data-testid=seccion-curso][value="{sid}"]').check()
        o.check('[data-testid=inscribir-anteriores]')
        o.click('button:has-text("Guardar asignaturas")'); msg = status_msg(o); print('   ', msg)
        check(one(f"select cardinality(section_ids) from catalog_offerings where id='{off}'") == '2', '🎓 El curso del sitio queda asociado a 2 asignaturas')
        check(secs_of('antes.cursos@demo.sematec.test') == '2', '🎓 «Inscribir también a los anteriores»: quien ya había comprado queda en sus asignaturas')
        # 3) Compra en línea después: queda inscrito solo
        buy(b, 'despues.cursos@demo.sematec.test', 15151515)
        check(secs_of('despues.cursos@demo.sematec.test') == '2', '💳 Al pagar en línea queda inscrito en las asignaturas del curso')
        # 4) Inscripción general desde la web con el curso preelegido
        sql(f"insert into organization_settings (organization_id, key, value) values ('{ORG}', 'inscripcion.general', '{{\"enabled\": true, \"fee\": 0}}') on conflict (organization_id, key) do update set value = excluded.value")
        c = b.new_context(viewport={'width': 390, 'height': 844}); p = c.new_page()
        go(p, f'{BASE}/cursos/sql-desde-cero')
        inc = p.locator('[data-testid=asignaturas-incluidas]').inner_text()
        check('Programación I' in inc and 'Bases de Datos' in inc, '📚 La página del curso muestra las asignaturas en que quedará')
        p.click('[data-testid=inscribirme-curso]'); p.wait_for_url(re.compile(r'/inscripcion\?curso='))
        check(p.locator('[data-testid=elegir-programa]').input_value() == off, '📝 «Inscribirme» abre la inscripción con el curso ya elegido')
        check(p.locator('a[href="/inscripcion"]').count() >= 1, '☰ «Inscripción» aparece en el menú del sitio')
        p.fill('input[name=name]', 'Inés Web Cursos'); p.fill('input[name=email]', 'ines.cursos@demo.sematec.test'); p.fill('input[name=doc_number]', rut(16161616))
        p.check('input[name=consent]'); p.click('button:has-text("Enviar inscripción")')
        p.wait_for_url(re.compile(r'/inscripcion/lista'), timeout=30000)
        check(secs_of('ines.cursos@demo.sematec.test') == '2', '🎓 Inscripción web: queda inscrita en las asignaturas del curso')
        check(one(f"select count(*) from enrollments e join students s on s.id=e.student_id where s.email='ines.cursos@demo.sematec.test' and e.program_id=(select program_id from catalog_offerings where id='{off}')") == '1',
              '🎓 …y matriculada en el programa del curso')
        # 5) Ya aparece en la sección del profesor
        t = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'profesor1.a@demo.sematec.test')
        sql(f"update sections set teacher_id = (select id from teachers where email='profesor1.a@demo.sematec.test') where id='{S1}'")
        go(t, f'{BASE}/app/secciones/{S1}?t=planillas')
        go(t, f'{BASE}/app/secciones/{S1}')
        check('Inés' in t.locator('main').inner_text(), '👩‍🏫 El profesor ya la ve en su sección')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
