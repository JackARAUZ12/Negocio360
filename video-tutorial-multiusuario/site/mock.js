// Tutorial mock controller. The parent video calls window.update(u) every frame;
// everything here must be a pure function of u (frames render out of order).
(function () {
  const PAGE = location.pathname.split('/').pop().replace('.html', '');
  const V = new URLSearchParams(location.search).get('v') || '';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const ease = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const typed = (s, u, a, cps = 9) => s.slice(0, clamp(Math.floor((u - a) * cps), 0, s.length));

  // same palette/hash as perfiles-guard.js
  const AVATAR_COLORS = ['#6C63FF', '#F59E0B', '#10B981', '#EF4444', '#3B82F6', '#EC4899', '#14B8A6', '#8B5CF6'];
  function colorFor(seed) { let h = 0; for (let i = 0; i < seed.length; i++) h = seed.charCodeAt(i) + ((h << 5) - h); return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]; }
  const MODS = [['🏠', 'Dashboard'], ['💰', 'Ventas'], ['👥', 'Clientes'], ['📦', 'Productos/Servicios'], ['🛒', 'Compras'], ['💸', 'Gastos'], ['🏦', 'Caja / Pagos'], ['📊', 'Reportes'], ['🧾', 'Créditos'], ['📄', 'Proformas'], ['🧑‍💼', 'Salarios'], ['🏬', 'Sucursales']];
  const MARIA_MODS = ['Dashboard', 'Ventas', 'Clientes', 'Caja / Pagos'];

  // ---------- pointer (desktop cursor / phone finger) ----------
  const isPhone = innerWidth < 600;
  let cursor, ripple, tap, LASTP = [640, 400];
  function ensurePointer() {
    if (cursor) return;
    cursor = document.createElement('div'); cursor.id = 'mk-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2l15 12-6.6.8 3.9 7.4-2.9 1.5-3.9-7.5L4 21z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    ripple = document.createElement('div'); ripple.id = 'mk-ripple';
    tap = document.createElement('div'); tap.id = 'mk-tap';
    document.body.append(cursor, ripple, tap);
  }
  function center(sel) {
    const el = typeof sel === 'string' ? $(sel) : sel; if (!el) return null;
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) return null;
    return [r.left + r.width / 2, r.top + r.height / 2];
  }
  // keys: [time, target] where target is [x,y] or a selector/element; clicks: times
  function pointer(u, keys, clicks = [], show = true) {
    ensurePointer();
    if (!show || !keys.length) { cursor.style.display = ripple.style.display = tap.style.display = 'none'; return; }
    const pos = keys.map(k => Array.isArray(k[1]) ? k[1] : center(k[1]));
    let i = 0; while (i < keys.length - 1 && u >= keys[i + 1][0]) i++;
    let p;
    if (i === keys.length - 1 || u < keys[0][0]) p = pos[u < keys[0][0] ? 0 : i];
    else {
      const a = pos[i] || pos[i + 1] || LASTP, b = pos[i + 1] || pos[i] || LASTP;
      const t0 = keys[i][0], t1 = keys[i + 1][0], mv = Math.min(0.7, t1 - t0);
      const k = ease(clamp((u - (t1 - mv)) / mv));
      p = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    if (!p) p = LASTP;
    LASTP = p;
    const ck = clicks.map(c => u - c).find(d => d >= 0 && d < 0.45);
    if (isPhone) {
      cursor.style.display = 'none';
      const near = clicks.some(c => u > c - 0.6 && u < c + 0.35);
      tap.style.display = near ? 'block' : 'none';
      tap.style.left = p[0] + 'px'; tap.style.top = p[1] + 'px';
      tap.style.transform = `scale(${ck != null ? 0.8 + ck : 1})`;
      tap.style.opacity = ck != null ? String(1 - ck / 0.45) : String(clamp((u - (clicks.find(c => u > c - 0.6 && u < c + 0.35) - 0.6)) / 0.3));
    } else {
      cursor.style.display = 'block';
      cursor.style.transform = `translate(${p[0] - 5}px, ${p[1] - 3}px) scale(${ck != null && ck < 0.15 ? 0.85 : 1})`;
    }
    if (ck != null) {
      ripple.style.display = 'block'; ripple.style.left = p[0] + 'px'; ripple.style.top = p[1] + 'px';
      ripple.style.transform = `scale(${0.4 + ck * 2.2})`; ripple.style.opacity = String(1 - ck / 0.45);
    } else ripple.style.display = 'none';
  }

  // ---------- profile overlay (real perfiles-guard.css classes) ----------
  let ov, lastKey = '';
  function overlay(html, key) {
    if (!ov) { ov = document.createElement('div'); ov.id = 'pg-overlay'; ov.className = 'pg-visible'; ov.innerHTML = '<div class="pg-card" id="pg-card"></div>'; document.body.appendChild(ov); }
    ov.style.display = html == null ? 'none' : 'flex';
    if (html != null && key !== lastKey) { $('#pg-card').innerHTML = html; lastKey = key; }
  }
  const tile = (n, admin) => `<button class="pg-profile" data-n="${esc(n)}"><div class="pg-avatar" style="background:${admin ? '#1A1D2E' : colorFor(n)}">${admin ? '👑' : esc(n.charAt(0))}</div><div class="pg-profile-name">${esc(n)}</div>${admin ? '<div class="pg-profile-badge">Admin</div>' : ''}</button>`;
  const selector = names => `<div class="pg-title">¿Quién eres?</div><div class="pg-subtitle">Elige tu usuario para continuar</div>
    <div class="pg-grid">${tile('Admin', true)}${names.map(n => tile(n)).join('')}<button class="pg-profile" id="pg-add-tile"><div class="pg-avatar pg-avatar-add">＋</div><div class="pg-profile-name" style="color:var(--text-muted,#9CA3AF)">Agregar usuario</div></button></div>
    <div class="pg-manage-link" id="pg-manage-link">⚙ Gestionar usuarios</div>`;
  const pinView = (n, admin, sub, dots) => `<div class="pg-back-arrow">← Volver</div><div class="pg-pin-wrap">
    <div class="pg-pin-avatar" style="background:${admin ? '#1A1D2E' : colorFor(n)}">${admin ? '👑' : esc(n.charAt(0))}</div>
    <div class="pg-title" style="margin-bottom:2px">${esc(n)}</div><div class="pg-subtitle" style="margin-bottom:4px">${sub}</div>
    <input type="text" class="pg-pin-input" placeholder="••••" value="${'0'.repeat(dots)}" style="${dots ? 'border-color:var(--accent,#6C63FF)' : ''}"/>
    <div class="pg-hint"></div><div class="pg-error"></div>
    <div class="pg-btn-row"><button class="pg-btn pg-btn-ghost">Cancelar</button><button class="pg-btn pg-btn-primary" id="mk-entrar">Entrar</button></div>
    ${admin ? '' : '<div class="pg-manage-link">¿Olvidaste tu código?</div>'}</div>`;
  const userRow = (n, mods) => `<div class="pg-user-row"><div class="pg-avatar" style="background:${colorFor(n)}">${esc(n.charAt(0))}</div>
    <div class="pg-user-row-info"><div class="pg-user-row-name">${esc(n)}</div><div class="pg-user-row-mods">${esc(mods)}</div></div>
    <button class="pg-icon-btn" title="Editar">✏️</button><button class="pg-icon-btn pg-icon-danger" title="Eliminar">🗑️</button></div>`;
  const gestion = (rows, ok) => `<div class="pg-back-arrow">← Volver</div><div class="pg-title">Gestionar usuarios</div>
    <div class="pg-subtitle">Crea perfiles con acceso limitado a ciertos módulos</div>${ok ? `<div id="mk-success">${ok}</div>` : ''}
    <div style="font-size:12.5px;font-weight:700;color:var(--text-muted,#9CA3AF);margin-bottom:8px">Usuarios con acceso restringido</div>
    ${rows.length ? rows.map(r => userRow(r[0], r[1])).join('') : '<div style="font-size:13px;color:var(--text-muted,#9CA3AF);text-align:center;padding:14px 0">Aún no has agregado usuarios.</div>'}
    <button class="pg-btn pg-btn-primary" id="mk-nuevo" style="width:100%;margin-top:12px">+ Nuevo usuario</button>
    <details style="margin-top:14px"><summary style="font-size:12.5px;font-weight:600;color:var(--text-muted,#9CA3AF)">👑 Administradores (1)</summary></details>`;
  const form = (nombre, pinLen, checked) => `<div class="pg-back-arrow">← Volver</div><div class="pg-title">Nuevo usuario</div>
    <div class="pg-subtitle">Define su nombre, código de acceso y a qué módulos puede entrar</div>
    <div class="pg-field"><label>Nombre</label><input type="text" id="mk-nombre" placeholder="Ej: Vendedor, Cajera, Bodega..." value="${esc(nombre)}" style="${nombre && pinLen === 0 ? 'border-color:var(--accent,#6C63FF)' : ''}"/></div>
    <div class="pg-field"><label>Código de acceso (4 a 6 dígitos)</label><input type="password" id="mk-pin" placeholder="••••" value="${'0'.repeat(pinLen)}"/></div>
    <div class="pg-field"><label>Módulos permitidos</label><div class="pg-mods-grid">${MODS.map(([i, l]) => `<label class="pg-mod-check ${checked.includes(l) ? 'pg-mod-checked' : ''}" data-l="${esc(l)}"><input type="checkbox" ${checked.includes(l) ? 'checked' : ''}/> ${i} ${esc(l)}</label>`).join('')}</div></div>
    <div class="pg-error"></div><div class="pg-btn-row"><button class="pg-btn pg-btn-ghost">Cancelar</button><button class="pg-btn pg-btn-primary" id="mk-guardar">Guardar</button></div>`;

  // ---------- dashboard helpers ----------
  function fillDashboard(nombre) {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
    set('kpi-ventas-dia', '<span class="currency-symbol">C$</span>12,450'); set('kpi-ventas-mes', '<span class="currency-symbol">C$</span>284,300');
    set('kpi-ganancia-mes', '<span class="currency-symbol">C$</span>96,820'); set('kpi-caja-disponible', '<span class="currency-symbol">C$</span>38,150');
    set('kpi-clientes', '214'); set('kpi-productos', '1,326');
    $$('.kpi-delta').forEach(d => { d.textContent = 'Hoy'; });
    const g = $('#greeting-text'); if (g) g.textContent = nombre ? `¡Buen día, ${nombre}! 👋` : '¡Buen día! 👋';
  }
  function restrictSidebar(on) {
    const allowed = new Set([...MARIA_MODS, 'Chat con Negocio360', 'Tutoriales', 'Nueva venta', 'Nuevo cliente']);
    $$('#sidebar .nav-item').forEach(it => { const l = (it.querySelector('.nav-label') || it).textContent.trim(); it.style.display = !on || allowed.has(l) ? '' : 'none'; });
    $$('#sidebar .nav-section-title').forEach(t => { const keep = /PRINCIPAL|ACCESOS/.test(t.textContent); t.style.display = !on || keep ? '' : 'none'; });
  }
  let sw;
  function switchBtn(show, nombre) {
    if (!sw) { sw = document.createElement('button'); sw.id = 'pg-switch-btn'; document.body.appendChild(sw); }
    sw.style.display = show ? 'flex' : 'none';
    if (show) sw.innerHTML = `<span class="pg-switch-avatar" style="background:${colorFor(nombre)}">${esc(nombre.charAt(0))}</span><span class="pg-switch-label">${esc(nombre)} · cambiar</span>`;
  }
  let kbd;
  function keypad(show, pressed) {
    if (!kbd) { kbd = document.createElement('div'); kbd.id = 'mk-kbd'; kbd.innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'].map(k => `<div data-k="${k}" class="${k === ',' || k === '⌫' ? 'fn' : ''}">${k}</div>`).join(''); document.body.appendChild(kbd); }
    kbd.style.display = show ? 'grid' : 'none';
    kbd.querySelectorAll('div').forEach(d => d.classList.toggle('on', d.dataset.k === pressed));
  }

  // ======================= SCENARIOS =======================
  const S = {};

  S['configuracion'] = u => {
    if (!S._cfgInit) {
      S._cfgInit = 1;
      const card = $('#mu-toggle').closest('.cfg-card'); const first = $('.cfg-card'); first.parentNode.insertBefore(card, first);
      $('#mu-toggle').disabled = false;
    }
    const on = u >= 4.6;
    $('#mu-toggle').checked = on;
    $('#mu-row-label').textContent = on ? 'Sistema multiusuario activado' : 'Sistema multiusuario desactivado';
    $('#mu-row-sub').textContent = on ? 'Al entrar se pedirá elegir un usuario (con PIN).' : 'Se entra directo al dashboard, sin selector de usuario.';
    pointer(u, [[0, [1000, 650]], [1.2, [1000, 650]], [4.4, '.cfg-switch-track']], [4.5]);
  };

  // desktop: create a user through the profile selector
  S['dashboard:crear'] = u => {
    if (!S._dc) { S._dc = 1; fillDashboard(); }
    let html, key;
    const nombre = typed('María', u, 7.6, 7), pin = clamp(Math.floor((u - 8.9) * 6), 0, 4);
    const checks = [[10.4, 'Dashboard'], [11.0, 'Ventas'], [11.6, 'Clientes'], [12.4, 'Caja / Pagos']].filter(c => u >= c[0] + 0.05).map(c => c[1]);
    const card = () => $('#pg-card');
    if (u < 2.3) { html = selector([]); key = 'sel0'; }
    else if (u < 5.0) { const d = clamp(Math.floor((u - 3.0) * 5), 0, 4); html = pinView('Admin', true, 'Se requiere el código de administrador', d); key = 'pinA' + d; }
    else if (u < 7.0) { html = gestion([]); key = 'g0'; }
    else if (u < 14.0) { html = form(nombre, pin, checks); key = 'f' + nombre + pin + checks.join(); }
    else if (u < 17.6) {
      const rows = [['María', MARIA_MODS.join(', ')]];
      if (u > 15.6) rows.push(['Carlos', 'Dashboard, Ventas, Clientes, Productos/Servicios']);
      if (u > 16.4) rows.push(['Bodega', 'Productos/Servicios, Compras']);
      html = gestion(rows, '✅ Usuario "María" creado correctamente'); key = 'g' + rows.length;
    } else { html = selector(['María', 'Carlos', 'Bodega']); key = 'sel3'; }
    overlay(html, key);
    // form scrolls down to reach "Guardar"
    if (u >= 7.0 && u < 14.0) card().scrollTop = ease(clamp((u - 12.7) / 0.6)) * 400; else card().scrollTop = 0;
    pointer(u, [[0, [900, 560]], [1.9, '#pg-add-tile'], [3.0, '#pg-add-tile'], [4.4, '#mk-entrar'], [5.6, '#mk-entrar'], [6.6, '#mk-nuevo'],
      [7.4, '#mk-nombre'], [8.7, '#mk-pin'], [10.4, '[data-l="Dashboard"]'], [11.0, '[data-l="Ventas"]'], [11.6, '[data-l="Clientes"]'], [12.4, '[data-l="Caja / Pagos"]'],
      [13.6, '#mk-guardar'], [15.0, [900, 640]]], [1.95, 4.45, 6.65, 7.45, 8.75, 10.4, 11.0, 11.6, 12.4, 13.65], u < 17.6);
  };

  // phone: login screen
  S['login'] = u => {
    const em = $('#email') || $('input[type="email"]'), pw = $('#password') || $('input[type="password"]');
    em.value = typed('minegocio@correo.com', u, 1.0, 16); pw.value = '•'.repeat(clamp(Math.floor((u - 2.5) * 10), 0, 8));
    em.style.borderColor = u > 0.9 && u < 2.4 ? '#2563eb' : ''; pw.style.borderColor = u > 2.4 && u < 3.6 ? '#2563eb' : '';
    const btn = $$('button').find(b => /Iniciar sesión/.test(b.textContent));
    if (btn) btn.style.filter = u > 3.9 && u < 4.3 ? 'brightness(.85)' : '';
    if (btn) btn.id = 'mk-login';
    pointer(u, [[0, em], [2.4, pw], [3.9, '#mk-login']], [0.8, 2.4, 3.9]);
  };

  // phone: choose profile + PIN, then restricted dashboard
  S['dashboard:celular'] = u => {
    if (!S._dp) { S._dp = 1; fillDashboard(); }
    let html = null, key = '';
    const digits = ['2', '5', '8', '0'], dt = [1.2, 1.7, 2.2, 2.7].map(x => x + 4.0);
    const nd = dt.filter(x => u >= x).length;
    if (u < 4.0) { html = selector(['María', 'Carlos', 'Bodega']); key = 's'; }
    else if (u < 8.8) { html = pinView('María', false, 'Ingresa tu código de acceso', nd); key = 'p' + nd; }
    overlay(html, key);
    const pressed = dt.map((x, i) => u >= x && u < x + 0.22 ? digits[i] : null).find(Boolean);
    keypad(u >= 4.4 && u < 7.4, pressed);
    fillDashboard(u >= 8.8 ? 'María' : null); restrictSidebar(u >= 8.8); switchBtn(u >= 8.8, 'María');
    const keyEl = k => () => kbd && kbd.querySelector(`[data-k="${k}"]`);
    pointer(u, [[0, '[data-n="María"]'], [2.6, '[data-n="María"]'], ...dt.map((x, i) => [x, kbd ? kbd.querySelector(`[data-k="${digits[i]}"]`) : [195, 700]]), [7.9, '#mk-entrar']],
      [2.6, ...dt, 7.9], u < 8.8);
  };

  // phone: restricted drawer menu
  S['dashboard:menu'] = u => {
    if (!S._dm) { S._dm = 1; fillDashboard('María'); restrictSidebar(true); }
    overlay(null);
    const open = u >= 2.4;
    $('#sidebar').classList.toggle('mobile-open', open); $('#sidebar-overlay').classList.toggle('active', open);
    switchBtn(true, 'María');
    pointer(u, [[0, '#sidebar-toggle'], [2.0, '#sidebar-toggle']], [2.0]);
  };
  // desktop: same restricted user
  S['dashboard:menudesk'] = u => {
    if (!S._dd) { S._dd = 1; fillDashboard('María'); restrictSidebar(true); switchBtn(true, 'María'); }
    overlay(null); pointer(u, [], [], false);
  };

  // desktop: action permissions inside Productos/Servicios
  S['productos'] = u => {
    if (!S._pr) {
      S._pr = 1;
      const m = $('#modalConfigInventario .modal-body');
      [...m.children].forEach(c => { if (c.id !== 'permisosInvSeccion') c.style.display = 'none'; });
      $('#modalConfigInventarioTitle').textContent = '🖼️ Configuración de inventario';
      const btn = $$('button').find(b => /Configuración de inventario/.test(b.textContent)); if (btn) btn.id = 'mk-cfginv';
      $('#modalConfigInventario .modal-footer').style.display = 'none';
    }
    const open = u >= 1.8;
    $('#modalConfigInventario').classList.toggle('open', open);
    const off = [[4.2, 'eliminar'], [5.0, 'importar'], [5.8, 'exportar']].filter(x => u >= x[0] + 0.05).map(x => x[1]);
    const saved = u >= 7.4;
    const ACC = [['crear', 'Crear productos y servicios', 'Botones "Nuevo producto", "Nuevo servicio" y "Nueva materia prima".'], ['editar', 'Editar', 'Cambiar datos, precios, costos y fotos de un producto o servicio (✏️).'], ['duplicar', 'Duplicar', 'Crear una copia de un producto (📋).'], ['eliminar', 'Eliminar', 'Borrar productos o servicios (🗑️).'], ['movimiento', 'Movimientos especiales', 'Mermas y bajas de existencia (📉).'], ['traslados', 'Mover o trasladar productos', 'Enviar stock a otra sucursal o bodega.'], ['importar', 'Importar desde Excel', 'Cargar o completar productos con un archivo.'], ['exportar', 'Exportar inventario', 'Descargar el inventario en Excel o PDF.'], ['combos', 'Combos y promociones', 'Crear, editar y eliminar combos y promociones.']];
    const k = off.join() + saved;
    const cont = $('#permisosInvSeccion'); cont.style.display = 'block';
    if (cont.dataset.k !== k) {
      cont.dataset.k = k;
      cont.innerHTML = `<style>.pi-box{margin-top:0;padding-top:0}.pi-tit{font-weight:700;font-size:14px;margin-bottom:4px}.pi-sub{font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.45}.pi-fila{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid var(--border,#e5e7eb);border-radius:10px;margin-bottom:6px}.pi-fila input{width:18px;height:18px;margin-top:2px;flex:none}.pi-et{font-size:13px;font-weight:600}.pi-ds{font-size:11.5px;color:var(--text-muted)}.pi-sel{width:100%;padding:9px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--bg-surface,#fff);color:var(--text-primary);font-size:13px;margin-bottom:10px}.pi-modo{display:flex;flex-direction:column;gap:6px;font-size:12.5px;margin-bottom:10px}.pi-modo label{display:flex;gap:8px;align-items:flex-start}.pi-acc{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}.pi-msg{font-size:12.5px}.pi-ok{color:#166534}</style>
      <div class="pi-box"><div class="pi-tit">🔐 Permisos de los usuarios en Productos/Servicios</div>
      <p class="pi-sub">Solo tú (administrador) ves esta opción. Elige qué puede hacer cada usuario. Los administradores nunca se bloquean.</p>
      <select class="pi-sel"><option>👤 Solo: Carlos</option></select>
      <div class="pi-modo"><label><input type="radio" name="m"><span>Igual que la configuración de todos los usuarios</span></label><label><input type="radio" name="m" checked><span>Personalizar para este usuario</span></label></div>
      ${ACC.map(a => `<label class="pi-fila" data-k="${a[0]}"><input type="checkbox" ${off.includes(a[0]) ? '' : 'checked'}><span><span class="pi-et">${a[1]}</span><br><span class="pi-ds">${a[2]}</span></span></label>`).join('')}
      <p class="pi-sub" style="margin-top:4px">✔ marcado = puede hacerlo · sin marcar = no puede (los botones se ocultan). Ver el inventario siempre está permitido.</p>
      <div class="pi-acc"><button class="btn btn-primary" id="piGuardar">Guardar permisos</button><span class="pi-msg ${saved ? 'pi-ok' : ''}">${saved ? '✅ Permisos guardados. Se aplican la próxima vez que el usuario abra Productos/Servicios.' : ''}</span></div></div>`;
    }
    const mb = $('#modalConfigInventario .modal-body'); if (mb) mb.scrollTop = ease(clamp((u - 3.0) / 0.8)) * 120 + ease(clamp((u - 6.2) / 0.6)) * 400;
    pointer(u, [[0, [700, 500]], [1.7, '#mk-cfginv'], [2.8, [640, 420]], [4.2, '[data-k="eliminar"] input'], [5.0, '[data-k="importar"] input'], [5.8, '[data-k="exportar"] input'], [7.3, '#piGuardar'], [9, '#piGuardar']], [1.75, 4.2, 5.0, 5.8, 7.35]);
  };

  // desktop: audit log
  S['auditoria'] = u => {
    if (!S._au) {
      S._au = 1;
      // keep only the movement history in view
      const hist = $('#aud-tbody').closest('.card, section, .aud-card, .table-card') || $('#aud-tbody').closest('div');
      let el = hist; while (el && el.parentElement && el.parentElement.id !== 'content' && el.parentElement.tagName !== 'MAIN') el = el.parentElement;
      if (el && el.parentElement) [...el.parentElement.children].forEach(c => { if (c !== el && c.tagName !== 'SCRIPT' && !/page-header|aud-header/.test(c.className) && !c.querySelector('h1')) c.style.display = 'none'; });
      const us = $('#aud-filtro-usuario'); us.innerHTML = '<option>Todos los usuarios</option><option>María</option>';
      const md = $('#aud-filtro-modulo'); md.innerHTML = '<option>Todos los módulos</option>';
    }
    const ROWS = [
      ['02/11/2026', '11:42', 'María', 'Ventas', 'vendió — Factura #1024 · C$ 850.00'],
      ['02/11/2026', '11:15', 'Carlos', 'Productos/Servicios', 'editó un producto/servicio — Arroz 1 lb'],
      ['02/11/2026', '10:58', 'María', 'Clientes', 'registró un cliente — Ana López'],
      ['02/11/2026', '10:31', 'Bodega', 'Compras', 'compró — Compra #208'],
      ['02/11/2026', '09:47', 'Admin', 'Gastos', 'registró un gasto — Pago de luz'],
      ['02/11/2026', '09:12', 'María', 'Ventas', 'vendió — Factura #1023 · C$ 1,240.00'],
    ];
    const filt = u >= 6.0;
    const shown = ROWS.filter((r, i) => u >= 1.0 + i * 0.35).filter(r => !filt || r[2] === 'María');
    const k = shown.length + '' + filt;
    const tb = $('#aud-tbody');
    if (tb.dataset.k !== k) {
      tb.dataset.k = k;
      tb.innerHTML = shown.map(r => `<tr><td>${r[0]}</td><td style="font-family:var(--font-mono);font-size:12.5px">${r[1]}</td><td style="font-weight:500">${r[2]}${r[2] === 'Admin' ? ' <span style="font-size:10px;color:var(--text-muted)">(admin)</span>' : ''}</td><td>${r[3]}</td><td style="font-size:13px;color:var(--text-secondary)">${r[4]}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-cell">—</td></tr>';
    }
    $('#aud-filtro-usuario').selectedIndex = filt ? 1 : 0;
    $('#aud-filtro-usuario').style.borderColor = filt ? '#5a5af4' : '';
    const info = $('#paginacion-info'); if (info) info.textContent = `1–${shown.length} de ${shown.length}`;
    pointer(u, [[0, [800, 600]], [5.4, '#aud-filtro-usuario'], [8, '#aud-filtro-usuario']], [5.5]);
  };

  // desktop: branch access
  S['sucursales'] = u => {
    if (!S._su) {
      S._su = 1;
      const tb = $$('tbody')[0];
      const row = (n, central) => `<tr><td style="font-weight:600">${central ? '🏠 ' : '🏬 '}${n}</td><td>${central ? '<span class="status-badge badge-activo">Central</span>' : '<span class="status-badge">Sucursal</span>'}</td><td>01/10/2026</td><td><span class="status-badge badge-activo">Activa</span></td><td class="td-actions"><div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">${central ? '<span style="font-size:11px;color:var(--text-muted);align-self:center;white-space:nowrap">Estás aquí</span>' : `<button class="btn-secondary" style="padding:6px 12px;font-size:12px;gap:5px">🔑 Entrar</button><button class="btn-secondary" ${n.includes('Norte') ? 'id="mk-acc"' : ''} style="padding:6px 12px;font-size:12px;gap:5px">👥 Accesos</button><button class="btn-icon btn-icon-danger">🗑️</button>`}</div></td></tr>`;
      tb.innerHTML = row('Mi Negocio — Central', 1) + row('Sucursal Norte') + row('Sucursal Sur');
      const tb2 = $$('tbody')[1]; if (tb2) tb2.innerHTML = '<tr><td colspan="4" class="empty-cell">Todavía no tienes ninguna bodega — "Nueva bodega" para crear la primera.</td></tr>';
      $('#acc-suc-title').textContent = 'Accesos — Sucursal Norte';
    }
    const open = u >= 1.9;
    const m = $('#modal-accesos-sucursal'); m.style.display = open ? 'flex' : 'none'; m.classList.toggle('modal-open', open);
    const carlos = u >= 4.05;
    const cm = [[4.8, 'Ventas'], [5.4, 'Productos/Servicios']].filter(x => u >= x[0] + 0.05).map(x => x[1]);
    const k = carlos + cm.join();
    const cont = $('#acc-suc-lista');
    if (cont.dataset.k !== k) {
      cont.dataset.k = k;
      const perf = (n, acc, sel) => `<div style="border:1px solid var(--border);border-radius:var(--radius-md);padding:12px 14px;margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13.5px;margin-bottom:${acc ? '10px' : '0'}"><input type="checkbox" id="mk-p-${n}" ${acc ? 'checked' : ''} style="width:16px;height:16px"/>${n} <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(restringido)</span></label>
        <div style="display:${acc ? 'grid' : 'none'};grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:6px;margin-left:24px">${MODS.map(([i, l]) => `<label style="display:flex;align-items:center;gap:6px;font-size:12.5px" data-p="${n}" data-l="${l}"><input type="checkbox" ${sel.includes(l) ? 'checked' : ''}/>${i} ${l}</label>`).join('')}</div></div>`;
      cont.innerHTML = perf('María', true, MARIA_MODS) + perf('Carlos', carlos, cm) + perf('Bodega', false, []);
    }
    const mbs = $('#modal-accesos-sucursal .modal-body'); if (mbs) mbs.scrollTop = ease(clamp((u - 3.2) / 0.6)) * 260;
    const save = $$('#modal-accesos-sucursal .modal-footer button').pop(); if (save) save.id = 'mk-save';
    pointer(u, [[0, [700, 520]], [1.8, '#mk-acc'], [4.0, '#mk-p-Carlos'], [4.8, '[data-p="Carlos"][data-l="Ventas"] input'], [5.4, '[data-p="Carlos"][data-l="Productos/Servicios"] input'], [6.8, '#mk-save'], [9, '#mk-save']], [1.85, 4.05, 4.85, 5.45, 6.85]);
  };

  // header placeholders that only fill from the database
  function fixLoading() { $$('body *').forEach(el => { if (el.children.length === 0 && /^Cargando(\.\.\.|…)$/.test(el.textContent.trim())) el.textContent = 'Mi Negocio'; }); }
  window.update = u => { fixLoading(); const f = S[PAGE + (V ? ':' + V : '')] || S[PAGE]; if (f) f(u); };
  window.mkReady = document.fonts.ready;
})();
