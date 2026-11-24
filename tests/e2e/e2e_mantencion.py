"""🛠 Centro de mantención: toda la plataforma o solo un módulo/sistema/área, con aviso y horario; el propietario sigue entrando."""
import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
def one(q): return sql(q).split('\n')[0]
def blocked(p, path):
    go(p, f'{BASE}{path}')
    return p.locator('[data-testid=en-mantencion]').count() > 0

def main():
    sql(f"delete from organization_settings where organization_id='{ORG}' and key='maintenance'")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        o = login(b.new_context(viewport={'width': 1400, 'height': 900}), 'propietario.a@demo.sematec.test', mfa=True)
        o.on('dialog', lambda d: d.accept())
        go(o, f'{BASE}/app/mantencion')
        check(o.locator('[data-testid=estado-plataforma]').count() == 1 and o.locator('[data-testid=nada-en-mantencion]').count() == 1, '🛠 El propietario abre el Centro de mantención con el estado de la plataforma')
        check(o.locator('[data-testid=accesos-mantencion] a[href="/app/modulos?t=areas"]').count() == 1, '⚡ Accesos para agregar/eliminar áreas, módulos y sistemas')
        o.locator('[data-testid=opcion-_app_biblioteca]').check()
        o.locator('[data-testid=area-comunidad]').check()
        o.locator('[data-testid=mensaje-items]').fill('Estamos ordenando los libros. Vuelve pronto.')
        o.locator('button:has-text("Poner en mantención lo elegido")').click(); status_msg(o)
        time.sleep(0.5)
        v = one(f"select (value->'items') ? '/app/biblioteca' and (value->'items') ? 'area:comunidad' from organization_settings where organization_id='{ORG}' and key='maintenance'")
        check(v == 't', '🧩 Pone en mantención una opción (Biblioteca) y un área completa (Comunicación)')

        s = login(b.new_context(viewport={'width': 1400, 'height': 900}), 'estudiante1.a@demo.sematec.test')
        check(blocked(s, '/app/biblioteca') and 'ordenando los libros' in s.locator('[data-testid=en-mantencion]').inner_text(), '🚧 El estudiante ve el aviso con el mensaje en Biblioteca')
        check(blocked(s, '/app/anuncios'), '🗂 Lo del área en mantención también muestra el aviso (Anuncios)')
        check(not blocked(s, '/app/perfil'), '👤 «Mi cuenta» siempre está disponible')
        check(s.locator('nav >> text=/Biblioteca · 🛠/').count() > 0 or 'Biblioteca · 🛠' in s.content(), '🛠 El menú marca lo que está en mantención')
        check(not blocked(o, '/app/biblioteca') and o.locator('[data-testid=aviso-mantencion]').count() == 1, '🔑 El propietario sigue entrando y ve el aviso para ir a Mantención')

        go(o, f'{BASE}/app/mantencion')
        it = o.locator('[data-testid=item-mantencion]', has_text='Biblioteca')
        it.locator('button:has-text("Terminar")').click(); status_msg(o); time.sleep(0.5)
        check(not blocked(s, '/app/biblioteca') and blocked(s, '/app/anuncios'), '✓ «Terminar» vuelve a abrir solo esa opción')

        # Toda la plataforma
        go(o, f'{BASE}/app/mantencion')
        o.locator('[data-testid=mensaje-global]').fill('Mejoras generales hasta las 14:00')
        o.locator('button:has-text("Poner toda la plataforma en mantención")').click(); status_msg(o); time.sleep(0.5)
        check(blocked(s, '/app/calificaciones') and 'Mejoras generales' in s.locator('[data-testid=en-mantencion]').inner_text(), '🌐 Toda la plataforma en mantención: el estudiante ve el aviso')
        check(not blocked(s, '/app/perfil') and not blocked(o, '/app/calificaciones'), '🔑 Mi cuenta sigue abierta y el propietario trabaja normal')

        # Horario: «hasta» ya pasado → se abre sola
        sql(f"update organization_settings set value = jsonb_set(value, '{{global,until}}', to_jsonb((now() - interval '1 minute')::text)) where organization_id='{ORG}' and key='maintenance'")
        check(not blocked(s, '/app/calificaciones'), '⏰ Con la hora «hasta» cumplida, se abre sola')
        sql(f"update organization_settings set value = jsonb_set(value, '{{global,until}}', 'null') where organization_id='{ORG}' and key='maintenance'")
        check(blocked(s, '/app/calificaciones'), '🔁 Sin hora de término sigue en mantención')

        go(o, f'{BASE}/app/mantencion')
        o.locator('button:has-text("Terminar todo")').click(); status_msg(o); time.sleep(0.5)
        check(not blocked(s, '/app/calificaciones') and not blocked(s, '/app/anuncios'), '✓ «Terminar todo» deja todo disponible')
        check(o.locator('[data-testid=nada-en-mantencion]').count() == 1 or (go(o, f'{BASE}/app/mantencion') or True) and o.locator('[data-testid=nada-en-mantencion]').count() == 1, '📋 La lista queda vacía')

        # Un estudiante no puede entrar al centro de mantención
        go(s, f'{BASE}/app/mantencion')
        check('/app/mantencion' not in s.url, '🔒 Solo el propietario abre el Centro de mantención')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
