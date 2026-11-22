"""👩‍🏫 Varios profesores por sección y por asignatura: agregar, permisos en el aula, mensajes, quitar."""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'
def one(q): return sql(q).split('\n')[0]

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test' on conflict do nothing")
    p2 = one("select id from teachers where email='profesor2.a@demo.sematec.test'")
    p2u = one("select user_id from teachers where email='profesor2.a@demo.sematec.test'")
    sql(f"update sections set teacher_id = (select id from teachers where email='profesor1.a@demo.sematec.test') where id='{A}'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        o = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'propietario.a@demo.sematec.test', mfa=True)
        o.on('dialog', lambda d: d.accept())
        # Antes: profesor 2 no tiene acceso a la sala A
        t2c = b.new_context(viewport={'width': 1300, 'height': 900}); t2 = login(t2c, 'profesor2.a@demo.sematec.test')
        go(t2, f'{BASE}/app/aula')
        before = t2.locator(f'a[href="/app/aula/{A}"]').count()
        # Agregar co-profesor desde la sección
        go(o, f'{BASE}/app/secciones/{A}')
        box = o.locator('[data-testid=agregar-profesores]'); box.locator('summary').click()
        box.locator('input[aria-label="Buscar personas"]').fill('Dos')
        box.locator('label:has-text("Dos") input[type=checkbox]').first.check()
        box.locator('button:has-text("Agregar a la sección")').click(); m = status_msg(o)
        check(one(f"select role from section_teachers where section_id='{A}' and teacher_id='{p2}'") == 'coprofesor', f'Agrega un co-profesor a la sección ({m[:50]})')
        go(o, f'{BASE}/app/secciones/{A}')
        team = o.locator('[data-testid=equipo-docente]').inner_text()
        check('Titular' in team and 'Co-profesor' in team, 'La sección muestra el titular y el co-profesor')
        # El co-profesor ahora maneja el aula
        go(t2, f'{BASE}/app/aula')
        check(before == 0 and t2.locator(f'a[href="/app/aula/{A}"]').count() == 1, 'El co-profesor ve la sala en su Aula')
        go(t2, f'{BASE}/app/aula/{A}?t=tareas')
        check(t2.locator('summary:has-text("Nueva tarea")').count() == 1, 'Y puede crear tareas (maneja el aula)')
        check('co-profesor' in t2.locator('main').inner_text(), 'El aula muestra a todos los profesores de la sala')
        go(t2, f'{BASE}/app/docencia')
        check(t2.locator(f'a[href*="{A}"]').count() >= 1, 'Aparece en «Mis secciones» del co-profesor')
        go(t2, f'{BASE}/app/secciones/{A}?t=asistencia')
        check(t2.locator('text=Libro de clases').count() >= 1 and '404' not in t2.title(), 'Puede abrir el libro de clases y asistencia')
        # Estudiante puede escribirle al co-profesor
        rec = sql(f"""set request.jwt.claims = '{{"sub":"{one("select user_id from students where email='estudiante1.a@demo.sematec.test'")}","role":"authenticated"}}'; select string_agg(user_id::text, ',') from message_recipients('{ORG}')""").splitlines()[-1]
        check(p2u in rec, 'El estudiante puede enviar mensajes a su co-profesor')
        # Asignatura completa: agrega como ayudante en todas sus secciones activas
        course = one(f"select course_id from sections where id='{A}'")
        nsec = int(one(f"select count(*) from sections where course_id='{course}' and status='active'"))
        p3 = one(f"select id from teachers where organization_id='{ORG}' and email not in ('profesor1.a@demo.sematec.test','profesor2.a@demo.sematec.test') limit 1")
        if not p3:
            p3 = one(f"insert into teachers (organization_id, teacher_code, first_names, last_names, email) values ('{ORG}', 'E2EAYU', 'Ana', 'Ayudante', 'ayudante.e2e@demo.sematec.test') returning id")
        go(o, f'{BASE}/app/secciones')
        box = o.locator('[data-testid=profesores-asignatura]'); box.locator('summary').click()
        box.locator('select[name=course_id]').select_option(course); box.locator('select[name=role]').select_option('ayudante')
        name3 = one(f"select first_names from teachers where id='{p3}'")
        box.locator('input[aria-label="Buscar personas"]').fill(name3)
        box.locator(f'label:has-text("{name3}") input[type=checkbox]').first.check()
        box.locator('button:has-text("Agregar a la asignatura")').click(); m = status_msg(o)
        check(one(f"select count(*) from section_teachers st join sections s on s.id=st.section_id where st.teacher_id='{p3}' and s.course_id='{course}' and st.role='ayudante'") == str(nsec),
              f'Agrega un ayudante a todas las secciones activas de la asignatura ({nsec}) ({m[:50]})')
        # Quitar al co-profesor
        go(o, f'{BASE}/app/secciones/{A}')
        o.locator('[data-testid=equipo-docente] li', has_text='Co-profesor').first.locator('button:has-text("Quitar")').click(); status_msg(o)
        check(one(f"select count(*) from section_teachers where section_id='{A}' and teacher_id='{p2}'") == '0', 'Quita un profesor de la sección')
        go(t2, f'{BASE}/app/aula')
        check(t2.locator(f'a[href="/app/aula/{A}"]').count() == 0, 'Al quitarlo, ya no ve la sala')
        # Un profesor no puede agregar profesores (solo quien administra secciones)
        import subprocess
        r = subprocess.run(['psql', '-h', '/tmp/pg', '-p', '54322', '-U', 'postgres', '-d', 'academy', '-tAc',
            f"""select set_config('request.jwt.claims', '{{"sub":"{p2u}","role":"authenticated"}}', true); set local role authenticated; select public.add_section_teacher('{A}', '{p2}', 'coprofesor')"""], capture_output=True, text=True)
        check(r.returncode != 0 and 'No autorizado' in r.stderr, 'Base: un profesor no puede agregarse solo a una sección')
        check(one(f"select count(*) from section_teachers where section_id='{A}' and teacher_id='{p2}'") == '0', 'Un profesor no puede agregarse a una sección por su cuenta')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
