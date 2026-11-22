"""
Adjuntos: el estudiante sube archivos a su tarea, examen, evaluación con enlace y mensajes;
el profesor los ve; un estudiante de otra sala no puede abrirlos.
"""
import os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'
PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')

def files(names):
    return [{'name': n, 'mimeType': 'application/pdf' if n.endswith('.pdf') else 'image/png', 'buffer': PDF if n.endswith('.pdf') else PNG} for n in names]

def upload(scope, names):
    scope.locator('[data-testid=adjuntar-input]').set_input_files(files(names))
    end = time.time() + 30
    while time.time() < end:
        t = scope.locator('[data-testid=adjuntos-lista]').inner_text() if scope.locator('[data-testid=adjuntos-lista]').count() else ''
        if t.count('✓') >= len(names): return True
        if '✕' in t: print('ERR', t); return False
        time.sleep(0.4)
    return False

def att(kind):
    return int(sql(f"select count(*) from attachments where entity_type='{kind}'"))

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test'")
    tid = sql(f"insert into assignments (organization_id, section_id, title, due_at, published) values ('{ORG}', '{A}', 'Tarea con archivos', now()+interval '3 days', true) returning id").split('\n')[0]
    eid = sql(f"insert into external_evaluations (organization_id, section_id, title, url, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Prueba en Forms', 'https://forms.gle/abc', now()-interval '1 hour', now()+interval '1 day', true) returning id").split('\n')[0]
    qid = sql(f"insert into quizzes (organization_id, section_id, title, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Examen con desarrollo', now()-interval '1 hour', now()+interval '1 day', true) returning id").split('\n')[0]
    qq = sql(f"""insert into quiz_questions (organization_id, quiz_id, kind, prompt, options) values ('{ORG}', '{qid}', 'vf', '¿2+2=4?', '["Verdadero","Falso"]'::jsonb) returning id""").split('\n')[0]
    sql(f"insert into quiz_answer_keys (question_id, correct) values ('{qq}', '{{0}}')")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'estudiante1.a@demo.sematec.test')
        p.on('dialog', lambda d: d.accept())
        # Tarea
        go(p, f'{BASE}/app/aula/{A}?t=tareas')
        card = p.locator('.card', has_text='Tarea con archivos').first
        check(upload(card, ['mi-tarea.pdf', 'foto-cuaderno.png']), 'Tarea: sube 2 archivos con barra de progreso')
        card.locator('textarea[name=body]').fill('Adjunto mi desarrollo'); card.locator('button:has-text("Entregar")').click()
        m = status_msg(p)
        check('2 archivo' in m and att('submission') == 2, f'Tarea entregada con sus archivos ({m[:60]})')
        go(p, f'{BASE}/app/aula/{A}?t=tareas')
        card = p.locator('.card', has_text='Tarea con archivos').first
        check(card.locator('[data-testid=adjuntos] li').count() == 2, 'El estudiante ve sus archivos entregados')
        card.locator('[data-testid=adjuntos] li', has_text='foto-cuaderno.png').locator('button:has-text("Quitar")').click(); status_msg(p)
        check(att('submission') == 1, 'Puede quitar un archivo mientras no esté calificada')
        # Evaluación con enlace
        go(p, f'{BASE}/app/aula/{A}?t=examenes')
        box = p.locator('[data-testid=entregar-evaluacion]').first
        check(upload(box, ['respuestas.pdf']), 'Evaluación con enlace: sube su archivo')
        box.locator('button:has-text("Entregar archivos")').click(); m = status_msg(p)
        check('entregado' in m and att('external_eval') == 1, 'Evaluación: archivo entregado al profesor')
        # Examen
        go(p, f'{BASE}/app/aula/{A}/examen/{qid}/rendir'); p.click('[data-testid=comenzar-prueba]'); p.wait_for_selector('text=¿2+2=4?', timeout=20000)
        p.locator('label:has-text("Verdadero")').click()
        check(upload(p.locator('.card', has=p.locator('[data-testid=adjuntar]')), ['desarrollo-examen.pdf']), 'Examen: adjunta su desarrollo')
        p.click('button:has-text("Enviar examen")'); p.wait_for_selector('text=Examen enviado', timeout=20000)
        check(att('quiz_attempt') == 1, 'Examen enviado con su archivo')
        # Mensaje con archivo
        prof = sql("select id from profiles where email='profesor1.a@demo.sematec.test'")
        go(p, f'{BASE}/app/mensajes?para={prof}')
        f = p.locator('form:has(select[name=recipient_id])')
        f.locator('input[name=subject]').fill('Certificado médico'); f.locator('textarea[name=body]').fill('Le envío el documento')
        check(upload(f, ['certificado.pdf']), 'Mensaje: adjunta un archivo')
        f.locator('button:has-text("Enviar")').first.click(); m = status_msg(p)
        check('1 archivo' in m and att('message') == 1, f'Mensaje enviado con archivo ({m[:50]})')
        c.close()

        # Profesor ve todo
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'profesor1.a@demo.sematec.test')
        go(p, f'{BASE}/app/aula/{A}/tarea/{tid}')
        check('mi-tarea.pdf' in p.locator('[data-testid=adjuntos]').inner_text(), 'Profesor: ve el archivo de la tarea')
        aid = sql("select id from attachments where entity_type='submission' limit 1")
        r = p.request.get(f'{BASE}/api/adjunto/{aid}', max_redirects=0)
        check(r.status == 302, f'Profesor: puede abrir el archivo ({r.status})')
        go(p, f'{BASE}/app/aula/{A}?t=examenes')
        check('respuestas.pdf' in p.content() and 'Estudiante' in p.locator('[data-testid=archivos-recibidos]').locator('..').inner_text(), 'Profesor: ve los archivos recibidos de la evaluación con el nombre del estudiante')
        go(p, f'{BASE}/app/aula/{A}/examen/{qid}')
        check('desarrollo-examen.pdf' in p.content(), 'Profesor: ve el archivo adjunto en los resultados del examen')
        mid = sql("select entity_id from attachments where entity_type='message'")
        go(p, f'{BASE}/app/mensajes/{mid}')
        check('certificado.pdf' in p.locator('[data-testid=adjuntos]').inner_text(), 'Destinatario: ve el archivo del mensaje')
        c.close()

        # Otro estudiante (de otra sala) no puede abrirlo
        c = b.new_context(); p = login(c, 'estudiante2.a@demo.sematec.test')
        r = p.request.get(f'{BASE}/api/adjunto/{aid}', max_redirects=0)
        check(r.status == 404, f'Otro estudiante: no puede abrir el archivo ({r.status})')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
