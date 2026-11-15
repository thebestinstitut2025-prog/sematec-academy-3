"""
Mi cuenta: cambiar el correo de acceso (con contraseña y confirmación), idioma.
Navegación: ← Volver / Siguiente → y botón «Cancelar» en los formularios desplegables.
"""
import email, glob, os, re, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, PASS, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

def mails(addr):
    out = []
    for f in sorted(glob.glob('/tmp/mails/*.eml')):
        raw = open(f, 'rb').read(); first, rest = raw.split(b'\r\n', 1)
        if addr.encode() not in first: continue
        m = email.message_from_bytes(rest, policy=policy.default); b = m.get_body(preferencelist=('plain',))
        out.append(b.get_content() if b else '')
    return out

def until(fn, t=15):
    end = time.time() + t
    while time.time() < end:
        if fn(): return True
        time.sleep(0.4)
    return False

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    for f in glob.glob('/tmp/mails/*.eml'): os.remove(f)
    NEW = 'ana.nueva@correo-personal.cl'
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1400, 'height': 900}); p = login(c, 'estudiante1.a@demo.sematec.test')
        go(p, f'{BASE}/app/perfil')
        f = p.locator('form:has(input[name=new_email])')
        f.locator('input[name=new_email]').fill(NEW); f.locator('input[name=current_password]').fill('Incorrecta123x'); f.locator('button:has-text("Enviar enlace")').click()
        check('contraseña actual no es correcta' in status_msg(p), 'Cambiar correo: con contraseña equivocada no se puede')
        go(p, f'{BASE}/app/perfil'); f = p.locator('form:has(input[name=new_email])')
        f.locator('input[name=new_email]').fill(NEW); f.locator('input[name=current_password]').fill(PASS); f.locator('button:has-text("Enviar enlace")').click()
        m = status_msg(p)
        check('Le enviamos un enlace' in m and until(lambda: mails(NEW)), 'Cambiar correo: llega el enlace de confirmación al correo nuevo')
        check(until(lambda: mails('estudiante1.a@demo.sematec.test')), 'Se avisa también al correo anterior')
        check(sql("select email from profiles where email like 'estudiante1.a%'") == 'estudiante1.a@demo.sematec.test', 'Hasta confirmar, el correo no cambia')
        link = re.search(r'(https?://\S+/cuenta/confirmar-correo\?t=\S+)', mails(NEW)[-1]).group(1)
        go(p, re.sub(r'^https?://[^/]+', BASE, link)); p.wait_for_url(re.compile(r'/app/perfil\?correo=ok'))
        check(NEW in p.locator('[data-testid=correo-cambiado]').inner_text(), 'Al abrir el enlace, el correo de acceso queda cambiado')
        check(sql(f"select count(*) from profiles where email='{NEW}'") == '1' and sql(f"select count(*) from students where email='{NEW}'") == '1', 'El perfil y la ficha quedan con el correo nuevo')
        go(p, re.sub(r'^https?://[^/]+', BASE, link)); p.wait_for_url(re.compile(r'correo=enlace'))
        check(True, 'El enlace sirve una sola vez')
        c.close()
        c = b.new_context(); p = login(c, NEW); go(p, f'{BASE}/app/perfil')
        check(NEW in p.content(), 'Entra con el correo nuevo y la misma contraseña')
        f = p.locator('form:has(select[name=preferred_locale])'); f.locator('select[name=preferred_locale]').select_option('fr'); f.locator('button:has-text("Guardar idioma")').click()
        check('Idioma guardado' in status_msg(p) and sql(f"select preferred_locale from profiles where email='{NEW}'") == 'fr', 'Preferencias: idioma guardado')
        c.close()

        # Navegación ← Volver / Siguiente →
        c = b.new_context(viewport={'width': 1400, 'height': 900}); p = login(c, 'secretaria.a@demo.sematec.test')
        go(p, f'{BASE}/app/estudiantes'); go(p, f'{BASE}/app/secciones')
        p.click('[data-testid=nav-volver]'); p.wait_for_url(re.compile(r'/app/estudiantes$'))
        check(True, '← Volver regresa a la página anterior')
        p.click('[data-testid=nav-siguiente]'); p.wait_for_url(re.compile(r'/app/secciones$'))
        check(True, 'Siguiente → avanza otra vez')
        # Cancelar en un formulario desplegable
        d = p.locator('details:has(summary:has-text("Nueva sección"))'); d.locator('summary').click()
        d.locator('input[name=code]').fill('ZZ-CANCELAR')
        d.locator('[data-testid=form-cancelar]').click()
        check(d.get_attribute('open') is None, 'Cancelar cierra el formulario')
        d.locator('summary').click()
        check(d.locator('input[name=code]').input_value() == '', 'Cancelar borra lo escrito sin guardar')
        check(sql("select count(*) from sections where code='ZZ-CANCELAR'") == '0', 'Cancelar no guarda nada')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
