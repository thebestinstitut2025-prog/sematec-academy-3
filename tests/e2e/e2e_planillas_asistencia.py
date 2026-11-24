"""📊 Planillas de asistencia: tablas con filas y columnas, marcar con un toque, columnas propias, diseño, Excel, varias tablas."""
import os, sys, io, time, zipfile
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

A = '0a000000-0000-4000-8000-00000000ad01'
def one(q): return sql(q).split('\n')[0]
def wait_for(q, expect=None, secs=15):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if (expect is None and v) or (expect is not None and v == expect): return v
        time.sleep(0.3)
    return v

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email in ('estudiante1.a@demo.sematec.test','estudiante2.a@demo.sematec.test') on conflict do nothing")
    sql(f"update sections set teacher_id = (select id from teachers where email='profesor1.a@demo.sematec.test'), grades_closed_at = null where id='{A}'")
    e1 = one("select id from students where email='estudiante1.a@demo.sematec.test'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        p = login(b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True), 'profesor1.a@demo.sematec.test')
        p.on('dialog', lambda d: d.accept())
        go(p, f'{BASE}/app/secciones/{A}?t=planillas')
        nt = p.locator('[data-testid=nueva-tabla]')
        if nt.get_attribute('open') is None: nt.locator('summary').click()
        nt.locator('input[name=name]').fill('Marzo'); nt.locator('select[name=theme]').select_option('morado')
        nt.locator('button:has-text("Crear tabla")').click(); status_msg(p)
        sid = wait_for(f"select id from attendance_sheets where section_id='{A}' and name='Marzo'")
        check(sid and one(f"select design->>'theme' from attendance_sheets where id='{sid}'") == 'morado', '📊 Crea una tabla de asistencia con su color')
        # Columnas (clases)
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={sid}')
        for dte in ['2030-03-02', '2030-03-09']:
            p.locator('[data-testid=agregar-columna]').click()
            p.locator('input[name=date]').first.fill(dte); p.locator('input[name=topic]').first.fill(f'Clase {dte}')
            p.locator('button:has-text("Agregar columna")').click(); status_msg(p)
            go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={sid}')
        cols = p.locator('[data-testid=columna-clase]').count()
        rows = p.locator('[data-testid=fila-estudiante]').count()
        check(cols >= 2 and rows >= 2, f'Filas = estudiantes ({rows}) y columnas = clases ({cols})')
        s1 = one(f"select id from class_sessions where section_id='{A}' and starts_at::date='2030-03-02'")
        # Marcar con un toque (ciclo P → A → T → J)
        row = p.locator('[data-testid=fila-estudiante]', has_text='Uno').first
        cell = row.locator('[data-testid=celda]').first
        cell.click(); time.sleep(0.3); cell.click()
        check(wait_for(f"select status from attendance_records where class_session_id='{s1}' and student_id='{e1}'", 'absent') == 'absent', '👆 Un toque marca P, otro A (se guarda solo en el libro de clases)')
        p.locator('[data-testid=pincel-late]').click(); cell.click()
        check(wait_for(f"select status from attendance_records where class_session_id='{s1}' and student_id='{e1}'", 'late') == 'late', '🖌 Pincel: marca «Atrasado» con un toque')
        p.locator('[data-testid=pincel-borrar]').click(); cell.click()
        check(wait_for(f"select count(*) from attendance_records where class_session_id='{s1}' and student_id='{e1}'", '0') == '0', '⌫ Deja una celda vacía')
        # Toda la columna presente
        p.locator('[data-testid=columna-clase]').first.locator('summary').click()
        p.locator('[data-testid=columna-present]').first.click()
        check(wait_for(f"select count(*) from attendance_records where class_session_id='{s1}' and status='present'", str(rows)) == str(rows), '✓ Marca toda una columna como presente')
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={sid}')
        pct = p.locator('[data-testid=fila-estudiante]', has_text='Uno').first.locator('[data-testid=porcentaje]').inner_text()
        check(pct == '100%', f'Calcula el % de asistencia por estudiante ({pct})')
        # Columna propia
        p.locator('[data-testid=columna-propia]').click(); p.locator('[data-testid=nueva-propia]').click()
        p.locator('[data-testid=panel-propias] input[aria-label="Nombre de la columna"]').fill('Observación')
        p.locator('[data-testid=guardar-propias]').click(); time.sleep(1.5)
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={sid}')
        c = p.locator('[data-testid=fila-estudiante]', has_text='Uno').first.locator('[data-testid=celda-propia]')
        c.fill('Llegó con licencia'); c.press('Tab')
        check(wait_for(f"select value from attendance_sheet_cells where sheet_id='{sid}' and student_id='{e1}'") == 'Llegó con licencia', '➕ Agrega columnas propias (observaciones) y escribe en ellas')
        # Diseño
        p.locator('[data-testid=diseno]').click(); p.locator('[data-testid=tema-verde]').click(); p.locator('[data-testid=simbolos]').select_option('iconos')
        p.locator('[data-testid=guardar-diseno]').click()
        check(wait_for(f"select design->>'theme'||'|'||(design->>'symbols') from attendance_sheets where id='{sid}'", 'verde|iconos') == 'verde|iconos', '🎨 Cambia el diseño: color y símbolos (✓ ✕ ⏰ 📝)')
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={sid}')
        check('✓' in p.locator('[data-testid=tabla-asistencia]').inner_text(), 'La tabla se ve con el nuevo diseño')
        # Excel
        with p.expect_download(timeout=60000) as dl:
            p.locator('[data-testid=exportar-excel]').click()
        z = zipfile.ZipFile(io.BytesIO(open(dl.value.path(), 'rb').read()))
        xml = z.read('xl/sharedStrings.xml').decode() if 'xl/sharedStrings.xml' in z.namelist() else ''.join(z.read(n).decode(errors='ignore') for n in z.namelist() if n.startswith('xl/worksheets'))
        check(dl.value.suggested_filename.endswith('.xlsx') and 'Observación' in xml, '⬇ Descarga la tabla en Excel')
        # Otra tabla copiando el diseño
        nt = p.locator('[data-testid=nueva-tabla]'); nt.locator('summary').click()
        nt.locator('input[name=name]').fill('Abril'); nt.locator('input[name=from_date]').fill('2030-04-01'); nt.locator('select[name=copy_from]').select_option(sid)
        nt.locator('button:has-text("Crear tabla")').click(); status_msg(p)
        s2 = wait_for(f"select id from attendance_sheets where section_id='{A}' and name='Abril'")
        check(one(f"select design->>'theme'||'|'||jsonb_array_length(extra_cols) from attendance_sheets where id='{s2}'") == 'verde|1', '📑 Crea otra tabla copiando el diseño y las columnas')
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={s2}')
        check(p.locator('[data-testid=columna-clase]').count() == 0, 'Cada tabla muestra solo las clases de su rango de fechas')
        # Eliminar una columna (clase)
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={sid}')
        s9 = one(f"select id from class_sessions where section_id='{A}' and starts_at::date='2030-03-09'")
        p.locator('[data-testid=columna-clase]').nth(1).locator('summary').click()
        p.locator('[data-testid=columna-clase]').nth(1).locator('button:has-text("Eliminar columna")').click(); status_msg(p)
        check(wait_for(f"select count(*) from class_sessions where id='{s9}'", '0') == '0', '🗑 Elimina una columna (clase)')
        # Eliminar tabla
        go(p, f'{BASE}/app/secciones/{A}?t=planillas&planilla={s2}')
        p.locator('[data-testid=ajustes-tabla]').click(); p.locator('button:has-text("Eliminar esta tabla")').click(); status_msg(p)
        check(wait_for(f"select count(*) from attendance_sheets where id='{s2}'", '0') == '0' and one(f"select count(*) from attendance_records where class_session_id='{s1}'") != '0',
              '🗑 Elimina una tabla (la asistencia del libro se conserva)')
        # Un estudiante no puede ver ni cambiar planillas
        st = login(b.new_context(), 'estudiante1.a@demo.sematec.test')
        r = st.request.get(f'{BASE}/app/secciones/{A}?t=planillas')
        check(r.status == 404 or 'planilla' not in r.text(), 'Un estudiante no puede abrir las planillas')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
