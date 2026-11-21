"""✉ Correo para todos: un estudiante escribe a direcciones externas con archivos; respuesta a su correo; historial y límite diario."""
import email, glob, os, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

def last_to(addr):
    for f in sorted(glob.glob('/tmp/mails/*.eml'), reverse=True):
        raw = open(f, 'rb').read(); first, rest = raw.split(b'\r\n', 1)
        if addr.encode() in first: return email.message_from_bytes(rest, policy=policy.default)
    return None

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'estudiante1.a@demo.sematec.test')
        go(p, f'{BASE}/app')
        check(p.locator('a[href="/app/correo"]').count() >= 1, 'Menú: «Correo» para todos los usuarios')
        go(p, f'{BASE}/app/correo')
        f = p.locator('form:has(input[name=to])')
        f.locator('input[name=to]').fill('empleador@empresa-externa.cl, no-es-correo'); f.locator('input[name=subject]').fill('Mi CV')
        f.locator('textarea[name=body]').fill('Adjunto mi CV.'); f.locator('button:has-text("Enviar correo")').click()
        check('no-es-correo' in status_msg(p), 'Avisa si un correo está mal escrito')
        f.locator('input[name=to]').fill('empleador@empresa-externa.cl, profesor1.a@demo.sematec.test')
        f.locator('[data-testid=adjuntar-input]').set_input_files([{'name': 'cv.pdf', 'mimeType': 'application/pdf', 'buffer': PDF}])
        end = time.time() + 30
        while time.time() < end and '✓' not in (f.locator('[data-testid=adjuntos-lista]').inner_text() if f.locator('[data-testid=adjuntos-lista]').count() else ''): time.sleep(0.4)
        f.locator('button:has-text("Enviar correo")').click(); m = status_msg(p)
        check('2 destinatario' in m and '1 archivo' in m, f'Envía a una dirección externa y a un profesor, con archivo ({m[:70]})')
        msg = last_to('empleador@empresa-externa.cl')
        check(msg is not None and any(part.get_filename() == 'cv.pdf' for part in msg.iter_attachments()), 'El archivo llega adjunto de verdad')
        check(msg is not None and str(msg['Reply-To']) == 'estudiante1.a@demo.sematec.test' and 'vía' in str(msg['From']), 'Sale con su nombre y las respuestas le llegan a su correo')
        go(p, f'{BASE}/app/correo')
        check(p.locator('[data-testid=mis-correos] tbody tr').count() == 2, '📤 Mis correos enviados: aparecen los 2')
        # Límite diario (estudiante: 30)
        sql("insert into mail_log (to_email, subject, kind, status, sent_by) select 'x@y.cl', 'x', 'correo', 'sent', id from profiles, generate_series(1, 28) where email='estudiante1.a@demo.sematec.test'")
        f = p.locator('form:has(input[name=to])')
        f.locator('input[name=to]').fill('otro@empresa-externa.cl'); f.locator('input[name=subject]').fill('Hola'); f.locator('textarea[name=body]').fill('Hola')
        f.locator('button:has-text("Enviar correo")').click()
        check('límite' in status_msg(p), 'Límite diario para evitar abusos')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
