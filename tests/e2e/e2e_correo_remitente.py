"""Cualquier cuenta envía correos desde la plataforma: el correo sale «Nombre vía Institución» y las respuestas llegan a quien escribió."""
import email, glob, os, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

def last_to(addr):
    for f in sorted(glob.glob('/tmp/mails/*.eml'), reverse=True):
        raw = open(f, 'rb').read(); first, rest = raw.split(b'\r\n', 1)
        if addr.encode() in first: return email.message_from_bytes(rest, policy=policy.default)
    return None

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    prof = sql("select id from profiles where email='profesor1.a@demo.sematec.test'")
    sql("insert into section_enrollments (organization_id, section_id, student_id, enrollment_id) select e.organization_id, '0a000000-0000-4000-8000-00000000ad01', e.student_id, e.id from enrollments e join students s on s.id=e.student_id where s.email='estudiante1.a@demo.sematec.test'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'estudiante1.a@demo.sematec.test')
        go(p, f'{BASE}/app/mensajes?para={prof}')
        f = p.locator('form:has(select[name=recipient_id])')
        f.locator('input[name=subject]').fill('Consulta sobre la tarea'); f.locator('textarea[name=body]').fill('Profe, ¿la tarea es para el lunes?')
        box = f.locator('input[name=send_email]')
        if box.count(): box.check()
        f.locator('button[type=submit]').first.click(); m = status_msg(p)
        end = time.time() + 15
        while time.time() < end and not last_to('profesor1.a@demo.sematec.test'): time.sleep(0.4)
        msg = last_to('profesor1.a@demo.sematec.test')
        check(msg is not None, f'El estudiante envía un correo desde la plataforma ({m[:60]})')
        check(msg is not None and 'vía' in str(msg['From']), f"Remitente con su nombre: {msg['From'] if msg else ''}")
        check(msg is not None and str(msg['Reply-To']) == 'estudiante1.a@demo.sematec.test', 'Al responder, la respuesta le llega al estudiante')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
