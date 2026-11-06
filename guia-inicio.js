/* =====================================================
   GUÍA DE INICIO OBLIGATORIA (solo la primera vez)
   -----------------------------------------------------
   Cuenta NUEVA, después de elegir usuario, poner su código y
   terminar la animación de bienvenida, el sistema la va guiando
   señalando el botón real que tiene que tocar:
     1) Caja / Pagos  -> poner el saldo inicial
     2) Productos/Servicios -> "+ Nuevo Producto" -> crear el primero
     3) Tutoriales -> explicación corta -> se desbloquea todo
   Mientras tanto, los demás módulos están bloqueados.

   CANDADOS
   - El paso de cada cuenta lo decide el SERVIDOR (guia_inicio_estado):
     solo avanza si el paso está hecho de verdad. No se puede saltar.
   - Cuentas existentes: no les aplica.
   - Solo el administrador hace la guía; los trabajadores no se bloquean.
   - Demostraciones: la guía sale en cada entrada; la caja se deja en 0
     (guia_demo_reiniciar_caja, con un movimiento de ajuste visible, no
     borra nada) y el saldo inicial tiene tope de 1,000,000.
   - Si algo falla (sin red, función no disponible) NO se bloquea nada.
===================================================== */
(function () {
  'use strict';
  if (window.__n360GuiaInicio) return;
  window.__n360GuiaInicio = true;

  const URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
  const TOPE_DEMO = 1000000;

  const archivo = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const EXCLUIDAS = ['', 'index.html', 'login.html', 'personalizacion.html', 'admin.html',
    'negocios-vinculados.html', 'restaurante-pedidos.html', 'catalogo360.html',
    'catalogo360-registro.html', 'bodega.html'];
  if (EXCLUIDAS.includes(archivo)) return;

  const ORDEN = ['caja', 'producto', 'tutoriales'];
  const PAGINA = { caja: 'caja.html', producto: 'productos.html', tutoriales: 'tutoriales.html' };
  // Páginas permitidas en cada paso (el resto te regresa al inicio, donde la guía te señala el camino)
  const PERMITIDAS = {
    caja:       ['dashboard.html', 'caja.html'],
    producto:   ['dashboard.html', 'caja.html', 'productos.html'],
    tutoriales: ['dashboard.html', 'caja.html', 'productos.html', 'tutoriales.html'],
  };

  let sb = null, uid = null, esDemo = false, paso = null;
  let reloj = null, sondeo = null, pausa = false, ultimaClave = '', ultimoObjetivo = null;

  const espera = ms => new Promise(r => setTimeout(r, ms));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const ssGet = k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function perfilActivo() {
    try {
      const p = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null');
      return p && p.authUserId === uid ? p : null;
    } catch (_) { return null; }
  }

  async function consultar(vistoTutoriales) {
    const { data, error } = await sb.rpc('guia_inicio_estado', { p_tutoriales_visto: !!vistoTutoriales });
    if (error) throw error;
    return data || { paso: 'listo' };
  }

  /* =============== estilos =============== */
  function estilos() {
    if (document.getElementById('gi-estilos')) return;
    const s = document.createElement('style');
    s.id = 'gi-estilos';
    s.textContent = `
      html.gi-activa #pp-card{display:none!important}
      #gi-anillo{position:fixed;z-index:99991;pointer-events:none;border:3px solid var(--accent,#5a5af4);border-radius:12px;
        transition:top .25s ease,left .25s ease,width .25s ease,height .25s ease,box-shadow .25s;display:none}
      #gi-anillo.gi-dim{box-shadow:0 0 0 9999px rgba(12,12,30,.45)}
      #gi-anillo::after{content:'';position:absolute;inset:-3px;border-radius:12px;border:3px solid var(--accent,#5a5af4);animation:giPulso 1.4s ease-out infinite}
      @keyframes giPulso{0%{opacity:.9;transform:scale(1)}100%{opacity:0;transform:scale(1.18)}}
      #gi-tip{position:fixed;z-index:99992;width:min(340px,calc(100vw - 24px));background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);
        border-radius:14px;box-shadow:0 14px 40px -6px rgba(10,10,40,.45);padding:14px 16px 14px;display:none;
        font-family:'DM Sans','Segoe UI',system-ui,sans-serif;border:1px solid var(--border,#e8e8ef);transition:top .25s ease,left .25s ease}
      #gi-tip .gi-fl{position:absolute;width:14px;height:14px;background:inherit;border:inherit;transform:rotate(45deg);left:var(--fx,30px)}
      #gi-tip.gi-abajo .gi-fl{top:-8px;border-right:0;border-bottom:0}
      #gi-tip.gi-arriba .gi-fl{bottom:-8px;border-left:0;border-top:0}
      #gi-tip.gi-libre .gi-fl{display:none}
      #gi-tip .gi-et{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--accent,#5a5af4);margin-bottom:4px}
      #gi-tip .gi-et i{flex:1;height:4px;border-radius:9px;background:var(--border,#e8e8ef);max-width:26px}
      #gi-tip .gi-et i.on{background:var(--accent,#5a5af4)} #gi-tip .gi-et i.ok{background:var(--accent-2,#22c55e)}
      #gi-tip b.gi-ti{display:block;font-size:15.5px;line-height:1.3;margin-bottom:4px}
      #gi-tip p{margin:0;font-size:13.5px;line-height:1.5;color:var(--text-secondary,#60607a)}
      #gi-tip.gi-comp{padding:10px 13px;width:min(290px,calc(100vw - 24px))}
      #gi-tip.gi-comp b.gi-ti{font-size:14px;margin-bottom:2px} #gi-tip.gi-comp p{font-size:12.5px;line-height:1.4}
      #gi-tip .gi-lk{margin-top:8px;font-size:11.5px;color:var(--text-muted,#9999b3)}
      #gi-tip .gi-bs{display:flex;gap:8px;margin-top:12px}
      .gi-btn{flex:1;min-height:44px;border:0;border-radius:10px;padding:10px 16px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;
        background:var(--accent,#5a5af4);color:#fff;-webkit-tap-highlight-color:transparent}
      .gi-btn:disabled{opacity:.6;cursor:default}
      #gi-tip.gi-sacude{animation:giSacude .4s}
      @keyframes giSacude{0%,100%{translate:0}25%{translate:-6px}75%{translate:6px}}
      #gi-modal{position:fixed;inset:0;z-index:99993;background:rgba(10,10,25,.55);display:flex;align-items:center;justify-content:center;padding:16px;
        font-family:'DM Sans','Segoe UI',system-ui,sans-serif;animation:giEntra .25s ease}
      @keyframes giEntra{from{opacity:0}to{opacity:1}}
      #gi-modal .gi-caja{background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);border-radius:20px;max-width:430px;width:100%;
        padding:26px 22px 22px;text-align:center;box-shadow:0 20px 60px -10px rgba(0,0,0,.45);max-height:calc(100vh - 32px);overflow:auto}
      #gi-modal .gi-ico{font-size:46px;line-height:1;margin-bottom:10px}
      #gi-modal h2{font-size:21px;font-weight:800;margin:0 0 8px}
      #gi-modal p{font-size:14.5px;color:var(--text-secondary,#60607a);line-height:1.55;margin:0 0 18px}
      #gi-modal ol{text-align:left;margin:0 0 18px;padding:0;list-style:none;display:grid;gap:8px}
      #gi-modal ol li{display:flex;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;background:var(--bg-surface-2,#f6f6fa);font-size:14px;font-weight:600}
      #gi-modal ol li span{flex:0 0 26px;height:26px;border-radius:50%;background:var(--accent,#5a5af4);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px}
      #gi-modal .gi-pts{display:flex;justify-content:center;gap:6px;margin:0 0 14px}
      #gi-modal .gi-pts i{width:30px;height:6px;border-radius:99px;background:var(--border,#e8e8ef)}
      #gi-modal .gi-pts i.ok{background:var(--accent-2,#22c55e)} #gi-modal .gi-pts i.on{background:var(--accent,#5a5af4)}
      #gi-modal .gi-btn{width:100%;font-size:15px;min-height:48px}
      @media (prefers-reduced-motion:reduce){#gi-anillo::after{animation:none}#gi-anillo,#gi-tip{transition:none}}
    `;
    document.head.appendChild(s);
  }

  /* =============== utilidades de pantalla =============== */
  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.right < 2 || r.bottom < 2 || r.left > vw - 2 || r.top > vh - 2) return false;
    const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const enc = document.elementFromPoint(cx, cy);
    if (!enc) return false;
    return enc === el || el.contains(enc) || enc.closest('#gi-tip') !== null;
  }

  // Enlace del menú lateral hacia una página (ej. 'caja.html'), el más visible.
  function enlaceMenu(pag) {
    const sel = `[onclick*="'${pag}'"], [onclick*="\\"${pag}\\""], a[href="${pag}"]`;
    const lista = Array.from(document.querySelectorAll(sel))
      .filter(el => el.closest('#sidebar, .sidebar, aside, nav'));
    return lista.find(visible) || lista[0] || null;
  }
  function botonMenu() {
    const lista = Array.from(document.querySelectorAll('#sidebar-toggle, #menuToggle, [onclick="toggleSidebar()"], .header-toggle, .menu-toggle'));
    return lista.find(visible) || null;
  }
  function modalAbierto(id, clase) {
    const m = document.getElementById(id);
    return !!(m && m.classList.contains(clase));
  }
  function hayCapaEncima() {
    return !!(document.getElementById('n360-welcome') || document.getElementById('pg-overlay') || document.getElementById('gi-modal'));
  }

  function etiqueta(n) {
    return `<div class="gi-et">Paso ${n} de 3 ${[1, 2, 3].map(i => `<i class="${i < n ? 'ok' : i === n ? 'on' : ''}"></i>`).join('')}</div>`;
  }

  /* =============== qué señalar ahora =============== */
  // Devuelve { objetivo, titulo, texto, botones, dim, arriba }
  function queSenalar() {
    const n = ORDEN.indexOf(paso) + 1;
    const irMenu = (pag, titulo, texto) => {
      const link = enlaceMenu(pag);
      if (link && visible(link)) return { objetivo: link, titulo, texto, dim: true };
      const ham = botonMenu();
      if (ham) return { objetivo: ham, titulo: 'Abre el menú', texto: 'Toca aquí para abrir el menú de módulos.', dim: true };
      if (link && link.offsetParent && link !== ultimoObjetivo) { ultimoObjetivo = link; try { link.scrollIntoView({ block: 'center' }); } catch (_) {} }
      return { objetivo: link, titulo, texto, dim: true };
    };

    if (paso === 'caja') {
      if (archivo !== 'caja.html') {
        return irMenu('caja.html', 'Toca aquí: Caja / Pagos',
          'Ahí vas a poner el dinero con el que empieza tu negocio.');
      }
      if (modalAbierto('modal-capital-inicial', 'modal-open')) {
        const inp = document.getElementById('capital-inicial-monto');
        const btn = document.getElementById('btn-guardar-capital-inicial');
        if (inp && esDemo) { inp.max = String(TOPE_DEMO); }
        const vacio = !inp || String(inp.value).trim() === '';
        if (vacio && visible(inp)) {
          return { objetivo: inp, titulo: 'Escribe tu saldo inicial',
            texto: 'Cuánto efectivo tienes hoy en el negocio. Si no tienes, pon 0.' + (esDemo ? ' En la demostración, máximo 1,000,000.' : ''), dim: false };
        }
        if (!vacio && btn && visible(btn)) {
          return { objetivo: btn, titulo: 'Ahora toca aquí', texto: 'Para guardar tu saldo inicial.', dim: false };
        }
        return null;
      }
      // La ventana no está abierta (demo, o la cerraron): botón para abrirla.
      return { objetivo: null, titulo: 'Pon tu saldo inicial de caja',
        texto: 'Tu caja está en 0. Escribe con cuánto efectivo empieza tu negocio.',
        botones: [{ txt: 'Poner mi saldo inicial', fn: () => { try { openModal('modal-capital-inicial'); } catch (_) {} } }] };
    }

    if (paso === 'producto') {
      if (archivo !== 'productos.html') {
        return irMenu('productos.html', 'Toca aquí: Productos/Servicios',
          'Aquí está tu inventario: todo lo que vendes.');
      }
      if (modalAbierto('modalProducto', 'open')) {
        const btn = document.getElementById('btnGuardarProducto');
        if (btn && visible(btn)) {
          return { objetivo: btn, titulo: 'Llena los datos y toca aquí',
            texto: 'Nombre, precio, costo y cuántos tienes. Luego toca aquí.', dim: false };
        }
        return { objetivo: null, arriba: true, titulo: 'Llena los datos del producto',
          texto: 'Nombre, precio de venta, costo y cuántos tienes. Al final toca el botón de crear.' };
      }
      const nuevo = document.getElementById('btnNuevoProducto');
      if (nuevo && visible(nuevo)) {
        return { objetivo: nuevo, titulo: 'Toca aquí: + Nuevo Producto', texto: 'Para agregar tu primer producto al inventario.', dim: true };
      }
      return { objetivo: null, titulo: 'Agrega tu primer producto', texto: 'Busca el botón "+ Nuevo Producto" arriba de la lista.' };
    }

    if (paso === 'tutoriales') {
      if (archivo !== 'tutoriales.html') {
        return irMenu('tutoriales.html', 'Por último, toca aquí: Tutoriales',
          'Ahí están los videos de ayuda de cada módulo.');
      }
      return null; // en tutoriales se muestra la ventana final
    }
    return null;
  }

  /* =============== dibujar anillo + globo =============== */
  function capas() {
    estilos();
    let a = document.getElementById('gi-anillo');
    if (!a) { a = document.createElement('div'); a.id = 'gi-anillo'; document.body.appendChild(a); }
    let t = document.getElementById('gi-tip');
    if (!t) { t = document.createElement('div'); t.id = 'gi-tip'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    return [a, t];
  }
  function ocultarCapas() {
    const a = document.getElementById('gi-anillo'), t = document.getElementById('gi-tip');
    if (a) a.style.display = 'none';
    if (t) t.style.display = 'none';
    ultimaClave = '';
  }

  function dibujar() {
    if (pausa || !paso || hayCapaEncima()) { ocultarCapas(); return; }
    const s = queSenalar();
    if (!s) { ocultarCapas(); return; }
    const [a, t] = capas();
    const n = ORDEN.indexOf(paso) + 1;

    // Dentro de un formulario (dim=false) el globo es compacto para no tapar los campos.
    const compacto = s.dim === false || (s.arriba && window.innerWidth < 600);
    const clave = paso + '|' + s.titulo + '|' + s.texto + '|' + compacto;
    if (clave !== ultimaClave) {
      ultimaClave = clave;
      t.innerHTML = `<span class="gi-fl"></span>${compacto ? '' : etiqueta(n)}<b class="gi-ti">${esc(s.titulo)}</b><p>${esc(s.texto)}</p>
        ${s.botones ? '<div class="gi-bs"></div>' : ''}
        ${compacto ? '' : '<div class="gi-lk">🔒 Los demás módulos se abren al terminar estos 3 pasos.</div>'}`;
      t.classList.toggle('gi-comp', compacto);
      if (s.botones) {
        const cont = t.querySelector('.gi-bs');
        s.botones.forEach(b => { const e = document.createElement('button'); e.type = 'button'; e.className = 'gi-btn'; e.textContent = b.txt; e.onclick = b.fn; cont.appendChild(e); });
      }
    }
    t.style.display = 'block';
    const vw = window.innerWidth, vh = window.innerHeight, M = 12;
    const tw = t.offsetWidth, th = t.offsetHeight;

    if (s.objetivo && visible(s.objetivo)) {
      if (s.objetivo !== ultimoObjetivo) {
        ultimoObjetivo = s.objetivo;
        try { s.objetivo.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
      }
      const r = s.objetivo.getBoundingClientRect();
      const P = 5;
      a.style.display = 'block';
      a.classList.toggle('gi-dim', !!s.dim);
      a.style.top = (r.top - P) + 'px'; a.style.left = (r.left - P) + 'px';
      a.style.width = (r.width + P * 2) + 'px'; a.style.height = (r.height + P * 2) + 'px';
      let left = Math.min(vw - tw - M, Math.max(M, r.left + r.width / 2 - tw / 2));
      // Si el objetivo está en una columna angosta (menú lateral en PC), el globo va a su derecha.
      let top, cls;
      if (r.bottom + 14 + th <= vh - M) { top = r.bottom + 14; cls = 'gi-abajo'; }
      else if (r.top - 14 - th >= M) { top = r.top - 14 - th; cls = 'gi-arriba'; }
      else if (r.right + 14 + tw <= vw - M) { top = Math.max(M, Math.min(vh - th - M, r.top)); left = r.right + 14; cls = 'gi-libre'; }
      else { top = vh - th - M; cls = 'gi-libre'; }
      t.className = cls + (compacto ? ' gi-comp' : '');
      t.style.top = top + 'px'; t.style.left = left + 'px';
      t.style.setProperty('--fx', Math.max(14, Math.min(tw - 28, r.left + r.width / 2 - left - 7)) + 'px');
    } else {
      ultimoObjetivo = null;
      a.style.display = 'none';
      t.className = 'gi-libre' + (compacto ? ' gi-comp' : '');
      t.style.left = Math.max(M, (vw - tw) / 2) + 'px';
      t.style.top = (s.arriba ? M : vh - th - M - 4) + 'px';
    }
  }

  function sacudir() {
    const t = document.getElementById('gi-tip');
    if (!t) return;
    t.classList.remove('gi-sacude'); void t.offsetWidth; t.classList.add('gi-sacude');
  }

  /* =============== ventanas (inicio / avance / final) =============== */
  function ventana(html, txtBoton, fn) {
    estilos();
    const viejo = document.getElementById('gi-modal'); if (viejo) viejo.remove();
    const m = document.createElement('div');
    m.id = 'gi-modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="gi-caja">${html}<button type="button" class="gi-btn">${esc(txtBoton)}</button></div>`;
    const b = m.querySelector('.gi-btn');
    b.onclick = async () => { b.disabled = true; try { await fn(b); } finally { if (b.isConnected) b.disabled = false; } };
    document.body.appendChild(m);
    setTimeout(() => { try { b.focus(); } catch (_) {} }, 50);
  }
  const cerrarVentana = () => { const m = document.getElementById('gi-modal'); if (m) m.remove(); };
  const puntos = n => `<div class="gi-pts">${[1, 2, 3].map(i => `<i class="${i < n ? 'ok' : i === n ? 'on' : ''}"></i>`).join('')}</div>`;

  function ventanaInicio() {
    ventana(`<div class="gi-ico">👋</div><h2>¡Bienvenido a Negocio360!</h2>
      <p>Vamos a dejar tu negocio listo en 3 pasos. Te voy señalando dónde tocar.</p>
      <ol><li><span>1</span>Tu saldo inicial de caja</li><li><span>2</span>Tu primer producto</li><li><span>3</span>Dónde están los tutoriales</li></ol>`,
      'Empezar', () => { ssSet('n360_guia_intro_' + uid, '1'); cerrarVentana(); });
  }

  function ventanaFinal() {
    ventana(`<div class="gi-ico">🎓</div>${puntos(3)}<h2>Aquí están los Tutoriales</h2>
      <p>Cuando tengas una duda de cualquier módulo, entra aquí desde el menú (<b>🎓 Tutoriales</b>) y mira el video de ese módulo. No tienes que verlos ahora.</p>`,
      'Entendido, desbloquear todo', async (b) => {
        b.textContent = 'Un momento…';
        if (esDemo) { ssSet('n360_guia_demo_' + uid, 'listo'); paso = 'listo'; }
        else {
          try { const r = await consultar(true); paso = r.paso; } catch (_) {}
          if (paso !== 'listo') { b.textContent = 'Reintentar'; return; }
          lsSet('n360_guia_listo_' + uid, '1');
        }
        terminar();
      });
  }

  function terminar() {
    detener();
    document.documentElement.classList.remove('gi-activa');
    ventana(`<div class="gi-ico">🎉</div>${puntos(4)}<h2>¡Todo listo!</h2>
      <p>Ya se desbloquearon todos los módulos. Lo siguiente: registrar tu primera venta en <b>Ventas</b>.</p>`,
      'Empezar a usar Negocio360', () => { cerrarVentana(); location.href = 'dashboard.html'; });
  }

  function avanzar(anterior, nuevo) {
    paso = nuevo;
    if (esDemo) ssSet('n360_guia_demo_' + uid, nuevo);
    if (nuevo === 'listo') { lsSet('n360_guia_listo_' + uid, '1'); return terminar(); }
    const msg = anterior === 'caja'
      ? ['✅', '¡Muy bien!', 'Tu caja ya tiene su saldo inicial. Ahora vamos a cargar tu inventario.']
      : ['📦', '¡Excelente!', 'Ya tienes tu primer producto. Falta un último paso.'];
    ventana(`<div class="gi-ico">${msg[0]}</div>${puntos(ORDEN.indexOf(nuevo) + 1)}<h2>${msg[1]}</h2><p>${msg[2]}</p>`,
      'Continuar', () => { cerrarVentana(); arrancarSondeo(); });
  }

  async function revisar() {
    if (esDemo || !paso || paso === 'listo') return;
    try {
      const r = await consultar(false);
      if (r.paso && r.paso !== paso && (r.paso === 'listo' || ORDEN.indexOf(r.paso) > ORDEN.indexOf(paso))) {
        avanzar(paso, r.paso);
      }
    } catch (_) {}
  }

  function arrancarSondeo() {
    clearInterval(sondeo); sondeo = null;
    if (paso === 'tutoriales' && archivo === 'tutoriales.html') { ventanaFinal(); return; }
    if (esDemo) return;
    if (archivo === PAGINA[paso]) {
      sondeo = setInterval(() => { if (!document.hidden && !document.getElementById('gi-modal')) revisar(); }, 4000);
    }
  }

  function detener() {
    clearInterval(reloj); clearInterval(sondeo); reloj = sondeo = null;
    ocultarCapas();
  }

  /* =============== candado de navegación =============== */
  function destinoDe(el) {
    const n = el.closest('[onclick], a[href]');
    if (!n) return null;
    const txt = (n.getAttribute('href') || '') + ' ' + (n.getAttribute('onclick') || '');
    const m = txt.match(/([a-z0-9_-]+\.html)/i);
    return m ? m[1].toLowerCase() : null;
  }
  function candadoClicks(ev) {
    if (!paso || paso === 'listo' || ev.target.closest('#gi-tip, #gi-modal')) return;
    const dest = destinoDe(ev.target);
    if (!dest || dest === archivo || dest === 'login.html' || dest === 'index.html') return;
    if (dest === PAGINA[paso] || dest === 'dashboard.html') return;
    ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
    sacudir();
  }

  /* =============== eventos de guardado (aviso inmediato) =============== */
  function ganchos() {
    document.addEventListener('click', (ev) => {
      if (!paso) return;
      // Tope de demostración en el saldo inicial
      if (esDemo && ev.target.closest('#btn-guardar-capital-inicial')) {
        const inp = document.getElementById('capital-inicial-monto');
        const v = parseFloat(inp && inp.value);
        if (!isNaN(v) && v > TOPE_DEMO) {
          ev.preventDefault(); ev.stopImmediatePropagation();
          try { showToast('En la demostración el saldo inicial máximo es 1,000,000', 'error'); } catch (_) { alert('Máximo 1,000,000 en la demostración'); }
          return;
        }
      }
      if (paso === 'caja' && ev.target.closest('#btn-guardar-capital-inicial')) {
        const ver = async () => {
          if (modalAbierto('modal-capital-inicial', 'modal-open')) return false;
          if (esDemo) { avanzar('caja', 'producto'); return true; }
          await revisar(); return paso !== 'caja';
        };
        setTimeout(async () => { if (!(await ver())) setTimeout(ver, 2500); }, 1200);
      }
      if (paso === 'producto' && ev.target.closest('#btnGuardarProducto')) {
        const ver = async () => {
          if (modalAbierto('modalProducto', 'open')) return false;
          if (esDemo) { avanzar('producto', 'tutoriales'); return true; }
          await revisar(); return paso !== 'producto';
        };
        setTimeout(async () => { if (!(await ver())) setTimeout(ver, 2500); }, 1500);
      }
    }, true);
  }

  async function abrirSaldoInicialSolo() {
    for (let i = 0; i < 40; i++) {           // hasta ~10 s a que Caja termine de cargar
      await espera(250);
      if (paso !== 'caja') return;
      if (modalAbierto('modal-capital-inicial', 'modal-open')) return; // Caja ya la abrió
      if (typeof window.openModal === 'function' && document.getElementById('modal-capital-inicial') && i >= 4) {
        if (document.querySelector('.modal-overlay.modal-open')) continue; // otra ventana abierta: esperar
        try {
          const inp = document.getElementById('capital-inicial-monto');
          if (inp) { inp.value = ''; if (esDemo) inp.max = String(TOPE_DEMO); }
          window.openModal('modal-capital-inicial');
          setTimeout(() => { try { inp && inp.focus(); } catch (_) {} }, 200);
        } catch (_) {}
        return;
      }
    }
  }

  /* =============== esperar animación + pantalla de código =============== */
  function animacionPendiente() {
    // En las pantallas de entrada la animación marca esta clave al empezar.
    if (archivo !== 'dashboard.html') return false;
    if (!window.__giT0) window.__giT0 = Date.now();
    if (Date.now() - window.__giT0 > 15000) return false; // si la animación no corre, no esperar para siempre
    return ssGet('n360_welcome_visto_' + uid) !== '1' && ssGet('n360_welcome_visto') !== '1';
  }
  async function esperarAnimacionYCodigo() {
    let quietos = 0;
    for (let i = 0; i < 400 && quietos < 3; i++) {
      await espera(250);
      const ocupado = animacionPendiente() || document.getElementById('n360-welcome') || document.getElementById('pg-overlay');
      quietos = ocupado ? 0 : quietos + 1;
    }
  }

  /* =============== arranque =============== */
  async function iniciar() {
    for (let i = 0; i < 50 && !window.supabase; i++) await espera(100);
    if (!window.supabase) return;
    sb = window.supabase.createClient(URL_SB, KEY_SB);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    uid = session.user.id;
    if (lsGet('n360_guia_listo_' + uid) === '1') return;

    let r;
    try { r = await consultar(false); } catch (_) { return; }
    if (r.paso === 'listo') { lsSet('n360_guia_listo_' + uid, '1'); return; }
    if (r.paso === 'espera') return;
    if (r.paso === 'demo') {
      esDemo = true;
      paso = ssGet('n360_guia_demo_' + uid) || 'caja';
      if (paso === 'listo') return;
    } else {
      paso = r.paso;
    }
    if (!ORDEN.includes(paso)) return;

    // 1) Esperar a que elija usuario y ponga su código (si usa multiusuario)
    if (r.multiusuario !== false) {
      for (let i = 0; i < 1800 && !perfilActivo(); i++) await espera(700);
      const p = perfilActivo();
      if (!p || p.tipo !== 'admin') return;
    }
    if (window.N360VerComo && window.N360VerComo.activo) return;

    // 2) Página no permitida en este paso -> al inicio (ahí la guía señala el camino)
    if (!PERMITIDAS[paso].includes(archivo)) { location.replace('dashboard.html'); return; }

    // 3) Orden: animación del logo -> usuario y código -> recién ahí la guía.
    await esperarAnimacionYCodigo();

    document.documentElement.classList.add('gi-activa');
    document.addEventListener('click', candadoClicks, true);
    ganchos();

    // 4) Demostración: la caja vuelve a 0 para este visitante (una vez por entrada)
    if (esDemo && paso === 'caja' && ssGet('n360_guia_demo_caja_' + uid) !== '1') {
      try {
        const { data } = await sb.rpc('guia_demo_reiniciar_caja');
        if (data && data.ok) {
          ssSet('n360_guia_demo_caja_' + uid, '1');
          if (archivo === 'caja.html' && typeof window.loadCaja === 'function') {
            try { await window.loadCaja(); if (typeof window.loadResumen === 'function') await window.loadResumen(); } catch (_) {}
          }
        }
      } catch (_) {}
    }

    if (paso === 'caja' && archivo === 'dashboard.html' && ssGet('n360_guia_intro_' + uid) !== '1') {
      await esperarAnimacionYCodigo();
      ventanaInicio();
    }
    // En Caja la ventana de saldo inicial sale sola (como en una cuenta real), también en demostración.
    if (paso === 'caja' && archivo === 'caja.html') abrirSaldoInicialSolo();
    arrancarSondeo();
    reloj = setInterval(dibujar, 300);
    window.addEventListener('resize', dibujar);
    dibujar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => iniciar());
  else iniciar();
})();
