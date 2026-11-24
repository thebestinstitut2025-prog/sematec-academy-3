"""💳 Pagar todo lo pendiente: aviso de deuda, tarjeta (todas las marcas), transferencia con comprobante que finanzas
revisa antes de confirmar, boleta por correo al confirmar, rechazo con motivo y boleta para descargar/compartir."""
import os, sys, time, glob
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
MAT = '00000000-0000-4000-8000-000000000016'
S1 = '0a000000-0000-4000-8000-00000000a501'
PNG = bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010806000000'
                    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082')
def one(q): return sql(q).split('\n')[0]
def wait_for(q, expect, secs=20):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if v == expect: return v
        time.sleep(0.4)
    return v
def mails_to(addr):
    n = 0
    for f in glob.glob('/tmp/mails/*.eml'):
        first = open(f, 'rb').read().split(b'\r\n', 1)[0]
        if addr.encode() in first: n += 1
    return n

def upload(scope):
    scope.locator('[data-testid=adjuntar-input]').set_input_files([{'name': 'comprobante.png', 'mimeType': 'image/png', 'buffer': PNG}])
    end = time.time() + 30
    while time.time() < end:
        if scope.locator('[data-testid=adjuntos-lista]').count() and '✓' in scope.locator('[data-testid=adjuntos-lista]').inner_text(): return True
        time.sleep(0.4)
    return False

