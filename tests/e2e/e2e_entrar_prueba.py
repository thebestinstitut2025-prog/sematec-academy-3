"""Botón «Entrar a la prueba / evaluación»: habilitado cuando está abierta, bloqueado con el motivo; vista previa del profesor."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
A = '0a000000-0000-4000-8000-00000000ad01'
def one(q): return sql(q).split('\n')[0]

def main():
    sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '{A}', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test' on conflict do nothing")
    q_open = one(f"insert into quizzes (organization_id, section_id, title, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Prueba abierta', now()-interval '1 hour', now()+interval '1 day', true) returning id")
    qq = one(f"""insert into quiz_questions (organization_id, quiz_id, kind, prompt, options) values ('{ORG}', '{q_open}', 'unica', '¿Color del cielo?', '["Azul","Verde"]'::jsonb) returning id""")
    sql(f"insert into quiz_answer_keys (question_id, correct) values ('{qq}', '{{0}}')")
    one(f"insert into quizzes (organization_id, section_id, title, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Prueba futura', now()+interval '2 days', now()+interval '3 days', true) returning id")
    one(f"insert into external_evaluations (organization_id, section_id, title, url, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Forms abierto', 'https://forms.gle/a', now()-interval '1 hour', now()+interval '1 day', true) returning id")
    one(f"insert into external_evaluations (organization_id, section_id, title, url, opens_at, closes_at, published) values ('{ORG}', '{A}', 'Forms cerrado', 'https://forms.gle/b', now()-interval '3 day', now()-interval '1 day', true) returning id")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        s = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'estudiante1.a@demo.sematec.test')
        go(s, f'{BASE}/app/aula/{A}?t=examenes')
        c_open = s.locator('.card', has_text='Prueba abierta').first
        c_fut = s.locator('.card', has_text='Prueba futura').first
        check(c_open.locator('[data-testid=entrar-prueba]:has-text("Entrar a la prueba")').count() == 1, 'Prueba abierta: botón «▶ Entrar a la prueba»')
        check(c_fut.locator('[data-testid=entrar-prueba-bloqueado]').count() == 1 and 'Se habilita el' in c_fut.inner_text(), 'Prueba futura: botón bloqueado con la fecha en que se habilita')
        check(s.locator('.card', has_text='Forms abierto').first.locator('[data-testid=entrar-evaluacion]:has-text("Entrar a la evaluación")').count() == 1, 'Evaluación con enlace abierta: «▶ Entrar a la evaluación»')
        cc = s.locator('.card', has_text='Forms cerrado').first
        check(cc.locator('[data-testid=entrar-evaluacion-bloqueado]').count() == 1 and 'ya cerró' in cc.inner_text(), 'Evaluación cerrada: botón bloqueado con el motivo')
        go(s, f'{BASE}/app/aula/{A}?t=evaluacion')
        check(s.locator('a:has-text("Entrar a la prueba")').count() == 1 and s.locator('a:has-text("Entrar a la evaluación")').count() == 1, 'En «Evaluación y calificación» aparecen las pruebas abiertas con su botón')
        go(s, f'{BASE}/app/aula/{A}?t=examenes'); s.locator('.card', has_text='Prueba abierta').first.locator('[data-testid=entrar-prueba]').click()
        s.wait_for_selector('[data-testid=comenzar-prueba]'); s.locator('[data-testid=comenzar-prueba]').click()
        s.wait_for_selector('text=¿Color del cielo?', timeout=20000)
        check(True, 'Al entrar, el estudiante comienza la prueba y ve las preguntas')
        go(s, f'{BASE}/app/aula/{A}?t=examenes')
        check(s.locator('.card', has_text='Prueba abierta').first.locator('text=Continuar la prueba').count() == 1, 'Si la dejó a medias: «▶ Continuar la prueba»')
        # Profesor: vista previa
        t = login(b.new_context(viewport={'width': 1300, 'height': 900}), 'profesor1.a@demo.sematec.test')
        go(t, f'{BASE}/app/aula/{A}?t=examenes')
        t.locator('.card', has_text='Prueba abierta').first.locator('[data-testid=entrar-prueba]').click()
        t.wait_for_selector('[data-testid=vista-previa]')
        check('¿Color del cielo?' in t.content() and t.locator('[data-testid=pregunta] input[type=radio]').count() == 2 and t.locator('[data-testid=vista-previa-envio]').count() == 1
              and t.locator('button:has-text("Enviar examen")').count() == 0 and '✔' not in t.locator('main').inner_text(),
              'Profesor: «Entrar a la prueba (vista previa)» la muestra como la ve el estudiante, sin respuestas correctas')
        check(one(f"select count(*) from quiz_attempts where quiz_id='{q_open}' and student_id in (select id from students where email like 'profesor%')") == '0', 'La vista previa no crea intentos')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
