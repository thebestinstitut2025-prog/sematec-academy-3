"""Clase en vivo estilo Zoom (mejoras): vista previa con prueba de cámara y micrófono, entrar con micrófono/cámara,
buscar participantes, pedir que hable o encienda la cámara, detener video, bajar todas las manos y co-anfitrión."""
import re, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, login, go, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
SEC = '0a000000-0000-4000-8000-00000000ad01'
sql(f"insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select '{ORG}', '{SEC}', e.student_id, e.id from enrollments e join students s on s.id = e.student_id where s.organization_id = '{ORG}' and s.user_id is not null on conflict do nothing")
T1 = '00000000-0000-4000-8000-000000000020'
room = sql(f"insert into conference_rooms (organization_id, name, room_type, section_id, max_participants, created_by) values ('{ORG}', 'Zoom mejoras E2E', 'class', '{SEC}', 50, '{T1}') returning id").splitlines()[0]
sess = sql(f"""set request.jwt.claims = '{{"sub":"{T1}","role":"authenticated"}}'; select create_conference_session('{room}', 'Clase con vista previa', 'class', now() - interval '5 minutes', now() + interval '55 minutes', 'America/Santiago', true, null)""").splitlines()[-1]
E1 = sql("select id from profiles where email='estudiante1.a@demo.sematec.test'")

def until(fn, t=20):
    end = time.time() + t
    while time.time() < end:
        if fn(): return True
        time.sleep(0.5)
    return False

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'])
    new = lambda: b.new_context(viewport={'width': 1440, 'height': 900}, permissions=['camera', 'microphone'])
    tc = new(); t = login(tc, 'profesor1.a@demo.sematec.test')
    go(t, f'{BASE}/app/conferencias/sala/{sess}')
    t.click('[data-testid=probar-dispositivos]'); t.wait_for_selector('[data-testid=video-previa]', timeout=15000)
    check(until(lambda: t.evaluate("document.querySelector('[data-testid=video-previa]').videoWidth > 0")), 'Vista previa: se ve la cámara antes de entrar')
    check(t.locator('select').count() >= 1, 'Vista previa: puede elegir cámara y micrófono')
    t.check('[data-testid=entrar-con-camara]'); t.click('button:has-text("Entrar a la sala")')
    t.wait_for_selector('.lk-video-conference', timeout=30000)
    check(until(lambda: t.evaluate("!!document.querySelector('.lk-participant-tile video')")), 'Entra con la cámara encendida, como eligió en la vista previa')

    ec = new(); e = login(ec, 'estudiante1.a@demo.sematec.test')
    go(e, f'{BASE}/app/conferencias/sala/{sess}'); e.click('button:has-text("Entrar a la sala")')
    e.wait_for_selector('.lk-video-conference', timeout=30000)
    check(e.locator('[data-testid=boton-microfono]').first.get_attribute('aria-pressed') != 'true', 'El estudiante entra con micrófono apagado (por defecto)')

    # Panel de participantes
    t.click('[data-testid=boton-participantes]'); t.wait_for_selector('[data-testid=personas] >> text=Estudiante', timeout=15000)
    check('2 en la sala' in t.locator('[data-testid=cuenta-personas]').inner_text(), 'Participantes: cuenta cuántos hay en la sala')
    row = t.locator('[data-testid=personas] li', has_text='Estudiante')
    row.locator('[data-testid=pedir-microfono]').click()
    e.wait_for_selector('[data-testid=pedido-anfitrion]', timeout=15000)
    check('micrófono' in e.locator('[data-testid=pedido-anfitrion]').inner_text(), '🙋 El estudiante recibe el pedido de activar su micrófono')
    e.click('[data-testid=aceptar-pedido]')
    check(until(lambda: row.locator('text=🎙').count() > 0), 'Al aceptar, su micrófono se enciende (nunca sin su permiso)')

    # Mano levantada → bajar todas
    e.click('[data-testid=boton-reacciones]'); e.click('[data-testid=menu-reacciones] button:has-text("Levantar la mano")')
    t.wait_for_selector('[data-testid=bajar-manos]', timeout=15000)
    t.click('[data-testid=bajar-manos]')
    check(until(lambda: t.locator('[data-testid=bajar-manos]').count() == 0), '✋ Bajar todas las manos')

    # Co-anfitrión
    row.locator('[data-testid=hacer-coanfitrion]').click()
    check(until(lambda: sql(f"select role from conference_participants where session_id='{sess}' and user_id='{E1}'") == 'moderator'), '👑 Hacer co-anfitrión: queda como moderador')
    check(until(lambda: e.locator('[data-testid=boton-anfitrion]').count() >= 1), 'El co-anfitrión ve los controles del anfitrión sin salir de la sala')
    t.locator('[data-testid=personas] li', has_text='Estudiante').locator('[data-testid=quitar-coanfitrion]').click()
    check(until(lambda: sql(f"select role from conference_participants where session_id='{sess}' and user_id='{E1}'") != 'moderator'), 'Quitar co-anfitrión: vuelve a su rol')
    check(until(lambda: e.locator('[data-testid=boton-anfitrion]').count() == 0), 'Al quitarlo, deja de ver los controles')
    b.close()
ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
