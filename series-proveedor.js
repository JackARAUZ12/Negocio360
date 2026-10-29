/* =====================================================
   SERIES-PROVEEDOR.JS — Negocio360
   Números de serie desde la COMPRA + garantía y reclamos del proveedor.
   SOLO funciona si el negocio tiene activado "números de serie" en Configuración
   (empresaConfig.usa_numero_serie === true) y solo para productos marcados
   "requiere número de serie". Si no, este archivo no hace nada.

   Qué hace:
     · Después de guardar una compra, pide las series de las unidades recibidas
       (escáner, pegar lista, rango o a mano). Se puede "completar después".
     · Cada serie queda con su compra, proveedor, garantía del proveedor y estado
       (en stock → vendida → en reclamo → devuelta al proveedor).
     · Al vender, la serie en stock pasa a "vendida" (no se duplica).
     · Panel "Series y garantías": series, reclamos al proveedor y pendientes.
   NUNCA mueve caja, créditos, contabilidad ni el stock del producto:
   el stock sigue saliendo/entrando exactamente igual que antes.
===================================================== */
(function () {
  'use strict';
  if (window.N360Series) return;

  var ESTADOS = { en_stock: 'En stock', vendida: 'Vendida', en_reclamo: 'En reclamo', devuelta_proveedor: 'Devuelta al proveedor' };
  var ESTADOS_RECLAMO = { abierto: 'Abierto', enviado: 'Enviado al proveedor', aprobado: 'Aprobado', resuelto: 'Resuelto', rechazado: 'Rechazado' };
  var RESULTADOS = { reemplazo: 'Reemplazo', reparacion: 'Reparación', credito: 'Nota de crédito', otro: 'Otro' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hoy() { return ymd(new Date()); }
  function fc(iso) { var s = String(iso || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—'; }
  function sumarMeses(iso, m) { var d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); d.setMonth(d.getMonth() + Math.round(Number(m) || 0)); return ymd(d); }
  function diasHasta(iso) { return Math.round((new Date(String(iso).slice(0, 10) + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 86400000); }
  function aviso(msg, tipo) { try { if (typeof showToast === 'function') showToast(msg, tipo || 'success'); } catch (e) {} }
  function activo(cfg) { return !!cfg && cfg.usa_numero_serie === true; }
  function escLike(s) { return String(s).replace(/[\\%_]/g, function (c) { return '\\' + c; }); }
  function parseLista(txt) { return String(txt || '').split(/[\n\r,;\t]+/).map(function (x) { return x.trim(); }).filter(Boolean); }
  function nombreUsuario() { try { var p = JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null'); return (p && p.nombre) || 'Admin'; } catch (e) { return 'Admin'; } }

  function inyectarEstilos() {
    if (document.getElementById('nsp-estilos')) return;
    var s = document.createElement('style'); s.id = 'nsp-estilos';
    s.textContent =
      '.nsp-ov{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9990;display:flex;align-items:center;justify-content:center;padding:12px}' +
      '.nsp-box{background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);border-radius:14px;width:100%;max-width:720px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.3)}' +
      '.nsp-box.nsp-ancho{max-width:1040px}' +
      '.nsp-h{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--border,#e8e8ef);font-weight:700;font-size:15px}' +
      '.nsp-b{padding:14px 18px;overflow-y:auto;display:flex;flex-direction:column;gap:14px}' +
      '.nsp-f{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--border,#e8e8ef);justify-content:flex-end}' +
      '.nsp-x{background:none;border:none;font-size:18px;cursor:pointer;color:inherit}' +
      '.nsp-muted{color:var(--text-muted,#777);font-size:12.5px}' +
      '.nsp-in{padding:8px 10px;border:1px solid var(--border,#e8e8ef);border-radius:8px;font-size:13px;background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);box-sizing:border-box;max-width:100%}' +
      '.nsp-ta{width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;resize:vertical}' +
      '.nsp-lin{border:1px solid var(--border,#e8e8ef);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px}' +
      '.nsp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.nsp-cnt{font-size:12.5px;font-weight:600}.nsp-ok{color:var(--success,#16a34a)}.nsp-mal{color:var(--danger,#dc2626)}' +
      '.nsp-tab{padding:8px 14px;border:none;background:none;cursor:pointer;font-size:13.5px;color:var(--text-muted,#777);border-bottom:2px solid transparent;font-weight:600}' +
      '.nsp-tab.on{color:var(--accent,#5a5af4);border-bottom-color:var(--accent,#5a5af4)}' +
      '.nsp-tabs{display:flex;gap:4px;border-bottom:1px solid var(--border,#e8e8ef);overflow-x:auto}' +
      '.nsp-tbl{width:100%;border-collapse:collapse;font-size:13px}' +
      '.nsp-tbl th{text-align:left;padding:8px;border-bottom:1px solid var(--border,#e8e8ef);font-size:12px;color:var(--text-muted,#777);white-space:nowrap}' +
      '.nsp-tbl td{padding:8px;border-bottom:1px solid var(--border,#e8e8ef);vertical-align:top}' +
      '.nsp-tw{overflow-x:auto}' +
      '.nsp-bd{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11.5px;font-weight:600;background:var(--bg-hover,#eee);white-space:nowrap}' +
      '.nsp-bd.g{background:#dcfce7;color:#166534}.nsp-bd.y{background:#fef3c7;color:#92400e}.nsp-bd.r{background:#fee2e2;color:#991b1b}.nsp-bd.b{background:#dbeafe;color:#1e40af}' +
      '[data-theme="dark"] .nsp-bd.g{background:#14532d;color:#bbf7d0}[data-theme="dark"] .nsp-bd.y{background:#78350f;color:#fde68a}[data-theme="dark"] .nsp-bd.r{background:#7f1d1d;color:#fecaca}[data-theme="dark"] .nsp-bd.b{background:#1e3a8a;color:#bfdbfe}' +
      '.nsp-bt{padding:7px 12px;border-radius:8px;border:1px solid var(--border,#e8e8ef);background:var(--bg-surface,#fff);color:var(--text-primary,#0d0d14);cursor:pointer;font-size:13px}' +
      '.nsp-bt.p{background:var(--accent,#5a5af4);border-color:var(--accent,#5a5af4);color:#fff}' +
      '.nsp-bt:disabled{opacity:.55;cursor:default}' +
      '.nsp-bt.s{padding:4px 9px;font-size:12px}' +
      '.nsp-err{color:var(--danger,#dc2626);font-size:12.5px;display:none}';
    document.head.appendChild(s);
  }

  function overlay(html, ancho) {
    inyectarEstilos();
    var d = document.createElement('div'); d.className = 'nsp-ov';
    d.innerHTML = '<div class="nsp-box' + (ancho ? ' nsp-ancho' : '') + '">' + html + '</div>';
    document.body.appendChild(d);
    d.close = function () { d.remove(); };
    return d;
  }
  function confirmar(titulo, texto, botonOk) {
    return new Promise(function (ok) {
      var d = overlay('<div class="nsp-h"><span>' + esc(titulo) + '</span></div><div class="nsp-b"><div>' + esc(texto) + '</div></div><div class="nsp-f"><button class="nsp-bt" id="nsp-c-no">Cancelar</button><button class="nsp-bt p" id="nsp-c-si">' + esc(botonOk || 'Confirmar') + '</button></div>');
      d.querySelector('#nsp-c-no').onclick = function () { d.close(); ok(false); };
      d.querySelector('#nsp-c-si').onclick = function () { d.close(); ok(true); };
    });
  }

  async function leerTodo(construir) {
    var out = [];
    for (var desde = 0; desde < 500000; desde += 1000) {
      var r = await construir().order('id', { ascending: true }).range(desde, desde + 999);
      if (r.error) throw r.error;
      var d = r.data || []; for (var i = 0; i < d.length; i++) out.push(d[i]);
      if (d.length < 1000) break;
    }
    return out;
  }

  /* ---------- 1) REGISTRAR SERIES AL COMPRAR ---------- */
  // lineas: [{detalleId, productoId, nombre, sku, cantidad, garantiaMeses}]
  // ctx: {sb,userId,compraId,numero,fecha,proveedor:{id,nombre}}
  function abrirRegistro(ctx, lineas, opciones) {
    opciones = opciones || {};
    var bloques = lineas.map(function (l, i) {
      var filas = Math.min(Math.max(l.cantidad, 2), 10) + 1;
      return '<div class="nsp-lin" data-i="' + i + '">' +
        '<div style="font-weight:600">' + esc(l.nombre) + (l.sku ? ' <span class="nsp-muted">(' + esc(l.sku) + ')</span>' : '') + ' — <span class="nsp-cnt" data-cnt="' + i + '">0 de ' + l.cantidad + '</span></div>' +
        '<textarea class="nsp-in nsp-ta" data-ta="' + i + '" rows="' + filas + '" placeholder="Escanea o escribe una serie por línea (' + l.cantidad + ' en total)" autocomplete="off" spellcheck="false"></textarea>' +
        '<div class="nsp-row"><span class="nsp-muted">Rango:</span>' +
          '<input class="nsp-in" data-pre="' + i + '" placeholder="Prefijo (ej. SN)" style="width:110px"/>' +
          '<input class="nsp-in" data-des="' + i + '" type="number" min="0" placeholder="Desde" style="width:90px"/>' +
          '<button type="button" class="nsp-bt s" data-gen="' + i + '">Generar</button>' +
          '<span class="nsp-muted" style="margin-left:auto">Garantía del proveedor:</span>' +
          '<input class="nsp-in" data-gar="' + i + '" type="number" min="0" step="1" value="' + (l.garantiaMeses || '') + '" placeholder="meses" style="width:80px"/>' +
        '</div><div class="nsp-err" data-err="' + i + '"></div></div>';
    }).join('');
    var d = overlay(
      '<div class="nsp-h"><span>🔢 Números de serie — ' + esc(opciones.titulo || ('Compra ' + (ctx.numero || ''))) + '</span><button class="nsp-x" data-x>✕</button></div>' +
      '<div class="nsp-b"><div class="nsp-muted">' + (opciones.sinPendientes ? 'Registra las series de unidades que ya tienes. ' : '') + 'Cada unidad tiene su propia serie. Con un lector de códigos solo escanea: cada lectura baja a la siguiente línea. También puedes pegar la lista del proveedor, o generar un rango (SN1001 a SN1010). ' + (opciones.sinPendientes ? 'Esto no cambia el stock ni el dinero.' : 'Si no las tienes ahora, usa <b>Completar después</b>: esto no cambia el stock ni el dinero de la compra.') + '</div>' + bloques +
      '<div class="nsp-err" id="nsp-err-g"></div></div>' +
      '<div class="nsp-f">' + (opciones.sinPendientes ? '<button class="nsp-bt" id="nsp-despues">Cancelar</button>' : '<button class="nsp-bt" id="nsp-despues">Completar después</button>') + '<button class="nsp-bt p" id="nsp-guardar">Guardar series</button></div>');
    function ta(i) { return d.querySelector('[data-ta="' + i + '"]'); }
    function actualizar(i) {
      var vals = parseLista(ta(i).value), c = d.querySelector('[data-cnt="' + i + '"]');
      var lower = vals.map(function (v) { return v.toLowerCase(); });
      var dup = lower.some(function (v, k) { return lower.indexOf(v) !== k; });
      c.textContent = vals.length + ' de ' + lineas[i].cantidad + (dup ? ' · hay series repetidas' : '');
      c.className = 'nsp-cnt ' + (dup || vals.length > lineas[i].cantidad ? 'nsp-mal' : (vals.length === lineas[i].cantidad ? 'nsp-ok' : ''));
    }
    lineas.forEach(function (l, i) {
      ta(i).addEventListener('input', function () { actualizar(i); });
      d.querySelector('[data-gen="' + i + '"]').onclick = function () {
        var pre = d.querySelector('[data-pre="' + i + '"]').value.trim(), des = d.querySelector('[data-des="' + i + '"]').value;
        if (des === '') { d.querySelector('[data-err="' + i + '"]').textContent = 'Escribe desde qué número empieza el rango.'; d.querySelector('[data-err="' + i + '"]').style.display = 'block'; return; }
        d.querySelector('[data-err="' + i + '"]').style.display = 'none';
        var ya = parseLista(ta(i).value), falta = Math.max(0, l.cantidad - ya.length), n0 = parseInt(des, 10), ancho = String(des).length, nuevos = [];
        for (var k = 0; k < falta; k++) nuevos.push(pre + String(n0 + k).padStart(ancho, '0'));
        ta(i).value = ya.concat(nuevos).join('\n'); actualizar(i);
      };
    });
    if (lineas.length) setTimeout(function () { try { ta(0).focus(); } catch (e) {} }, 50);
    var cerrar = function () { d.close(); if (opciones.alCerrar) opciones.alCerrar(); };
    d.querySelector('[data-x]').onclick = cerrar;

    d.querySelector('#nsp-despues').onclick = async function () {
      var b = this; b.disabled = true;
      if (opciones.sinPendientes) { d.close(); if (opciones.alCerrar) opciones.alCerrar(); return; }
      try { await guardarPendientes(ctx, lineas.map(function (l) { return { l: l, faltan: l.cantidad }; })); aviso('Quedó pendiente: lo completas en Compras › Series y garantías'); }
      catch (e) { console.warn('series pendientes:', e); }
      d.close(); if (opciones.alCerrar) opciones.alCerrar();
    };
    d.querySelector('#nsp-guardar').onclick = async function () {
      var b = this, errG = d.querySelector('#nsp-err-g'); errG.style.display = 'none';
      var datos = [], hayError = false;
      lineas.forEach(function (l, i) {
        var e = d.querySelector('[data-err="' + i + '"]'); e.style.display = 'none';
        var vals = parseLista(ta(i).value), lower = vals.map(function (v) { return v.toLowerCase(); }), msg = '';
        if (lower.some(function (v, k) { return lower.indexOf(v) !== k; })) msg = 'Hay series repetidas en esta lista.';
        else if (vals.length > l.cantidad) msg = 'Pusiste ' + vals.length + ' series y la compra trae ' + l.cantidad + '.';
        if (msg) { e.textContent = msg; e.style.display = 'block'; hayError = true; }
        datos.push({ l: l, vals: vals, gar: parseFloat(d.querySelector('[data-gar="' + i + '"]').value) || 0 });
      });
      if (hayError) return;
      var algo = datos.some(function (x) { return x.vals.length; });
      b.disabled = true; b.textContent = 'Guardando…';
      try {
        // series que ya existen en stock
        for (var k = 0; k < datos.length; k++) {
          var x = datos[k]; if (!x.vals.length) continue;
          var variantes = []; x.vals.forEach(function (v) { [v, v.toUpperCase(), v.toLowerCase()].forEach(function (z) { if (variantes.indexOf(z) < 0) variantes.push(z); }); });
          var ex = await ctx.sb.from('numeros_serie').select('numero_serie').eq('auth_user_id', ctx.userId).eq('producto_id', x.l.productoId).eq('estado', 'en_stock').in('numero_serie', variantes);
          if (ex.error) throw ex.error;
          if ((ex.data || []).length) {
            var e2 = d.querySelector('[data-err="' + k + '"]'); e2.textContent = 'Ya están en stock: ' + ex.data.map(function (r) { return r.numero_serie; }).slice(0, 5).join(', ') + (ex.data.length > 5 ? '…' : '') + '. Quítalas o corrígelas.';
            e2.style.display = 'block'; b.disabled = false; b.textContent = 'Guardar series'; return;
          }
        }
        var filas = [];
        datos.forEach(function (x) {
          x.vals.forEach(function (v) {
            filas.push({ auth_user_id: ctx.userId, producto_id: x.l.productoId, numero_serie: v, estado: 'en_stock', compra_id: ctx.compraId, compra_detalle_id: x.l.detalleId || null,
              proveedor_id: ctx.proveedor && ctx.proveedor.id || null, proveedor_nombre: ctx.proveedor && ctx.proveedor.nombre || null, fecha_compra: ctx.fecha || hoy(),
              garantia_proveedor_meses: x.gar || null, garantia_proveedor_vence: x.gar ? sumarMeses(ctx.fecha || hoy(), x.gar) : null, updated_at: new Date().toISOString() });
          });
        });
        for (var p = 0; p < filas.length; p += 200) {
          var ins = await ctx.sb.from('numeros_serie').insert(filas.slice(p, p + 200));
          if (ins.error) throw ins.error;
        }
        // recordar la garantía del proveedor por producto (solo ese dato nuevo)
        for (var g = 0; g < datos.length; g++) {
          if (datos[g].gar) { try { await ctx.sb.from('productos').update({ garantia_proveedor_meses: datos[g].gar }).eq('id', datos[g].l.productoId).eq('auth_user_id', ctx.userId); } catch (eg) {} }
        }
        // pendientes: lo que falte
        await guardarPendientes(ctx, datos.map(function (x) { return { l: x.l, faltan: x.l.cantidad - x.vals.length }; }));
        var faltan = datos.reduce(function (s, x) { return s + (x.l.cantidad - x.vals.length); }, 0);
        aviso(algo ? (filas.length + ' series registradas' + (faltan ? ' · faltan ' + faltan + ' por completar' : '')) : 'Quedó pendiente');
        d.close(); if (opciones.alCerrar) opciones.alCerrar(true);
      } catch (e) {
        console.error('registrar series:', e);
        errG.textContent = 'No se pudieron guardar: ' + (e && e.message ? e.message : 'error'); errG.style.display = 'block';
        b.disabled = false; b.textContent = 'Guardar series';
      }
    };
  }

  async function guardarPendientes(ctx, items) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i], l = it.l;
      if (!l.detalleId) continue;
      if (it.faltan > 0) {
        await ctx.sb.from('series_compra_pendientes').upsert({ auth_user_id: ctx.userId, compra_id: ctx.compraId, compra_detalle_id: l.detalleId, numero_compra: ctx.numero || null, fecha_compra: ctx.fecha || null,
          producto_id: l.productoId, producto_nombre: l.nombre, proveedor_id: ctx.proveedor && ctx.proveedor.id || null, proveedor_nombre: ctx.proveedor && ctx.proveedor.nombre || null, cantidad_faltante: it.faltan }, { onConflict: 'compra_detalle_id' });
      } else {
        await ctx.sb.from('series_compra_pendientes').delete().eq('compra_detalle_id', l.detalleId).eq('auth_user_id', ctx.userId);
      }
    }
  }

  // Se llama justo después de guardar una compra. Nunca lanza error hacia la compra.
  async function despuesDeCompra(ctx) {
    try {
      if (!activo(ctx.empresaConfig)) return;
      var det = await ctx.sb.from('detalle_compras').select('id,producto_id,producto_nombre,producto_sku,cantidad').eq('compra_id', ctx.compraId).eq('auth_user_id', ctx.userId);
      if (det.error || !det.data || !det.data.length) return;
      var ids = det.data.map(function (x) { return x.producto_id; }).filter(Boolean);
      var pr = await ctx.sb.from('productos').select('id,requiere_numero_serie,garantia_proveedor_meses').eq('auth_user_id', ctx.userId).in('id', ids);
      var mapa = {}; ((pr.data) || []).forEach(function (p) { mapa[p.id] = p; });
      var lineas = det.data.filter(function (x) { return mapa[x.producto_id] && mapa[x.producto_id].requiere_numero_serie && Math.floor(Number(x.cantidad)) >= 1; }).map(function (x) {
        return { detalleId: x.id, productoId: x.producto_id, nombre: x.producto_nombre, sku: x.producto_sku, cantidad: Math.floor(Number(x.cantidad)), garantiaMeses: mapa[x.producto_id].garantia_proveedor_meses || '' };
      });
      if (!lineas.length) return;
      abrirRegistro(ctx, lineas, {});
    } catch (e) { console.warn('series después de compra (no afecta la compra):', e); }
  }

  /* ---------- 2) VENTAS: la serie en stock pasa a vendida ---------- */
  async function marcarVendidas(sb, userId, ventaId, clienteId, fecha, series) {
    var restantes = [];
    for (var i = 0; i < series.length; i++) {
      var s = series[i];
      try {
        var r = await sb.from('numeros_serie').update({ estado: 'vendida', venta_id: ventaId, cliente_id: clienteId || null, fecha_venta: fecha || hoy(), combo_id: s.combo_id || null, combo_nombre: s.combo_nombre || null, updated_at: new Date().toISOString() })
          .eq('auth_user_id', userId).eq('producto_id', s.producto_id).eq('estado', 'en_stock').ilike('numero_serie', escLike(s.numero_serie)).select('id');
        if (r.error || !r.data || !r.data.length) restantes.push(s);
      } catch (e) { restantes.push(s); }
    }
    return restantes;
  }

  async function validarVenta(sb, userId, items) {
    try {
      var vistos = {};
      for (var i = 0; i < items.length; i++) {
        var k = items[i].producto_id + '|' + String(items[i].numero_serie).toLowerCase();
        if (vistos[k]) return 'La serie "' + items[i].numero_serie + '" está repetida en esta venta.';
        vistos[k] = 1;
      }
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var r = await sb.from('numeros_serie').select('estado,compra_id').eq('auth_user_id', userId).eq('producto_id', it.producto_id).ilike('numero_serie', escLike(it.numero_serie)).in('estado', ['vendida', 'en_reclamo', 'devuelta_proveedor']);
        if (!r.error && r.data && r.data.length) {
          var est = r.data[0].estado;
          return 'La serie "' + it.numero_serie + '" ya figura como ' + (ESTADOS[est] || est).toLowerCase() + '. Si el cliente la devolvió, márcala "Volver a stock" en Compras › Series y garantías.';
        }
      }
    } catch (e) { console.warn('validarVenta:', e); }
    return null;
  }

  // Ventana de venta: por cada unidad se elige la serie exacta entre las que están en stock.
  // Si el producto no tiene series cargadas, o se escribe otra, la venta sigue como siempre (solo con aviso).
  async function decorarModalVenta(sb, userId, slots) {
    try {
      var ids = []; slots.forEach(function (s) { if (s.producto_id && ids.indexOf(s.producto_id) < 0) ids.push(s.producto_id); });
      if (!ids.length) return;
      var por = {};
      for (var i = 0; i < ids.length; i += 40) {
        var r = await sb.from('numeros_serie').select('producto_id,numero_serie').eq('auth_user_id', userId).eq('estado', 'en_stock').in('producto_id', ids.slice(i, i + 40)).order('numero_serie').limit(1000);
        if (r.error) return;
        (r.data || []).forEach(function (x) { (por[x.producto_id] = por[x.producto_id] || []).push(x.numero_serie); });
      }
      var cont = document.getElementById('ns-lista-campos'); if (!cont) return;
      var inputs = Array.prototype.slice.call(cont.querySelectorAll('.ns-input'));
      function elegidas(pid, excepto) { return inputs.filter(function (x) { var sl = slots[parseInt(x.getAttribute('data-idx'), 10)]; return x !== excepto && sl && sl.producto_id === pid && x.value.trim(); }).map(function (x) { return x.value.trim().toLowerCase(); }); }
      function refrescar() {
        inputs.forEach(function (inp) {
          var sl = slots[parseInt(inp.getAttribute('data-idx'), 10)]; if (!sl || !por[sl.producto_id]) return;
          var wrap = inp.parentNode, sel = wrap.querySelector('.nsp-sel'), av = wrap.querySelector('.nsp-aviso');
          var otras = elegidas(sl.producto_id, inp), val = inp.value.trim().toLowerCase();
          var libres = por[sl.producto_id].filter(function (v) { return otras.indexOf(v.toLowerCase()) < 0; });
          var actual = sel.value;
          sel.innerHTML = '<option value="">— Elegir serie en stock (' + libres.length + ') —</option>' + libres.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
          sel.value = libres.indexOf(actual) >= 0 ? actual : '';
          var enLista = !!val && por[sl.producto_id].some(function (v) { return v.toLowerCase() === val; });
          av.textContent = !val ? '' : (enLista ? '✓ Serie en stock' : 'Esta serie no está entre las cargadas: la venta se guarda igual, pero sin enlace a la compra ni garantía del proveedor.');
          av.style.color = enLista ? '#16a34a' : '#b45309';
        });
      }
      inputs.forEach(function (inp) {
        var sl = slots[parseInt(inp.getAttribute('data-idx'), 10)];
        if (!sl || !por[sl.producto_id]) return;
        var sel = document.createElement('select'); sel.className = 'form-input nsp-sel'; sel.style.marginBottom = '6px';
        var av = document.createElement('div'); av.className = 'nsp-aviso'; av.style.cssText = 'font-size:12px;margin-top:4px';
        inp.parentNode.insertBefore(sel, inp); inp.parentNode.appendChild(av);
        inp.placeholder = 'o escanea / escribe la serie';
        sel.onchange = function () { if (sel.value) { inp.value = sel.value; } refrescar(); };
        inp.addEventListener('input', refrescar);
      });
      refrescar();
    } catch (e) { console.warn('decorarModalVenta:', e); }
  }

  /* ---------- 3) PANEL: series · reclamos · pendientes ---------- */
  function badgeGarantia(vence) {
    if (!vence) return '<span class="nsp-muted">—</span>';
    var d = diasHasta(vence);
    if (d < 0) return '<span class="nsp-bd r" title="Venció el ' + fc(vence) + '">Vencida ' + fc(vence) + '</span>';
    if (d <= 30) return '<span class="nsp-bd y">Vence en ' + d + ' d · ' + fc(vence) + '</span>';
    return '<span class="nsp-bd g">Hasta ' + fc(vence) + '</span>';
  }
  function badgeEstado(e) {
    var cl = { en_stock: 'b', vendida: 'g', en_reclamo: 'y', devuelta_proveedor: '' }[e] || '';
    return '<span class="nsp-bd ' + cl + '">' + esc(ESTADOS[e] || e) + '</span>';
  }

  async function abrirPanel(ctx, tabInicial) {
    if (!activo(ctx.empresaConfig)) { aviso('Activa los números de serie en Configuración para usar esto', 'warning'); return; }
    var d = overlay(
      '<div class="nsp-h"><span>🛡️ Series y garantías de proveedor</span><button class="nsp-x" data-x>✕</button></div>' +
      '<div class="nsp-tabs"><button class="nsp-tab on" data-t="series">Series</button><button class="nsp-tab" data-t="reclamos">Reclamos al proveedor</button><button class="nsp-tab" data-t="pend">Pendientes <span id="nsp-npend"></span></button></div>' +
      '<div class="nsp-b" id="nsp-cuerpo" style="min-height:260px"></div>', true);
    var st = { tab: tabInicial || 'series', cargado: false, series: [], reclamos: [], pend: [], compras: {}, clientes: {}, prods: {}, q: '', est: '', prod: '', vence: '' };
    d.querySelector('[data-x]').onclick = function () { d.close(); };
    d.addEventListener('mousedown', function (e) { if (e.target === d) d.close(); });
    var cuerpo = d.querySelector('#nsp-cuerpo');

    async function cargar() {
      cuerpo.innerHTML = '<div class="nsp-muted">Cargando…</div>';
      try {
        st.series = await leerTodo(function () { return ctx.sb.from('numeros_serie').select('id,producto_id,numero_serie,estado,compra_id,proveedor_id,proveedor_nombre,fecha_compra,garantia_proveedor_meses,garantia_proveedor_vence,venta_id,cliente_id,fecha_venta,combo_nombre').eq('auth_user_id', ctx.userId); });
        st.reclamos = await leerTodo(function () { return ctx.sb.from('reclamos_proveedor').select('*').eq('auth_user_id', ctx.userId); });
        st.pend = await leerTodo(function () { return ctx.sb.from('series_compra_pendientes').select('*').eq('auth_user_id', ctx.userId); });
        var pid = {}; st.series.forEach(function (s) { pid[s.producto_id] = 1; });
        var ids = Object.keys(pid), pr = [];
        for (var i = 0; i < ids.length; i += 80) { var r = await ctx.sb.from('productos').select('id,nombre,sku').eq('auth_user_id', ctx.userId).in('id', ids.slice(i, i + 80)); pr = pr.concat(r.data || []); }
        st.prods = {}; pr.forEach(function (p) { st.prods[p.id] = p; });
        var cid = {}, vid = {}; st.series.forEach(function (s) { if (s.compra_id) cid[s.compra_id] = 1; if (s.cliente_id) vid[s.cliente_id] = 1; });
        var cids = Object.keys(cid); st.compras = {};
        for (var j = 0; j < cids.length; j += 80) { var rc = await ctx.sb.from('compras').select('id,numero').eq('auth_user_id', ctx.userId).in('id', cids.slice(j, j + 80)); (rc.data || []).forEach(function (c) { st.compras[c.id] = c.numero; }); }
        var vids = Object.keys(vid); st.clientes = {};
        for (var k = 0; k < vids.length; k += 80) { var rv = await ctx.sb.from('clientes').select('id,nombre,apellido').eq('auth_user_id', ctx.userId).in('id', vids.slice(k, k + 80)); (rv.data || []).forEach(function (c) { st.clientes[c.id] = ((c.nombre || '') + ' ' + (c.apellido || '')).trim(); }); }
        st.cargado = true;
        var np = d.querySelector('#nsp-npend'); if (np) np.textContent = st.pend.length ? '(' + st.pend.length + ')' : '';
        pintar();
      } catch (e) {
        console.error('panel series:', e);
        cuerpo.innerHTML = '<div class="nsp-err" style="display:block">No se pudo cargar: ' + esc(e && e.message || 'error') + '</div>';
      }
    }
    function estadoReal(s) { return s.estado || 'vendida'; }
    function nombreProd(id) { return (st.prods[id] && st.prods[id].nombre) || '—'; }

    function pintar() {
      d.querySelectorAll('.nsp-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === st.tab); });
      if (st.tab === 'series') pintarSeries(); else if (st.tab === 'reclamos') pintarReclamos(); else pintarPend();
    }

    function pintarSeries() {
      var q = st.q.trim().toLowerCase();
      var lista = st.series.filter(function (s) {
        if (st.est && estadoReal(s) !== st.est) return false;
        if (st.prod && s.producto_id !== st.prod) return false;
        if (st.vence === 'pronto') { if (!s.garantia_proveedor_vence || diasHasta(s.garantia_proveedor_vence) < 0 || diasHasta(s.garantia_proveedor_vence) > 30) return false; }
        if (st.vence === 'vencida') { if (!s.garantia_proveedor_vence || diasHasta(s.garantia_proveedor_vence) >= 0) return false; }
        if (q && (String(s.numero_serie).toLowerCase().indexOf(q) < 0 && nombreProd(s.producto_id).toLowerCase().indexOf(q) < 0 && String(s.proveedor_nombre || '').toLowerCase().indexOf(q) < 0 && String(st.compras[s.compra_id] || '').toLowerCase().indexOf(q) < 0)) return false;
        return true;
      }).sort(function (a, b) { return String(b.fecha_compra || b.fecha_venta || '') < String(a.fecha_compra || a.fecha_venta || '') ? -1 : 1; });
      var cuenta = { en_stock: 0, vendida: 0, en_reclamo: 0 };
      st.series.forEach(function (s) { var e = estadoReal(s); if (cuenta[e] !== undefined) cuenta[e]++; });
      var prodsOpt = Object.keys(st.prods).sort(function (a, b) { return nombreProd(a).localeCompare(nombreProd(b)); }).map(function (id) { return '<option value="' + id + '"' + (st.prod === id ? ' selected' : '') + '>' + esc(nombreProd(id)) + '</option>'; }).join('');
      var maxF = 200, corte = lista.slice(0, maxF);
      cuerpo.innerHTML =
        '<div class="nsp-row"><button class="nsp-bt p s" id="nsp-inv">+ Registrar series de inventario</button><span class="nsp-bd b">En stock: ' + cuenta.en_stock + '</span><span class="nsp-bd g">Vendidas: ' + cuenta.vendida + '</span><span class="nsp-bd y">En reclamo: ' + cuenta.en_reclamo + '</span><span class="nsp-muted">Solo cuentan las series registradas; el stock del producto no cambia por esto.</span></div>' +
        '<div class="nsp-row"><input class="nsp-in" id="nsp-q" placeholder="Buscar serie, producto, proveedor o compra…" value="' + esc(st.q) + '" style="flex:1;min-width:200px"/>' +
        '<select class="nsp-in" id="nsp-est"><option value="">Todos los estados</option>' + Object.keys(ESTADOS).map(function (k) { return '<option value="' + k + '"' + (st.est === k ? ' selected' : '') + '>' + ESTADOS[k] + '</option>'; }).join('') + '</select>' +
        '<select class="nsp-in" id="nsp-prod"><option value="">Todos los productos</option>' + prodsOpt + '</select>' +
        '<select class="nsp-in" id="nsp-vence"><option value="">Garantía: todas</option><option value="pronto"' + (st.vence === 'pronto' ? ' selected' : '') + '>Vence en 30 días</option><option value="vencida"' + (st.vence === 'vencida' ? ' selected' : '') + '>Vencida</option></select></div>' +
        (lista.length ? '<div class="nsp-tw"><table class="nsp-tbl"><thead><tr><th>Serie</th><th>Producto</th><th>Estado</th><th>Proveedor / compra</th><th>Garantía proveedor</th><th>Venta</th><th></th></tr></thead><tbody>' +
          corte.map(function (s) {
            var e = estadoReal(s);
            return '<tr><td><a href="#" data-ficha="' + s.id + '" style="font-weight:700;color:var(--accent,#5a5af4);text-decoration:none" title="Ver historial de la serie">' + esc(s.numero_serie) + '</a></td><td>' + esc(nombreProd(s.producto_id)) + '</td><td>' + badgeEstado(e) + '</td>' +
              '<td>' + (s.proveedor_nombre ? esc(s.proveedor_nombre) : '<span class="nsp-muted">—</span>') + (s.compra_id ? '<div class="nsp-muted">' + esc(st.compras[s.compra_id] || '') + ' · ' + fc(s.fecha_compra) + '</div>' : '') + '</td>' +
              '<td>' + badgeGarantia(s.garantia_proveedor_vence) + '</td>' +
              '<td>' + (e === 'vendida' ? (esc(st.clientes[s.cliente_id] || 'Sin cliente') + '<div class="nsp-muted">' + fc(s.fecha_venta) + '</div>') : '<span class="nsp-muted">—</span>') + '</td>' +
              '<td style="white-space:nowrap">' + ((e === 'en_stock' || e === 'vendida') ? '<button class="nsp-bt s" data-rec="' + s.id + '">Reclamar</button> ' : '') + ((s.estado === 'vendida') ? '<button class="nsp-bt s" data-vol="' + s.id + '" title="Si el cliente la devolvió">Volver a stock</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' + (lista.length > maxF ? '<div class="nsp-muted">Mostrando ' + maxF + ' de ' + lista.length + '. Usa los filtros para acotar.</div>' : '')
          : '<div class="nsp-muted" style="padding:20px 0">No hay series con esos filtros. Las series se registran al guardar una compra de productos que requieren número de serie.</div>');
      cuerpo.querySelector('#nsp-inv').onclick = function () { abrirInventario(ctx, cargar); };
      var q2 = cuerpo.querySelector('#nsp-q');
      q2.oninput = function () { st.q = q2.value; clearTimeout(pintarSeries._t); pintarSeries._t = setTimeout(function () { var pos = q2.selectionStart; pintarSeries(); var n = cuerpo.querySelector('#nsp-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }, 250); };
      cuerpo.querySelector('#nsp-est').onchange = function (e) { st.est = e.target.value; pintarSeries(); };
      cuerpo.querySelector('#nsp-prod').onchange = function (e) { st.prod = e.target.value; pintarSeries(); };
      cuerpo.querySelector('#nsp-vence').onchange = function (e) { st.vence = e.target.value; pintarSeries(); };
      cuerpo.querySelectorAll('[data-ficha]').forEach(function (a) { a.onclick = function (ev) { ev.preventDefault(); var x = st.series.find(function (y) { return y.id === a.getAttribute('data-ficha'); }); if (x) fichaSerie(x); }; });
      cuerpo.querySelectorAll('[data-rec]').forEach(function (b) { b.onclick = function () { var s = st.series.find(function (x) { return x.id === b.getAttribute('data-rec'); }); if (s) nuevoReclamo(s); }; });
      cuerpo.querySelectorAll('[data-vol]').forEach(function (b) { b.onclick = async function () {
        var s = st.series.find(function (x) { return x.id === b.getAttribute('data-vol'); }); if (!s) return;
        if (!(await confirmar('Volver a stock', 'La serie ' + s.numero_serie + ' volverá a "En stock" (el cliente la devolvió). No se cambia el stock del producto ni el dinero; eso lo manejas en la devolución de venta.', 'Volver a stock'))) return;
        var r = await ctx.sb.from('numeros_serie').update({ estado: 'en_stock', venta_id: null, cliente_id: null, fecha_venta: null, updated_at: new Date().toISOString() }).eq('id', s.id).eq('auth_user_id', ctx.userId);
        if (r.error) { aviso('No se pudo: ' + r.error.message, 'error'); return; }
        aviso('Serie de vuelta en stock'); cargar();
      }; });
    }


    async function fichaSerie(s) {
      var e = estadoReal(s), gar = [], recs = st.reclamos.filter(function (r) { return r.numero_serie_id === s.id; });
      try {
        var q = ctx.sb.from('garantias_clientes').select('numero,fecha_compra,fecha_vencimiento,garantia_meses,cliente_nombre,venta_id').eq('auth_user_id', ctx.userId).eq('numero_serie', s.numero_serie);
        if (s.producto_id) q = q.eq('producto_id', s.producto_id);
        var rg = await q.limit(20); gar = rg.data || [];
      } catch (er) { gar = []; }
      var linea = function (t, v) { return '<div class="nsp-row" style="justify-content:space-between;border-bottom:1px solid var(--border,#e8e8ef);padding:6px 0"><span class="nsp-muted">' + t + '</span><span style="text-align:right">' + v + '</span></div>'; };
      var dd = overlay('<div class="nsp-h"><span>Serie ' + esc(s.numero_serie) + '</span><button class="nsp-x" data-x>✕</button></div><div class="nsp-b">' +
        linea('Producto', esc(nombreProd(s.producto_id))) + linea('Estado', badgeEstado(e)) +
        '<div style="font-weight:700;margin-top:6px">Compra y proveedor</div>' +
        linea('Proveedor', esc(s.proveedor_nombre || '—')) + linea('Compra', s.compra_id ? esc(st.compras[s.compra_id] || '') + ' · ' + fc(s.fecha_compra) : (s.fecha_compra ? 'Inventario · ' + fc(s.fecha_compra) : '—')) +
        linea('Garantía del proveedor', s.garantia_proveedor_meses ? esc(s.garantia_proveedor_meses) + ' meses · ' + badgeGarantia(s.garantia_proveedor_vence) : '<span class="nsp-muted">Sin garantía registrada</span>') +
        '<div style="font-weight:700;margin-top:6px">Venta y garantía al cliente</div>' +
        (e === 'vendida' ? linea('Cliente', esc(st.clientes[s.cliente_id] || 'Sin cliente')) + linea('Fecha de venta', fc(s.fecha_venta)) : linea('Venta', '<span class="nsp-muted">Aún no vendida</span>')) +
        (gar.length ? gar.map(function (g) { return linea('Garantía ' + esc(g.numero), esc(g.garantia_meses) + ' meses · ' + badgeGarantia(g.fecha_vencimiento)); }).join('') : linea('Garantía al cliente', '<span class="nsp-muted">—</span>')) +
        '<div style="font-weight:700;margin-top:6px">Reclamos al proveedor</div>' +
        (recs.length ? recs.map(function (r) { return linea(esc(r.numero) + ' · ' + fc(r.fecha_reclamo), esc(ESTADOS_RECLAMO[r.estado] || r.estado) + (r.resultado ? ' · ' + esc(RESULTADOS[r.resultado] || r.resultado) : '')); }).join('') : '<div class="nsp-muted">Sin reclamos.</div>') +
        '</div><div class="nsp-f"><button class="nsp-bt" data-x2>Cerrar</button>' + ((e === 'en_stock' || e === 'vendida') ? '<button class="nsp-bt p" id="fi-rec">Reclamar al proveedor</button>' : '') + '</div>');
      dd.querySelector('[data-x]').onclick = dd.querySelector('[data-x2]').onclick = function () { dd.close(); };
      var br = dd.querySelector('#fi-rec'); if (br) br.onclick = function () { dd.close(); nuevoReclamo(s); };
    }

    function nuevoReclamo(s) {
      var dd = overlay('<div class="nsp-h"><span>Reclamo al proveedor</span><button class="nsp-x" data-x>✕</button></div><div class="nsp-b">' +
        '<div><b>' + esc(s.numero_serie) + '</b> — ' + esc(nombreProd(s.producto_id)) + '<div class="nsp-muted">' + esc(s.proveedor_nombre || 'Sin proveedor registrado') + (s.compra_id ? ' · compra ' + esc(st.compras[s.compra_id] || '') : '') + '</div><div style="margin-top:4px">' + badgeGarantia(s.garantia_proveedor_vence) + '</div></div>' +
        (s.garantia_proveedor_vence && diasHasta(s.garantia_proveedor_vence) < 0 ? '<div class="nsp-muted" style="color:var(--danger,#dc2626)">La garantía del proveedor ya venció; igual puedes registrar el reclamo.</div>' : '') +
        '<label class="nsp-muted">¿Qué falla tiene? (obligatorio)</label><textarea class="nsp-in nsp-ta" id="rc-desc" rows="3" style="font-family:inherit"></textarea>' +
        '<div class="nsp-err" id="rc-err"></div></div><div class="nsp-f"><button class="nsp-bt" data-x2>Cancelar</button><button class="nsp-bt p" id="rc-ok">Crear reclamo</button></div>');
      dd.querySelector('[data-x]').onclick = dd.querySelector('[data-x2]').onclick = function () { dd.close(); };
      dd.querySelector('#rc-ok').onclick = async function () {
        var desc = dd.querySelector('#rc-desc').value.trim(), er = dd.querySelector('#rc-err');
        if (!desc) { er.textContent = 'Describe la falla.'; er.style.display = 'block'; return; }
        this.disabled = true;
        try {
          var ult = await ctx.sb.from('reclamos_proveedor').select('numero').eq('auth_user_id', ctx.userId).order('created_at', { ascending: false }).limit(1);
          var n = 1; if (ult.data && ult.data[0] && /(\d+)$/.test(ult.data[0].numero || '')) n = parseInt(RegExp.$1, 10) + 1;
          var numero = 'RP-' + String(n).padStart(6, '0');
          var ins = await ctx.sb.from('reclamos_proveedor').insert({ auth_user_id: ctx.userId, numero: numero, numero_serie_id: s.id, numero_serie: s.numero_serie, producto_id: s.producto_id, producto_nombre: nombreProd(s.producto_id),
            proveedor_id: s.proveedor_id || null, proveedor_nombre: s.proveedor_nombre || null, compra_id: s.compra_id || null, numero_compra: st.compras[s.compra_id] || null,
            cliente_id: s.cliente_id || null, cliente_nombre: st.clientes[s.cliente_id] || null, fecha_reclamo: hoy(), descripcion: desc, estado: 'abierto', usuario_nombre: nombreUsuario() });
          if (ins.error) throw ins.error;
          await ctx.sb.from('numeros_serie').update({ estado: 'en_reclamo', notas: 'previo:' + estadoReal(s), updated_at: new Date().toISOString() }).eq('id', s.id).eq('auth_user_id', ctx.userId);
          aviso('Reclamo ' + numero + ' creado'); dd.close(); st.tab = 'reclamos'; cargar();
        } catch (e) { er.textContent = 'No se pudo crear: ' + (e && e.message || 'error'); er.style.display = 'block'; this.disabled = false; }
      };
    }

    function pintarReclamos() {
      var orden = st.reclamos.slice().sort(function (a, b) { return String(b.created_at) < String(a.created_at) ? -1 : 1; });
      cuerpo.innerHTML = orden.length ? '<div class="nsp-tw"><table class="nsp-tbl"><thead><tr><th>No.</th><th>Fecha</th><th>Serie / producto</th><th>Proveedor</th><th>Falla</th><th>Estado</th><th></th></tr></thead><tbody>' +
        orden.map(function (r) {
          var cerrado = r.estado === 'resuelto' || r.estado === 'rechazado';
          return '<tr><td><b>' + esc(r.numero) + '</b></td><td>' + fc(r.fecha_reclamo) + '</td><td>' + esc(r.numero_serie) + '<div class="nsp-muted">' + esc(r.producto_nombre) + '</div></td><td>' + esc(r.proveedor_nombre || '—') + (r.numero_compra ? '<div class="nsp-muted">' + esc(r.numero_compra) + '</div>' : '') + '</td>' +
            '<td style="max-width:240px">' + esc(r.descripcion) + (r.resultado ? '<div class="nsp-muted">Resultado: ' + esc(RESULTADOS[r.resultado] || r.resultado) + (r.serie_reemplazo ? ' · nueva serie ' + esc(r.serie_reemplazo) : '') + (r.monto_credito ? ' · crédito ' + esc(r.monto_credito) : '') + '</div>' : '') + '</td>' +
            '<td><span class="nsp-bd ' + (r.estado === 'resuelto' ? 'g' : r.estado === 'rechazado' ? 'r' : 'y') + '">' + esc(ESTADOS_RECLAMO[r.estado] || r.estado) + '</span>' + (r.fecha_cierre ? '<div class="nsp-muted">' + fc(r.fecha_cierre) + '</div>' : '') + '</td>' +
            '<td>' + (cerrado ? '' : '<button class="nsp-bt s" data-act="' + r.id + '">Actualizar</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div><div class="nsp-muted">Los reclamos solo se registran: no mueven caja, deuda ni el stock del producto. Si recibes un crédito o un reemplazo, regístralo donde corresponda (Cuentas por pagar / Compras).</div>'
        : '<div class="nsp-muted" style="padding:20px 0">Aún no hay reclamos. Crea uno desde la pestaña Series con el botón "Reclamar".</div>';
      cuerpo.querySelectorAll('[data-act]').forEach(function (b) { b.onclick = function () { var r = st.reclamos.find(function (x) { return x.id === b.getAttribute('data-act'); }); if (r) actualizarReclamo(r); }; });
    }

    function actualizarReclamo(r) {
      var dd = overlay('<div class="nsp-h"><span>' + esc(r.numero) + ' — ' + esc(r.numero_serie) + '</span><button class="nsp-x" data-x>✕</button></div><div class="nsp-b">' +
        '<label class="nsp-muted">Estado</label><select class="nsp-in" id="ar-est">' + Object.keys(ESTADOS_RECLAMO).map(function (k) { return '<option value="' + k + '"' + (r.estado === k ? ' selected' : '') + '>' + ESTADOS_RECLAMO[k] + '</option>'; }).join('') + '</select>' +
        '<div id="ar-res" style="display:none;flex-direction:column;gap:8px"><label class="nsp-muted">¿Cómo se resolvió?</label><select class="nsp-in" id="ar-resultado">' + Object.keys(RESULTADOS).map(function (k) { return '<option value="' + k + '">' + RESULTADOS[k] + '</option>'; }).join('') + '</select>' +
        '<div id="ar-rep" style="display:flex;flex-direction:column;gap:6px"><label class="nsp-muted">Serie de la pieza nueva</label><input class="nsp-in" id="ar-nueva" placeholder="Nueva serie (opcional)"/><label class="nsp-muted"><input type="checkbox" id="ar-alta" checked/> Registrarla como "En stock" con la misma garantía</label></div>' +
        '<div id="ar-cred" style="display:none;flex-direction:column;gap:6px"><label class="nsp-muted">Monto del crédito (informativo)</label><input class="nsp-in" id="ar-monto" type="number" min="0" step="0.01"/></div></div>' +
        '<label class="nsp-muted">Nota</label><textarea class="nsp-in nsp-ta" id="ar-nota" rows="2" style="font-family:inherit">' + esc(r.resultado_nota || '') + '</textarea><div class="nsp-err" id="ar-err"></div></div>' +
        '<div class="nsp-f"><button class="nsp-bt" data-x2>Cancelar</button><button class="nsp-bt p" id="ar-ok">Guardar</button></div>');
      var est = dd.querySelector('#ar-est'), resBox = dd.querySelector('#ar-res'), resSel = dd.querySelector('#ar-resultado');
      function vista() { resBox.style.display = est.value === 'resuelto' ? 'flex' : 'none'; dd.querySelector('#ar-rep').style.display = resSel.value === 'reemplazo' ? 'flex' : 'none'; dd.querySelector('#ar-cred').style.display = resSel.value === 'credito' ? 'flex' : 'none'; }
      est.onchange = vista; resSel.onchange = vista; vista();
      dd.querySelector('[data-x]').onclick = dd.querySelector('[data-x2]').onclick = function () { dd.close(); };
      dd.querySelector('#ar-ok').onclick = async function () {
        var b = this, er = dd.querySelector('#ar-err'); er.style.display = 'none'; b.disabled = true;
        try {
          var nuevo = est.value, cierre = (nuevo === 'resuelto' || nuevo === 'rechazado');
          var cambios = { estado: nuevo, resultado_nota: dd.querySelector('#ar-nota').value.trim() || null, updated_at: new Date().toISOString() };
          var s = st.series.find(function (x) { return x.id === r.numero_serie_id; });
          if (nuevo === 'resuelto') {
            cambios.resultado = resSel.value; cambios.fecha_cierre = hoy();
            if (resSel.value === 'credito') cambios.monto_credito = parseFloat(dd.querySelector('#ar-monto').value) || null;
            if (resSel.value === 'reemplazo') {
              var nueva = dd.querySelector('#ar-nueva').value.trim();
              if (nueva) {
                cambios.serie_reemplazo = nueva;
                if (dd.querySelector('#ar-alta').checked && s) {
                  var ya = await ctx.sb.from('numeros_serie').select('id').eq('auth_user_id', ctx.userId).eq('producto_id', s.producto_id).eq('estado', 'en_stock').ilike('numero_serie', escLike(nueva));
                  if (ya.data && ya.data.length) throw new Error('La serie nueva ya está en stock.');
                  var ins = await ctx.sb.from('numeros_serie').insert({ auth_user_id: ctx.userId, producto_id: s.producto_id, numero_serie: nueva, estado: 'en_stock', compra_id: s.compra_id || null, proveedor_id: s.proveedor_id || null, proveedor_nombre: s.proveedor_nombre || null,
                    fecha_compra: s.fecha_compra || null, garantia_proveedor_meses: s.garantia_proveedor_meses || null, garantia_proveedor_vence: s.garantia_proveedor_vence || null, notas: 'Reemplazo de ' + s.numero_serie + ' (' + r.numero + ')', updated_at: new Date().toISOString() });
                  if (ins.error) throw ins.error;
                }
              }
            }
          }
          if (nuevo === 'rechazado') cambios.fecha_cierre = hoy();
          var up = await ctx.sb.from('reclamos_proveedor').update(cambios).eq('id', r.id).eq('auth_user_id', ctx.userId);
          if (up.error) throw up.error;
          if (s) {
            if (nuevo === 'resuelto' && resSel.value === 'reemplazo') await ctx.sb.from('numeros_serie').update({ estado: 'devuelta_proveedor', updated_at: new Date().toISOString() }).eq('id', s.id).eq('auth_user_id', ctx.userId);
            else if (cierre) await ctx.sb.from('numeros_serie').update({ estado: (s.notas && /previo:en_stock/.test(s.notas)) || !s.venta_id ? 'en_stock' : 'vendida', updated_at: new Date().toISOString() }).eq('id', s.id).eq('auth_user_id', ctx.userId);
          }
          aviso('Reclamo actualizado'); dd.close(); cargar();
        } catch (e) { er.textContent = 'No se pudo guardar: ' + (e && e.message || 'error'); er.style.display = 'block'; b.disabled = false; }
      };
    }

    function pintarPend() {
      cuerpo.innerHTML = st.pend.length ? '<div class="nsp-muted">Compras con series por registrar. Registrarlas no cambia el stock ni el dinero.</div><div class="nsp-tw"><table class="nsp-tbl"><thead><tr><th>Compra</th><th>Fecha</th><th>Producto</th><th>Proveedor</th><th>Faltan</th><th></th></tr></thead><tbody>' +
        st.pend.map(function (p) { return '<tr><td><b>' + esc(p.numero_compra || '') + '</b></td><td>' + fc(p.fecha_compra) + '</td><td>' + esc(p.producto_nombre) + '</td><td>' + esc(p.proveedor_nombre || '—') + '</td><td>' + p.cantidad_faltante + '</td><td><button class="nsp-bt s p" data-pend="' + p.id + '">Registrar series</button></td></tr>'; }).join('') + '</tbody></table></div>'
        : '<div class="nsp-muted" style="padding:20px 0">No hay series pendientes. 👍</div>';
      cuerpo.querySelectorAll('[data-pend]').forEach(function (b) { b.onclick = async function () {
        var p = st.pend.find(function (x) { return x.id === b.getAttribute('data-pend'); }); if (!p) return;
        var pr = await ctx.sb.from('productos').select('garantia_proveedor_meses').eq('id', p.producto_id).eq('auth_user_id', ctx.userId).maybeSingle();
        abrirRegistro({ sb: ctx.sb, userId: ctx.userId, compraId: p.compra_id, numero: p.numero_compra, fecha: p.fecha_compra, proveedor: { id: p.proveedor_id, nombre: p.proveedor_nombre } },
          [{ detalleId: p.compra_detalle_id, productoId: p.producto_id, nombre: p.producto_nombre, sku: '', cantidad: p.cantidad_faltante, garantiaMeses: pr.data && pr.data.garantia_proveedor_meses || '' }],
          { titulo: 'Compra ' + (p.numero_compra || ''), alCerrar: function (guardado) { if (guardado) cargar(); } });
      }; });
    }

    d.querySelectorAll('.nsp-tab').forEach(function (b) { b.onclick = function () { st.tab = b.getAttribute('data-t'); if (st.cargado) pintar(); }; });
    await cargar();
  }


  /* ---------- Registrar series de inventario que ya existe (sin compra) ---------- */
  async function abrirInventario(ctx, alTerminar) {
    try {
      var prods = await leerTodo(function () { return ctx.sb.from('productos').select('id,nombre,sku,stock_actual,requiere_numero_serie,garantia_proveedor_meses').eq('auth_user_id', ctx.userId).eq('requiere_numero_serie', true); });
      var provs = await leerTodo(function () { return ctx.sb.from('proveedores').select('id,nombre').eq('auth_user_id', ctx.userId); });
      prods.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });
      provs.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });
      if (!prods.length) { aviso('Primero marca "requiere número de serie" en los productos que lo necesiten (Productos › editar)', 'warning'); return; }
      var d = overlay('<div class="nsp-h"><span>Registrar series de inventario</span><button class="nsp-x" data-x>✕</button></div><div class="nsp-b">' +
        '<div class="nsp-muted">Para unidades que ya tienes (productos nuevos o existentes). No cambia el stock ni el dinero.</div>' +
        '<label class="nsp-muted">Producto</label><select class="nsp-in" id="iv-prod">' + prods.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + (p.sku ? ' (' + esc(p.sku) + ')' : '') + '</option>'; }).join('') + '</select>' +
        '<div class="nsp-muted" id="iv-info"></div>' +
        '<label class="nsp-muted">Proveedor</label><select class="nsp-in" id="iv-prov"><option value="">Sin proveedor / no sé</option>' + provs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }).join('') + '</select>' +
        '<div class="nsp-row"><div><label class="nsp-muted">Fecha de compra</label><br/><input class="nsp-in" id="iv-fecha" type="date" value="' + hoy() + '"/></div>' +
        '<div><label class="nsp-muted">¿Cuántas series?</label><br/><input class="nsp-in" id="iv-cant" type="number" min="1" step="1" value="1" style="width:100px"/></div></div>' +
        '<div class="nsp-err" id="iv-err"></div></div><div class="nsp-f"><button class="nsp-bt" data-x2>Cancelar</button><button class="nsp-bt p" id="iv-ok">Continuar</button></div>');
      var sel = d.querySelector('#iv-prod'), info = d.querySelector('#iv-info');
      async function actualizarInfo() {
        var p = prods.find(function (x) { return x.id === sel.value; }); if (!p) return;
        var r = await ctx.sb.from('numeros_serie').select('id').eq('auth_user_id', ctx.userId).eq('producto_id', p.id).eq('estado', 'en_stock').limit(1000);
        var reg = (r.data || []).length, stock = Math.floor(Number(p.stock_actual) || 0);
        info.textContent = 'Stock del producto: ' + stock + ' · series en stock ya registradas: ' + reg;
        d.querySelector('#iv-cant').value = Math.max(1, stock - reg);
      }
      if (ctx.productoId && prods.some(function (x) { return x.id === ctx.productoId; })) sel.value = ctx.productoId;
      sel.onchange = actualizarInfo; actualizarInfo();
      d.querySelector('[data-x]').onclick = d.querySelector('[data-x2]').onclick = function () { d.close(); };
      d.querySelector('#iv-ok').onclick = function () {
        var p = prods.find(function (x) { return x.id === sel.value; }), cant = Math.floor(Number(d.querySelector('#iv-cant').value)), er = d.querySelector('#iv-err');
        if (!p || !(cant >= 1)) { er.textContent = 'Indica cuántas series vas a registrar.'; er.style.display = 'block'; return; }
        var pv = provs.find(function (x) { return x.id === d.querySelector('#iv-prov').value; });
        var fecha = d.querySelector('#iv-fecha').value || hoy();
        d.close();
        abrirRegistro({ sb: ctx.sb, userId: ctx.userId, compraId: null, numero: 'Inventario', fecha: fecha, proveedor: pv ? { id: pv.id, nombre: pv.nombre } : null },
          [{ detalleId: null, productoId: p.id, nombre: p.nombre, sku: p.sku, cantidad: cant, garantiaMeses: p.garantia_proveedor_meses || '' }],
          { titulo: 'Inventario · ' + p.nombre, sinPendientes: true, alCerrar: function (g) { if (g && alTerminar) alTerminar(); } });
      };
    } catch (e) { console.error('abrirInventario:', e); aviso('No se pudo abrir: ' + (e && e.message || 'error'), 'error'); }
  }

  /* ---------- Asistente: qué productos llevan serie y cuántas faltan por cargar ---------- */
  async function abrirAsistente(ctx) {
    if (!activo(ctx.empresaConfig)) { aviso('Activa los números de serie en Configuración', 'warning'); return; }
    var d = overlay('<div class="nsp-h"><span>🔢 Asistente de números de serie</span><button class="nsp-x" data-x>✕</button></div>' +
      '<div class="nsp-tabs"><button class="nsp-tab on" data-t="con">Productos con serie</button><button class="nsp-tab" data-t="marcar">Marcar productos</button></div>' +
      '<div class="nsp-b" id="nsp-as" style="min-height:260px"></div>', true);
    d.querySelector('[data-x]').onclick = function () { d.close(); };
    var cuerpo = d.querySelector('#nsp-as'), st = { tab: 'con', prods: [], cnt: {}, q: '' };
    async function cargar() {
      cuerpo.innerHTML = '<div class="nsp-muted">Cargando…</div>';
      try {
        st.prods = await leerTodo(function () { return ctx.sb.from('productos').select('id,nombre,sku,stock_actual,requiere_numero_serie,tipo,activo').eq('auth_user_id', ctx.userId).eq('tipo', 'producto'); });
        var ss = await leerTodo(function () { return ctx.sb.from('numeros_serie').select('producto_id,estado').eq('auth_user_id', ctx.userId).eq('estado', 'en_stock'); });
        st.cnt = {}; ss.forEach(function (x) { st.cnt[x.producto_id] = (st.cnt[x.producto_id] || 0) + 1; });
        st.prods.sort(function (a, b) { return String(a.nombre).localeCompare(String(b.nombre)); });
        pintar();
      } catch (e) { cuerpo.innerHTML = '<div class="nsp-err" style="display:block">No se pudo cargar: ' + esc(e && e.message || 'error') + '</div>'; }
    }
    function pintar() {
      d.querySelectorAll('.nsp-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-t') === st.tab); });
      var q = st.q.trim().toLowerCase();
      if (st.tab === 'con') {
        var lista = st.prods.filter(function (p) { return p.requiere_numero_serie === true && (!q || (p.nombre + ' ' + (p.sku || '')).toLowerCase().indexOf(q) >= 0); });
        var totFalta = 0; lista.forEach(function (p) { totFalta += Math.max(0, Math.floor(Number(p.stock_actual) || 0) - (st.cnt[p.id] || 0)); });
        cuerpo.innerHTML = '<div class="nsp-muted">Cada producto que requiere serie debe tener cargadas las series de las unidades que tienes. Al vender, se elige entre las series cargadas. Cargarlas no cambia stock ni dinero.</div>' +
          '<div class="nsp-row"><input class="nsp-in" id="as-q" placeholder="Buscar producto…" value="' + esc(st.q) + '" style="flex:1;min-width:200px"/><span class="nsp-bd ' + (totFalta ? 'y' : 'g') + '">Faltan por cargar: ' + totFalta + '</span></div>' +
          (lista.length ? '<div class="nsp-tw"><table class="nsp-tbl"><thead><tr><th>Producto</th><th>Stock</th><th>Con serie</th><th>Faltan</th><th></th></tr></thead><tbody>' + lista.map(function (p) {
            var stock = Math.floor(Number(p.stock_actual) || 0), c = st.cnt[p.id] || 0, f = Math.max(0, stock - c);
            return '<tr><td><b>' + esc(p.nombre) + '</b>' + (p.sku ? '<div class="nsp-muted">' + esc(p.sku) + '</div>' : '') + '</td><td>' + stock + '</td><td>' + c + '</td><td>' + (f ? '<span class="nsp-bd y">' + f + '</span>' : '<span class="nsp-bd g">Completo</span>') + '</td><td><button class="nsp-bt s p" data-cargar="' + p.id + '">Cargar series</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="nsp-muted" style="padding:20px 0">Aún no hay productos marcados con "requiere número de serie". Usa la pestaña <b>Marcar productos</b>.</div>');
        var qi = cuerpo.querySelector('#as-q'); qi.oninput = function () { st.q = qi.value; clearTimeout(pintar._t); pintar._t = setTimeout(function () { var pos = qi.selectionStart; pintar(); var n = cuerpo.querySelector('#as-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }, 250); };
        cuerpo.querySelectorAll('[data-cargar]').forEach(function (b) { b.onclick = function () { abrirInventario({ sb: ctx.sb, userId: ctx.userId, productoId: b.getAttribute('data-cargar'), empresaConfig: ctx.empresaConfig }, cargar); }; });
      } else {
        var cand = st.prods.filter(function (p) { return p.requiere_numero_serie !== true && p.activo !== false && (!q || (p.nombre + ' ' + (p.sku || '')).toLowerCase().indexOf(q) >= 0); });
        var corte = cand.slice(0, 300);
        cuerpo.innerHTML = '<div class="nsp-muted">Marca los productos que se venden con número de serie (celulares, laptops, equipos…). Desde ese momento, al venderlos se pedirá la serie. No cambia el stock.</div>' +
          '<div class="nsp-row"><input class="nsp-in" id="as-q" placeholder="Buscar producto…" value="' + esc(st.q) + '" style="flex:1;min-width:200px"/><button class="nsp-bt" id="as-todos">Marcar visibles</button><button class="nsp-bt p" id="as-ok">Activar serie en los marcados</button></div>' +
          (corte.length ? '<div class="nsp-tw"><table class="nsp-tbl"><tbody>' + corte.map(function (p) { return '<tr><td style="width:28px"><input type="checkbox" data-m="' + p.id + '"/></td><td><b>' + esc(p.nombre) + '</b>' + (p.sku ? ' <span class="nsp-muted">' + esc(p.sku) + '</span>' : '') + '</td><td class="nsp-muted">Stock ' + Math.floor(Number(p.stock_actual) || 0) + '</td></tr>'; }).join('') + '</tbody></table></div>' + (cand.length > 300 ? '<div class="nsp-muted">Mostrando 300 de ' + cand.length + '. Usa la búsqueda.</div>' : '') : '<div class="nsp-muted" style="padding:20px 0">No hay más productos para marcar.</div>');
        var qi2 = cuerpo.querySelector('#as-q'); qi2.oninput = function () { st.q = qi2.value; clearTimeout(pintar._t); pintar._t = setTimeout(function () { var pos = qi2.selectionStart; pintar(); var n = cuerpo.querySelector('#as-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} }, 250); };
        cuerpo.querySelector('#as-todos').onclick = function () { cuerpo.querySelectorAll('[data-m]').forEach(function (c) { c.checked = true; }); };
        cuerpo.querySelector('#as-ok').onclick = async function () {
          var ids = Array.prototype.map.call(cuerpo.querySelectorAll('[data-m]:checked'), function (c) { return c.getAttribute('data-m'); });
          if (!ids.length) { aviso('Marca al menos un producto', 'warning'); return; }
          if (!(await confirmar('Activar número de serie', 'Se activará "requiere número de serie" en ' + ids.length + ' producto(s). Al venderlos se pedirá la serie. El stock no cambia.', 'Activar'))) return;
          try {
            for (var i = 0; i < ids.length; i += 80) {
              var r = await ctx.sb.from('productos').update({ requiere_numero_serie: true }).eq('auth_user_id', ctx.userId).in('id', ids.slice(i, i + 80));
              if (r.error) throw r.error;
            }
            aviso(ids.length + ' producto(s) con número de serie'); st.tab = 'con'; st.q = '';
            if (ctx.alCambiar) { try { ctx.alCambiar(); } catch (e) {} }
            cargar();
          } catch (e) { aviso('No se pudo: ' + (e && e.message || 'error'), 'error'); }
        };
      }
    }
    d.querySelectorAll('.nsp-tab').forEach(function (b) { b.onclick = function () { st.tab = b.getAttribute('data-t'); st.q = ''; pintar(); }; });
    await cargar();
  }

  /* ---------- botón en Compras (solo si el negocio activó números de serie) ---------- */
  function iniciarBoton(idBoton, getCtx) {
    var intentos = 0, t = setInterval(function () {
      intentos++;
      var c; try { c = getCtx(); } catch (e) { c = null; }
      var btn = document.getElementById(idBoton);
      if (c && c.empresaConfig && c.empresaConfig.usa_numero_serie === true && btn) { btn.style.display = ''; clearInterval(t); }
      else if (intentos > 60) clearInterval(t);
    }, 500);
  }

  window.N360Series = { activo: activo, despuesDeCompra: despuesDeCompra, abrirPanel: abrirPanel, abrirInventario: abrirInventario, abrirAsistente: abrirAsistente, marcarVendidas: marcarVendidas, validarVenta: validarVenta, decorarModalVenta: decorarModalVenta, iniciarBoton: iniciarBoton, _abrirRegistro: abrirRegistro };
})();
