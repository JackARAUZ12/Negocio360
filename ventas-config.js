/* =====================================================================
   VENTAS · Configuración del módulo (solo administradores)
   ---------------------------------------------------------------------
   Primera opción: "Ver las ventas de todo el negocio".
   - Apagada (como siempre): un usuario que no es administrador ve solo
     las ventas que él mismo registró (Ventas y Dashboard).
   - Encendida: ve las ventas de todo el negocio, como un administrador.
   Se puede configurar para TODOS los usuarios (menos administradores) o
   para un usuario específico (la regla del usuario tiene prioridad).
   Se guarda en config_modulo_perfiles. Sin nada configurado, todo sigue igual.
   Solo afecta lo que se MUESTRA; no toca ventas, caja ni contabilidad.
   ===================================================================== */
(function () {
  'use strict';
  const MOD = 'ventas';
  const OPC = 'ver_todas_las_ventas';
  const C = { cargado: false, general: null, propio: null, promesa: null, client: null, userId: null };

  function perfilActivo() {
    try { const r = sessionStorage.getItem('n360_perfil_activo'); return r ? JSON.parse(r) : null; } catch (_) { return null; }
  }
  function esAdmin() { const p = perfilActivo(); return !!(p && p.tipo === 'admin'); }

  // ¿El usuario restringido que está viendo la pantalla puede ver TODAS las ventas?
  // (el dueño/administrador no pasa por aquí: ya ve todo). Sin configurar = false = como siempre.
  function verTodas() {
    if (!C.cargado) return false;
    const v = (C.propio && C.propio.opciones && C.propio.opciones[OPC]);
    if (typeof v === 'boolean') return v;
    const g = (C.general && C.general.opciones && C.general.opciones[OPC]);
    return g === true;
  }

  // Descuento general de la factura (Ventas). Sin configurar = permitido, hasta 100 %.
  // El dueño/administrador siempre puede, sin tope. Solo controla lo que se MUESTRA/permite en pantalla;
  // la base de datos valida aparte que los montos cuadren.
  function descuentoGeneral() {
    if (esAdmin()) return { permitido: true, maxPct: 100 };
    const leerO = (f) => (f && f.opciones) ? f.opciones : null;
    const o = leerO(C.propio) || leerO(C.general) || {};
    const permitido = o.descuento_general !== false;
    let max = Number(o.descuento_general_max_pct);
    if (!(max > 0) || max > 100) max = 100;
    return { permitido, maxPct: max };
  }

  // Lee la configuración UNA vez (se puede llamar varias veces; reutiliza la respuesta).
  function cargar(client, userId) {
    if (client) C.client = client;
    if (userId) C.userId = userId;
    if (C.promesa) return C.promesa;
    C.promesa = (async () => {
      try {
        const { data, error } = await C.client.from('config_modulo_perfiles')
          .select('id, perfil_id, opciones').eq('auth_user_id', C.userId).eq('modulo', MOD);
        if (error) throw error;
        const filas = data || [];
        const p = perfilActivo();
        C.general = filas.find(f => !f.perfil_id) || null;
        C.propio = p && p.id ? (filas.find(f => f.perfil_id === p.id) || null) : null;
        C.cargado = true;
      } catch (e) {
        console.warn('config_modulo_perfiles:', e);   // si falla, todo sigue como siempre
        C.cargado = false;
      }
      return C.cargado;
    })();
    return C.promesa;
  }

  /* ---------- Ventana de configuración (solo administrador) ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ADM = { filas: [], perfiles: [], scope: '', personalizar: false, valor: false, dg: true, dgmax: '' };

  function filaDe(scope) { return ADM.filas.find(f => (scope ? f.perfil_id === scope : !f.perfil_id)) || null; }
  function leer(f) { return !!(f && f.opciones && f.opciones[OPC] === true); }
  function leerDg(f) { return !(f && f.opciones && f.opciones.descuento_general === false); }
  function leerDgMax(f) { const m = f && f.opciones ? Number(f.opciones.descuento_general_max_pct) : 0; return (m > 0 && m < 100) ? String(m) : ''; }
  function prepararValor() {
    if (!ADM.scope) { ADM.personalizar = true; ADM.valor = leer(filaDe('')); ADM.dg = leerDg(filaDe('')); ADM.dgmax = leerDgMax(filaDe('')); return; }
    const propia = filaDe(ADM.scope);
    ADM.personalizar = !!propia;
    const base = propia || filaDe('');
    ADM.valor = leer(base); ADM.dg = leerDg(base); ADM.dgmax = leerDgMax(base);
  }

  async function cargarAdmin() {
    const [r1, r2] = await Promise.all([
      C.client.from('config_modulo_perfiles').select('id, perfil_id, opciones').eq('auth_user_id', C.userId).eq('modulo', MOD),
      C.client.from('perfiles_acceso').select('id, nombre, tipo, activo').eq('auth_user_id', C.userId).eq('activo', true).order('nombre'),
    ]);
    if (r1.error) throw r1.error;
    ADM.filas = r1.data || [];
    ADM.perfiles = (r2.data || []).filter(p => p.tipo !== 'admin');
  }

  function css() {
    if (document.getElementById('vc-css')) return;
    const st = document.createElement('style'); st.id = 'vc-css';
    st.textContent = `
      #vc-overlay{position:fixed;inset:0;z-index:100000;background:rgba(15,18,30,.55);display:flex;align-items:center;justify-content:center;padding:16px}
      #vc-sheet{background:var(--bg-surface,#fff);color:var(--text-primary,#111);width:100%;max-width:520px;max-height:92vh;border-radius:16px;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.35);overflow:hidden}
      #vc-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--border,#e5e7eb)}
      #vc-head h3{margin:0;font-size:16px;font-weight:700}
      #vc-x{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:var(--text-secondary,#555);min-width:40px;min-height:40px;border-radius:10px}
      #vc-body{padding:16px 18px;overflow-y:auto;-webkit-overflow-scrolling:touch}
      #vc-foot{display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--border,#e5e7eb);background:var(--bg-surface,#fff)}
      .vc-sub{font-size:12.5px;color:var(--text-secondary,#555);line-height:1.5;margin:0 0 12px}
      .vc-sel{width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--border,#d1d5db);border-radius:10px;background:var(--bg-surface,#fff);color:var(--text-primary,#111);font-size:14px;margin-bottom:12px}
      .vc-modo{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;font-size:13px}
      .vc-modo label{display:flex;gap:10px;align-items:flex-start;cursor:pointer;min-height:36px}
      .vc-modo input{width:18px;height:18px;margin-top:2px;flex:none}
      .vc-op{display:flex;gap:12px;align-items:flex-start;padding:12px;border:1.5px solid var(--border,#e5e7eb);border-radius:12px;cursor:pointer}
      .vc-op.off{opacity:.55;cursor:default}
      .vc-op input{width:22px;height:22px;margin-top:1px;flex:none}
      .vc-et{font-size:14px;font-weight:700}
      .vc-ds{font-weight:400;font-size:12px;color:var(--text-secondary,#555);line-height:1.45;margin-top:2px}
      .vc-msg{font-size:12.5px;flex:1 1 100%}
      .vc-ok{color:#166534}.vc-err{color:var(--danger,#dc2626)}
      .vc-btn{min-height:44px;padding:0 18px;border-radius:10px;border:1px solid var(--border,#d1d5db);background:var(--bg-surface,#fff);color:var(--text-primary,#111);font-size:14px;font-weight:600;cursor:pointer}
      .vc-btn.p{background:var(--accent,#6c63ff);border-color:transparent;color:#fff}
      .vc-btn[disabled]{opacity:.6;cursor:default}
      @media (max-width:600px){
        #vc-overlay{padding:0;align-items:flex-end}
        #vc-sheet{max-width:none;max-height:94vh;border-radius:18px 18px 0 0}
        #vc-foot .vc-btn{flex:1 1 0}
      }`;
    document.head.appendChild(st);
  }

  function pintar() {
    const body = document.getElementById('vc-body'); if (!body) return;
    if (!ADM.perfiles.length) {
      body.innerHTML = '<p class="vc-sub">Todavía no tienes usuarios. Cuando crees usuarios (desde el selector de perfiles), aquí podrás decidir qué ventas puede ver cada uno.</p>';
      document.getElementById('vc-guardar').style.display = 'none';
      return;
    }
    const off = ADM.scope && !ADM.personalizar;
    body.innerHTML = `
      <p class="vc-sub">Solo tú (administrador) ves esta configuración. Los administradores siempre ven todas las ventas.
        Sin cambios, cada usuario sigue viendo <b>solo las ventas que él mismo registra</b>, como hasta ahora.</p>
      <select class="vc-sel" id="vc-scope" aria-label="A quién aplicar">
        <option value="" ${ADM.scope === '' ? 'selected' : ''}>👥 Todos los usuarios (menos administradores)</option>
        ${ADM.perfiles.map(p => `<option value="${esc(p.id)}" ${ADM.scope === p.id ? 'selected' : ''}>👤 Solo: ${esc(p.nombre)}</option>`).join('')}
      </select>
      ${ADM.scope ? `<div class="vc-modo">
        <label><input type="radio" name="vc-modo" value="igual" ${!ADM.personalizar ? 'checked' : ''}><span>Igual que la configuración de todos los usuarios</span></label>
        <label><input type="radio" name="vc-modo" value="propia" ${ADM.personalizar ? 'checked' : ''}><span>Personalizar para este usuario</span></label>
      </div>` : ''}
      <label class="vc-op ${off ? 'off' : ''}">
        <input type="checkbox" id="vc-ver" ${ADM.valor ? 'checked' : ''} ${off ? 'disabled' : ''}>
        <span><span class="vc-et">Ver las ventas de todo el negocio</span><br>
          <span class="vc-ds">Marcado: ve el total del día y del mes, el historial, la ganancia y los gráficos de todo el negocio (Ventas y Dashboard), no solo lo que él vendió.
          Sin marcar: solo ve lo que él mismo registra. Solo cambia lo que se ve; no modifica ventas, caja ni contabilidad.</span></span>
      </label>
      <label class="vc-op ${off ? 'off' : ''}" style="margin-top:10px">
        <input type="checkbox" id="vc-dg" ${ADM.dg ? 'checked' : ''} ${off ? 'disabled' : ''}>
        <span><span class="vc-et">Permitir "Descuento general" en la factura</span><br>
          <span class="vc-ds">Marcado (como viene por defecto): puede aplicar un descuento al total de la factura, en % o en monto.
          Sin marcar: no ve el botón. Los administradores siempre pueden.</span>
          <span class="vc-ds" style="display:block;margin-top:8px">Máximo permitido (%), vacío = sin tope:
            <input type="number" id="vc-dgmax" min="1" max="99" step="0.5" value="${esc(ADM.dgmax)}" ${off ? 'disabled' : ''} style="width:80px;margin-left:6px;padding:6px 8px;border:1px solid var(--border,#d1d5db);border-radius:8px;background:var(--bg-surface,#fff);color:inherit"></span></span>
      </label>`;
    document.getElementById('vc-guardar').style.display = '';
    document.getElementById('vc-scope').onchange = e => { ADM.scope = e.target.value || ''; prepararValor(); limpiarMsg(); pintar(); };
    body.querySelectorAll('input[name=vc-modo]').forEach(r => r.onchange = () => {
      ADM.personalizar = r.value === 'propia';
      if (ADM.personalizar && !filaDe(ADM.scope)) { ADM.valor = leer(filaDe('')); ADM.dg = leerDg(filaDe('')); ADM.dgmax = leerDgMax(filaDe('')); }
      limpiarMsg(); pintar();
    });
    const cb = document.getElementById('vc-ver'); if (cb) cb.onchange = () => { ADM.valor = cb.checked; limpiarMsg(); };
    const cdg = document.getElementById('vc-dg'); if (cdg) cdg.onchange = () => { ADM.dg = cdg.checked; limpiarMsg(); };
    const cdm = document.getElementById('vc-dgmax'); if (cdm) cdm.oninput = () => { ADM.dgmax = cdm.value; limpiarMsg(); };
  }
  function msg(t, ok) { const m = document.getElementById('vc-msg'); if (m) { m.textContent = t; m.className = 'vc-msg ' + (ok ? 'vc-ok' : 'vc-err'); } }
  function limpiarMsg() { msg('', true); }

  function opcionesDg() {
    const m = Number(ADM.dgmax);
    return { descuento_general: ADM.dg !== false, descuento_general_max_pct: (m > 0 && m < 100) ? m : null };
  }
  async function guardar() {
    if (!esAdmin()) { msg('Solo un administrador puede guardar esta configuración.', false); return; }
    const btn = document.getElementById('vc-guardar'); if (btn) btn.disabled = true;
    try {
      const existente = filaDe(ADM.scope);
      if (ADM.scope && !ADM.personalizar) {
        if (existente) { const { error } = await C.client.from('config_modulo_perfiles').delete().eq('id', existente.id).eq('auth_user_id', C.userId); if (error) throw error; }
      } else if (existente) {
        const opciones = Object.assign({}, existente.opciones || {}, { [OPC]: !!ADM.valor }, opcionesDg());
        const { error } = await C.client.from('config_modulo_perfiles').update({ opciones, updated_at: new Date().toISOString() }).eq('id', existente.id).eq('auth_user_id', C.userId);
        if (error) throw error;
      } else {
        const { error } = await C.client.from('config_modulo_perfiles').insert({ auth_user_id: C.userId, modulo: MOD, perfil_id: ADM.scope || null, opciones: Object.assign({ [OPC]: !!ADM.valor }, opcionesDg()) });
        if (error) throw error;
      }
      await cargarAdmin(); prepararValor(); pintar();
      msg('✅ Guardado. Se aplica la próxima vez que ese usuario abra Ventas o el Dashboard.', true);
    } catch (e) {
      console.error('guardar config ventas:', e);
      msg('No se pudo guardar. Intenta de nuevo.', false);
    } finally { const b2 = document.getElementById('vc-guardar'); if (b2) b2.disabled = false; }
  }

  function cerrar() { const o = document.getElementById('vc-overlay'); if (o) o.remove(); document.removeEventListener('keydown', escClose); }
  function escClose(e) { if (e.key === 'Escape') cerrar(); }

  async function abrir() {
    if (!esAdmin()) return;   // solo administradores
    css(); cerrar();
    const o = document.createElement('div'); o.id = 'vc-overlay';
    o.innerHTML = `<div id="vc-sheet" role="dialog" aria-modal="true" aria-labelledby="vc-t">
        <div id="vc-head"><h3 id="vc-t">⚙️ Configuración de Ventas</h3><button id="vc-x" aria-label="Cerrar">✕</button></div>
        <div id="vc-body"><p class="vc-sub">Cargando…</p></div>
        <div id="vc-foot"><span class="vc-msg" id="vc-msg"></span>
          <button class="vc-btn" id="vc-cerrar">Cerrar</button>
          <button class="vc-btn p" id="vc-guardar">Guardar</button></div>
      </div>`;
    document.body.appendChild(o);
    o.addEventListener('click', e => { if (e.target === o) cerrar(); });
    document.getElementById('vc-x').onclick = cerrar; document.getElementById('vc-cerrar').onclick = cerrar;
    document.getElementById('vc-guardar').onclick = guardar;
    document.addEventListener('keydown', escClose);
    try {
      if (!C.client) throw new Error('sin conexión lista');
      await cargarAdmin(); ADM.scope = ''; prepararValor(); pintar();
    } catch (e) {
      console.warn('abrir config ventas:', e);
      document.getElementById('vc-body').innerHTML = '<p class="vc-sub">No se pudo cargar la configuración. Actualiza la página e intenta de nuevo.</p>';
      document.getElementById('vc-guardar').style.display = 'none';
    }
  }

  // El botón del encabezado de Ventas solo se muestra a administradores.
  function iniciarBoton() {
    const b = document.getElementById('btn-config-ventas');
    if (b && esAdmin()) b.style.display = '';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarBoton); else iniciarBoton();

  window.N360VentasConfig = { cargar, verTodas, descuentoGeneral, abrir, _estado: C };
})();
