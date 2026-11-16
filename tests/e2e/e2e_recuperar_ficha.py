"""
«¿Olvidó su contraseña?» para un estudiante con ficha pero SIN cuenta: se activa su cuenta y le llega el enlace.
Diagnóstico de la administración: muestra la causa exacta.
"""
import email, glob, os, re, sys, time
from email import policy
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'

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
    NEW = 'lucia.sincuenta@correo-personal.cl'
    sql(f"insert into students (organization_id, campus_id, student_code, first_names, last_names, email, id_document_number) values ('{ORG}', '0a000000-0000-4000-8000-0000000000c1', 'SC-1', 'Lucía', 'Sin Cuenta', '{NEW}', '15.555.555-0')")
    sql(f"insert into students (organization_id, campus_id, student_code, first_names, last_names, email, status) values ('{ORG}', '0a000000-0000-4000-8000-0000000000c1', 'SC-2', 'Pedro', 'Inactivo', 'pedro.inactivo@correo-personal.cl', 'inactive')")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        # Diagnóstico de la administración
        c = b.new_context(viewport={'width': 1300, 'height': 900}); p = login(c, 'propietario.a@demo.sematec.test', mfa=True)
        go(p, f'{BASE}/app/configuracion?t=institucion')
        d = p.locator('[data-testid=diagnostico-recuperar]')
        d.locator('input[name=identifier]').fill(NEW); d.locator('button:has-text("Revisar")').click(); m = status_msg(p)
        check('No tiene cuenta, pero su ficha de estudiante' in m, f'Diagnóstico: ficha sin cuenta ({m[:90]})')
        d.locator('input[name=identifier]').fill('pedro.inactivo@correo-personal.cl'); d.locator('button:has-text("Revisar")').click(); m = status_msg(p)
        check('inactive' in m or 'no activa' in m, 'Diagnóstico: ficha inactiva')
        d.locator('input[name=identifier]').fill('estudiante2.a@demo.sematec.test'); d.locator('button:has-text("Revisar")').click(); m = status_msg(p)
        check('Tiene cuenta' in m and 'está activa' in m, 'Diagnóstico: cuenta activa')
        c.close()
        # El estudiante sin cuenta pide el enlace desde el inicio
        c = b.new_context(); p = c.new_page(); go(p, f'{BASE}/recuperar')
        p.fill('input[name=email]', NEW.upper()); p.click('button:has-text("Enviar enlace")'); status_msg(p)
        check(until(lambda: mails(NEW)), 'Ficha sin cuenta: le llega el enlace para crear su contraseña')
        check(sql(f"select user_id is not null from students where email='{NEW}'") == 't', 'Su cuenta quedó creada y unida a su ficha')
        check(sql(f"select count(*) from memberships m join profiles p on p.id=m.user_id where p.email='{NEW}' and m.status='active'") == '1', 'Con su rol de estudiante en la institución')
        link = re.search(r'(https?://\S+/auth/confirm\?\S+)', mails(NEW)[-1]).group(1)
        go(p, re.sub(r'^https?://[^/]+', BASE, link)); p.wait_for_url(re.compile(r'/cambiar-clave'), timeout=20000)
        p.fill('input[name=password]', 'LuciaNueva2026x'); p.fill('input[name=confirm]', 'LuciaNueva2026x'); p.click('button:has-text("Guardar contraseña")'); status_msg(p)
        c.close()
        c = b.new_context(); p = c.new_page(); go(p, f'{BASE}/login')
        p.fill('input[name=email]', NEW); p.fill('input[name=password]', 'LuciaNueva2026x'); p.click('button[type=submit]')
        p.wait_for_url(re.compile(r'/app'), timeout=20000)
        check(True, 'Crea su contraseña y entra')
        c.close()
        # Por RUT también
        sql("update students set email='rut.sincuenta@correo-personal.cl', id_document_number='14.444.444-3' where student_code='SC-2'")
        sql("update students set status='active' where student_code='SC-2'")
        c = b.new_context(); p = c.new_page(); go(p, f'{BASE}/recuperar')
        p.fill('input[name=email]', '14444444-3'); p.click('button:has-text("Enviar enlace")'); status_msg(p)
        check(until(lambda: mails('rut.sincuenta@correo-personal.cl')), 'Ficha sin cuenta por RUT: el enlace llega al correo de su ficha')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
