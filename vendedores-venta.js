/* ============================================================
   VENDEDORES-VENTA.JS — NEGOCIO360 · "¿Quién vendió?" en Ventas
   Solo actúa si el negocio activó "Vendedores" en Configuración.
   Si está apagado: no dibuja nada y no agrega ningún dato a la venta
   (Ventas funciona exactamente igual que siempre).
   El vendedor es solo un DATO: no cambia montos, Caja ni inventario.
   La base valida el vendedor y le pone el nombre (no se puede falsificar).
   ============================================================ */
(function () {
  'use strict';
  if (window.N360Vendedor) return;
  const V = { activo: false, obligatorio: false, lista: [], sel: { normal: '', vr: '' }, cargado: false };
  const KEY = 'n360_vendedor_ultimo';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function cliente() { try { return (typeof sb !== 'undefined' && sb) || window.sb || null; } catch (_) { return null; } }
  function uid() { try { return (typeof S !== 'undefined' && S && S.userId) || null; } catch (_) { return null; } }

  async function cargar() {
    const c = cliente(), u = uid();
    if (!c || !u) return false;
    try {
      const { data: cfg } = await c.from('configuracion_empresa').select('usa_vendedores,vendedor_obligatorio').eq('auth_user_id', u).maybeSingle();
      V.activo = cfg?.usa_vendedores === true; V.obligatorio = V.activo && cfg?.vendedor_obligatorio === true;
      if (!V.activo) { V.cargado = true; return true; }
      const { data } = await c.from('vendedores').select('id,nombre').eq('auth_user_id', u).eq('activo', true).order('nombre');
      V.lista = data || [];
      let ult = ''; try { ult = sessionStorage.getItem(KEY) || ''; } catch (_) {}
      if (ult && V.lista.some(x => x.id === ult)) { V.sel.normal = ult; V.sel.vr = ult; }
      V.cargado = true; return true;
    } catch (e) { console.warn('vendedores:', e); V.activo = false; V.cargado = true; return true; }
  }
  function opciones(modo) {
    const s = V.sel[modo] || '';
    return `<option value="">${V.obligatorio ? '— Elige quién vendió —' : 'Sin vendedor'}</option>` +
      V.lista.map(x => `<option value="${x.id}"${x.id === s ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('');
  }
  function bloque(modo) {
    return `<div class="form-group n360-vend" data-modo="${modo}" style="margin-top:14px">
      <label for="n360-vend-${modo}" style="font-weight:700">🧑‍💼 ¿Quién vendió?${V.obligatorio ? ' <span style="color:var(--danger)">*</span>' : ' <span style="font-weight:400;color:var(--text-muted)">(opcional)</span>'}</label>
      <select id="n360-vend-${modo}" class="form-input" style="max-width:320px" onchange="N360Vendedor._cambio('${modo}', this.value)">${opciones(modo)}</select>
      ${V.lista.length ? '' : '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">Aún no hay vendedores. Agrégalos en <b>Vendedores</b> del menú.</div>'}
    </div>`;
  }
  function dibujar() {
    if (!V.activo) return;
    // Venta normal: en el paso de pago, debajo del método
    const ancla = document.getElementById('metodo-error');
    if (ancla && !document.getElementById('n360-vend-normal')) ancla.insertAdjacentHTML('afterend', bloque('normal'));
    // Venta rápida: antes de "Método de pago"
    const vr = document.getElementById('vr-metodos-grid');
    const tit = vr && vr.previousElementSibling;
    if (tit && !document.getElementById('n360-vend-vr')) tit.insertAdjacentHTML('beforebegin', bloque('vr'));
  }
  function _cambio(modo, val) {
    V.sel[modo] = val || '';
    try { if (val) sessionStorage.setItem(KEY, val); } catch (_) {}
  }
  // Datos que se agregan a la venta. Apagado o sin elegir: no agrega NADA.
  function payload(modo) {
    if (!V.activo) return {};
    const id = V.sel[modo === 'vr' ? 'vr' : 'normal'];
    return id ? { vendedor_id: id } : {};
  }
  // Si es obligatorio y no se eligió, avisa y no deja seguir (solo en esta pantalla).
  function validar(modo) {
    if (!V.activo || !V.obligatorio) return true;
    if (V.sel[modo === 'vr' ? 'vr' : 'normal']) return true;
    try { showToast('Elige quién vendió (lo pide la configuración de Vendedores).', 'error'); } catch (_) {}
    const el = document.getElementById('n360-vend-' + (modo === 'vr' ? 'vr' : 'normal'));
    if (el) { el.focus(); el.style.borderColor = 'var(--danger)'; }
    return false;
  }
  // En el detalle de una venta: quién vendió y botón para cambiarlo.
  function htmlDetalle(venta) {
    if (!V.activo || !venta) return '';
    const puede = venta.estado === 'completada';
    return `<div class="detalle-item" id="n360-vend-det">
      <div class="detalle-label">Vendedor</div>
      <div class="detalle-value">${venta.vendedor_nombre ? esc(venta.vendedor_nombre) : '<span style="color:var(--text-muted)">Sin vendedor</span>'}
        ${puede ? `<button type="button" class="btn-secondary" style="padding:3px 10px;font-size:12px;margin-left:8px" onclick="N360Vendedor._editar('${venta.id}')">Cambiar</button>` : ''}</div>
    </div>`;
  }
  function _editar(ventaId) {
    const cont = document.getElementById('n360-vend-det'); if (!cont) return;
    const v = cont.querySelector('.detalle-value');
    v.innerHTML = `<select id="n360-vend-edit" class="form-input" style="max-width:220px;display:inline-block">${'<option value="">Sin vendedor</option>' + V.lista.map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select>
      <button type="button" class="btn-primary" style="padding:4px 10px;font-size:12px;margin-left:6px" id="n360-vend-ok">Guardar</button>`;
    let ocupado = false;
    document.getElementById('n360-vend-ok').onclick = async () => {
      if (ocupado) return; ocupado = true;
      const sel = document.getElementById('n360-vend-edit').value || null;
      try {
        const { data, error } = await cliente().rpc('venta_asignar_vendedor', { p_venta_id: ventaId, p_vendedor_id: sel });
        if (error || !data || !data.ok) {
          const m = { anulada: 'La venta está anulada.', vendedor: 'Ese vendedor ya no está activo.', no_existe: 'No se encontró la venta.', desactivado: 'Vendedores está apagado.' }[data && data.motivo];
          showToast(m || 'No se pudo cambiar el vendedor.', 'error'); return;
        }
        v.innerHTML = data.vendedor_nombre ? esc(data.vendedor_nombre) : '<span style="color:var(--text-muted)">Sin vendedor</span>';
        showToast('Vendedor actualizado (solo ese dato; montos y Caja no cambian).');
      } finally { ocupado = false; }
    };
  }
  async function init() {
    for (let i = 0; i < 40 && !uid(); i++) await new Promise(r => setTimeout(r, 250));
    await cargar();
    dibujar();
    // Los pasos de la venta se redibujan: se vuelve a poner el selector si hiciera falta.
    if (V.activo) setInterval(dibujar, 1500);
  }
  window.N360Vendedor = { payload, validar, htmlDetalle, _cambio, _editar, estado: () => ({ ...V }) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
