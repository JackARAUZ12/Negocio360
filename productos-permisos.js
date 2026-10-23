/* =====================================================================
   PRODUCTOS/SERVICIOS · Permisos por usuario
   ---------------------------------------------------------------------
   El administrador decide qué acciones puede hacer cada usuario (o todos
   los usuarios que no son administradores) dentro de Productos/Servicios.
   - Sin nada configurado, TODO sigue como siempre (todos pueden todo).
   - Los administradores (y cuentas sin usuarios) nunca se bloquean.
   - Se guarda en la tabla permisos_inventario:
       perfil_id NULL  = todos los usuarios que no son administradores
       perfil_id = X   = solo ese usuario (tiene prioridad sobre la general)
   Este archivo es nuevo y no modifica productos.js: oculta los botones y
   bloquea las funciones de cada acción.
   ===================================================================== */
(function () {
  'use strict';

  const ACCIONES = [
    { k: 'crear',      et: 'Crear productos y servicios',            ds: 'Botones "Nuevo producto", "Nuevo servicio" y "Nueva materia prima".', fns: ['abrirModalNuevo', 'irAIngresarMateriaPrima'] },
    { k: 'editar',     et: 'Editar',                                 ds: 'Cambiar datos, precios, costos y fotos de un producto o servicio (✏️).', fns: ['abrirEditar'] },
    { k: 'duplicar',   et: 'Duplicar',                               ds: 'Crear una copia de un producto (📋).', fns: ['duplicarProducto'] },
    { k: 'eliminar',   et: 'Eliminar',                               ds: 'Borrar productos o servicios (🗑️).', fns: ['confirmarEliminarProducto'] },
    { k: 'movimiento', et: 'Movimientos especiales',                 ds: 'Mermas y bajas de existencia (📉).', fns: ['abrirMovimiento'] },
    { k: 'traslados',  et: 'Mover o trasladar productos',            ds: 'Enviar stock a otra sucursal o bodega.', fns: ['abrirModalMoverProducto', 'abrirTrasladoLote'] },
    { k: 'importar',   et: 'Importar desde Excel',                   ds: 'Cargar o completar productos con un archivo.', fns: ['abrirModalImportar'] },
    { k: 'exportar',   et: 'Exportar inventario',                    ds: 'Descargar el inventario en Excel o PDF.', fns: ['abrirModalExportarInventario', 'exportarInventarioExcel', 'exportarInventarioPDF'] },
    { k: 'combos',     et: 'Combos y promociones',                   ds: 'Crear, editar y eliminar combos y promociones.', fns: ['abrirModalCombo', 'abrirEditarCombo', 'confirmarEliminarCombo', 'abrirModalPromocion'] },
  ];

  const PERM = { cargado: false, error: false, general: null, propio: null };

  function perfilActivo() {
    try { const r = sessionStorage.getItem('n360_perfil_activo'); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }
  // "Restringido" = un usuario que NO es administrador. Sin perfil (cuenta sin usuarios) = dueño = sin límites.
  function esRestringido() { const p = perfilActivo(); return !!(p && p.tipo && p.tipo !== 'admin'); }
  function esAdmin() { const p = perfilActivo(); return !!(p && p.tipo === 'admin'); }

  function accionesEfectivas() {
    return (PERM.propio && PERM.propio.acciones) || (PERM.general && PERM.general.acciones) || {};
  }
  function permitido(k) {
    if (!esRestringido()) return true;
    if (PERM.error) return true;          // si no se pudo leer la configuración, no se rompe nada (todo como siempre)
    if (!PERM.cargado) return false;      // mientras carga, un usuario restringido no puede hacer nada sensible
    return accionesEfectivas()[k] !== false;
  }

  /* ---------- Ocultar botones + bloquear funciones ---------- */
  function aplicarEstilos() {
    let st = document.getElementById('pi-css-permisos');
    if (!st) { st = document.createElement('style'); st.id = 'pi-css-permisos'; document.head.appendChild(st); }
    if (!esRestringido()) { st.textContent = ''; return; }
    const reglas = [];
    ACCIONES.forEach(a => {
      if (permitido(a.k)) return;
      a.fns.forEach(fn => reglas.push('[onclick*="' + fn + '("]'));
    });
    st.textContent = reglas.length ? reglas.join(',') + '{display:none!important}' : '';
  }

  function avisarSinPermiso() {
    try { showToast('error', 'Sin permiso', 'El administrador no te dio permiso para hacer esto.'); }
    catch (_) { alert('El administrador no te dio permiso para hacer esto.'); }
  }

  function envolverFunciones() {
    ACCIONES.forEach(a => a.fns.forEach(fn => {
      const orig = window[fn];
      if (typeof orig !== 'function' || orig.__piGuard) return;
      const w = function () {
        if (!permitido(a.k)) { avisarSinPermiso(); return; }
        return orig.apply(this, arguments);
      };
      w.__piGuard = true;
      window[fn] = w;
    }));
  }

  /* ---------- Carga de la configuración ---------- */
  async function cargar() {
    const listo = () => typeof STATE !== 'undefined' && STATE && STATE.user && typeof supabaseClient !== 'undefined';
    for (let i = 0; i < 100 && !listo(); i++) await new Promise(r => setTimeout(r, 150));
    if (!listo()) { PERM.error = true; aplicarEstilos(); return; }
    try {
      const { data, error } = await supabaseClient.from('permisos_inventario')
        .select('id, perfil_id, acciones').eq('auth_user_id', STATE.user.id);
      if (error) throw error;
      const filas = data || [];
      const p = perfilActivo();
      PERM.general = filas.find(f => !f.perfil_id) || null;
      PERM.propio = p && p.id ? (filas.find(f => f.perfil_id === p.id) || null) : null;
      PERM.cargado = true; PERM.error = false;
    } catch (e) {
      console.warn('permisos_inventario:', e);
      PERM.error = true;
    }
    aplicarEstilos();
  }

  /* ---------- Sección del ADMINISTRADOR dentro de "Configuración de inventario" ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ADM = { filas: [], perfiles: [], scope: '', personalizar: false, borrador: {} };

  function valorDe(k) { return ADM.borrador[k] !== false; }

  async function cargarAdmin() {
    const uid = STATE.user.id;
    const [r1, r2] = await Promise.all([
      supabaseClient.from('permisos_inventario').select('id, perfil_id, acciones').eq('auth_user_id', uid),
      supabaseClient.from('perfiles_acceso').select('id, nombre, tipo, activo').eq('auth_user_id', uid).eq('activo', true).order('nombre'),
    ]);
    if (r1.error) throw r1.error;
    ADM.filas = r1.data || [];
    ADM.perfiles = (r2.data || []).filter(p => p.tipo !== 'admin');
  }
  function filaDe(scope) { return ADM.filas.find(f => (scope ? f.perfil_id === scope : !f.perfil_id)) || null; }
  function prepararBorrador() {
    const propia = ADM.scope ? filaDe(ADM.scope) : null;
    ADM.personalizar = !ADM.scope || !!propia;
    const fuente = ADM.scope ? (propia || filaDe('')) : filaDe('');
    ADM.borrador = Object.assign({}, (fuente && fuente.acciones) || {});
  }

  function pintarAdmin() {
    const cont = document.getElementById('permisosInvSeccion');
    if (!cont) return;
    if (!ADM.perfiles.length) {
      cont.innerHTML = '<div class="pi-box"><div class="pi-tit">🔐 Permisos de los usuarios</div><p class="pi-sub">Todavía no tienes usuarios. Cuando crees usuarios (desde el selector de perfiles), aquí podrás decidir qué pueden hacer en Productos/Servicios.</p></div>';
      return;
    }
    const deshabilitado = ADM.scope && !ADM.personalizar;
    cont.innerHTML = `
      <style>
        .pi-box{margin-top:18px;border-top:1px solid var(--border,#e5e7eb);padding-top:16px}
        .pi-tit{font-weight:700;font-size:14px;margin-bottom:4px}
        .pi-sub{font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.45}
        .pi-fila{display:flex;gap:10px;align-items:flex-start;padding:9px 10px;border:1px solid var(--border,#e5e7eb);border-radius:10px;margin-bottom:6px;cursor:pointer}
        .pi-fila input{width:18px;height:18px;margin-top:2px;flex:none}
        .pi-fila.off{opacity:.55;cursor:default}
        .pi-et{font-size:13px;font-weight:600}
        .pi-ds{font-size:11.5px;color:var(--text-muted)}
        .pi-sel{width:100%;padding:9px 10px;border:1px solid var(--border,#e5e7eb);border-radius:8px;background:var(--bg-surface,#fff);color:var(--text-primary);font-size:13px;margin-bottom:10px}
        .pi-modo{display:flex;flex-direction:column;gap:6px;font-size:12.5px;margin-bottom:10px}
        .pi-modo label{display:flex;gap:8px;align-items:flex-start;cursor:pointer}
        .pi-acc{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px}
        .pi-msg{font-size:12.5px}
        .pi-ok{color:#166534}.pi-err{color:var(--danger,#dc2626)}
      </style>
      <div class="pi-box">
        <div class="pi-tit">🔐 Permisos de los usuarios en Productos/Servicios</div>
        <p class="pi-sub">Solo tú (administrador) ves esta opción. Elige qué puede hacer cada usuario. Los administradores nunca se bloquean.
          Sin cambios, todos los usuarios siguen pudiendo todo, como hasta ahora.</p>
        <select class="pi-sel" id="piScope" onchange="N360PermisosInv.cambiarScope(this.value)">
          <option value="" ${ADM.scope === '' ? 'selected' : ''}>👥 Todos los usuarios (menos administradores)</option>
          ${ADM.perfiles.map(p => `<option value="${esc(p.id)}" ${ADM.scope === p.id ? 'selected' : ''}>👤 Solo: ${esc(p.nombre)}</option>`).join('')}
        </select>
        ${ADM.scope ? `<div class="pi-modo">
          <label><input type="radio" name="piModo" ${!ADM.personalizar ? 'checked' : ''} onchange="N360PermisosInv.setModo(false)"><span>Igual que la configuración de todos los usuarios</span></label>
          <label><input type="radio" name="piModo" ${ADM.personalizar ? 'checked' : ''} onchange="N360PermisosInv.setModo(true)"><span>Personalizar para este usuario</span></label>
        </div>` : ''}
        ${ACCIONES.map(a => `
          <label class="pi-fila ${deshabilitado ? 'off' : ''}">
            <input type="checkbox" ${valorDe(a.k) ? 'checked' : ''} ${deshabilitado ? 'disabled' : ''} onchange="N360PermisosInv.toggle('${a.k}', this.checked)">
            <span><span class="pi-et">${esc(a.et)}</span><br><span class="pi-ds">${esc(a.ds)}</span></span>
          </label>`).join('')}
        <p class="pi-sub" style="margin-top:4px">✔ marcado = puede hacerlo · sin marcar = no puede (los botones se ocultan). Ver el inventario siempre está permitido.</p>
        <div class="pi-acc">
          <button class="btn btn-primary" id="piGuardar" onclick="N360PermisosInv.guardar()">Guardar permisos</button>
          <span class="pi-msg" id="piMsg"></span>
        </div>
      </div>`;
  }

  async function guardarAdmin() {
    const msg = document.getElementById('piMsg'), btn = document.getElementById('piGuardar');
    const ponMsg = (t, ok) => { if (msg) { msg.textContent = t; msg.className = 'pi-msg ' + (ok ? 'pi-ok' : 'pi-err'); } };
    if (!esAdmin()) { ponMsg('Solo un administrador puede guardar permisos.', false); return; }
    if (btn) btn.disabled = true;
    try {
      const uid = STATE.user.id;
      const existente = filaDe(ADM.scope);
      if (ADM.scope && !ADM.personalizar) {
        // "Igual que todos": se quita la regla propia de este usuario
        if (existente) { const { error } = await supabaseClient.from('permisos_inventario').delete().eq('id', existente.id).eq('auth_user_id', uid); if (error) throw error; }
      } else {
        // Se guarda solo lo que está APAGADO (lo demás queda permitido)
        const acciones = {};
        ACCIONES.forEach(a => { if (!valorDe(a.k)) acciones[a.k] = false; });
        if (existente) {
          const { error } = await supabaseClient.from('permisos_inventario').update({ acciones, updated_at: new Date().toISOString() }).eq('id', existente.id).eq('auth_user_id', uid);
          if (error) throw error;
        } else {
          const { error } = await supabaseClient.from('permisos_inventario').insert({ auth_user_id: uid, perfil_id: ADM.scope || null, acciones });
          if (error) throw error;
        }
      }
      await cargarAdmin();
      prepararBorrador(); pintarAdmin();
      const m2 = document.getElementById('piMsg'); if (m2) { m2.textContent = '✅ Permisos guardados. Se aplican la próxima vez que el usuario abra Productos/Servicios.'; m2.className = 'pi-msg pi-ok'; }
    } catch (e) {
      console.error('guardar permisos_inventario:', e);
      ponMsg('No se pudo guardar. Intenta de nuevo.', false);
    } finally { const b2 = document.getElementById('piGuardar'); if (b2) b2.disabled = false; }
  }

  async function abrirSeccionAdmin() {
    const cont = document.getElementById('permisosInvSeccion');
    if (!cont) return;
    if (!esAdmin()) { cont.innerHTML = ''; cont.style.display = 'none'; return; }   // solo administradores la ven
    cont.style.display = '';
    try {
      await cargarAdmin();
      ADM.scope = ''; prepararBorrador(); pintarAdmin();
    } catch (e) {
      console.warn('permisos admin:', e);
      cont.innerHTML = '<div class="pi-box"><div class="pi-tit">🔐 Permisos de los usuarios</div><p class="pi-sub">No se pudieron cargar los permisos. Actualiza la página e intenta de nuevo.</p></div>';
    }
  }

  window.N360PermisosInv = {
    puede: permitido,
    cambiarScope(v) { ADM.scope = v || ''; prepararBorrador(); pintarAdmin(); },
    setModo(p) { ADM.personalizar = !!p; if (p) { const g = filaDe(''); if (!filaDe(ADM.scope) && g) ADM.borrador = Object.assign({}, g.acciones || {}); } pintarAdmin(); },
    toggle(k, v) { if (v) delete ADM.borrador[k]; else ADM.borrador[k] = false; },
    guardar: guardarAdmin,
    _estado: PERM,
  };

  /* ---------- Arranque ---------- */
  function iniciar() {
    envolverFunciones();
    aplicarEstilos();   // restringido: oculta todo lo sensible mientras carga
    cargar();
    // La sección del administrador se arma cada vez que se abre "Configuración de inventario"
    const orig = window.abrirModalConfigInventario;
    if (typeof orig === 'function' && !orig.__piGuard) {
      const w = function () { const r = orig.apply(this, arguments); abrirSeccionAdmin(); return r; };
      w.__piGuard = true; window.abrirModalConfigInventario = w;
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
