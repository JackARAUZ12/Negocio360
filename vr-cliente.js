/* ============================================================
   VR-CLIENTE.JS — NEGOCIO360 · Elegir cliente en Venta rápida
   (caja POS y Venta con lector).

   - Por defecto cada venta es "Consumidor final" (como siempre).
   - "Elegir": buscador instantáneo por nombre o teléfono sobre la
     lista de clientes que Ventas ya tiene cargada, o "Cliente nuevo"
     con nombre y teléfono.
   - Solo guarda VR.clienteId / VR.clienteNombre: la venta se registra
     con ese cliente y el servidor le suma la compra (y los puntos si
     el negocio los usa), igual que en Nueva Venta. Total, Caja e
     inventario no cambian.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360VRCliente) return;
  const $ = id => document.getElementById(id);
  const norm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  let guardando = false;

  function pintarFila() {
    const n = $('vr-cliente-nombre'), q = $('vr-cliente-quitar'), b = $('vr-cliente-btn');
    const hay = !!VR.clienteId;
    if (n) n.textContent = hay ? VR.clienteNombre : 'Consumidor final';
    if (q) q.style.display = hay ? '' : 'none';
    if (b) b.textContent = hay ? 'Cambiar' : 'Elegir';
  }

  function usar(c) {
    VR.clienteId = c.id; VR.clienteNombre = c.nombre;
    pintarFila(); cerrar();
    showToast(`Cliente: ${c.nombre}`, 'success');
  }

  function quitar() {
    VR.clienteId = null; VR.clienteNombre = null;
    pintarFila();
  }

  function lista() { return (S.clientesCache || []).filter(c => c && c.activo !== false); }

  function filtrar() {
    const cont = $('vrcl-lista'); if (!cont) return;
    const q = norm($('vrcl-buscar').value), qTel = q.replace(/[^0-9]/g, '');
    let res = lista();
    if (q) res = res.filter(c => {
      const txt = norm([c.nombre, c.apellido, c.telefono, c.correo].filter(Boolean).join(' '));
      if (q.split(/\s+/).every(p => txt.includes(p))) return true;
      return qTel.length >= 3 && String(c.telefono || '').replace(/[^0-9]/g, '').includes(qTel);
    });
    const total = res.length;
    res = res.slice(0, 40);
    if (!res.length) {
      cont.innerHTML = `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:18px 8px">${q ? 'Ningún cliente coincide. Puedes crearlo con “＋ Cliente nuevo”.' : 'Todavía no tienes clientes. Crea el primero con “＋ Cliente nuevo”.'}</div>`;
      return;
    }
    cont.innerHTML = res.map(c => `
      <button type="button" data-id="${esc(c.id)}" style="display:flex;width:100%;text-align:left;gap:10px;align-items:center;padding:10px 12px;margin-bottom:6px;border:1px solid var(--border);border-radius:10px;background:var(--bg-surface);color:var(--text-primary);font:inherit;cursor:pointer;min-height:48px">
        <span style="width:32px;height:32px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;font-weight:800;flex:0 0 auto">${esc((c.nombre || '?').trim().charAt(0).toUpperCase())}</span>
        <span style="min-width:0;flex:1"><b style="display:block;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.nombre)}</b>
        <span style="font-size:12px;color:var(--text-muted)">${esc(c.telefono || c.correo || '')}</span></span>
      </button>`).join('') + (total > res.length ? `<div style="text-align:center;font-size:12px;color:var(--text-muted);padding:6px">Mostrando 40 de ${total}. Escribe para encontrar más rápido.</div>` : '');
  }

  async function abrir() {
    volver();
    $('vrcl-buscar').value = '';
    openModal('modal-vr-cliente');
    if (!(S.clientesCache || []).length && typeof loadClientesCache === 'function') {
      $('vrcl-lista').innerHTML = '<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:18px">Cargando clientes…</div>';
      try { await loadClientesCache(); } catch (_) {}
    }
    filtrar();
    setTimeout(() => { try { $('vrcl-buscar').focus(); } catch (_) {} }, 80);
  }

  function cerrar() {
    closeModal('modal-vr-cliente');
    try { if (typeof enfocarScannerVR === 'function') enfocarScannerVR(); } catch (_) {}
  }

  function nuevo() {
    $('vrcl-vista-buscar').style.display = 'none';
    $('vrcl-vista-nuevo').style.display = '';
    $('vrcl-error').textContent = '';
    const q = $('vrcl-buscar').value.trim();
    $('vrcl-nombre').value = /\d{4}/.test(q) ? '' : q;          // lo que ya escribió en el buscador
    $('vrcl-telefono').value = /\d{4}/.test(q) ? q : '';
    setTimeout(() => { try { ($('vrcl-nombre').value ? $('vrcl-telefono') : $('vrcl-nombre')).focus(); } catch (_) {} }, 50);
  }

  function volver() {
    $('vrcl-vista-buscar').style.display = '';
    $('vrcl-vista-nuevo').style.display = 'none';
  }

  async function guardarNuevo() {
    if (guardando) return;
    const nombre = $('vrcl-nombre').value.replace(/\s+/g, ' ').trim();
    const telefono = $('vrcl-telefono').value.trim();
    const err = $('vrcl-error');
    if (nombre.length < 2) { err.textContent = 'Escribe el nombre del cliente.'; return; }
    // Candado contra duplicados: mismo nombre (sin tildes) o mismo teléfono ya registrados.
    const n = norm(nombre), tel = telefono.replace(/[^0-9]/g, '');
    const igual = lista().find(c => norm(c.nombre) === n) || (tel.length >= 7 ? lista().find(c => String(c.telefono || '').replace(/[^0-9]/g, '') === tel) : null);
    if (igual && confirm(`Ya existe "${igual.nombre}"${igual.telefono ? ' (' + igual.telefono + ')' : ''}.\n\n¿Usar ese cliente en vez de crear otro?`)) { usar(igual); return; }
    guardando = true;
    const btn = $('vrcl-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      // Última revisión en la base (puede haber clientes que esta pantalla aún no tiene cargados)
      if (!igual && window.N360ClienteRepetido && N360ClienteRepetido.exactosEnBase) {
        const ex = await N360ClienteRepetido.exactosEnBase(sb, S.userId, nombre);
        if (ex && ex.length && confirm(`Ya existe "${ex[0].nombre}".\n\n¿Usar ese cliente en vez de crear otro?`)) { usar(ex[0]); return; }
      }
      const { data, error } = await sb.from('clientes').insert({ auth_user_id: S.userId, nombre, telefono: telefono || null })
        .select('id,nombre,telefono,correo,activo,updated_at').single();
      if (error) throw error;
      (S.clientesCache = S.clientesCache || []).push(data);
      usar(data);
    } catch (e) {
      console.warn('Cliente nuevo (venta rápida):', e);
      err.textContent = 'No se pudo guardar el cliente: ' + (e.message || 'revisa tu conexión');
    } finally {
      guardando = false; btn.disabled = false; btn.textContent = 'Guardar y usar';
    }
  }

  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('#vrcl-lista button[data-id]');
    if (!b) return;
    const c = lista().find(x => String(x.id) === b.dataset.id);
    if (c) usar(c);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Enter') return;
    if (ev.target && ev.target.id === 'vrcl-buscar') {
      const primero = document.querySelector('#vrcl-lista button[data-id]');
      if (primero) { ev.preventDefault(); primero.click(); }
    } else if (ev.target && (ev.target.id === 'vrcl-nombre' || ev.target.id === 'vrcl-telefono')) {
      ev.preventDefault(); guardarNuevo();
    }
  });

  window.N360VRCliente = { abrir, cerrar, quitar, filtrar, nuevo, volver, guardarNuevo, _pintar: pintarFila };
})();