def main():
    os.makedirs('/tmp/mails', exist_ok=True)
    sql(f"""set request.jwt.claims = '{{"sub":"{MAT}","role":"authenticated"}}'; select create_charge('{S1}', 'tuition', 300000, 'CLP', 3, current_date - 40, null, null, 'Arancel 2026')""")
    insts = sql(f"select installment_id from installment_balances where student_id='{S1}' and outstanding>0 order by due_on").split('\n')
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        o = login(b.new_context(viewport={'width': 1400, 'height': 900}), 'propietario.a@demo.sematec.test', mfa=True)
        o.on('dialog', lambda d: d.accept())
        # 1) Finanzas publica los datos para transferir
        go(o, f'{BASE}/app/finanzas/transferencias')
        o.check('[data-testid=activar-transferencia]')
        o.fill('[data-testid=datos-cuenta]', 'Banco Estado\nCuenta corriente N° 123456789\nRUT 76.123.456-7\nSEMATEC ACADEMY\npagos@sematec.test')
        o.click('button:has-text("Guardar")'); status_msg(o)
        check(one(f"select value->>'transfer' from organization_settings where organization_id='{ORG}' and key='pagos'") == 'true', '🏦 Finanzas activa las transferencias y publica sus datos bancarios')

        # 2) Estudiante: aviso de deuda y página Pagar
        s = login(b.new_context(viewport={'width': 390, 'height': 844}), 'estudiante1.a@demo.sematec.test')
        go(s, f'{BASE}/app')
        check(s.locator('[data-testid=aviso-deuda]').count() == 1, '⚠ El estudiante ve el aviso de cuotas vencidas con «Pagar ahora»')
        s.click('[data-testid=aviso-deuda]'); s.wait_for_url('**/app/pagar')
        check('300.000' in s.locator('[data-testid=resumen-deuda]').inner_text() or '$300' in s.locator('[data-testid=resumen-deuda]').inner_text(), '💳 «Pagar» muestra todo lo pendiente')
        medios = s.locator('[data-testid=medios-pago]').inner_text()
        check('Transferencia' in medios and 'Visa' in medios and 'American Express' in medios and 'Redcompra' in medios, '💳 Ofrece tarjeta (Visa, Mastercard, Amex, Redcompra…) y transferencia')
        # 3) Transferencia: sin comprobante no se puede enviar
        form = s.locator('form', has=s.locator('[data-testid=medios-pago]')).first
        for i in range(form.locator('input[name=inst]').count()):
            cb = form.locator('input[name=inst]').nth(i)
            if (i == 0) != cb.is_checked(): cb.click()
        form.locator('[data-testid=pagar-transferencia]').check()
        check('Banco Estado' in form.locator('[data-testid=datos-banco]').inner_text(), '🏦 Muestra los datos de la cuenta para transferir')
        check(form.locator('[data-testid=enviar-comprobante]').is_disabled(), '🔒 No se puede enviar sin subir el comprobante')
        check(upload(form), '📎 Sube la foto del comprobante')
        form.locator('input[name=operation]').fill('987654'); form.locator('input[name=bank_from]').fill('Banco de Chile')
        form.locator('[data-testid=enviar-comprobante]').click()
        s.wait_for_selector('[data-testid=transferencia-enviada]', timeout=20000)
        p1 = wait_for(f"select count(*) from transfer_proofs where student_id='{S1}' and status='pending'", '1')
        check(p1 == '1' and one(f"select count(*) from attachments a join transfer_proofs t on t.id=a.entity_id where a.entity_type='transfer_proof' and t.student_id='{S1}'") == '1',
              '📤 La transferencia queda «en revisión» con su comprobante')
        check(one(f"select outstanding::int from installment_balances where installment_id='{insts[0]}'") == '100000', '⏳ La cuota NO se da por pagada hasta que finanzas confirme')
        check(int(one(f"select count(*) from notifications where organization_id='{ORG}' and title='Transferencia por revisar'")) >= 1, '🔔 Finanzas recibe el aviso')
        go(s, f'{BASE}/app/pagar')
        check('En revisión' in s.locator('[data-testid=mis-transferencias]').inner_text(), '⏳ El estudiante ve su transferencia «En revisión»')

        # 4) Finanzas confirma → pago + boleta por correo
        before = mails_to('estudiante1.a@demo.sematec.test')
        go(o, f'{BASE}/app/finanzas/transferencias')
        card = o.locator('[data-testid=transferencia-revisar]').first
        check(card.locator('[data-testid=foto-comprobante]').count() == 1, '🖼 Finanzas ve la foto del comprobante')
        card.locator('button:has-text("Confirmar")').click(); print('   ', status_msg(o))
        check(wait_for(f"select status from transfer_proofs where student_id='{S1}' order by created_at limit 1", 'approved') == 'approved'
              and one(f"select outstanding::int from installment_balances where installment_id='{insts[0]}'") == '0', '✓ Al confirmar, la cuota queda pagada')
        check(one(f"select p.method from transfer_proofs t join payments p on p.id=t.payment_id where t.student_id='{S1}'") == 'bank_transfer', '🧾 Se registra el pago por transferencia con su boleta')
        end = time.time() + 15
        while time.time() < end and mails_to('estudiante1.a@demo.sematec.test') <= before: time.sleep(0.5)
        check(mails_to('estudiante1.a@demo.sematec.test') > before, '✉ La boleta llega al correo del estudiante')

        # 5) Rechazo con motivo
        go(s, f'{BASE}/app/pagar')
        form = s.locator('form', has=s.locator('[data-testid=medios-pago]')).first
        for i in range(form.locator('input[name=inst]').count()):
            cb = form.locator('input[name=inst]').nth(i)
            if (i == 0) != cb.is_checked(): cb.click()
        form.locator('[data-testid=pagar-transferencia]').check(); upload(form)
        form.locator('[data-testid=enviar-comprobante]').click(); s.wait_for_selector('[data-testid=transferencia-enviada]', timeout=20000)
        go(o, f'{BASE}/app/finanzas/transferencias')
        card = o.locator('[data-testid=transferencia-revisar]').first
        card.locator('[data-testid=motivo-rechazo]').fill('El monto no llegó a la cuenta'); card.locator('button:has-text("Rechazar")').click(); status_msg(o)
        check(wait_for(f"select status from transfer_proofs where student_id='{S1}' order by created_at desc limit 1", 'rejected') == 'rejected', '✕ Finanzas rechaza con motivo')
        go(s, f'{BASE}/app/pagar')
        txt = s.locator('[data-testid=mis-transferencias]').inner_text()
        check('Rechazada' in txt and 'no llegó' in txt, '✕ El estudiante ve el rechazo y el motivo, y puede volver a informarla')

        # 6) Boleta: descargar, compartir, WhatsApp, correo
        pay = one(f"select payment_id from transfer_proofs where student_id='{S1}' and status='approved'")
        go(s, f'{BASE}/app/finanzas/boleta/{pay}')
        check(s.locator('[data-testid=descargar-boleta]').count() == 1 and s.locator('[data-testid=compartir-boleta]').count() == 1 and s.locator('a:has-text("WhatsApp")').count() == 1,
              '🧾 La boleta se puede descargar, compartir y enviar por WhatsApp')
        check(s.locator('a[href="/app/pagar"]').count() >= 1, '☰ «Pagar» está en el menú del estudiante')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
