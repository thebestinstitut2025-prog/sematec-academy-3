"""
🗂 Áreas, módulos y sistemas editables y reutilizables sin tocar código:
áreas (renombrar, crear, ocultar, mover opciones, eliminar), módulos (área, estados, funciones),
duplicar, plantillas, exportar e importar en otra institución, desactivar y permisos.
"""
import os, sys, json, time
sys.path.insert(0, os.path.dirname(__file__))
from e2e import BASE, CHROME, sql, check, go, login, status_msg, results
from playwright.sync_api import sync_playwright

ORG = '0a000000-0000-4000-8000-000000000001'
def one(q): return sql(q).split('\n')[0]

def area_row(o, title):
    """Fila de un área por su nombre actual (fija por posición, aunque se le cambie el nombre)."""
    vals = o.locator('[data-testid=area] input[aria-label="Nombre del área"]').evaluate_all('els => els.map(e => e.value)')
    return o.locator('[data-testid=area]').nth(vals.index(title))

def wait_for(q, expect=None, secs=20):
    end = time.time() + secs; v = ''
    while time.time() < end:
        v = one(q)
        if (expect is None and v) or (expect is not None and v == expect): return v
        time.sleep(0.4)
    return v

def save_areas(o):
    o.locator('button:has-text("Guardar áreas")').click(); return status_msg(o)

