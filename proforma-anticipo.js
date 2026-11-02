/* ============================================================
   ANTICIPO DE PEDIDOS   (ciclo opcional, Fase 3c)
   Cobra un adelanto de una proforma APROBADA. Usa el Certificado de regalo en modo
   "anticipo": el dinero entra a Caja hoy (no cuenta como venta) y se aplica solo como
   pago al convertir la proforma en venta. Toda la contabilidad la hace la base de datos.
   Solo funciona si están activos: Pedidos con producción, Anticipo de pedidos y Certificados.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ProfAnt) return;
  var ocupado = false, bancos = null;
  function $(id) { return document.getElementById(id); }
  function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function money(n) { try { return fmt(n); } catch (_) { return Number(n || 0).toFixed(2); } }
  function activo() {
    try { var c = STATE.empresaConfig || {}; return c.usa_ciclo_produccion_pedidos === true && c.usa_anticipo_pedidos === true && c.usa_modulo_certificados === true; } catch (_) { return false; }
  }

  async function pintar(p, body) {
    var viejo = $('pfa-detalle'); if (viejo) viejo.remove();
    if (!body || !(STATE.empresaConfig || {}).usa_modulo_certificados) return;
    var r = await sbClient.rpc('proforma_anticipo_resumen', { p_proforma_id: p.id });
    var d = r.data || {};
    var certs = d.certificados || [];
    var puede = activo() && p.estado === 'aprobada';
    if (!certs.length && !puede) return;
    var filas = certs.map(function (c) {
      return '<tr><td><strong style="font-family:var(--font-mono)">' + e(c.codigo) + '</strong></td><td class="td-right">' + money(c.monto) + '</td><td class="td-right">' + money(c.saldo) + '</td><td>' + (c.estado === 'agotado' ? 'Usado' : 'Disponible') + '</td></tr>';
    }).join('');
    var html = '<div id="pfa-detalle" style="margin-top:16px;padding:12px;border:1px solid var(--border);border-radius:10px">' +
      '<div style="font-weight:700;margin-bottom:8px">💵 Anticipo de esta proforma</div>' +
      (filas ? '<div class="table-wrap"><table><thead><tr><th>Certificado</th><th class="th-right">Cobrado</th><th class="th-right">Saldo</th><th>Estado</th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
        '<p style="margin-top:8px;font-size:12.5px;color:var(--text-secondary)">Al convertir la proforma en venta, el anticipo se aplica solo como pago.</p>' : '<p style="font-size:12.5px;color:var(--text-secondary)">Aún no se ha cobrado anticipo.</p>') +
      (puede ? '<button class="btn-secondary" style="margin-top:8px" onclick="N360ProfAnt.abrir()">💵 Cobrar anticipo</button>' : '') + '</div>';
    body.insertAdjacentHTML('beforeend', html);
  }

  function asegurarModal() {
    if ($('modal-pf-anticipo')) return;
    var d = document.createElement('div');
    d.className = 'modal-overlay'; d.id = 'modal-pf-anticipo';
    d.setAttribute('onclick', "if(event.target===this)closeModal('modal-pf-anticipo')");
    d.innerHTML = '<div class="modal-box"><div class="modal-header"><h3>💵 Cobrar anticipo</h3><button class="modal-close" onclick="closeModal(\'modal-pf-anticipo\')">&times;</button></div>' +
      '<div class="modal-body"><p id="pfa-info" style="font-size:13px;margin-bottom:10px"></p>' +
      '<div class="form-group"><label>Monto del anticipo</label><input type="number" id="pfa-monto" class="form-input" min="0" step="0.01"></div>' +
      '<div class="form-group"><label>Método de pago</label><select id="pfa-metodo" onchange="N360ProfAnt.cambioMetodo()"></select></div>' +
      '<div class="form-group" id="pfa-wrap-banco" style="display:none"><label>Banco</label><select id="pfa-banco"></select></div>' +
      '<p style="font-size:12.5px;color:var(--text-secondary)">El dinero entra a Caja hoy, pero <strong>no cuenta como venta</strong> hasta que conviertas la proforma.</p>' +
      '<p id="pfa-error" style="color:var(--danger);font-size:12.5px;margin-top:6px"></p></div>' +
      '<div class="modal-footer"><button class="btn-ghost" onclick="closeModal(\'modal-pf-anticipo\')">Cancelar</button><button class="btn-primary" id="pfa-ok" onclick="N360ProfAnt.cobrar()">Cobrar anticipo</button></div></div>';
    document.body.appendChild(d);
  }

  async function abrir() {
    var p = STATE.proformaActual; if (!p || !activo()) return;
    asegurarModal();
    if (!(STATE.metodosPago && STATE.metodosPago.length)) { try { await loadMetodosPago(); } catch (_) { /* nada */ } }
    var mp = (STATE.metodosPago && STATE.metodosPago.length) ? STATE.metodosPago : [{ id: null, nombre: 'Efectivo' }];
    $('pfa-metodo').innerHTML = mp.map(function (m) { return '<option value="' + (m.id || '') + '" data-nombre="' + e(m.nombre) + '">' + e(m.nombre) + '</option>'; }).join('');
    var r = await sbClient.rpc('proforma_anticipo_resumen', { p_proforma_id: p.id });
    var ya = ((r.data || {}).certificados || []).reduce(function (t, c) { return t + Number(c.monto || 0); }, 0);
    $('pfa-info').innerHTML = 'Total de la proforma: <strong>' + money(p.total) + '</strong>' + (ya ? ' · ya cobrado: <strong>' + money(ya) + '</strong>' : '');
    $('pfa-monto').value = ''; $('pfa-error').textContent = ''; $('pfa-ok').disabled = false;
    await cambioMetodo();
    openModal('modal-pf-anticipo');
  }

  async function cambioMetodo() {
    var sel = $('pfa-metodo'), wrap = $('pfa-wrap-banco'), b = $('pfa-banco'); if (!sel || !wrap) return;
    var nombre = ((sel.selectedOptions[0] || {}).dataset || {}).nombre || '';
    if (!/tarjeta|transferencia/i.test(nombre)) { wrap.style.display = 'none'; b.value = ''; return; }
    if (!bancos) {
      var r = await sbClient.from('bancos').select('id,nombre,moneda,activo').eq('auth_user_id', STATE.userId).eq('activo', true).order('created_at');
      var mon = (STATE.empresaConfig || {}).moneda === 'USD' ? 'USD' : 'NIO';
      bancos = (r.data || []).filter(function (x) { return (x.moneda || 'NIO') === mon; });
    }
    if (!bancos.length) { wrap.style.display = 'none'; return; }
    b.innerHTML = '<option value="">Sin banco</option>' + bancos.map(function (x) { return '<option value="' + x.id + '">' + e(x.nombre) + '</option>'; }).join('');
    wrap.style.display = '';
  }

  var MSG = { desactivado: 'La opción de anticipo está apagada en Configuración.', sin_certificados: 'Activa el módulo de Certificados de regalo en Configuración.',
    estado: 'Solo las proformas aprobadas reciben anticipo.', monto: 'Escribe el monto del anticipo.', no_existe: 'No se encontró la proforma.' };
  async function cobrar() {
    if (ocupado) return;
    var p = STATE.proformaActual; if (!p) return;
    var monto = Math.round((parseFloat($('pfa-monto').value) || 0) * 100) / 100;
    var err = $('pfa-error'); err.textContent = '';
    if (!(monto > 0)) { err.textContent = MSG.monto; return; }
    ocupado = true; $('pfa-ok').disabled = true;
    try {
      var sel = $('pfa-metodo'), wrap = $('pfa-wrap-banco');
      var args = { monto: monto, metodo_pago_id: sel.value || null, metodo_pago_nombre: ((sel.selectedOptions[0] || {}).dataset || {}).nombre || 'Efectivo',
        banco_id: (wrap.style.display !== 'none' ? $('pfa-banco').value : '') || null,
        creado_por: (typeof obtenerNombrePerfilActivo === 'function' && obtenerNombrePerfilActivo()) || null };
      var r = await sbClient.rpc('proforma_cobrar_anticipo', { p_proforma_id: p.id, p: args });
      if (r.error) throw r.error;
      var d = r.data || {};
      if (!d.ok) {
        err.textContent = d.motivo === 'excede' ? 'El anticipo no puede pasar del total de la proforma (ya cobrado: ' + money(d.ya_cobrado) + ' de ' + money(d.total) + ').' : (MSG[d.motivo] || 'No se pudo cobrar el anticipo.');
        $('pfa-ok').disabled = false; return;
      }
      closeModal('modal-pf-anticipo');
      showToast('Anticipo ' + d.codigo + ' cobrado: ' + money(d.monto) + '. Entró a Caja.');
      try { verDetalleProf(p.id); } catch (_) { /* nada */ }
    } catch (ex) {
      console.error('N360ProfAnt.cobrar:', ex);
      err.textContent = (ex && ex.message && !/fetch/i.test(ex.message)) ? ex.message : 'No se pudo cobrar. Revisa tu conexión e intenta de nuevo.';
      $('pfa-ok').disabled = false;
    } finally { ocupado = false; }
  }

  window.N360ProfAnt = { pintar: pintar, abrir: abrir, cobrar: cobrar, cambioMetodo: cambioMetodo, activo: activo };
})();
