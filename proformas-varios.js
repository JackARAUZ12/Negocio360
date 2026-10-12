/* ============================================================
   PROFORMAS DIRIGIDAS A VARIOS CLIENTES
   Una proforma puede ser para un cliente individual (funciona
   exactamente como siempre) o "dirigida a varios", con la lista de
   clientes (nombre, teléfono, correo) guardada por separado en
   proforma_destinatarios. Módulo aditivo: si no se elige "varios",
   no hace nada.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ProfVarios) return;

  var modo = 'individual';
  var lista = [];

  function $(id) { return document.getElementById(id); }
  function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(m, t) { try { showToast(m, t); } catch (_) { /* nada */ } }

  function llenarSelect() {
    var sel = $('npv-select'); if (!sel) return;
    var usados = {}; lista.forEach(function (d) { if (d.cliente_id) usados[d.cliente_id] = 1; });
    sel.innerHTML = '<option value="">— Elegir cliente registrado —</option>' +
      (STATE.clientes || []).filter(function (c) { return !usados[c.id]; }).map(function (c) {
        return '<option value="' + c.id + '">' + e(c.nombre) + (c.telefono ? ' — ' + e(c.telefono) : '') + '</option>';
      }).join('');
  }
  function render() {
    var el = $('npv-lista'); if (!el) return;
    el.innerHTML = lista.length ? lista.map(function (d, i) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;margin-top:6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md)">' +
        '<div><strong>' + e(d.nombre) + '</strong><div style="font-size:12px;color:var(--text-secondary)">' +
        e([d.telefono, d.correo].filter(Boolean).join(' · ') || 'Sin teléfono ni correo') + '</div></div>' +
        '<button type="button" class="btn-ghost" title="Quitar" onclick="N360ProfVarios.quitar(' + i + ')">✕</button></div>';
    }).join('') : '<p style="font-size:12.5px;color:var(--text-secondary);margin-top:6px">Aún no hay clientes en la lista.</p>';
    llenarSelect();
  }

  function setModo(m) {
    modo = m === 'varios' ? 'varios' : 'individual';
    var ind = $('np-cliente-individual'), pan = $('np-varios-panel');
    if (ind) ind.style.display = modo === 'varios' ? 'none' : '';
    if (pan) pan.style.display = modo === 'varios' ? 'block' : 'none';
    document.querySelectorAll('input[name="np-modo-dest"]').forEach(function (r) { r.checked = r.value === modo; });
    if (modo === 'varios') {
      STATE.clienteSeleccionado = null;
      render();
    } else {
      // Al volver a individual se restaura lo que marque el selector de siempre.
      if (typeof onSelectClienteProf === 'function') onSelectClienteProf();
    }
  }
  function agregarRegistrado() {
    var id = $('npv-select') && $('npv-select').value; if (!id) return;
    var c = (STATE.clientes || []).find(function (x) { return x.id === id; }); if (!c) return;
    lista.push({ cliente_id: c.id, nombre: c.nombre, telefono: c.telefono || '', correo: c.correo || '' });
    render();
  }
  function agregarManual() {
    var n = ($('npv-nombre').value || '').trim();
    if (!n) { toast('Escribe el nombre', 'error'); return; }
    lista.push({ cliente_id: null, nombre: n, telefono: ($('npv-telefono').value || '').trim(), correo: ($('npv-correo').value || '').trim() });
    ['npv-nombre', 'npv-telefono', 'npv-correo'].forEach(function (i) { $(i).value = ''; });
    render();
  }
  function quitar(i) { lista.splice(i, 1); render(); }

  function validar() {
    if (modo !== 'varios') return null;
    if (lista.length < 2) return 'Agrega al menos 2 clientes a la lista, o elige "Cliente individual".';
    return null;
  }
  function payloadExtra() {
    if (modo === 'varios') return { dirigida_a_varios: true, cliente_id: null, cliente_nombre: 'Varios clientes (' + lista.length + ')' };
    if (STATE.proformaActual && STATE.proformaActual.dirigida_a_varios) return { dirigida_a_varios: false };
    return {};
  }
  async function guardarDestinatarios(proformaId) {
    var eraVarios = !!(STATE.proformaActual && STATE.proformaActual.dirigida_a_varios);
    if (modo !== 'varios' && !eraVarios) return true;
    try {
      var d = await sbClient.from('proforma_destinatarios').delete().eq('proforma_id', proformaId);
      if (d.error) throw d.error;
      if (modo === 'varios') {
        var r = await sbClient.from('proforma_destinatarios').insert(lista.map(function (x, i) {
          return { auth_user_id: STATE.userId, proforma_id: proformaId, cliente_id: x.cliente_id || null,
            nombre: x.nombre, telefono: x.telefono || null, correo: x.correo || null, orden: i };
        }));
        if (r.error) throw r.error;
      }
      return true;
    } catch (err) {
      console.error('guardarDestinatarios:', err);
      toast('La proforma se guardó, pero NO se pudo guardar la lista de clientes. Ábrela con Editar y vuelve a guardar.', 'error');
      return false;
    }
  }
  async function cargarDestinatarios(p) {
    if (!p) return [];
    if (!p.dirigida_a_varios) { delete p._destinatarios; return []; }
    try {
      var r = await sbClient.from('proforma_destinatarios').select('*').eq('proforma_id', p.id).order('orden');
      if (r.error) throw r.error;
      p._destinatarios = r.data || [];
    } catch (err) { console.warn('cargarDestinatarios:', err); p._destinatarios = p._destinatarios || []; }
    return p._destinatarios;
  }
  async function copiarDestinatarios(origenId, nuevaId) {
    try {
      var r = await sbClient.from('proforma_destinatarios').select('*').eq('proforma_id', origenId).order('orden');
      if (r.error || !r.data || !r.data.length) return;
      await sbClient.from('proforma_destinatarios').insert(r.data.map(function (d) {
        return { auth_user_id: STATE.userId, proforma_id: nuevaId, cliente_id: d.cliente_id, nombre: d.nombre, telefono: d.telefono, correo: d.correo, orden: d.orden };
      }));
    } catch (err) { console.warn('copiarDestinatarios:', err); }
  }

  /* ---- Elegir para qué cliente es la venta / el crédito ---- */
  function elegirCliente(dests, titulo) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px';
      ov.innerHTML = '<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md);max-width:420px;width:100%;padding:18px">' +
        '<h3 style="margin-bottom:6px">' + e(titulo) + '</h3>' +
        '<p style="font-size:12.5px;color:var(--text-secondary);margin-bottom:10px">Esta proforma va dirigida a varios clientes. Elige para cuál es esta operación.</p>' +
        dests.map(function (d, i) {
          return '<button type="button" class="btn-secondary" data-i="' + i + '" style="display:block;width:100%;text-align:left;margin-bottom:6px"><strong>' + e(d.nombre) + '</strong><br><span style="font-size:12px">' + e([d.telefono, d.correo].filter(Boolean).join(' · ')) + '</span></button>';
        }).join('') +
        '<div style="text-align:right;margin-top:8px"><button type="button" class="btn-ghost" data-cancel="1">Cancelar</button></div></div>';
      ov.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('button');
        if (b && b.dataset.i != null) { document.body.removeChild(ov); resolve(dests[Number(b.dataset.i)]); }
        else if ((b && b.dataset.cancel) || ev.target === ov) { document.body.removeChild(ov); resolve(null); }
      });
      document.body.appendChild(ov);
    });
  }

  async function pdfPorCliente() {
    var p = STATE.proformaActual; if (!p) return;
    try {
      var dests = await cargarDestinatarios(p);
      if (!dests.length) { toast('Esta proforma no tiene clientes en la lista', 'error'); return; }
      var r = await sbClient.from('proforma_detalles').select('*').eq('proforma_id', p.id);
      var items = await enriquecerItemsConCombo(r.data || []);
      toast('Generando ' + dests.length + ' PDF (uno por cliente)…');
      for (var i = 0; i < dests.length; i++) {
        var d = dests[i], cli = { telefono: d.telefono, correo: d.correo };
        if (d.cliente_id) {
          var c = await sbClient.from('clientes').select('telefono,correo,direccion,direccion_factura,ciudad').eq('id', d.cliente_id).maybeSingle();
          if (c.data) cli = c.data;
        }
        var pc = Object.assign({}, p, { cliente_nombre: d.nombre, cliente_id: d.cliente_id || null }); delete pc._destinatarios;
        var doc = await generarPDFProforma(pc, items, cli);
        doc.save('Proforma_' + String(p.numero_proforma || 'proforma').replace(/[^\w\-]/g, '') + '_' + String(d.nombre).replace(/[^\w\-]+/g, '_').slice(0, 30) + '.pdf');
        await new Promise(function (ok) { setTimeout(ok, 500); });
      }
    } catch (err) { console.error('pdfPorCliente:', err); toast('No se pudieron generar los PDF', 'error'); }
  }

  window.N360ProfVarios = {
    setModo: setModo, agregarRegistrado: agregarRegistrado, agregarManual: agregarManual, quitar: quitar,
    validar: validar, payloadExtra: payloadExtra, guardarDestinatarios: guardarDestinatarios,
    cargarDestinatarios: cargarDestinatarios, copiarDestinatarios: copiarDestinatarios, pdfPorCliente: pdfPorCliente,
    _estado: function () { return { modo: modo, lista: lista.slice() }; },
  };

  /* ---- Envolturas: si la proforma no es de varios, llaman a la original sin más ---- */
  var _nueva = window.abrirNuevaProforma;
  window.abrirNuevaProforma = function () {
    modo = 'individual'; lista = [];
    var r = _nueva.apply(this, arguments);
    setModo('individual');
    // setModo('individual') llama onSelectClienteProf; la original ya dejó el selector en blanco.
    return r;
  };
  var _editar = window.abrirEditarProforma;
  window.abrirEditarProforma = function (id) {
    var r = _editar.apply(this, arguments);
    var p = (STATE.proformas || []).find(function (x) { return x.id === id; });
    if (p && p.dirigida_a_varios && STATE.proformaActual === p) {
      cargarDestinatarios(p).then(function (ds) {
        lista = ds.map(function (d) { return { cliente_id: d.cliente_id, nombre: d.nombre, telefono: d.telefono || '', correo: d.correo || '' }; });
        setModo('varios');
      });
    }
    return r;
  };
  var _detalle = window.verDetalleProf;
  window.verDetalleProf = async function (id) {
    var b = $('det-prof-btn-pdf-varios'); if (b) b.style.display = 'none';
    var r = await _detalle.apply(this, arguments);
    var p = (STATE.proformas || []).find(function (x) { return x.id === id; });
    if (p && p.dirigida_a_varios) {
      var ds = await cargarDestinatarios(p);
      var body = $('detalle-prof-body');
      if (body && STATE.proformaActual === p) {
        body.insertAdjacentHTML('afterbegin', '<div style="margin-bottom:12px;padding:10px 12px;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:var(--radius-md)"><label>Dirigida a</label>' +
          (ds.map(function (d) { return '<div style="margin-top:4px"><strong>' + e(d.nombre) + '</strong> <span style="font-size:12px;color:var(--text-secondary)">' + e([d.telefono, d.correo].filter(Boolean).join(' · ')) + '</span></div>'; }).join('') || '—') + '</div>');
        if (b) b.style.display = 'inline-flex';
      }
    }
    return r;
  };
  var _convertir = window.abrirConvertirAVenta;
  window.abrirConvertirAVenta = async function (id) {
    var p = (STATE.proformas || []).find(function (x) { return x.id === id; });
    if (p && p.dirigida_a_varios) {
      var ds = await cargarDestinatarios(p);
      if (!ds.length) { toast('Esta proforma no tiene clientes en la lista', 'error'); return; }
      var d = await elegirCliente(ds, 'Convertir a venta');
      if (!d) return;
      p.cliente_id = d.cliente_id || null; p.cliente_nombre = d.nombre;
    }
    return _convertir.apply(this, arguments);
  };
  var _pago = window.abrirPagoParcial;
  window.abrirPagoParcial = async function () {
    var p = STATE.proformaActual;
    if (p && p.dirigida_a_varios) {
      var ds = (await cargarDestinatarios(p)).filter(function (d) { return d.cliente_id; });
      if (!ds.length) { toast('Para pago parcial / crédito el cliente debe estar registrado', 'error'); return; }
      var d = await elegirCliente(ds, 'Pago parcial / a crédito');
      if (!d) return;
      p.cliente_id = d.cliente_id; p.cliente_nombre = d.nombre;
    }
    return _pago.apply(this, arguments);
  };
})();
