"""
Varias salas de un mismo curso, cada una con sus estudiantes, su profesor y su propio código.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'  # PRG101 sala S1, profesor1

def enter(p, code):
    go(p, f'{BASE}/app/aula'); p.fill('input[name=code]', code); p.click('button:has-text("Entrar a la sala")')
    try:
        p.wait_for_url(re.compile(r'/app/aula/[0-9a-f-]{36}'), timeout=6000); return p.url.rsplit('/', 1)[-1].split('?')[0]
    except Exception:
        return status_msg(p)

def main():
    # Segunda sala del mismo curso (PRG101), con otro profesor y otros estudiantes
    B = sql(f"insert into sections (organization_id, campus_id, course_id, period_id, code, teacher_id, grade_scale_id, capacity, modality) select organization_id, campus_id, course_id, period_id, 'Noche', '0a000000-0000-4000-8000-00000000a702', grade_scale_id, 30, 'online' from sections where id='{A}' returning id").split('\n')[0]
    ca, cb = sql(f"select room_code from sections where id='{A}'"), sql(f"select room_code from sections where id='{B}'")
    check(re.fullmatch(r'SALA-[A-Z2-9]{6}', cb or '') is not None and ca != cb, f'Cada sala tiene su propio código automático ({ca} / {cb})')
    for email, sec in (('estudiante1.a@demo.sematec.test', A), ('estudiante2.a@demo.sematec.test', B)):
        sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{sec}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='{email}'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(); p = login(c, 'estudiante1.a@demo.sematec.test'); go(p, f'{BASE}/app/aula')
        check(ca in p.locator('[data-testid=tarjeta-codigo]').all_inner_texts()[0] and p.locator('[data-testid=tarjeta-codigo]').count() == 1, 'El estudiante ve solo su sala, con su código')
        r = enter(p, ca.lower().replace('-', ' '))
        check(r == A, 'Con el código de su sala (minúsculas, con espacio) entra a su sala')
        r = enter(p, cb)
        check('no corresponde a ninguna de sus salas' in r, 'Con el código de otra sala no entra')
        go(p, f'{BASE}/app/aula/{A}'); check(ca in p.locator('[data-testid=codigo-sala]').inner_text(), 'La sala muestra su código para copiar')
        check(p.locator('[data-testid=otras-salas]').count() == 0, 'El estudiante no ve las otras salas')
        c.close()
        c = b.new_context(); p = login(c, 'estudiante2.a@demo.sematec.test')
        check(enter(p, cb) == B, 'El estudiante de la sala Noche entra con su código')
        check(p.locator(f'a[href="/app/aula/{A}"]').count() == 0, 'No ve la sala del otro grupo')
        c.close()
        c = b.new_context(); p = login(c, 'profesor2.a@demo.sematec.test')
        check(enter(p, cb) == B, 'El profesor de la sala entra con su código')
        check('no corresponde' in enter(p, ca), 'El profesor no entra a la sala de otro profesor')
        c.close()
        c = b.new_context(); p = login(c, 'secretaria.a@demo.sematec.test'); go(p, f'{BASE}/app/aula/{A}')
        check('Sala Noche' in p.locator('[data-testid=otras-salas]').inner_text(), 'Personal: ve las otras salas del mismo curso')
        go(p, f'{BASE}/app/secciones')
        codes = p.locator('[data-testid=codigo-sala-lista]').all_inner_texts()
        check(ca in codes and cb in codes, 'Secciones: cada sala muestra su código')
        go(p, f'{BASE}/app/secciones/{B}')
        p.once('dialog', lambda d: d.accept()); p.click('button:has-text("Nuevo código")'); m = status_msg(p)
        nb = sql(f"select room_code from sections where id='{B}'")
        check(nb != cb and nb in m, f'♻ Nuevo código de sala ({nb})')
        c.close()
        c = b.new_context(); p = login(c, 'estudiante2.a@demo.sematec.test')
        check('no corresponde' in enter(p, cb) and enter(p, nb) == B, 'El código anterior deja de funcionar y el nuevo sí')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
