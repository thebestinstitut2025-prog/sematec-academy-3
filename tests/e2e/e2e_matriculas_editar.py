"""
Matrículas: cambiar monto/cuotas de un arancel, anularlo y eliminar una matrícula.
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

def main():
    enr = sql("select e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test'")
    enr3 = sql("select e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante3.a@demo.sematec.test'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1400, 'height': 900}); p = login(c, 'propietario.a@demo.sematec.test', mfa=True)
        p.on('dialog', lambda d: d.accept())
        go(p, f'{BASE}/app/matriculas/{enr}')
        f = p.locator('form:has(button:has-text("Agregar arancel"))')
        f.locator('select[name=concept]').select_option('tuition'); f.locator('input[name=amount]').fill('300000')
        f.locator('input[name=installments]').fill('3'); f.locator('input[name=first_due]').fill('2026-12-05')
        f.locator('button:has-text("Agregar arancel")').click(); check('cuotas generados' in status_msg(p), 'Agregar arancel a la matrícula')
        go(p, f'{BASE}/app/matriculas/{enr}')
        row = p.locator('[data-testid=fila-arancel]').last
        row.locator('[data-testid=cambiar-arancel] summary').click()
        row.locator('[data-testid=cambiar-arancel] input[name=amount]').fill('450000'); row.locator('[data-testid=cambiar-arancel] input[name=installments]').fill('5'); row.locator('[data-testid=cambiar-arancel] input[name=reason]').fill('Precio corregido')
        row.locator('button:has-text("Guardar cambio")').click(); m = status_msg(p)
        check('Arancel actualizado' in m, f'✏ Cambiar monto y cuotas ({m[:80]})')
        st = sql(f"select string_agg(status::text||':'||net_amount::int||':'||(select count(*) from installments i where i.charge_id=c.id), ',' order by created_at) from charges c where enrollment_id='{enr}'")
        check(st == 'cancelled:300000:3,pending:450000:5', f'El arancel anterior queda anulado y el nuevo con 5 cuotas ({st})')
        go(p, f'{BASE}/app/matriculas/{enr}')
        row = p.locator('[data-testid=fila-arancel]').last
        row.locator('[data-testid=anular-arancel] summary').click(); row.locator('[data-testid=anular-arancel] input[name=reason]').fill('Ya no corresponde')
        row.locator('button:has-text("Anular arancel")').click(); m = status_msg(p)
        check('anulado' in m and sql(f"select count(*) from charges where enrollment_id='{enr}' and status<>'cancelled'") == '0', '🗑 Anular arancel')
        # Eliminar matrícula desde la lista
        go(p, f'{BASE}/app/matriculas')
        r3 = p.locator('tr', has=p.locator(f'a[href="/app/matriculas/{enr3}"]'))
        r3.locator('[data-testid=eliminar-matricula] summary').click(); r3.locator('[data-testid=eliminar-matricula] input[name=reason]').fill('Matrícula duplicada')
        r3.locator('button:has-text("Eliminar")').last.click(); m = status_msg(p)
        check('eliminada' in m and sql(f"select count(*) from enrollments where id='{enr3}'") == '0', f'🗑 Eliminar matrícula desde la lista ({m[:70]})')
        # Con notas no se puede eliminar
        enr2 = sql("select e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante2.a@demo.sematec.test'")
        sec = sql("select id from sections limit 1")
        sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select organization_id, '{sec}', student_id, id from enrollments where id='{enr2}'")
        sql(f"insert into assessments (organization_id, section_id, name, weight_pct) select organization_id, '{sec}', 'Prueba E2E', 100 from sections where id='{sec}'")
        sql(f"insert into grades (organization_id, assessment_id, student_id, grade) select a.organization_id, a.id, e.student_id, 5.5 from assessments a, enrollments e where a.name='Prueba E2E' and e.id='{enr2}'")
        go(p, f'{BASE}/app/matriculas/{enr2}')
        f = p.locator('form:has(button:has-text("Eliminar matrícula"))'); f.locator('input[name=reason]').fill('prueba')
        f.locator('button:has-text("Eliminar matrícula")').click(); m = status_msg(p)
        check('notas' in m and sql(f"select count(*) from enrollments where id='{enr2}'") == '1', f'Con notas no se elimina y explica qué hacer ({m[:70]})')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