def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=['--no-sandbox'])
        oc = b.new_context(viewport={'width': 1400, 'height': 900}, accept_downloads=True)
        o = login(oc, 'propietario.a@demo.sematec.test', mfa=True)
        o.on('dialog', lambda d: d.accept())

        # ---------- Áreas ----------
        go(o, f'{BASE}/app/modulos?t=areas')
        ac = area_row(o, 'Gestión académica')
        ac.locator('input[aria-label="Nombre del área"]').fill('Académico')
        ac.locator('select[aria-label="Ícono del área"]').select_option('📚')
        o.locator('[data-testid=nueva-area]').click()
        nueva = o.locator('[data-testid=area]').last
        nueva.locator('input[aria-label="Nombre del área"]').fill('Pastoral')
        nueva.locator('select[aria-label="Color del área"]').select_option(label='Violeta')
        bien = area_row(o, 'Bienestar y vida estudiantil')
        bien.locator('[data-testid=ocultar-area]').check()
        m = save_areas(o)
        cfg = json.loads(one(f"select value::text from organization_settings where organization_id='{ORG}' and key='areas.custom'"))
        titles = {a['title']: a for a in cfg['areas']}
        check('Académico' in titles and titles['Académico']['icon'] == '📚' and 'Gestión académica' not in titles, f'Renombra un área y cambia su ícono ({m[:40]})')
        past = titles.get('Pastoral')
        check(past and past['key'].startswith('x_') and past['color'] == 'from-violet-700 to-fuchsia-500', 'Crea un área nueva con su color')
        check(titles['Bienestar y vida estudiantil'].get('hidden') is True, 'Oculta un área')
        # Mover «Biblioteca» al área nueva y subirla al primer lugar
        go(o, f'{BASE}/app/modulos?t=areas')
        o.locator('[data-testid=opciones-por-area]').click()
        o.locator('select[aria-label="Área de Biblioteca"]').select_option(past['key'])
        for _ in range(30):
            if o.locator('[data-testid=area]').first.locator('input[aria-label="Nombre del área"]').input_value() == 'Pastoral': break
            area_row(o, 'Pastoral').locator('button[aria-label=Subir]').click()
        save_areas(o)
        cfg = json.loads(one(f"select value::text from organization_settings where organization_id='{ORG}' and key='areas.custom'"))
        check(cfg['place'].get('/app/biblioteca') == past['key'] and cfg['areas'][0]['title'] == 'Pastoral', 'Mueve una opción del menú a otra área y cambia el orden')
        go(o, f'{BASE}/app/mapa')
        txt = o.locator('main').inner_text()
        check('Pastoral' in txt and 'Académico' in txt and 'Gestión académica' not in txt, 'El Mapa muestra las áreas con sus nuevos nombres')
        check(txt.index('Pastoral') < txt.index('Académico') and txt.index('Biblioteca') < txt.index('Académico'), 'El Mapa respeta el orden y la opción movida')

        # ---------- Módulo con área, estados y funciones ----------
        go(o, f'{BASE}/app/modulos')
        form = o.locator('form:has(button:has-text("Crear módulo"))')
        form.locator('input[name=name]').fill('Visitas pastorales')
        form.locator('[data-testid=area-modulo]').select_option(past['key'])
        form.locator('[data-testid=agregar-estado]').click(); form.locator('[data-testid=agregar-estado]').click()
        form.locator('[data-testid=estado]').nth(0).locator('input').first.fill('Agendada')
        form.locator('[data-testid=estado]').nth(1).locator('input').first.fill('Realizada')
        form.locator('[data-testid=estado]').nth(1).locator('input[type=checkbox]').check()
        form.locator('[data-testid=funcion-assignee]').check(); form.locator('[data-testid=funcion-due]').check()
        form.locator('button:has-text("Crear módulo")').click(); m = status_msg(o)
        row = one(f"select area||'|'||workflow::text||'|'||features::text from custom_modules where organization_id='{ORG}' and name='Visitas pastorales'")
        area, wf, ft = row.split('|')
        wf = json.loads(wf); ft = json.loads(ft)
        check(area == past['key'] and [w['label'] for w in wf] == ['Agendada', 'Realizada'] and wf[1].get('final') is True, f'Crea un sistema en un área, con sus estados ({m[:40]})')
        check(ft.get('assignee') is True and ft.get('due') is True and 'files' not in ft, 'Con las funciones elegidas (responsable y fecha límite)')
        go(o, f'{BASE}/app/sistemas')
        check(o.locator(f'[data-testid=sistemas-{past["key"]}]').count() == 1 and 'Visitas pastorales' in o.locator(f'[data-testid=sistemas-{past["key"]}]').inner_text(), 'Aparece en «Sistemas» dentro de su área')
        # No se puede quitar un estado con registros
        mid = one("select id from custom_modules where name='Visitas pastorales'")
        sql(f"""insert into custom_records (organization_id, module_id, data) values ('{ORG}', '{mid}', '{{"nombre":"Familia Pérez"}}')""")
        go(o, f'{BASE}/app/modulos?q=Visitas')
        li = o.locator('[data-testid=modulo]', has_text='Visitas pastorales').first
        li.locator('summary:has-text("Editar todo")').click()
        ef = li.locator('form:has(button:has-text("Guardar cambios"))')
        ef.locator('[data-testid=estado]').nth(0).locator('button[aria-label="Quitar estado"]').click()
        ef.locator('button:has-text("Guardar cambios")').click(); m = status_msg(o)
        check('Agendada' in m and '1 registro' in m, f'No deja quitar un estado que tiene registros ({m[:60]})')
        go(o, f'{BASE}/app/modulos?q=Visitas')
        li = o.locator('[data-testid=modulo]', has_text='Visitas pastorales').first
        li.locator('summary:has-text("Editar todo")').click()
        ef = li.locator('form:has(button:has-text("Guardar cambios"))')
        ef.locator('[data-testid=agregar-estado]').click(); ef.locator('[data-testid=estado]').last.locator('input').first.fill('Cancelada')
        ef.locator('input[name=name]').fill('Visitas pastorales')
        ef.locator('button:has-text("Guardar cambios")').click(); status_msg(o)
        check(json.loads(one(f"select workflow::text from custom_modules where id='{mid}'"))[-1]['label'] == 'Cancelada' and json.loads(one(f"select features::text from custom_modules where id='{mid}'")).get('assignee') is True,
              'Edita los estados de un sistema existente (agrega «Cancelada») y conserva sus funciones')

        # ---------- Reutilizar: duplicar, plantilla, exportar e importar ----------
        li = o.locator('[data-testid=modulo]', has_text='Visitas pastorales').first
        go(o, f'{BASE}/app/modulos?q=Visitas')
        li = o.locator('[data-testid=modulo]', has_text='Visitas pastorales').first
        li.locator('button:has-text("Duplicar")').click()
        dup = wait_for("select area||'|'||jsonb_array_length(workflow)||'|'||(select count(*) from custom_records r where r.module_id=m.id) from custom_modules m where name='Visitas pastorales (copia)'")
        check(dup == f"{past['key']}|3|0", f'📄 Duplica el sistema con su área y estados, sin registros ({dup})')
        go(o, f'{BASE}/app/modulos?q=Visitas')
        o.locator('[data-testid=modulo]', has_text='Visitas pastorales').first.locator('button:has-text("Guardar como plantilla")').click()
        wait_for(f"select value::text from organization_settings where organization_id='{ORG}' and key='modules.templates'")
        go(o, f'{BASE}/app/modulos?t=plantillas')
        check(o.locator('[data-testid=plantilla]', has_text='Visitas pastorales').count() == 1, '💾 Guarda el sistema como plantilla')
        pl = o.locator('[data-testid=plantilla]', has_text='Visitas pastorales').first
        pl.locator('input[name=name]').fill('Visitas a domicilio'); pl.locator('button:has-text("Crear módulo desde esta plantilla")').click(); m = status_msg(o)
        check(one("select jsonb_array_length(workflow) from custom_modules where name='Visitas a domicilio'") == '3', f'➕ Crea un módulo nuevo desde la plantilla ({m[:40]})')
        # Exportar
        r = o.request.get(f'{BASE}/app/modulos/exportar?id={mid}')
        pkg = r.json()
        check(r.status == 200 and pkg['formato'] == 'sematec.modulos' and pkg['modulos'][0]['name'] == 'Visitas pastorales' and 'Familia' not in r.text(),
              '⬇ Exporta el sistema en un archivo (estructura, sin registros)')
        check(any(a['title'] == 'Pastoral' for a in pkg['areas']['areas']), 'El archivo incluye su área')
        all_pkg = o.request.get(f'{BASE}/app/modulos/exportar')
        check(all_pkg.status == 200 and len(all_pkg.json()['modulos']) >= 3, '⬇ Exporta todos los módulos de una vez')
        # Importar en OTRA institución
        bc = b.new_context(viewport={'width': 1400, 'height': 900}); ob = login(bc, 'propietario.b@demo.sematec.test', mfa=True)
        go(ob, f'{BASE}/app/modulos?t=plantillas')
        ob.locator('[data-testid=archivo-importar]').set_input_files([{'name': 'visitas.json', 'mimeType': 'application/json', 'buffer': r.body()}])
        ob.locator('button:has-text("Importar")').click(); m = status_msg(ob)
        orgb = one("select id from organizations where slug='sematec-demo-pe'")
        imp = one(f"select m.area||'|'||jsonb_array_length(m.workflow) from custom_modules m where m.organization_id='{orgb}' and m.name='Visitas pastorales'")
        cfgb = one(f"select value::text from organization_settings where organization_id='{orgb}' and key='areas.custom'")
        check(imp.endswith('|3') and 'Pastoral' in cfgb and imp.split('|')[0] in cfgb, f'⬆ La otra institución importa el sistema con su área y estados ({m[:50]})')
        check(one(f"select count(*) from custom_records r join custom_modules m on m.id=r.module_id where m.organization_id='{orgb}' and m.name='Visitas pastorales'") == '0', 'Sin copiar registros de la otra institución')
        ob.locator('[data-testid=archivo-importar]').set_input_files([{'name': 'malo.json', 'mimeType': 'application/json', 'buffer': b'{"hola":1}'}])
        ob.locator('button:has-text("Importar")').click(); m = status_msg(ob)
        check('no es un paquete' in m, f'Rechaza archivos que no son paquetes de módulos ({m[:50]})')
        bc.close()

        # ---------- Desactivar, eliminar área ----------
        go(o, f'{BASE}/app/modulos?q=domicilio')
        o.locator('[data-testid=modulo]', has_text='Visitas a domicilio').first.locator('button:has-text("Desactivar")').click()
        check(wait_for("select active from custom_modules where name='Visitas a domicilio'", 'f') == 'f', '⏸ Desactiva un sistema sin borrar sus datos')
        go(o, f'{BASE}/app/modulos?t=areas')
        area_row(o, 'Pastoral').locator('[data-testid=eliminar-area]').click()
        save_areas(o)
        check(one(f"select coalesce(area,'-') from custom_modules where id='{mid}'") == '-' and 'Pastoral' not in one(f"select value::text from organization_settings where organization_id='{ORG}' and key='areas.custom'"),
              '🗑 Elimina un área: sus sistemas pasan a «Módulos propios» (no se pierden)')
        go(o, f'{BASE}/app/sistemas')
        check('Visitas pastorales' in o.locator('[data-testid=sistemas-otros]').inner_text(), 'Y siguen visibles en «Sistemas»')

        # ---------- Permisos ----------
        sc = b.new_context(); s = login(sc, 'secretaria.a@demo.sematec.test')
        s.goto(f'{BASE}/app/modulos'); time.sleep(1)
        check('/app/modulos' not in s.url, 'Solo el propietario administra áreas y módulos')
        check(s.request.get(f'{BASE}/app/modulos/exportar').status == 403, 'Y solo él puede exportarlos')
        b.close()

if __name__ == '__main__':
    try: main()
    finally:
        ok = sum(1 for r in results if r[0]); print(f'\n{ok}/{len(results)} verificaciones OK')
