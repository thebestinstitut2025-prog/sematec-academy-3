"""✅ Exámenes y tareas «pro»: 9 tipos de pregunta, imagen, portada de color, avance, revisión con retroalimentación,
corrección de desarrollo, % para aprobar, estadística, duplicar, importar preguntas, una por página y rúbricas."""
import os, sys, time, datetime
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

A = '0a000000-0000-4000-8000-00000000ad01'
URL = f'{BASE}/app/aula/{A}'
now = datetime.datetime.now()
fmt = lambda d: d.strftime('%Y-%m-%dT%H:%M')
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
def one(q): return sql(q).split('\n')[0]
def wait_for(q, expect, secs=15):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if v == expect: return v
        time.sleep(0.3)
    return v

def upload(scope):
    scope.locator('[data-testid=adjuntar-input]').set_input_files([{'name': 'diagrama.png', 'mimeType': 'image/png', 'buffer': PNG}])
    end = time.time() + 30
    while time.time() < end:
        t = scope.locator('[data-testid=adjuntos-lista]').inner_text() if scope.locator('[data-testid=adjuntos-lista]').count() else ''
        if '✓' in t: return True
        time.sleep(0.4)
    return False

QUESTIONS = [  # (tipo, enunciado, opciones, extra, puntos, retroalimentación)
    ('corta', '¿Quién fue el primer Director Supremo?', "Bernardo O'Higgins\nO'Higgins", None, '1', ''),
    ('numerica', '¿Cuánto es pi con dos decimales?', '', ('3.14', '0.01'), '1', ''),
    ('completar', 'La capital de Chile es [Santiago] y la de Perú es [Lima].', '', None, '2', ''),
    ('ordenar', 'Ordene las partes de un texto', 'Inicio\nDesarrollo\nCierre', None, '1', ''),
    ('unir', 'Una cada país con su capital', 'Chile = Santiago\nPerú = Lima\nColombia = Bogotá', None, '3', ''),
    ('desarrollo', 'Explique la fotosíntesis con el diagrama', 'Debe mencionar luz y clorofila', None, '4', ''),
    ('unica', '¿Cuánto es 2+2?', '3\n*4\n5', None, '1', 'Dos más dos es cuatro'),
]

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email in ('estudiante1.a@demo.sematec.test') on conflict do nothing")
    sql(f"update sections set teacher_id = (select id from teachers where email='profesor1.a@demo.sematec.test'), grades_closed_at = null where id='{A}'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        t = login(b.new_context(viewport={'width': 1400, 'height': 900}), 'profesor1.a@demo.sematec.test')
        t.on('dialog', lambda d: d.accept())
        # 1) Examen con opciones pro
        go(t, URL + '?t=examenes'); t.click('summary:has-text("Nuevo examen")')
        t.fill('input[name=title]', 'Examen Pro'); t.fill('input[name=opens_at]', fmt(now - datetime.timedelta(days=1))); t.fill('input[name=closes_at]', fmt(now + datetime.timedelta(days=2)))
        t.locator('[data-testid=portada-morado]').first.check(force=True)
        t.locator('input[name=shuffle_options]').first.check(); t.locator('input[name=pass_pct]').first.fill('60')
        t.click('button:has-text("Crear examen")'); status_msg(t)
        qid = one("select id from quizzes where title='Examen Pro'")
        check(one(f"select theme||'|'||shuffle_options||'|'||pass_pct from quizzes where id='{qid}'") == 'morado|true|60', '🎨 Examen con portada morada, alternativas al azar y % para aprobar')
        go(t, URL + '?t=examenes')
        check(t.locator('.card', has_text='Examen Pro').first.locator('[data-testid=franja-color]').count() == 1, '🎨 La tarjeta del examen muestra su color')
        # 2) Preguntas de todos los tipos
        go(t, f'{URL}/examen/{qid}')
        for kind, prompt, opts, extra, pts, fb in QUESTIONS:
            add = t.locator('.card:has-text("Agregar pregunta")').last
            add.locator('[data-testid=tipo-pregunta]').select_option(kind)
            add.locator('textarea[name=prompt]').fill(prompt)
            if extra: add.locator('input[name=num_value]').fill(extra[0]); add.locator('input[name=num_tol]').fill(extra[1])
            if opts: add.locator('textarea[name=options]').fill(opts)
            add.locator('input[name=points]').fill(pts)
            if fb: add.locator('textarea[name=feedback]').fill(fb)
            if kind == 'desarrollo': check(upload(add), '🖼 Sube una imagen a la pregunta')
            add.locator('button:has-text("Agregar")').click(); msg = status_msg(t)
            if 'agregada' not in msg: print('   ', kind, msg)
            t.wait_for_selector(f'text={prompt[:20]}')
        check(one(f"select count(*) from quiz_questions where quiz_id='{qid}'") == '7', '✍ Crea 7 preguntas: corta, numérica, completar, ordenar, unir, desarrollo y única')
        check(one(f"select k.answer->'blanks'->>1 from quiz_answer_keys k join quiz_questions x on x.id=k.question_id where x.quiz_id='{qid}' and x.kind='completar'") == '["Lima"]'
              and '[Santiago]' not in one(f"select prompt from quiz_questions where quiz_id='{qid}' and kind='completar'"), '🧩 «Completar»: las respuestas quedan ocultas (fuera del enunciado)')
        check(one(f"select count(*) from attachments where entity_type='quiz_question'") == '1', '🖼 La imagen queda unida a su pregunta')
        check(t.locator('[data-testid=respuesta-correcta]').count() >= 5, '✓ El profesor ve la respuesta correcta de cada tipo')
        t.click('button:has-text("Publicar examen")'); status_msg(t)

        # 3) Estudiante rinde
        s = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'estudiante1.a@demo.sematec.test')
        s.on('dialog', lambda d: d.accept())
        go(s, f'{URL}/examen/{qid}/rendir')
        cover = s.locator('[data-testid=portada-examen]').inner_text()
        check('7 preguntas' in cover and '13 puntos' in cover and '60%' in cover, f'🖼 Portada con preguntas, puntos y % para aprobar')
        s.click('[data-testid=comenzar-prueba]'); s.wait_for_selector('[data-testid=barra-examen]', timeout=20000)
        check(s.locator('[data-testid=imagen-pregunta]').count() == 1, '🖼 El estudiante ve la imagen de la pregunta')
        cards = {k: s.locator('[data-testid=pregunta]', has_text=p[:20]).first for k, p, *_ in QUESTIONS}
        cards['corta'].locator('[data-testid=resp-corta]').fill("o'higgins")
        cards['numerica'].locator('[data-testid=resp-numerica]').fill('3,14')
        cards['completar'].locator('[data-testid=espacio]').nth(0).fill('santiago'); cards['completar'].locator('[data-testid=espacio]').nth(1).fill('Quito')
        target = ['Inicio', 'Desarrollo', 'Cierre']
        for pos, want in enumerate(target):
            items = [x.strip() for x in cards['ordenar'].locator('[data-testid=item-ordenar] span.flex-1').all_inner_texts()]
            for _ in range(items.index(want) - pos):
                items = [x.strip() for x in cards['ordenar'].locator('[data-testid=item-ordenar] span.flex-1').all_inner_texts()]
                cards['ordenar'].locator('[data-testid=item-ordenar]').nth(items.index(want)).locator('[data-testid=subir]').click()
        items = [x.strip() for x in cards['ordenar'].locator('[data-testid=item-ordenar] span.flex-1').all_inner_texts()]
        check(items == target, f'↕ Ordena con las flechas ({items})')
        for i, cap in enumerate(['Santiago', 'Lima', 'Bogotá']): cards['unir'].locator('[data-testid=pareja]').nth(i).select_option(label=cap)
        cards['desarrollo'].locator('[data-testid=resp-desarrollo]').fill('La planta usa la luz y la clorofila para producir glucosa.')
        cards['unica'].locator('label:has-text("4")').click()
        check('Respondidas 7 de 7' in s.locator('[data-testid=avance]').inner_text(), '📊 Barra de avance: «Respondidas 7 de 7»')
        cards['unica'].locator('[data-testid=marcar-revisar]').click()
        check(s.locator('[data-testid=mapa-pregunta].bg-amber-400').count() == 1, '🚩 Marca una pregunta para revisar después (mapa de preguntas)')
        # Recarga: las respuestas siguen ahí (guardadas en el equipo)
        s.reload(); s.wait_for_selector('[data-testid=barra-examen]')
        check(s.locator('[data-testid=pregunta]', has_text='Director Supremo').first.locator('[data-testid=resp-corta]').input_value() == "o'higgins", '💾 Si recarga la página, sus respuestas no se pierden')
        s.click('button:has-text("Enviar examen")')
        s.wait_for_selector('[data-testid=resultado-examen]', timeout=20000)
        res = s.locator('[data-testid=resultado-examen]').inner_text(); print('   ', res.replace('\n', ' | '))
        check('Puntaje: 8 de 13' in res, '🤖 Corrección automática de todos los tipos (8 de 13; completar con puntaje parcial)')
        check('Aprobado' in res and 'corregirá' in res, '🎯 Muestra «Aprobado» y avisa que el desarrollo lo corrige el profesor')
        att = one(f"select id from quiz_attempts where quiz_id='{qid}'")
        check(one(f"select needs_review from quiz_attempts where id='{att}'") == 't', '📝 El intento queda «por corregir»')

        # 4) Profesor corrige el desarrollo
        go(t, f'{URL}/examen/{qid}')
        check(t.locator('[data-testid=por-corregir]').count() == 1, '📝 El profesor ve cuántos faltan por corregir')
        box = t.locator('[data-testid=intento]').first
        box.locator('[data-testid=puntaje-manual]').first.fill('3'); box.locator('input[name=comment]').first.fill('Bien, falta mencionar el CO2')
        box.locator('button:has-text("Guardar puntaje")').first.click(); status_msg(t)
        check(wait_for(f"select score||'|'||needs_review from quiz_attempts where id='{att}'", '11.00|false') == '11.00|false', '✅ Corrige el desarrollo: el puntaje sube a 11 y deja de estar pendiente')
        go(t, f'{URL}/examen/{qid}')
        check(t.locator('[data-testid=logro]').count() >= 6, '📊 Estadística: % de logro por pregunta')

        # 5) Revisión del estudiante (al cerrar se ven las correctas)
        sql(f"update quizzes set closes_at = now() - interval '1 minute' where id='{qid}'")
        go(s, f'{URL}/examen/{qid}/revision?intento={att}')
        page = s.locator('main').inner_text()
        check('11 de 13' in s.locator('[data-testid=puntaje-revision]').inner_text(), '🔍 Revisión con el puntaje final')
        check('Dos más dos es cuatro' in page and 'falta mencionar el CO2' in page and 'Lima' in page, '💬 Ve la retroalimentación, el comentario del profesor y las respuestas correctas')
        check('Debe mencionar luz' not in page, '🔒 La pauta del desarrollo no se le muestra al estudiante')

        # 6) Duplicar e importar
        go(t, f'{URL}/examen/{qid}')
        t.locator('button:has-text("📋 Duplicar")').click(); status_msg(t)
        dup = one("select id from quizzes where title='Copia de Examen Pro'")
        check(dup and one(f"select count(*)||'|'||(select published from quizzes where id='{dup}') from quiz_questions where quiz_id='{dup}'") == '7|false', '📋 Duplica el examen como borrador con sus 7 preguntas')
        go(t, f'{URL}/examen/{dup}')
        t.locator('[data-testid=importar-desde]').select_option(qid); t.click('button:has-text("Importar preguntas")'); status_msg(t)
        check(one(f"select count(*) from quiz_questions where quiz_id='{dup}'") == '14', '📥 Importa preguntas de otro examen (banco de preguntas)')
        # Una pregunta por página (vista previa del profesor)
        sql(f"update quizzes set one_per_page = true where id='{dup}'")
        go(t, f'{URL}/examen/{dup}/rendir')
        check(t.locator('[data-testid=pregunta]').count() == 1 and t.locator('[data-testid=siguiente]').count() == 1, '📄 Modo una pregunta por página con «Siguiente»')
        t.click('[data-testid=siguiente]')
        time.sleep(0.3); check('Pregunta 2 de 14' in t.locator('main').inner_text(), '📄 Avanza a la pregunta 2')

        # 7) Tarea con rúbrica
        go(t, URL + '?t=tareas'); t.click('summary:has-text("Nueva tarea")')
        t.fill('input[name=title]', 'Ensayo con rúbrica'); t.fill('input[name=due_at]', fmt(now + datetime.timedelta(days=2)))
        t.locator('textarea[name=rubric]').first.fill('Contenido | 6 | Responde lo pedido\nOrtografía | 4 | Sin faltas')
        t.locator('[data-testid=portada-verde]').first.check(force=True)
        t.click('button:has-text("Publicar tarea")'); status_msg(t)
        aid = one("select id from assignments where title='Ensayo con rúbrica'")
        check(one(f"select jsonb_array_length(rubric)||'|'||theme from assignments where id='{aid}'") == '2|verde', '📏 Crea una tarea con rúbrica (2 criterios) y color')
        go(s, URL + '?t=tareas')
        card = s.locator('.card', has_text='Ensayo con rúbrica').first
        check(card.locator('[data-testid=rubrica]').count() == 1, '📏 El estudiante ve la rúbrica antes de entregar')
        card.locator('textarea[name=body]').fill('Mi ensayo'); card.locator('button:has-text("Entregar")').click(); status_msg(s)
        go(t, f'{URL}/tarea/{aid}')
        crit = t.locator('[data-testid=criterio]'); crit.nth(0).fill('5'); crit.nth(1).fill('3')
        t.click('button:has-text("Calificar con rúbrica")'); status_msg(t)
        check(wait_for(f"select score||'|'||rubric_scores::text from submissions where assignment_id='{aid}'", '80.00|[5, 3]') == '80.00|[5, 3]', '📏 Califica por criterio: 8 de 10 → 80 de 100')
        go(s, URL + '?t=tareas')
        check('8 / 10' in s.locator('.card', has_text='Ensayo con rúbrica').first.locator('[data-testid=rubrica]').inner_text(), '📏 El estudiante ve su puntaje por criterio')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
