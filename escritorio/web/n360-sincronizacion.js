/* Pantalla "Sincronización" del programa de escritorio. */
(function () {
  'use strict';
  const API = window.negocio360SinConexion;
  const N = window.N360SinConexion;
  const $ = (id) => document.getElementById(id);
  const sb = window.supabase.createClient('https://zvlincmqmmoclqhykejv.supabase.co', 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t');
  const ESTADOS = { pendiente: 'Por subir', enviando: 'Subiendo…', subida: 'Subida', error: 'Con problema', anulada: 'Anulada' };
  const CONEXION = { en_linea: '🟢 En línea', inestable: '🟠 Inestable', verificando: '🟠 Verificando', sin_conexion: '🔴 Sin conexión' };
  let conexion = 'verificando';

  const fmtFecha = (ms) => (ms ? new Date(ms).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const fmtMonto = (n) => 'C$ ' + Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function mensaje(t, malo) { $('mensaje').textContent = t || ''; $('mensaje').style.color = malo ? 'var(--mal)' : 'var(--ok)'; }
  function celda(fila, texto) { const td = document.createElement('td'); td.textContent = texto; fila.appendChild(td); return td; }

  if (!API || !N) { mensaje('Esta pantalla solo funciona dentro del programa de escritorio.', true); return; }

  async function pintarEstado() {
    const e = await API.estado();
    $('d-conexion').textContent = CONEXION[conexion] || conexion;
    $('d-pendientes').textContent = e.pendientes || 0;
    $('d-errores').textContent = e.errores || 0;
    $('d-numeros').textContent = e.numeros_libres || 0;
    $('d-ultima').textContent = e.ultima_subida ? new Date(e.ultima_subida).toLocaleTimeString('es-NI') : '—';
    const partes = [];
    if (!e.cuenta) partes.push('No hay sesión iniciada en el programa.');
    else if (!e.habilitado) partes.push('El modo sin conexión no está activo para esta cuenta: las ventas van directo al servidor, como en la web.');
    if (e.cuenta && !e.sesion_valida) partes.push('La sesión necesita renovarse (se hace sola al volver internet).');
    if (e.ultimo_error) partes.push('Último aviso: ' + e.ultimo_error);
    if (e.sin_subir_equipo > (e.pendientes || 0) + (e.errores || 0)) partes.push(`Hay ${e.sin_subir_equipo - e.pendientes - e.errores} venta(s) de otra cuenta en este equipo: se suben cuando esa cuenta inicie sesión.`);
    $('d-detalle').textContent = partes.join(' ');
    return e;
  }

  async function pintarVentas() {
    const tbody = $('t-ventas');
    let ventas = [];
    try { ventas = await API.ventasListar({ limite: 300 }); } catch (e) { tbody.innerHTML = ''; celda(tbody.insertRow(), e.message); return; }
    tbody.innerHTML = '';
    if (!ventas.length) { const td = celda(tbody.insertRow(), 'No hay ventas guardadas en este equipo.'); td.colSpan = 6; td.className = 'vacio'; return; }
    for (const v of ventas) {
      const tr = tbody.insertRow();
      const final = v.resultado && v.resultado.numero_venta;
      celda(tr, final && final !== v.numero ? `${v.numero} → ${final}` : (v.numero || '—'));
      celda(tr, fmtFecha(v.creada));
      celda(tr, (v.resumen && v.resumen.cliente) || '—');
      celda(tr, fmtMonto(v.total));
      const est = celda(tr, '');
      const chip = document.createElement('span');
      chip.className = 'chip ' + v.estado; chip.textContent = ESTADOS[v.estado] || v.estado;
      est.appendChild(chip);
      if (v.error && v.estado !== 'subida') { const n = document.createElement('div'); n.className = 'nota'; n.textContent = v.error; est.appendChild(n); }
      const acc = celda(tr, '');
      if (v.estado === 'error') {
        const b = document.createElement('button'); b.textContent = 'Reintentar';
        b.onclick = async () => { await API.ventaReintentar(v.uuid); mensaje('Se volverá a intentar subir esta venta.'); refrescar(); };
        acc.appendChild(b);
      }
      if (v.estado === 'pendiente' || v.estado === 'error') {
        const b = document.createElement('button'); b.className = 'peligro'; b.textContent = 'Anular'; b.style.marginLeft = '6px';
        b.onclick = async () => {
          if (!confirm(`¿Anular la venta ${v.numero} por ${fmtMonto(v.total)}? No se subirá al servidor y el stock vuelve a este equipo.`)) return;
          const r = await API.ventaAnular(v.uuid);
          mensaje(r.ok ? 'Venta anulada.' : r.motivo, !r.ok);
          refrescar();
        };
        acc.appendChild(b);
      }
    }
  }

  async function pintarAlertas() {
    const tbody = $('t-alertas');
    tbody.innerHTML = '';
    if (conexion === 'sin_conexion') { const td = celda(tbody.insertRow(), 'Se ven con internet.'); td.colSpan = 4; td.className = 'vacio'; return; }
    const { data, error } = await sb.from('offline_alertas').select('id, numero_venta, tipo, mensaje, created_at').eq('revisada', false).order('created_at', { ascending: false }).limit(100);
    if (error || !data || !data.length) { const td = celda(tbody.insertRow(), error ? 'No se pudieron leer los avisos.' : 'No hay avisos pendientes. 👍'); td.colSpan = 4; td.className = 'vacio'; return; }
    for (const a of data) {
      const tr = tbody.insertRow();
      celda(tr, new Date(a.created_at).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' }));
      celda(tr, a.numero_venta || '—');
      celda(tr, a.mensaje);
      const b = document.createElement('button'); b.textContent = 'Revisado';
      b.onclick = async () => { const r = await sb.rpc('offline_marcar_alerta_revisada', { p_id: a.id }); if (r.error) mensaje('No se pudo marcar.', true); pintarAlertas(); };
      celda(tr, '').appendChild(b);
    }
  }

  async function refrescar() { await pintarEstado(); await pintarVentas(); }

  $('btn-ventas').onclick = () => { location.href = 'ventas.html'; };
  $('btn-subir').onclick = async () => {
    $('btn-subir').disabled = true; mensaje('Subiendo…');
    try { const e = await API.subirAhora(); mensaje(e.pendientes ? `Quedan ${e.pendientes} venta(s) por subir. ${e.ultimo_error || ''}` : 'Todo subido. ✅', !!e.pendientes); } finally { $('btn-subir').disabled = false; refrescar(); pintarAlertas(); }
  };
  $('btn-exportar').onclick = async () => {
    try { const r = await API.exportar(); if (r.ok) mensaje(`Se guardaron ${r.cantidad} venta(s) en ${r.ruta}`); } catch (e) { mensaje(e.message, true); }
  };

  window.negocio360Escritorio.alCambiarConexion((c) => { const antes = conexion; conexion = c.conexion; pintarEstado(); if (antes === 'sin_conexion' && conexion !== 'sin_conexion') pintarAlertas(); });
  API.alCambiar((ev) => { if (ev && (ev.tipo === 'subidas' || ev.tipo === 'estado')) { clearTimeout(window.__n360t); window.__n360t = setTimeout(refrescar, 300); } });
  N.listo.then(() => { refrescar(); pintarAlertas(); });
})();
