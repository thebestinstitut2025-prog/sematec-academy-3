"""
Buscar sin límites: desde 1 letra o número, números parciales (teléfono, RUT) y «Ver todos los resultados».
"""
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'

def main():
    sql(f"insert into students (organization_id, campus_id, student_code, first_names, last_names, email, phone, id_document_number) "
        f"select '{ORG}', '0a000000-0000-4000-8000-0000000000c1', 'ZT-' || g, 'Zoila', 'Zetamundo ' || g, 'zeta' || g || '@demo.sematec.test', '+56 9 8765 43' || lpad(g::text, 2, '0'), null from generate_series(1, 30) g")
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        c = b.new_context(viewport={'width': 1400, 'height': 900}); p = login(c, 'secretaria.a@demo.sematec.test')
        go(p, f'{BASE}/app'); p.click('[data-testid=buscar]'); p.fill('[data-testid=buscar-texto]', 'zetamundo')
        p.wait_for_selector('[data-testid=buscar-ver-todos]'); p.locator('[data-testid=buscar-resultados] li').nth(3).wait_for(timeout=15000)
        check(p.locator('[data-testid=buscar-ver-todos]').count() == 1, 'La búsqueda rápida ofrece «Ver todos los resultados»')
        p.click('[data-testid=buscar-ver-todos]'); p.wait_for_url(re.compile(r'/app/buscar\?q=zetamundo')); p.wait_for_load_state('networkidle')
        t = p.locator('[data-testid=buscar-total]').inner_text()
        check('30' in t and p.locator('[data-testid=buscar-grupo] li').count() == 30, f'Ver todos: muestra los 30 estudiantes, sin tope ({t[:60]})')
        go(p, f'{BASE}/app/buscar?q=8765 4317')
        check('Zetamundo 17' in p.content(), 'Número parcial con espacios (teléfono): lo encuentra')
        go(p, f'{BASE}/app/buscar?q=7')
        check(p.locator('[data-testid=buscar-grupo] li').count() >= 3, 'Un solo número (1 carácter) también busca')
        go(p, f'{BASE}/app'); p.click('[data-testid=buscar]'); p.fill('[data-testid=buscar-texto]', 'z')
        p.locator('[data-testid=buscar-resultados] li').nth(1).wait_for(timeout=15000)
        check(True, 'Una sola letra en la búsqueda rápida da resultados')
        p.keyboard.press('Control+Enter'); p.wait_for_url(re.compile(r'/app/buscar\?q=z'))
        check(p.locator('[data-testid=buscar-grupo] li').count() >= 30, 'Ctrl + Enter abre todos los resultados')
        c.close(); b.close()
    ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')

if __name__ == '__main__':
    main()
