"""Correos guardados: cada correo queda registrado con su contenido; los que fallaron se reenvían cuando el correo funciona.
Los correos con enlaces de acceso (recuperar contraseña) no guardan su contenido."""
import glob, os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'

def got(addr):
    return any(addr.encode() in open(f, 'rb').read().split(b'\r\n', 1)[0] for f in glob.glob('/tmp/mails/*.eml'))

def until(fn, t=20):
    end = time.time() + t
    while time.time() < end:
        if fn(): return True
        time.sleep(0.4)
    return False

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    # Correo que falló antes (clave de Gmail mal puesta)
    sql(f"""insert into mail_log (organization_id, to_email, subject, kind, status, error, html, text_body, created_at)
            values ('{ORG}', 'apoderado.pendiente@correo-personal.cl', 'Aviso: reunión de apoderados', 'aviso', 'failed', 'El servidor de correo rechazó el usuario o la clave.',
                    '<p>Reunión el lunes</p>', 'Reunión el lunes a las 19:00', now() - interval '2 hours')""")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        # Recuperar contraseña: no guarda el enlace
        c = b.new_context(); p = c.new_page(); go(p, f'{BASE}/recuperar')
        p.fill('input[name=email]', 'estudiante2.a@demo.sematec.test'); p.click('button:has-text("Enviar enlace")'); status_msg(p)
        check(until(lambda: sql("select count(*) from mail_log where kind='recuperar'") != '0'), 'Recuperar contraseña queda en el registro')
        check(sql("select count(*) from mail_log where kind='recuperar' and html is not null") == '0', 'El enlace de acceso NO se guarda (seguridad)')
        c.close()
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'propietario.a@demo.sematec.test', mfa=True)
        go(p, f'{BASE}/app/configuracion?t=institucion')
        check('1 correo(s) guardado(s) sin enviar' in p.locator('[data-testid=correos-pendientes]').inner_text(), 'Muestra los correos guardados que no se pudieron enviar')
        p.locator('[data-testid=correos-pendientes] button:has-text("Reenviar pendientes")').click(); m = status_msg(p)
        check('1 correo(s) reenviado' in m and until(lambda: got('apoderado.pendiente@correo-personal.cl')), f'📨 Reenviar: el correo pendiente llega ({m[:60]})')
        check(sql("select status, resent_at is not null from mail_log where to_email='apoderado.pendiente@correo-personal.cl'") == 'sent|t', 'Queda marcado como reenviado')
        go(p, f'{BASE}/app/configuracion?t=institucion')
        check(p.locator('[data-testid=correos-pendientes]').count() == 0 and 'Reenviado' in p.locator('[data-testid=registro-correos]').inner_text(), 'Ya no hay pendientes y el registro dice «Reenviado»')
        check(p.locator('[data-testid=registro-correos] summary:has-text("Ver contenido")').count() >= 1, 'Se puede ver el contenido de los correos guardados')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
