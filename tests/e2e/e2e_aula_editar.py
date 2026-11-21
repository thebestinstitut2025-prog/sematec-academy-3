"""
Aula: el profesor edita y elimina tareas, exámenes (y preguntas), evaluaciones con enlace,
evaluaciones del libro, unidades, contenidos y mensajes del foro. El estudiante no puede.
"""
import os, sys, subprocess
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'

def one(q):
    return sql(q).split('\n')[0]

def as_user(uid, q):
    """Ejecuta como usuario autenticado (para comprobar permisos en la base)."""
    full = (f"select set_config('request.jwt.claims', '{{\"sub\":\"{uid}\",\"role\":\"authenticated\",\"aal\":\"aal1\"}}', true); "
            f"set local role authenticated; {q}")
    r = subprocess.run(['psql', '-h', '/tmp/pg', '-p', '54322', '-U', 'postgres', '-d', 'academy', '-tAc', full], capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()

def edit(card, testid):
    box = card.locator(f'[data-testid={testid}]').first
    box.locator('summary').click()
    return box

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test' on conflict do nothing")
    st = one("select id from students where email='estudiante1.a@demo.sematec.test'")
    st_user = one("select user_id from students where email='estudiante1.a@demo.sematec.test'")
    t1 = one(f"insert into assignments (organization_id, section_id, title, due_at, max_score) values ('{ORG}', '{A}', 'Tarea original', now()+interval '3 days', 100) returning id")
    sql(f"insert into submissions (organization_id, assignment_id, student_id, body, score) values ('{ORG}', '{t1}', '{st}', 'mi respuesta', 80)")
    q1 = one(f"insert into quizzes (organization_id, section_id, title, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Examen original', now()-interval '1 hour', now()+interval '1 day', true) returning id")
    qq = one(f"""insert into quiz_questions (organization_id, quiz_id, kind, prompt, options, position) values ('{ORG}', '{q1}', 'unica', '¿Capital de Chile?', '["Lima","Santiago","Quito"]'::jsonb, 1) returning id""")
    sql(f"insert into quiz_answer_keys (question_id, correct) values ('{qq}', '{{1}}')")
    sql(f"insert into quiz_attempts (organization_id, quiz_id, student_id, deadline, submitted_at, score, max_score) values ('{ORG}', '{q1}', '{st}', now()+interval '1 hour', now(), 1, 1)")
    ev = one(f"insert into external_evaluations (organization_id, section_id, title, url, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Forms original', 'https://forms.gle/abc', now()-interval '1 hour', now()+interval '1 day', true) returning id")
    a_free = one(f"insert into assessments (organization_id, section_id, name, weight_pct, published) values ('{ORG}', '{A}', 'Control sin notas', 10, true) returning id")
    a_grad = one(f"insert into assessments (organization_id, section_id, name, weight_pct, published) values ('{ORG}', '{A}', 'Prueba con notas', 20, true) returning id")
    sql(f"insert into grades (organization_id, assessment_id, student_id, grade) values ('{ORG}', '{a_grad}', '{st}', 5.5)")
    sql(f"update assignments set assessment_id='{a_free}' where id='{t1}'")
    un = one(f"insert into course_units (organization_id, section_id, title, position) values ('{ORG}', '{A}', 'Unidad original', 1) returning id")
    cc = one(f"insert into course_contents (organization_id, section_id, unit_id, kind, title, url) values ('{ORG}', '{A}', '{un}', 'enlace', 'Enlace original', 'https://ejemplo.cl/a') returning id")
    th = one(f"insert into forum_threads (organization_id, section_id, author_id, title, body) values ('{ORG}', '{A}', '{st_user}', 'Tema de prueba', 'Hola') returning id")
    po = one(f"insert into forum_posts (organization_id, thread_id, author_id, body) values ('{ORG}', '{th}', '{st_user}', 'Respuesta a borrar') returning id")

    # Permisos en la base: el estudiante no puede eliminar ni editar
    rc, out = as_user(st_user, f"select public.delete_assignment('{t1}')")
    check(rc != 0 and 'No autorizado' in out, 'Base: el estudiante no puede eliminar una tarea')
    rc, out = as_user(st_user, f"select public.delete_quiz('{q1}')")
    check(rc != 0, 'Base: el estudiante no puede eliminar un examen')
    as_user(st_user, f"update public.assignments set title='hackeada' where id='{t1}'")
    check(one(f"select title from assignments where id='{t1}'") == 'Tarea original', 'Base: el estudiante no puede editar una tarea')

    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1300, 'height': 900})
        p = login(c, 'profesor1.a@demo.sematec.test')
        p.on('dialog', lambda d: d.accept())

        # ---- Contenidos
        go(p, f'{BASE}/app/aula/{A}')
        box = edit(p, 'editar-unidad')
        box.locator('input[name=title]').fill('Unidad 1 editada'); box.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(one(f"select title from course_units where id='{un}'") == 'Unidad 1 editada', 'Edita el título de una unidad')
        go(p, f'{BASE}/app/aula/{A}')
        li = p.locator('li', has_text='Enlace original').first
        box = edit(li, 'editar-contenido')
        box.locator('input[name=title]').fill('Enlace editado'); box.locator('input[name=url]').fill('http://inseguro.cl')
        box.locator('button:has-text("Guardar cambios")').click(); m = status_msg(p)
        check('https://' in m, f'Rechaza un enlace sin https ({m[:50]})')
        box.locator('input[name=url]').fill('https://ejemplo.cl/b'); box.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(sql(f"select title||'|'||url from course_contents where id='{cc}'") == 'Enlace editado|https://ejemplo.cl/b', 'Edita título y enlace de un contenido')

        # ---- Tareas
        go(p, f'{BASE}/app/aula/{A}?t=tareas')
        card = p.locator('.card', has_text='Tarea original').first
        box = edit(card, 'editar-tarea')
        check(box.locator('input[name=due_at]').input_value() != '', 'El formulario trae la fecha de entrega actual')
        box.locator('input[name=max_score]').fill('50'); box.locator('button:has-text("Guardar cambios")').click(); m = status_msg(p)
        check('80' in m and one(f"select max_score from assignments where id='{t1}'") == '100.00', f'No deja bajar el puntaje bajo una nota ya puesta ({m[:60]})')
        box.locator('input[name=max_score]').fill('120'); box.locator('input[name=title]').fill('Tarea editada')
        box.locator('textarea[name=instructions]').fill('Nuevas instrucciones'); box.locator('button:has-text("Guardar cambios")').click(); m = status_msg(p)
        check(sql(f"select title||'|'||max_score||'|'||instructions from assignments where id='{t1}'") == 'Tarea editada|120.00|Nuevas instrucciones', f'Edita título, puntaje e instrucciones ({m[:40]})')
        go(p, f'{BASE}/app/aula/{A}?t=tareas')
        card = p.locator('.card', has_text='Tarea editada').first
        box = edit(card, 'editar-tarea')
        box.locator('button:has-text("Eliminar tarea")').click(); m = status_msg(p)
        check('1 entrega' in m and one(f"select count(*) from assignments where id='{t1}'") == '0' and one(f"select count(*) from submissions where assignment_id='{t1}'") == '0',
              f'Elimina la tarea con sus entregas ({m[:70]})')

        # ---- Preguntas del examen
        go(p, f'{BASE}/app/aula/{A}/examen/{q1}')
        card = p.locator('.card', has_text='Capital de Chile').first
        box = edit(card, 'editar-pregunta')
        check('*Santiago' in box.locator('textarea[name=options]').input_value(), 'La pregunta trae marcada la respuesta correcta')
        box.locator('textarea[name=prompt]').fill('¿Cuál es la capital de Chile?')
        box.locator('textarea[name=options]').fill('Lima\nSantiago\n*Santiago de Chile')
        box.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(sql(f"select q.prompt||'|'||k.correct::text from quiz_questions q join quiz_answer_keys k on k.question_id=q.id where q.id='{qq}'") == '¿Cuál es la capital de Chile?|{2}',
              'Edita una pregunta y su respuesta correcta')

        # ---- Exámenes
        go(p, f'{BASE}/app/aula/{A}?t=examenes')
        card = p.locator('.card', has_text='Examen original').first
        box = edit(card, 'editar-examen')
        box.locator('input[name=title]').fill('Examen editado'); box.locator('input[name=max_attempts]').fill('3')
        box.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(sql(f"select title||'|'||max_attempts from quizzes where id='{q1}'") == 'Examen editado|3', 'Edita título e intentos del examen')
        # Evaluación con enlace
        go(p, f'{BASE}/app/aula/{A}?t=examenes')
        box = edit(p, 'editar-evaluacion-externa')
        box.locator('input[name=title]').fill('Drive editado'); box.locator('input[name=url]').fill('drive.google.com/file/d/xyz')
        box.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(sql(f"select title||'|'||url||'|'||provider from external_evaluations where id='{ev}'") == 'Drive editado|https://drive.google.com/file/d/xyz|google_drive',
              'Edita la evaluación con enlace (y detecta Google Drive)')
        go(p, f'{BASE}/app/aula/{A}?t=examenes')
        card = p.locator('.card', has_text='Examen editado').first
        box = edit(card, 'editar-examen')
        box.locator('button:has-text("Eliminar examen")').click(); m = status_msg(p)
        check('1 intento' in m and one(f"select count(*) from quizzes where id='{q1}'") == '0' and one(f"select count(*) from quiz_questions where quiz_id='{q1}'") == '0',
              f'Elimina el examen con preguntas e intentos ({m[:70]})')

        # ---- Evaluaciones del libro
        go(p, f'{BASE}/app/aula/{A}?t=evaluacion')
        li = p.locator('[data-testid=evaluacion-libro]', has_text='Control sin notas').first
        box = edit(li, 'editar-evaluacion')
        box.locator('input[name=name]').fill('Control 1'); box.locator('input[name=weight_pct]').fill('15')
        box.locator('button:has-text("Guardar cambios")').click(); status_msg(p)
        check(sql(f"select name||'|'||weight_pct from assessments where id='{a_free}'") == 'Control 1|15.00', 'Edita nombre y ponderación de una evaluación')
        go(p, f'{BASE}/app/aula/{A}?t=evaluacion')
        li = p.locator('[data-testid=evaluacion-libro]', has_text='Prueba con notas').first
        box = edit(li, 'editar-evaluacion')
        check('no se puede eliminar' in box.inner_text() and box.locator('button:has-text("Eliminar evaluación")').count() == 0, 'Una evaluación con notas no se puede eliminar (se explica por qué)')
        rc, out = as_user(one("select id from profiles where email='profesor1.a@demo.sematec.test'"), f"select public.delete_assessment('{a_grad}')")
        check(rc != 0 and 'nota' in out, 'Base: tampoco se puede eliminar una evaluación con notas')
        li = p.locator('[data-testid=evaluacion-libro]', has_text='Control 1').first
        box = edit(li, 'editar-evaluacion')
        box.locator('button:has-text("Eliminar evaluación")').click(); m = status_msg(p)
        check(one(f"select count(*) from assessments where id='{a_free}'") == '0', f'Elimina una evaluación sin notas ({m[:50]})')

        # ---- Foro
        go(p, f'{BASE}/app/aula/{A}/foro/{th}')
        p.locator('.card', has_text='Respuesta a borrar').locator('button:has-text("🗑")').click(); status_msg(p)
        check(one(f"select count(*) from forum_posts where id='{po}'") == '0', 'Elimina un mensaje del foro')
        go(p, f'{BASE}/app/aula/{A}/foro/{th}')
        p.locator('button:has-text("Eliminar tema")').click()
        p.wait_for_url('**t=foro**', timeout=20000)
        check(one(f"select count(*) from forum_threads where id='{th}'") == '0', 'Elimina el tema y vuelve al foro')

        # ---- El estudiante no ve opciones de edición
        c2 = b.new_context(viewport={'width': 1300, 'height': 900}); s = login(c2, 'estudiante1.a@demo.sematec.test')
        for t in ['', '?t=tareas', '?t=examenes']:
            go(s, f'{BASE}/app/aula/{A}{t}')
            check(s.locator('[data-testid^=editar-]').count() == 0, f'El estudiante no ve «Editar» ({t or "contenidos"})')
        b.close()

if __name__ == '__main__':
    try:
        main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
