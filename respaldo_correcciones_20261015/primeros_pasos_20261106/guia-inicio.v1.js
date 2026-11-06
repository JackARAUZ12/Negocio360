/* =====================================================
   GUÍA DE INICIO OBLIGATORIA (solo la primera vez)
   -----------------------------------------------------
   Cuenta NUEVA, después de elegir usuario y poner su código:
     1) Caja: poner el dinero inicial
     2) Productos/Servicios: crear el primer producto
     3) Tutoriales: explicación corta de dónde están
   Hasta terminar, los demás módulos quedan bloqueados (te regresa
   al paso que toca). Al terminar se desbloquea todo para siempre.

   CANDADOS
   - Quién está en qué paso lo decide el SERVIDOR (guia_inicio_estado):
     solo avanza si el paso está hecho de verdad (hay movimiento de
     caja / hay producto). El navegador no puede saltárselo.
   - Cuentas existentes: no les aplica (el servidor responde "listo").
   - Solo el administrador hace la guía; los trabajadores no se bloquean.
   - Cuentas de demostración: misma guía en cada sesión, pero sin
     obligar a guardar datos (botón "Siguiente"), así no se ensucian.
   - Si algo falla (sin red, función no disponible) NO se bloquea nada.
   - Modo "Ver como cliente" (solo lectura): no aplica.
===================================================== */
(function () {
  'use strict';
  if (window.__n360GuiaInicio) return;
  window.__n360GuiaInicio = true;

  const URL_SB = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const KEY_SB = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  const archivo = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  // Páginas donde la guía nunca actúa (entrada, registro, kiosko, panel del dueño del sistema...)
  const EXCLUIDAS = ['', 'index.html', 'login.html', 'personalizacion.html', 'admin.html',
    'negocios-vinculados.html', 'restaurante-pedidos.html', 'catalogo360.html',
    'catalogo360-registro.html', 'bodega.html'];
  if (EXCLUIDAS.includes(archivo)) return;

  const PASOS = {
    caja:       { n: 1, pagina: 'caja.html',       titulo: 'Pon tu dinero inicial de caja',
                  texto: 'Escribe cuánto efectivo tienes hoy en el negocio (si no tienes, pon 0). Así la caja cuadra desde el primer día.' },
    producto:   { n: 2, pagina: 'productos.html',  titulo: 'Crea tu primer producto',
                  texto: 'Aquí está tu inventario. Agrega un producto (o servicio) con su precio, costo y cuántos tienes.' },
    tutoriales: { n: 3, pagina: 'tutoriales.html', titulo: 'Tutoriales',
                  texto: '' },
  };
  const SIGUIENTE = { caja: 'producto', producto: 'tutoriales', tutoriales: 'listo' };
  const NOMBRE_PAG = { 'caja.html': 'Caja', 'productos.html': 'Productos/Servicios', 'tutoriales.html': 'Tutoriales' };

  let sb = null, uid = null, esDemo = false, paso = null, sondeo = null;

  const espera = ms => new Promise(r => setTimeout(r, ms));
  const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const ssGet = k => { try { return sessionStorage.getItem(k); } catch (_) { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, v); } catch (_) {} };

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

  /* ---------------- estilos ---------------- */
  function estilos() {
    if (document.getElementById('gi-estilos')) return;
    const s = document.createElement('style');
    s.id = 'gi-estilos';
    s.textContent = `
      #gi-barra{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:400;width:min(640px,calc(100% - 32px));
        background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);border:2px solid var(--accent,#5a5af4);border-radius:16px;
        box-shadow:0 12px 40px -8px rgba(20,20,60,.35);padding:14px 16px;display:flex;gap:14px;align-items:center;font-family:inherit}
      #gi-barra .gi-n{flex:0 0 40px;height:40px;border-radius:50%;background:var(--accent,#5a5af4);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px}
      #gi-barra .gi-t{flex:1;min-width:0}
      #gi-barra .gi-paso{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--accent,#5a5af4)}
      #gi-barra b{display:block;font-size:15px;margin:1px 0 2px}
      #gi-barra span{display:block;font-size:12.5px;color:var(--text-secondary,#60607a);line-height:1.4}
      #gi-barra .gi-lock{font-size:11.5px;color:var(--text-muted,#9999b3);margin-top:4px}
      #gi-barra .gi-acc{display:flex;flex-direction:column;gap:6px}
      .gi-btn{border:0;border-radius:10px;padding:10px 16px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer;background:var(--accent,#5a5af4);color:#fff;white-space:nowrap}
      .gi-btn.gi-sec{background:transparent;color:var(--text-secondary,#60607a);border:1px solid var(--border,#e8e8ef);font-weight:600;padding:8px 14px}
      #gi-modal{position:fixed;inset:0;z-index:100000;background:rgba(10,10,25,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:'DM Sans','Segoe UI',system-ui,sans-serif}
      #gi-modal .gi-caja{background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);border-radius:20px;max-width:440px;width:100%;padding:28px 24px;text-align:center;box-shadow:0 20px 60px -10px rgba(0,0,0,.4)}
      #gi-modal .gi-ico{font-size:44px;margin-bottom:6px}
      #gi-modal h2{font-size:20px;font-weight:800;margin:0 0 8px}
      #gi-modal p{font-size:14px;color:var(--text-secondary,#60607a);line-height:1.55;margin:0 0 18px}
      #gi-modal .gi-pasos{display:flex;justify-content:center;gap:8px;margin:0 0 16px}
      #gi-modal .gi-pasos i{width:34px;height:6px;border-radius:99px;background:var(--border,#e8e8ef)}
      #gi-modal .gi-pasos i.on{background:var(--accent,#5a5af4)}
      #gi-modal .gi-pasos i.ok{background:var(--accent-2,#22c55e)}
      #gi-modal .gi-btn{width:100%;padding:13px;font-size:15px}
      @media (max-width:640px){#gi-barra{flex-wrap:wrap;bottom:10px;padding:12px}#gi-barra .gi-acc{flex-direction:row;width:100%}#gi-barra .gi-acc .gi-btn{flex:1}}
    `;
    document.head.appendChild(s);
  }

  function puntos(n) {
    return '<div class="gi-pasos">' + [1, 2, 3].map(i => `<i class="${i < n ? 'ok' : i === n ? 'on' : ''}"></i>`).join('') + '</div>';
  }

  function modal(html, botones) {
    estilos();
    let m = document.getElementById('gi-modal');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'gi-modal';
    m.innerHTML = `<div class="gi-caja">${html}<div id="gi-modal-btns"></div></div>`;
    const cont = m.querySelector('#gi-modal-btns');
    botones.forEach(b => {
      const e = document.createElement('button');
      e.type = 'button'; e.className = 'gi-btn' + (b.sec ? ' gi-sec' : ''); e.textContent = b.txt;
      if (b.sec) e.style.marginTop = '8px';
      e.onclick = b.fn; cont.appendChild(e);
    });
    document.body.appendChild(m);
    return m;
  }

  function barra(p, botones) {
    estilos();
    let b = document.getElementById('gi-barra');
    if (b) b.remove();
    b = document.createElement('div');
    b.id = 'gi-barra';
    b.innerHTML = `<div class="gi-n">${p.n}</div>
      <div class="gi-t"><div class="gi-paso">Primeros pasos · Paso ${p.n} de 3</div><b>${p.titulo}</b><span>${p.texto}</span>
      <div class="gi-lock">🔒 Los demás módulos se desbloquean al terminar estos pasos.</div></div>
      <div class="gi-acc"></div>`;
    const acc = b.querySelector('.gi-acc');
    botones.forEach(x => {
      const e = document.createElement('button');
      e.type = 'button'; e.className = 'gi-btn' + (x.sec ? ' gi-sec' : ''); e.textContent = x.txt; e.onclick = x.fn;
      acc.appendChild(e);
    });
    document.body.appendChild(b);
  }

  /* ---------------- avance ---------------- */
  function guardarDemo(nuevo) { ssSet('n360_guia_demo_' + uid, nuevo); }

  function irA(pagina) { location.href = pagina; }

  // Se llama cuando el servidor (o el botón "Siguiente" en demo) confirma que el paso quedó hecho.
  function pasoCompletado(anterior) {
    clearInterval(sondeo); sondeo = null;
    const sig = SIGUIENTE[anterior];
    const b = document.getElementById('gi-barra'); if (b) b.remove();
    if (sig === 'listo') return terminado();
    const p = PASOS[sig];
    modal(`<div class="gi-ico">✅</div>${puntos(p.n)}<h2>¡Muy bien!</h2>
      <p>${anterior === 'caja' ? 'Tu caja ya tiene su dinero inicial.' : 'Ya tienes tu primer producto.'}<br>
      Ahora vamos a <b>${NOMBRE_PAG[p.pagina]}</b>.</p>`,
      [{ txt: `Ir a ${NOMBRE_PAG[p.pagina]} →`, fn: () => irA(p.pagina + (sig === 'producto' ? '?nuevo=1' : '')) }]);
  }

  function terminado() {
    if (esDemo) guardarDemo('listo'); else lsSet('n360_guia_listo_' + uid, '1');
    modal(`<div class="gi-ico">🎉</div>${puntos(4)}<h2>¡Todo listo!</h2>
      <p>Ya se desbloquearon todos los módulos. Empieza registrando tu primera venta.</p>`,
      [{ txt: 'Ir al inicio', fn: () => irA('dashboard.html') }]);
  }

  async function revisar(vistoTutoriales) {
    if (esDemo) return;
    try {
      const r = await consultar(vistoTutoriales);
      if (r.paso !== paso) {
        const anterior = paso;
        paso = r.paso;
        if (anterior === 'tutoriales' && r.paso === 'listo') return terminado();
        if (PASOS[anterior]) pasoCompletado(anterior);
      }
    } catch (_) {}
  }

  function vigilar() {
    if (esDemo || sondeo) return;
    sondeo = setInterval(() => { if (!document.hidden) revisar(false); }, 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && sondeo) revisar(false); });
  }

  /* ---------------- pantallas por paso ---------------- */
  function mostrarPaso() {
    const p = PASOS[paso];
    if (!p) return;

    // Cualquier otra página (menos el dashboard en el paso 1) -> te regresa al paso que toca.
    if (archivo !== p.pagina && !(archivo === 'dashboard.html' && paso === 'caja')) {
      location.replace(p.pagina + (paso === 'producto' ? '?nuevo=1' : ''));
      return;
    }

    if (archivo === 'dashboard.html') {
      modal(`<div class="gi-ico">👋</div>${puntos(1)}<h2>¡Bienvenido a Negocio360!</h2>
        <p>Vamos a dejar tu negocio listo en <b>3 pasos rápidos</b>:<br>
        1) tu dinero inicial de caja, 2) tu primer producto y 3) dónde ver los tutoriales.</p>`,
        [{ txt: 'Empezar: ir a Caja →', fn: () => irA('caja.html') }]);
      return;
    }

    if (paso === 'caja') {
      const abrir = () => { try { if (typeof openModal === 'function' && document.getElementById('modal-capital-inicial')) openModal('modal-capital-inicial'); } catch (_) {} };
      if (esDemo) {
        barra({ ...p, texto: 'Aquí escribes cuánto efectivo tienes hoy en el negocio. En esta demostración ya está puesto.' },
          [{ txt: 'Siguiente →', fn: () => { guardarDemo('producto'); pasoCompletado('caja'); } }]);
        return;
      }
      barra(p, [{ txt: 'Poner dinero inicial', fn: abrir }]);
      setTimeout(() => { const m = document.getElementById('modal-capital-inicial'); if (m && !m.classList.contains('modal-open')) abrir(); }, 1200);
      // Apenas se guarda, se revisa sin esperar al sondeo.
      if (typeof window.guardarCapitalInicialModal === 'function') {
        const orig = window.guardarCapitalInicialModal;
        window.guardarCapitalInicialModal = async function () { const r = await orig.apply(this, arguments); setTimeout(() => revisar(false), 300); return r; };
      }
      vigilar();
      return;
    }

    if (paso === 'producto') {
      const abrir = () => { try { if (typeof abrirModalNuevo === 'function') abrirModalNuevo('producto'); } catch (_) {} };
      const btns = [{ txt: '+ Crear producto', fn: abrir }];
      if (esDemo) {
        btns.push({ txt: 'Siguiente →', sec: true, fn: () => { guardarDemo('tutoriales'); pasoCompletado('producto'); } });
        barra({ ...p, texto: p.texto + ' En la demostración puedes crear uno de prueba o tocar Siguiente.' }, btns);
      } else {
        barra(p, btns);
        if (typeof window.guardarProducto === 'function') {
          const orig = window.guardarProducto;
          window.guardarProducto = async function () { const r = await orig.apply(this, arguments); setTimeout(() => revisar(false), 500); return r; };
        }
        vigilar();
      }
      return;
    }

    if (paso === 'tutoriales') {
      modal(`<div class="gi-ico">🎓</div>${puntos(3)}<h2>Aquí están los Tutoriales</h2>
        <p>Cuando tengas una duda de cualquier módulo, entra aquí desde el menú lateral (<b>🎓 Tutoriales</b>) y mira el video de ese módulo.
        No tienes que verlos ahora.</p>`,
        [{ txt: 'Entendido, desbloquear todo', fn: async (ev) => {
          ev.target.disabled = true; ev.target.textContent = 'Un momento…';
          if (esDemo) { guardarDemo('listo'); return terminado(); }
          await revisar(true);
          if (paso !== 'listo') { ev.target.disabled = false; ev.target.textContent = 'Reintentar'; }
        } }]);
    }
  }

  /* ---------------- arranque ---------------- */
  async function iniciar() {
    for (let i = 0; i < 50 && !window.supabase; i++) await espera(100);
    if (!window.supabase) return;
    sb = window.supabase.createClient(URL_SB, KEY_SB);
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    uid = session.user.id;
    if (lsGet('n360_guia_listo_' + uid) === '1') return; // ya la terminó: ni siquiera se consulta

    let r;
    try { r = await consultar(false); } catch (_) { return; } // ante cualquier falla, no bloquear
    if (r.paso === 'listo') { lsSet('n360_guia_listo_' + uid, '1'); return; }
    if (r.paso === 'espera') return;
    if (r.paso === 'demo') {
      esDemo = true;
      paso = ssGet('n360_guia_demo_' + uid) || 'caja';
      if (paso === 'listo') return;
    } else {
      paso = r.paso;
    }
    if (!PASOS[paso]) return;

    // Con multiusuario: esperar a que elija usuario y ponga su código.
    if (r.multiusuario !== false) {
      for (let i = 0; i < 1800 && !perfilActivo(); i++) await espera(700); // hasta ~20 min
      const p = perfilActivo();
      if (!p || p.tipo !== 'admin') return; // trabajadores: no se bloquean
    }
    for (let i = 0; i < 40 && document.getElementById('pg-overlay'); i++) await espera(250);
    if (window.N360VerComo && window.N360VerComo.activo) return;
    mostrarPaso();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => iniciar());
  else iniciar();
})();
