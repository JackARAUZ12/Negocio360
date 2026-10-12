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

  var modo = 'individual';   // 'individual' | 'varios' | 'contactos'
  var lista = [];
  var empresaId = '';

  function $(id) { return document.getElementById(id); }
  function e(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function toast(m, t) { try { showToast(m, t); } catch (_) { /* nada */ } }

  function visibles() {
    var q = (($('npv-buscar') && $('npv-buscar').value) || '').trim().toLowerCase();
    return (STATE.clientes || []).filter(function (c) {
      return !q || [c.nombre, c.telefono, c.correo].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function llenarSelect() {
    var box = $('npv-checks'); if (!box) return;
    var sel = {}; lista.forEach(function (d) { if (d.cliente_id) sel[d.cliente_id] = 1; });
    var v = visibles();
    box.innerHTML = v.length ? v.map(function (c) {
      return '<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border)">' +
        '<input type="checkbox" data-cid="' + c.id + '"' + (sel[c.id] ? ' checked' : '') + ' onchange="N360ProfVarios.alternar(this.dataset.cid,this.checked)"/>' +
        '<span><strong>' + e(c.nombre) + '</strong> <span style="font-size:12px;color:var(--text-secondary)">' + e([c.telefono, c.correo].filter(Boolean).join(' · ')) + '</span></span></label>';
    }).join('') : '<p style="padding:10px;font-size:12.5px;color:var(--text-secondary)">' + ((STATE.clientes || []).length ? 'Ningún cliente coincide con la búsqueda.' : 'No hay clientes registrados. Agrega personas en "Agregar alguien sin registrar".') + '</p>';
  }
  function alternar(id, marcado) {
    var i = lista.findIndex(function (d) { return d.cliente_id === id; });
    if (marcado && i < 0) {
      var c = (STATE.clientes || []).find(function (x) { return x.id === id; }); if (!c) return;
      lista.push({ cliente_id: c.id, nombre: c.nombre, telefono: c.telefono || '', correo: c.correo || '' });
    } else if (!marcado && i >= 0) lista.splice(i, 1);
    renderLista();
  }
  function marcarVisibles(m) { visibles().forEach(function (c) { alternar(c.id, m); }); llenarSelect(); }
  function filtrar() { llenarSelect(); }
  function render() {
    var el = $('npv-lista'); if (!el) return;
    el.innerHTML = lista.length ? lista.map(function (d, i) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;margin-top:6px;background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius-md)">' +
        '<div><strong>' + e(d.nombre) + '</strong>' + (d.cargo ? ' <span style="font-size:12px">(' + e(d.cargo) + ')</span>' : '') + '<div style="font-size:12px;color:var(--text-secondary)">' +
        e([d.telefono, d.correo].filter(Boolean).join(' · ') || 'Sin teléfono ni correo') + '</div></div>' +
        '<button type="button" class="btn-ghost" title="Quitar" onclick="N360ProfVarios.quitar(' + i + ')">✕</button></div>';
    }).join('') : '<p style="font-size:12.5px;color:var(--text-secondary);margin-top:6px">Aún no hay clientes en la lista.</p>';
    llenarSelect();
  }
  function renderLista() { var s = $('npv-lista'); if (!s) return; var sv = $('npv-checks') ? $('npv-checks').scrollTop : 0; render(); if ($('npv-checks')) $('npv-checks').scrollTop = sv; }

  function esContacto(t) { return /@/.test(t || ''); }
  function contactosDe(id) {
    var c = (STATE.clientes || []).find(function (x) { return x.id === id; });
    return c && Array.isArray(c.contactos) ? c.contactos.filter(function (k) { return (k.nombre || '').trim(); }) : [];
  }
  function dePersona(k, c) {
    var t = String(k.contacto || '').trim();
    return { cliente_id: c.id, nombre: String(k.nombre).trim(), cargo: String(k.cargo || '').trim(), telefono: esContacto(t) ? '' : t, correo: esContacto(t) ? t : '' };
  }
  function llenarEmpresas() {
    var sel = $('npv-empresa'); if (!sel) return;
    var conC = (STATE.clientes || []).filter(function (c) { return contactosDe(c.id).length; });
    sel.innerHTML = '<option value="">— Elegir cliente / empresa con contactos —</option>' +
      conC.map(function (c) { return '<option value="' + c.id + '"' + (c.id === empresaId ? ' selected' : '') + '>' + e(c.nombre) + ' (' + contactosDe(c.id).length + ' contactos)</option>'; }).join('');
  }
  function renderContactos() {
    var box = $('npv-contactos'); if (!box) return;
    if (!empresaId) { box.innerHTML = '<p style="padding:10px;font-size:12.5px;color:var(--text-secondary)">Elige la empresa para ver sus contactos. Los contactos se agregan en el módulo Clientes.</p>'; return; }
    var cs = contactosDe(empresaId);
    box.innerHTML = '<div style="padding:6px 10px"><button type="button" class="btn-ghost" onclick="N360ProfVarios.marcarContactos(true)">Marcar todos</button> <button type="button" class="btn-ghost" onclick="N360ProfVarios.marcarContactos(false)">Quitar todos</button></div>' +
      cs.map(function (k, i) {
        var p = dePersona(k, { id: empresaId });
        var on = lista.some(function (d) { return d.nombre === p.nombre && d.telefono === p.telefono && d.correo === p.correo; });
        return '<label style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-top:1px solid var(--border)"><input type="checkbox" data-k="' + i + '"' + (on ? ' checked' : '') + ' onchange="N360ProfVarios.alternarContacto(' + i + ',this.checked)"/>' +
          '<span><strong>' + e(p.nombre) + '</strong>' + (p.cargo ? ' <span style="font-size:12px">(' + e(p.cargo) + ')</span>' : '') + ' <span style="font-size:12px;color:var(--text-secondary)">' + e([p.telefono, p.correo].filter(Boolean).join(' · ') || 'sin teléfono ni correo') + '</span></span></label>';
      }).join('');
  }
  function elegirEmpresa(id) { empresaId = id || ''; lista = []; renderContactos(); render(); }
  function alternarContacto(i, on) {
    var c = (STATE.clientes || []).find(function (x) { return x.id === empresaId; }); if (!c) return;
    var k = contactosDe(empresaId)[i]; if (!k) return;
    var p = dePersona(k, c);
    var j = lista.findIndex(function (d) { return d.nombre === p.nombre && d.telefono === p.telefono && d.correo === p.correo; });
    if (on && j < 0) lista.push(p); else if (!on && j >= 0) lista.splice(j, 1);
    render();
  }
  function marcarContactos(on) {
    var c = (STATE.clientes || []).find(function (x) { return x.id === empresaId; }); if (!c) return;
    lista = on ? contactosDe(empresaId).map(function (k) { return dePersona(k, c); }) : [];
    render();
  }

  function setModo(m) {
    modo = (m === 'varios' || m === 'contactos') ? m : 'individual';
    var ind = $('np-cliente-individual'), pan = $('np-varios-panel');
    if (ind) ind.style.display = modo === 'individual' ? '' : 'none';
    if (pan) pan.style.display = modo === 'individual' ? 'none' : 'block';
    var eb = $('npv-empresa-bloque'), cb = $('npv-clientes-bloque');
    if (eb) eb.style.display = modo === 'contactos' ? 'block' : 'none';
    if (cb) cb.style.display = modo === 'varios' ? 'block' : 'none';
    var man = $('npv-manual'); if (man) man.style.display = modo === 'varios' ? '' : 'none';
    document.querySelectorAll('input[name="np-modo-dest"]').forEach(function (r) { r.checked = r.value === modo; });
    if (modo !== 'individual') {
      STATE.clienteSeleccionado = null;
      if (modo === 'contactos') { llenarEmpresas(); renderContactos(); }
      render();
    } else {
      // Al volver a individual se restaura lo que marque el selector de siempre.
      if (typeof onSelectClienteProf === 'function') onSelectClienteProf();
    }
  }
  function agregarRegistrado() {
    var id = $('npv-select') && $('npv-select').value; if (id) alternar(id, true);
  }
  function agregarManual() {
    var n = ($('npv-nombre').value || '').trim();
    if (!n) { toast('Escribe el nombre', 'error'); return; }
    lista.push({ cliente_id: null, nombre: n, telefono: ($('npv-telefono').value || '').trim(), correo: ($('npv-correo').value || '').trim() });
    ['npv-nombre', 'npv-telefono', 'npv-correo'].forEach(function (i) { $(i).value = ''; });
    render();
  }
  function quitar(i) { lista.splice(i, 1); render(); if (modo === 'contactos') renderContactos(); }

  function validar() {
    if (modo === 'contactos') {
      if (!empresaId) return 'Elige el cliente (empresa) del que vas a usar los contactos.';
      if (lista.length < 1) return 'Marca al menos un contacto de la empresa, o elige "Cliente individual".';
      return null;
    }
    if (modo !== 'varios') return null;
    if (lista.length < 2) return 'Agrega al menos 2 clientes a la lista, o elige "Cliente individual".';
    return null;
  }
  function payloadExtra() {
    if (modo === 'contactos') {
      var emp = (STATE.clientes || []).find(function (x) { return x.id === empresaId; });
      return { dirigida_a_varios: true, cliente_id: empresaId, cliente_nombre: emp ? emp.nombre : 'Cliente' };
    }
    if (modo === 'varios') return { dirigida_a_varios: true, cliente_id: null, cliente_nombre: 'Varios clientes (' + lista.length + ')' };
    if (STATE.proformaActual && STATE.proformaActual.dirigida_a_varios) return { dirigida_a_varios: false };
    return {};
  }
  async function guardarDestinatarios(proformaId) {
    var eraVarios = !!(STATE.proformaActual && STATE.proformaActual.dirigida_a_varios);
    if (modo === 'individual' && !eraVarios) return true;
    try {
      var d = await sbClient.from('proforma_destinatarios').delete().eq('proforma_id', proformaId);
      if (d.error) throw d.error;
      if (modo !== 'individual') {
        var filas = lista.map(function (x, i) {
          return { auth_user_id: STATE.userId, proforma_id: proformaId, cliente_id: x.cliente_id || null,
            nombre: x.nombre, telefono: x.telefono || null, correo: x.correo || null, orden: i, cargo: x.cargo || null };
        });
        var r = await sbClient.from('proforma_destinatarios').insert(filas);
        if (r.error) r = await sbClient.from('proforma_destinatarios').insert(filas.map(function (f) { var o = Object.assign({}, f); delete o.cargo; return o; }));
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
    if (!p.dirigida_a_varios) { delete p._destinatarios; delete p._empresa; return []; }
    try {
      var r = await sbClient.from('proforma_destinatarios').select('*').eq('proforma_id', p.id).order('orden');
      if (r.error) throw r.error;
      p._destinatarios = r.data || [];
      var ds0 = p._destinatarios;
      p._empresa = ds0.length > 0 && ds0.every(function (d) { return d.cliente_id && d.cliente_id === ds0[0].cliente_id; });
    } catch (err) { console.warn('cargarDestinatarios:', err); p._destinatarios = p._destinatarios || []; }
    return p._destinatarios;
  }
  async function copiarDestinatarios(origenId, nuevaId) {
    try {
      var r = await sbClient.from('proforma_destinatarios').select('*').eq('proforma_id', origenId).order('orden');
      if (r.error || !r.data || !r.data.length) return;
      var filas = r.data.map(function (d) {
        return { auth_user_id: STATE.userId, proforma_id: nuevaId, cliente_id: d.cliente_id, nombre: d.nombre, telefono: d.telefono, correo: d.correo, orden: d.orden, cargo: d.cargo || null };
      });
      var w = await sbClient.from('proforma_destinatarios').insert(filas);
      if (w.error) await sbClient.from('proforma_destinatarios').insert(filas.map(function (f) { var o = Object.assign({}, f); delete o.cargo; return o; }));
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
        var d = dests[i], cli = p._empresa ? {} : { telefono: d.telefono, correo: d.correo };
        if (d.cliente_id) {
          var c = await sbClient.from('clientes').select('telefono,correo,direccion,direccion_factura,ciudad').eq('id', d.cliente_id).maybeSingle();
          if (c.data) cli = c.data;
        }
        var pc = p._empresa ? Object.assign({}, p, { _destinatarios: [d], _empresa: true }) : Object.assign({}, p, { cliente_nombre: d.nombre, cliente_id: d.cliente_id || null }); if (!p._empresa) delete pc._destinatarios;
        var doc = await generarPDFProforma(pc, items, cli);
        doc.save('Proforma_' + String(p.numero_proforma || 'proforma').replace(/[^\w\-]/g, '') + '_' + String(d.nombre).replace(/[^\w\-]+/g, '_').slice(0, 30) + '.pdf');
        await new Promise(function (ok) { setTimeout(ok, 500); });
      }
    } catch (err) { console.error('pdfPorCliente:', err); toast('No se pudieron generar los PDF', 'error'); }
  }

  window.N360ProfVarios = {
    setModo: setModo, alternar: alternar, elegirEmpresa: elegirEmpresa, alternarContacto: alternarContacto, marcarContactos: marcarContactos, marcarVisibles: marcarVisibles, filtrar: filtrar, agregarRegistrado: agregarRegistrado, agregarManual: agregarManual, quitar: quitar,
    validar: validar, payloadExtra: payloadExtra, guardarDestinatarios: guardarDestinatarios,
    cargarDestinatarios: cargarDestinatarios, copiarDestinatarios: copiarDestinatarios, pdfPorCliente: pdfPorCliente,
    _estado: function () { return { modo: modo, lista: lista.slice() }; },
  };

  /* ---- Envolturas: si la proforma no es de varios, llaman a la original sin más ---- */
  var _nueva = window.abrirNuevaProforma;
  window.abrirNuevaProforma = function () {
    modo = 'individual'; lista = []; empresaId = '';
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
        lista = ds.map(function (d) { return { cliente_id: d.cliente_id, nombre: d.nombre, cargo: d.cargo || '', telefono: d.telefono || '', correo: d.correo || '' }; });
        if (p._empresa) { empresaId = ds[0].cliente_id; setModo('contactos'); }
        else setModo('varios');
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
        body.insertAdjacentHTML('afterbegin', '<div style="margin-bottom:12px"><label>' + (p._empresa ? 'Dirigida a (' + ds.length + ' contacto' + (ds.length === 1 ? '' : 's') + ' de ' + e(p.cliente_nombre) + ')' : 'Dirigida a (' + ds.length + ' clientes)') + '</label>' +
          ds.map(function (d, i) { return '<div style="margin-top:6px;padding:10px 12px;background:var(--bg-surface-2);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:var(--radius-md)">' +
            '<div style="font-weight:700">' + (i + 1) + '. ' + e(d.nombre) + (d.cargo ? ' <span style="font-weight:400;font-size:12.5px">(' + e(d.cargo) + ')</span>' : '') + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-secondary);margin-top:2px">Tel: ' + e(d.telefono || '—') + '</div>' +
            '<div style="font-size:12.5px;color:var(--text-secondary)">Correo: ' + e(d.correo || '—') + '</div></div>'; }).join('') + '</div>');
        if (b) { b.style.display = 'inline-flex'; b.textContent = p._empresa ? '📄 PDF por contacto' : '📄 PDF por cliente'; }
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
      if (p._empresa) { p.cliente_id = ds[0].cliente_id; /* la venta es de la empresa */ }
      else {
        var d = await elegirCliente(ds, 'Convertir a venta');
        if (!d) return;
        p.cliente_id = d.cliente_id || null; p.cliente_nombre = d.nombre;
      }
    }
    return _convertir.apply(this, arguments);
  };
  var _pago = window.abrirPagoParcial;
  window.abrirPagoParcial = async function () {
    var p = STATE.proformaActual;
    if (p && p.dirigida_a_varios) {
      var ds = (await cargarDestinatarios(p)).filter(function (d) { return d.cliente_id; });
      if (!ds.length) { toast('Para pago parcial / crédito el cliente debe estar registrado', 'error'); return; }
      if (p._empresa) { p.cliente_id = ds[0].cliente_id; }
      else {
        var d = await elegirCliente(ds, 'Pago parcial / a crédito');
        if (!d) return;
        p.cliente_id = d.cliente_id; p.cliente_nombre = d.nombre;
      }
    }
    return _pago.apply(this, arguments);
  };
})();
