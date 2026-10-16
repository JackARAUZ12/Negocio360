/* ============================================================
   CLIENTE REPETIDO (compartido: Ventas y Proformas)
   ------------------------------------------------------------
   Problema real: "Cliente rápido" creaba una ficha nueva cada vez,
   aunque ya existiera un cliente con ese mismo nombre (en All Plastic
   había 596 fichas repetidas, casi todas creadas así al vender).

   Esto es solo una ayuda, nunca un bloqueo:
     1. Mientras se escribe el nombre, se muestran los clientes que ya
        existen con ese nombre, con un botón "Usar este".
     2. Al continuar con un nombre EXACTAMENTE igual a uno existente,
        se pregunta si usar el existente o crear otro (puede ser otra
        persona con el mismo nombre: entonces se crea igual).
     3. Al guardar, se revisa de nuevo en la base por si la lista de la
        pantalla estaba vieja.
   La comparación ignora mayúsculas, tildes, puntos y espacios dobles,
   y usa nombre + apellido.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360ClienteRepetido) return;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function nombreCompleto(c) {
    return String(((c && c.nombre) || '') + ' ' + ((c && c.apellido) || '')).replace(/\s+/g, ' ').trim();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  /* exactos: mismo nombre normalizado. parecidos: cada palabra escrita es el
     inicio de alguna palabra del cliente (ej. "kelly men" -> "Kelly Mendoza"). */
  function buscar(lista, nombre, max) {
    var t = norm(nombre);
    var res = { exactos: [], parecidos: [] };
    if (!t) return res;
    var palabras = t.split(' ');
    (lista || []).forEach(function (c) {
      var n = norm(nombreCompleto(c));
      if (!n) return;
      if (n === t) { res.exactos.push(c); return; }
      if (t.length < 3) return;
      var pc = n.split(' ');
      var todas = palabras.every(function (p) { return pc.some(function (w) { return w.indexOf(p) === 0; }); });
      if (todas) res.parecidos.push(c);
    });
    res.parecidos = res.parecidos.slice(0, Math.max(0, (max || 5) - res.exactos.length));
    return res;
  }

  /* Revisión directa en la base (por si la lista en pantalla estaba vieja). */
  async function exactosEnBase(cliente, userId, nombre) {
    try {
      var t = norm(nombre);
      if (!t || !cliente || !userId) return [];
      var primera = t.split(' ')[0].replace(/[\\%_]/g, '');
      var r = await cliente.from('clientes').select('id,nombre,apellido,telefono,correo')
        .eq('auth_user_id', userId).eq('activo', true).ilike('nombre', primera + '%').limit(200);
      return ((r && r.data) || []).filter(function (c) { return norm(nombreCompleto(c)) === t; });
    } catch (e) { console.warn('ClienteRepetido.exactosEnBase:', e); return []; }
  }

  /* Pregunta qué hacer con un nombre que ya existe. Devuelve 'usar' o 'crear'. */
  function preguntar(existente) {
    var nom = nombreCompleto(existente);
    var extra = existente.telefono ? ' (tel. ' + existente.telefono + ')' : '';
    var ok = window.confirm('Ya existe un cliente llamado "' + nom + '"' + extra + '.\n\n' +
      'Aceptar = usar ese cliente (recomendado).\n' +
      'Cancelar = crear OTRO cliente con el mismo nombre (solo si es otra persona).');
    return ok ? 'usar' : 'crear';
  }

  /* Muestra debajo del campo de nombre los clientes que ya existen.
     opts.lista(): arreglo actual de clientes · opts.alUsar(cliente) */
  function conectar(input, opts) {
    if (!input || input.dataset.clienteRepetido === '1') return;
    input.dataset.clienteRepetido = '1';
    var caja = document.createElement('div');
    caja.className = 'cr-sugerencias';
    caja.style.cssText = 'display:none;margin-top:6px;padding:8px 10px;border:1px solid var(--warning,#d97706);' +
      'background:var(--bg-surface,#fff);border-radius:8px;font-size:12.5px;color:var(--text-primary,#111)';
    input.insertAdjacentElement('afterend', caja);
    var t = null;
    function pintar() {
      var r = buscar(opts.lista ? opts.lista() : [], input.value, 5);
      var todos = r.exactos.concat(r.parecidos);
      if (!todos.length) { caja.style.display = 'none'; caja.innerHTML = ''; return; }
      caja.innerHTML = '<div style="font-weight:700;margin-bottom:6px;color:var(--warning,#b45309)">' +
        (r.exactos.length ? '⚠️ Este cliente ya existe:' : 'Clientes parecidos que ya existen:') + '</div>' +
        todos.map(function (c, i) {
          return '<div style="display:flex;align-items:center;gap:8px;justify-content:space-between;padding:3px 0">' +
            '<span>' + esc(nombreCompleto(c)) + (c.telefono ? ' <span style="color:var(--text-muted,#888)">· ' + esc(c.telefono) + '</span>' : '') +
            (i < r.exactos.length ? ' <b style="color:var(--warning,#b45309)">(mismo nombre)</b>' : '') + '</span>' +
            '<button type="button" class="btn btn-secondary" data-cr="' + esc(c.id) + '" style="padding:3px 10px;font-size:12px;white-space:nowrap">Usar este</button></div>';
        }).join('');
      caja.style.display = '';
    }
    input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(pintar, 180); });
    caja.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cr]');
      if (!b) return;
      var id = b.getAttribute('data-cr');
      var c = (opts.lista ? opts.lista() : []).find(function (x) { return String(x.id) === id; });
      if (c && opts.alUsar) { caja.style.display = 'none'; opts.alUsar(c); }
    });
    return { refrescar: pintar, ocultar: function () { caja.style.display = 'none'; } };
  }

  window.N360ClienteRepetido = {
    norm: norm, nombreCompleto: nombreCompleto, buscar: buscar,
    exactosEnBase: exactosEnBase, preguntar: preguntar, conectar: conectar,
  };
})();
