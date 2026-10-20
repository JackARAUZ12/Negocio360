/* ============================================================
   ADMIN-FREELANCERS.JS — NEGOCIO360 (panel de administración)
   Vendedores externos de la plataforma: alta por invitación,
   permisos, códigos, clientes captados, pagos confirmados,
   comisiones y auditoría.
   - Todo cambio pasa por funciones del servidor (admin_fl_*) que
     verifican que quien llama es un administrador activo y dejan
     registro en la auditoría. Aquí solo se muestra y se pide.
   - Usa del panel: sb, toast, openModal, closeModal.
   ============================================================ */
(function () {
  'use strict';

  const FLA = {
    lista: [], estado: '', busqueda: '', periodo: 'mes',
    fichaId: null, ficha: null, tab: 'resumen', pagosFicha: [],
  };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = n => '$' + (Number(n) || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = n => (Number(n) || 0).toLocaleString('es-NI');
  const fecha = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const fechaHora = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('es-NI', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const aviso = (t, m, tipo) => (typeof toast === 'function' ? toast(t, m || '', tipo || 'success') : alert(t + (m ? '\n' + m : '')));

  const ESTADOS = {
    activo: ['Activo', 'badge-success'], pendiente: ['Pendiente de activar', 'badge-info'],
    suspendido: ['Suspendido', 'badge-warning'], desactivado: ['Desactivado', 'badge-danger'],
  };
  const badgeEstado = e => { const x = ESTADOS[e] || [e || '—', 'badge-info']; return `<span class="badge ${x[1]} badge-dot">${esc(x[0])}</span>`; };
  const COD = { disponible: ['Disponible', 'badge-success'], utilizado: ['Utilizado', 'badge-info'], expirado: ['Expirado', 'badge-warning'], revocado: ['Revocado', 'badge-danger'] };
  const badgeCodigo = e => { const x = COD[e] || [e, 'badge-info']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; };
  const COM = { pendiente: ['Pendiente', 'badge-warning'], aprobada: ['Aprobada', 'badge-info'], pagada: ['Pagada', 'badge-success'], anulada: ['Anulada', 'badge-danger'], revertida: ['Revertida', 'badge-danger'] };
  const badgeComision = e => { const x = COM[e] || [e, 'badge-info']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; };
  const badgeCuenta = e => e === 'activa' ? '<span class="badge badge-success">Activa</span>' : `<span class="badge badge-warning">${esc(e || '—')}</span>`;

  const ACCIONES = {
    freelancer_creado: 'Freelancer creado', invitacion_generada: 'Nueva invitación', cuenta_activada: 'Cuenta activada',
    inicio_sesion: 'Inició sesión', cierre_sesion: 'Cerró sesión', consulta_panel: 'Consultó su panel',
    codigo_generado: 'Generó un código', codigo_revocado: 'Código revocado', codigo_usado: 'Código usado en un registro',
    codigo_rechazado: 'Código rechazado', cliente_captado: 'Cliente captado', perfil_editado: 'Perfil editado',
    permisos_cambiados: 'Permisos cambiados', suspendido: 'Suspendido', reactivado: 'Reactivado', desactivado: 'Desactivado',
    atribucion_cambiada: 'Cambio de responsable', comision_generada: 'Comisión generada', comision_aprobada: 'Comisión aprobada',
    comision_anulada: 'Comisión anulada', comision_revertida: 'Comisión revertida', liquidacion_pagada: 'Liquidación pagada',
    generar_codigo: 'Intento de generar código', revocar_codigo: 'Intento de revocar código', editar_perfil: 'Intento de editar perfil',
    invitacion_rechazada: 'Invitación rechazada', crear_freelancer: 'Intento de crear freelancer', cambiar_permisos: 'Intento de cambiar permisos',
    cambiar_estado: 'Intento de cambiar estado', cambiar_atribucion: 'Intento de cambiar responsable', editar_freelancer: 'Intento de editar freelancer',
    nueva_invitacion: 'Intento de invitar', comision_estado: 'Intento sobre comisiones', liquidar_comisiones: 'Intento de liquidar',
  };
  const MOTIVOS = {
    no_autorizado: 'No tienes permiso para esta acción.', nombre: 'Escribe un nombre de 2 a 80 letras.', email: 'El correo no es válido.',
    email_repetido: 'Ya existe un freelancer con ese correo.', es_admin: 'Ese correo es de un administrador.', permiso_invalido: 'Algún permiso tiene un valor fuera de rango.',
    no_encontrado: 'No se encontró.', ya_tiene_cuenta: 'Ya activó su cuenta; no necesita invitación.', sin_cuenta: 'Aún no activó su cuenta: no se puede activar.',
    motivo_requerido: 'Escribe el motivo.', campo_no_permitido: 'Campo no permitido.', datos_invalidos: 'Revisa los datos.',
    cliente_no_existe: 'No existe esa cuenta de cliente.', freelancer_no_existe: 'No existe ese freelancer.', propia_cuenta: 'Un freelancer no puede ser responsable de su propia cuenta.',
    solo_aprobadas_del_freelancer: 'Solo se pueden liquidar comisiones APROBADAS de este freelancer.', sin_comisiones: 'No hay comisiones seleccionadas.', estado: 'Estado no válido.',
  };
  const msg = r => MOTIVOS[r?.motivo] || r?.motivo || 'No se pudo completar.';

  async function rpc(nombre, params) {
    const { data, error } = await sb.rpc(nombre, params || {});
    if (error) throw error;
    return data;
  }

  // ── Periodo del dashboard ─────────────────────────────────
  function rangoPeriodo() {
    const hoy = new Date();
    if (FLA.periodo === 'dia') return [isoLocal(hoy), isoLocal(hoy), 'Hoy'];
    if (FLA.periodo === 'semana') { const d = new Date(hoy); d.setDate(d.getDate() - 6); return [isoLocal(d), isoLocal(hoy), 'Últimos 7 días']; }
    if (FLA.periodo === 'rango') {
      const d = $('fl-desde').value, h = $('fl-hasta').value;
      if (d && h) return [d, h, `Del ${fecha(d + 'T12:00')} al ${fecha(h + 'T12:00')}`];
    }
    return [isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), isoLocal(hoy), 'Este mes'];
  }

  async function cargarResumen() {
    const [d, h, txt] = rangoPeriodo();
    $('fl-periodo-txt').textContent = txt;
    $('fl-kpis').innerHTML = '<div class="fl-cargando">Cargando…</div>';
    try {
      const r = await rpc('admin_fl_resumen', { p_desde: d, p_hasta: h });
      if (!r?.ok) throw new Error(msg(r));
      const f = r.freelancers || {}, p = r.pagos || {}, c = r.comisiones || {};
      const tasa = Number(r.codigos_generados) > 0 ? Math.round(100 * Number(r.codigos_usados) / Number(r.codigos_generados)) + '%' : '—';
      const kpi = (cls, valor, label, sub) => `<div class="stat-card ${cls}"><div class="stat-value">${valor}</div><div class="stat-label">${label}</div><div class="fl-kpi-sub">${sub}</div></div>`;
      $('fl-kpis').innerHTML =
        kpi('total', num(f.total), 'Freelancers', `${num(f.activos)} activos · ${num(f.suspendidos)} suspendidos · ${num(f.pendientes)} por activar`) +
        kpi('trial', num(r.codigos_generados), 'Códigos generados', `${num(r.codigos_usados)} usados en el periodo · tasa ${tasa}`) +
        kpi('active', num(r.clientes_nuevos), 'Clientes nuevos', `Hoy: ${num(r.clientes_activos)} activos · ${num(r.clientes_no_activos)} no activos (todos los atribuidos)`) +
        kpi('premium', usd(p.monto), 'Pagos confirmados', `${num(p.cantidad)} pago(s) · ${num(p.renovaciones)} renovación(es)`) +
        kpi('suspended', usd(c.pendiente), 'Comisiones por aprobar', `Aprobadas ${usd(c.aprobada)} · Pagadas ${usd(c.pagada)} (histórico)`) +
        kpi('total', r.ultima_actividad ? fechaHora(r.ultima_actividad) : '—', 'Última actividad', 'de cualquier freelancer');
      const rk = (r.ranking || []).filter(x => x.clientes || x.codigos || Number(x.pagos_monto));
      $('fl-ranking').innerHTML = rk.length ? `<table class="data-table"><thead><tr><th>#</th><th>Freelancer</th><th>Clientes nuevos</th><th>Códigos</th><th>Pagos confirmados</th><th>Última actividad</th></tr></thead><tbody>
        ${rk.map((x, i) => `<tr><td>${i + 1}</td><td><a href="#" data-fl-ver="${esc(x.id)}">${esc(x.nombre)}</a> ${badgeEstado(x.estado)}</td><td>${num(x.clientes)}</td><td>${num(x.codigos)}</td><td>${usd(x.pagos_monto)}</td><td>${fechaHora(x.ultima_actividad)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="fl-vacio">Sin movimiento de freelancers en este periodo.</div>';
    } catch (e) {
      console.error('admin_fl_resumen:', e);
      $('fl-kpis').innerHTML = `<div class="fl-error">No se pudo cargar el resumen: ${esc(e.message)}</div>`;
    }
  }

  // ── Listado ───────────────────────────────────────────────
  async function cargarLista() {
    try {
      const r = await rpc('admin_fl_listar');
      if (!r?.ok) throw new Error(msg(r));
      FLA.lista = r.freelancers || [];
      renderLista();
    } catch (e) {
      console.error('admin_fl_listar:', e);
      $('fl-tbody').innerHTML = `<tr><td colspan="9" class="fl-error">No se pudo cargar: ${esc(e.message)}</td></tr>`;
    }
  }
  function filtrados() {
    const q = FLA.busqueda.trim().toLowerCase(), d = $('fl-inc-desde').value, h = $('fl-inc-hasta').value;
    return FLA.lista.filter(f => {
      if (FLA.estado && f.estado !== FLA.estado) return false;
      const inc = String(f.created_at || '').slice(0, 10);
      if (d && inc < d) return false;
      if (h && inc > h) return false;
      if (!q) return true;
      return [f.nombre, f.email, f.identificacion, f.telefono, f.estado, f.id].some(v => String(v || '').toLowerCase().includes(q));
    });
  }
  function renderLista() {
    const l = filtrados();
    if (!l.length) {
      $('fl-tbody').innerHTML = `<tr><td colspan="9"><div class="empty-state"><p>${FLA.lista.length ? 'Ningún freelancer coincide con el filtro' : 'Aún no hay freelancers'}</p><span>${FLA.lista.length ? '' : 'Crea el primero con "Nuevo freelancer".'}</span></div></td></tr>`;
      return;
    }
    $('fl-tbody').innerHTML = l.map(f => `<tr>
      <td><a href="#" class="fl-nombre" data-fl-ver="${esc(f.id)}">${esc(f.nombre)}</a><div class="fl-mini">${esc(f.email)}${f.identificacion ? ' · ' + esc(f.identificacion) : ''}</div></td>
      <td>${badgeEstado(f.estado)}${f.estado === 'pendiente' ? `<div class="fl-mini">${f.invitacion_vigente ? 'Invitación vigente' : 'Invitación vencida'}</div>` : ''}</td>
      <td>${fecha(f.created_at)}</td>
      <td>${fechaHora(f.ultimo_acceso)}</td>
      <td><b>${num(f.codigos_total)}</b><div class="fl-mini">${num(f.codigos_usados)} usados · ${num(f.codigos_disponibles)} disponibles</div></td>
      <td><b>${num(f.clientes_total)}</b><div class="fl-mini">${num(f.clientes_activos)} activos · ${num(f.clientes_suspendidos)} no activos</div></td>
      <td><b>${usd(f.pagos_monto)}</b><div class="fl-mini">${num(f.pagos_confirmados)} pago(s)</div></td>
      <td>${f.comision_activa ? `<b>${usd(Number(f.comision_pendiente) + Number(f.comision_aprobada))}</b><div class="fl-mini">por pagar · pagado ${usd(f.comision_pagada)}</div>` : '<span class="fl-mini">Sin comisión</span>'}</td>
      <td><div class="td-actions">
        <button class="btn-icon btn-ghost btn-sm" type="button" data-fl-ver="${esc(f.id)}">Ver ficha</button>
        <button class="btn-icon btn-ghost btn-sm" type="button" data-fl-ver="${esc(f.id)}" data-fl-tab-ir="permisos">Permisos</button>
        ${f.estado === 'activo' ? `<button class="btn-icon btn-warning btn-sm" type="button" data-fl-estado-ir="suspendido" data-fl-id="${esc(f.id)}">Suspender</button>` : ''}
        ${(f.estado === 'suspendido' || f.estado === 'desactivado') && f.tiene_cuenta ? `<button class="btn-icon btn-success btn-sm" type="button" data-fl-estado-ir="activo" data-fl-id="${esc(f.id)}">Reactivar</button>` : ''}
      </div></td></tr>`).join('');
  }

  function csv(nombre, filas) {
    const txt = filas.map(r => r.map(v => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s;   // evita fórmulas al abrir en Excel
      return '"' + s.replace(/"/g, '""') + '"';
    }).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
    a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportarLista() {
    csv(`freelancers-${isoLocal(new Date())}.csv`, [
      ['Nombre', 'Correo', 'Identificación', 'Teléfono', 'Estado', 'Incorporación', 'Último acceso', 'Códigos', 'Códigos usados', 'Códigos disponibles',
        'Clientes', 'Clientes activos', 'Clientes no activos', 'Pagos confirmados', 'Monto pagos USD', 'Comisión pendiente', 'Comisión aprobada', 'Comisión pagada'],
      ...filtrados().map(f => [f.nombre, f.email, f.identificacion, f.telefono, f.estado, String(f.created_at || '').slice(0, 10), f.ultimo_acceso || '',
        f.codigos_total, f.codigos_usados, f.codigos_disponibles, f.clientes_total, f.clientes_activos, f.clientes_suspendidos, f.pagos_confirmados,
        f.pagos_monto, f.comision_pendiente, f.comision_aprobada, f.comision_pagada]),
    ]);
  }

  // ── Seguridad (intentos rechazados) ───────────────────────
  async function cargarSeguridad() {
    try {
      const { data, error } = await sb.from('plataforma_freelancer_auditoria').select('*').eq('resultado', 'denegado').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      const nom = id => FLA.lista.find(f => f.id === id)?.nombre;
      $('fl-seguridad').innerHTML = (data || []).length ? `<table class="data-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Quién</th><th>Freelancer</th><th>Detalle</th></tr></thead><tbody>
        ${data.map(a => `<tr><td>${fechaHora(a.created_at)}</td><td>${esc(ACCIONES[a.accion] || a.accion)}</td><td>${esc(a.actor_tipo)}${a.actor_email ? '<div class="fl-mini">' + esc(a.actor_email) + '</div>' : ''}</td>
          <td>${esc(nom(a.freelancer_id) || '—')}</td><td class="fl-detalle">${esc(resumenDetalle(a.detalle))}</td></tr>`).join('')}</tbody></table>`
        : '<div class="fl-vacio">Sin intentos rechazados. 👍</div>';
    } catch (e) {
      $('fl-seguridad').innerHTML = `<div class="fl-error">No se pudo cargar: ${esc(e.message)}</div>`;
    }
  }
  function resumenDetalle(d) {
    if (!d) return '';
    if (d.motivo) return 'Motivo: ' + d.motivo;
    try { return JSON.stringify(d).slice(0, 220); } catch { return ''; }
  }

  async function cargar() {
    await cargarLista();
    await Promise.all([cargarResumen(), cargarSeguridad()]);
  }

  // ── Crear freelancer ──────────────────────────────────────
  function abrirNuevo() {
    ['fl-n-nombre', 'fl-n-email', 'fl-n-tel', 'fl-n-ident'].forEach(id => { $(id).value = ''; });
    $('fl-n-generar').checked = false;
    $('fl-nuevo-form').style.display = ''; $('fl-nuevo-ok').style.display = 'none';
    $('fl-nuevo-footer').style.display = '';
    openModal('fl-modal-nuevo');
    setTimeout(() => $('fl-n-nombre').focus(), 50);
  }
  function htmlInvitacion(nombre, email, token, expira) {
    const link = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}freelancer.html?inv=${encodeURIComponent(token)}`;
    return `<div class="fl-invitacion">
      <p><b>Invitación para ${esc(nombre)}</b> (${esc(email)}). Vence el ${fechaHora(expira)}.</p>
      <p class="fl-mini">⚠️ Este código se muestra <b>una sola vez</b>: no se guarda en el sistema. Si se pierde, genera una nueva invitación.</p>
      <div class="fl-token"><code>${esc(token)}</code><button type="button" class="btn-copy" data-fl-copiar="${esc(token)}">Copiar código</button></div>
      <div class="fl-token"><code class="fl-link">${esc(link)}</code><button type="button" class="btn-copy" data-fl-copiar="${esc(link)}">Copiar enlace</button></div>
      <p class="fl-mini">El freelancer abre el enlace, crea su contraseña con ese mismo correo y entra a su panel. Si ya tiene cuenta en Negocio360, inicia sesión y pega el código.</p>
    </div>`;
  }
  async function guardarNuevo() {
    const btn = $('fl-n-guardar');
    const nombre = $('fl-n-nombre').value.trim(), email = $('fl-n-email').value.trim();
    if (nombre.length < 2) { aviso('Falta el nombre', '', 'warning'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { aviso('Correo no válido', '', 'warning'); return; }
    btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span>';
    try {
      const r = await rpc('admin_fl_crear', { p_nombre: nombre, p_email: email, p_telefono: $('fl-n-tel').value.trim() || null,
        p_identificacion: $('fl-n-ident').value.trim() || null, p_permisos: { puede_generar_codigos: $('fl-n-generar').checked } });
      if (!r?.ok) { aviso('No se creó', msg(r), 'error'); return; }
      $('fl-nuevo-form').style.display = 'none'; $('fl-nuevo-footer').style.display = 'none';
      $('fl-nuevo-ok').style.display = '';
      $('fl-nuevo-ok').innerHTML = htmlInvitacion(nombre, email, r.invitacion, r.expira);
      aviso('Freelancer creado', 'Envíale la invitación', 'success');
      cargar();
    } catch (e) { aviso('Error al crear', e.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Crear e invitar'; }
  }

  // ── Confirmación con motivo ───────────────────────────────
  function pedirMotivo({ titulo, texto, label = 'Motivo', minimo = 0, boton = 'Confirmar', peligro = true, extraHtml = '' }) {
    return new Promise(resolve => {
      $('fl-motivo-titulo').textContent = titulo;
      $('fl-motivo-texto').innerHTML = texto;
      $('fl-motivo-label').textContent = label + (minimo ? ' *' : ' (opcional)');
      $('fl-motivo-extra').innerHTML = extraHtml;
      $('fl-motivo-extra').style.display = extraHtml ? '' : 'none';
      $('fl-motivo-input').value = '';
      const ok = $('fl-motivo-ok');
      ok.textContent = boton; ok.className = 'btn-icon ' + (peligro ? 'btn-danger' : 'btn-primary');
      let hecho = false;
      const fin = v => { if (hecho) return; hecho = true; ok.onclick = null; obs.disconnect(); closeModal('fl-modal-motivo'); resolve(v); };
      ok.onclick = () => {
        const m = $('fl-motivo-input').value.trim();
        if (m.length < minimo) { aviso('Escribe el motivo', `Mínimo ${minimo} caracteres`, 'warning'); return; }
        const extra = {}; $('fl-motivo-extra').querySelectorAll('[name]').forEach(el => { extra[el.name] = el.value; });
        fin({ motivo: m, extra });
      };
      const modal = $('fl-modal-motivo');
      const obs = new MutationObserver(() => { if (!modal.classList.contains('open')) fin(null); });
      openModal('fl-modal-motivo');
      obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
      setTimeout(() => $('fl-motivo-input').focus(), 50);
    });
  }

  async function cambiarEstado(id, estado) {
    const f = FLA.lista.find(x => x.id === id) || FLA.ficha?.freelancer;
    if (!f) return;
    const pol = f.politica_suspension === 'conservar' ? 'Sus códigos sin usar <b>seguirán funcionando</b> (política "conservar").' : 'Sus códigos sin usar se <b>revocarán</b>.';
    const textos = {
      suspendido: { titulo: 'Suspender freelancer', texto: `¿Suspender a <b>${esc(f.nombre)}</b>? No podrá generar códigos ni ver su panel. ${pol}`, minimo: 3, boton: 'Suspender' },
      desactivado: { titulo: 'Desactivar freelancer', texto: `¿Dar de baja a <b>${esc(f.nombre)}</b>? Se revocan todos sus códigos sin usar. Sus clientes y su historial se conservan.`, minimo: 3, boton: 'Desactivar' },
      activo: { titulo: 'Reactivar freelancer', texto: `¿Reactivar a <b>${esc(f.nombre)}</b>? Los códigos que se revocaron no vuelven a activarse.`, minimo: 0, boton: 'Reactivar', peligro: false },
    }[estado];
    const r0 = await pedirMotivo(textos);
    if (!r0) return;
    try {
      const r = await rpc('admin_fl_estado', { p_id: id, p_estado: estado, p_motivo: r0.motivo || null });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      aviso('Listo', estado === 'activo' ? 'Freelancer reactivado' : `Freelancer ${estado}. Códigos revocados: ${r.codigos_revocados || 0}`, 'success');
      await cargar();
      if (FLA.fichaId === id && $('fl-modal-ficha').classList.contains('open')) await abrirFicha(id, FLA.tab);
    } catch (e) { aviso('Error', e.message, 'error'); }
  }

  // ── Ficha ─────────────────────────────────────────────────
  async function abrirFicha(id, tab) {
    FLA.fichaId = id; FLA.tab = tab || 'resumen';
    $('fl-ficha-body').innerHTML = '<div class="fl-cargando">Cargando…</div>';
    if (!$('fl-modal-ficha').classList.contains('open')) openModal('fl-modal-ficha');
    try {
      const r = await rpc('admin_fl_detalle', { p_id: id });
      if (!r?.ok) throw new Error(msg(r));
      FLA.ficha = r;
      const ids = (r.clientes || []).map(c => c.auth_user_id);
      FLA.pagosFicha = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data } = await sb.from('plataforma_pagos').select('auth_user_id,ciclo,monto,created_at').in('auth_user_id', ids.slice(i, i + 150));
        FLA.pagosFicha.push(...(data || []));
      }
      $('fl-ficha-titulo').innerHTML = `${esc(r.freelancer.nombre)} ${badgeEstado(r.freelancer.estado)}`;
      renderTab();
    } catch (e) {
      $('fl-ficha-body').innerHTML = `<div class="fl-error">No se pudo cargar la ficha: ${esc(e.message)}</div>`;
    }
  }
  function renderTab() {
    document.querySelectorAll('#fl-ficha-tabs .fl-tab').forEach(b => b.classList.toggle('on', b.dataset.flTab === FLA.tab));
    const fn = { resumen: tabResumen, permisos: tabPermisos, codigos: tabCodigos, clientes: tabClientes, actividad: tabActividad, rendimiento: tabRendimiento, comisiones: tabComisiones }[FLA.tab];
    $('fl-ficha-body').innerHTML = fn ? fn() : '';
  }

  function tabResumen() {
    const { freelancer: f, codigos = [], clientes = [], comisiones = [] } = FLA.ficha;
    const pagos = FLA.pagosFicha, montoPagos = pagos.reduce((s, p) => s + Number(p.monto || 0), 0);
    const usados = codigos.filter(c => Number(c.usos_actuales) > 0).length;
    const activos = clientes.filter(c => c.estado_cuenta === 'activa').length;
    const porPagar = comisiones.filter(c => c.estado === 'pendiente' || c.estado === 'aprobada').reduce((s, c) => s + Number(c.monto), 0);
    return `<div class="fl-mini-kpis">
        <div><b>${codigos.length}</b><span>códigos</span><small>${usados} usados</small></div>
        <div><b>${clientes.length}</b><span>clientes</span><small>${activos} activos</small></div>
        <div><b>${usd(montoPagos)}</b><span>pagos confirmados</span><small>${pagos.length} pago(s)</small></div>
        <div><b>${f.comision_activa ? usd(porPagar) : '—'}</b><span>comisión por pagar</span><small>${f.comision_activa ? f.comision_pct + '%' : 'sin comisión'}</small></div>
      </div>
      <div class="detail-grid fl-datos">
        <div><span>Correo</span><b>${esc(f.email)}</b></div>
        <div><span>Estado</span><b>${badgeEstado(f.estado)}</b>${f.motivo_estado ? `<small>Motivo: ${esc(f.motivo_estado)}</small>` : ''}</div>
        <div><span>Incorporación</span><b>${fecha(f.created_at)}</b><small>por ${esc(f.creado_por || '—')}</small></div>
        <div><span>Cuenta</span><b>${f.tiene_cuenta ? 'Activada' : 'Sin activar'}</b>${!f.tiene_cuenta ? `<small>${f.invitacion_vigente ? 'Invitación vigente hasta ' + fechaHora(f.invitacion_expira) : 'Invitación vencida'}</small>` : ''}</div>
        <div><span>Último acceso</span><b>${fechaHora(f.ultimo_acceso)}</b></div>
        <div><span>Última actividad</span><b>${fechaHora(f.ultima_actividad)}</b></div>
      </div>
      <h4 class="fl-h4">Datos</h4>
      <div class="form-row">
        <div class="form-group"><label for="fl-e-nombre">Nombre</label><input class="form-control" id="fl-e-nombre" maxlength="80" value="${esc(f.nombre)}" /></div>
        <div class="form-group"><label for="fl-e-tel">Teléfono</label><input class="form-control" id="fl-e-tel" maxlength="30" value="${esc(f.telefono || '')}" /></div>
      </div>
      <div class="form-group"><label for="fl-e-ident">Identificación</label><input class="form-control" id="fl-e-ident" maxlength="40" value="${esc(f.identificacion || '')}" /></div>
      <div class="form-group"><label for="fl-e-notas">Notas internas (el freelancer no las ve)</label><textarea class="form-control" id="fl-e-notas" rows="2" maxlength="2000">${esc(f.notas_admin || '')}</textarea></div>
      <div class="fl-acciones">
        <button class="btn-icon btn-primary btn-sm" type="button" id="fl-e-guardar">Guardar datos</button>
        ${f.estado === 'pendiente' ? '<button class="btn-icon btn-ghost btn-sm" type="button" id="fl-e-invitar">Generar nueva invitación</button>' : ''}
        ${f.estado === 'activo' ? `<button class="btn-icon btn-warning btn-sm" type="button" data-fl-estado-ir="suspendido" data-fl-id="${esc(f.id)}">Suspender</button>` : ''}
        ${(f.estado === 'suspendido' || f.estado === 'desactivado') && f.tiene_cuenta ? `<button class="btn-icon btn-success btn-sm" type="button" data-fl-estado-ir="activo" data-fl-id="${esc(f.id)}">Reactivar</button>` : ''}
        ${f.estado !== 'desactivado' ? `<button class="btn-icon btn-danger btn-sm" type="button" data-fl-estado-ir="desactivado" data-fl-id="${esc(f.id)}">Desactivar</button>` : ''}
      </div>
      <div id="fl-e-invitacion"></div>`;
  }

  function tabPermisos() {
    const f = FLA.ficha.freelancer, pl = f.planes_permitidos || [];
    return `<p class="fl-mini">Solo el administrador cambia estos permisos. Cada cambio queda en la auditoría con el valor anterior y el nuevo.</p>
      <div class="fl-permisos">
        <label class="fl-check"><input type="checkbox" id="fl-p-generar" ${f.puede_generar_codigos ? 'checked' : ''}/> Puede generar códigos de acceso</label>
        <div class="form-group"><label>Planes que puede ofrecer en sus códigos</label>
          <label class="fl-check"><input type="checkbox" id="fl-p-prueba" ${pl.includes('prueba') ? 'checked' : ''}/> Prueba</label>
          <label class="fl-check"><input type="checkbox" id="fl-p-premium" ${pl.includes('premium') ? 'checked' : ''}/> Premium</label>
        </div>
        <div class="form-row">
          <div class="form-group"><label for="fl-p-usos">Usos máximos por código (1–50)</label><input class="form-control" type="number" min="1" max="50" id="fl-p-usos" value="${esc(f.max_usos_por_codigo)}" /></div>
          <div class="form-group"><label for="fl-p-mes">Códigos por mes (0–500)</label><input class="form-control" type="number" min="0" max="500" id="fl-p-mes" value="${esc(f.max_codigos_mes)}" /></div>
          <div class="form-group"><label for="fl-p-dias">Vencimiento máximo en días (1–365)</label><input class="form-control" type="number" min="1" max="365" id="fl-p-dias" value="${esc(f.max_dias_expiracion)}" /></div>
        </div>
        <label class="fl-check"><input type="checkbox" id="fl-p-vercli" ${f.puede_ver_estado_clientes ? 'checked' : ''}/> Puede ver el estado y plan de sus clientes</label>
        <label class="fl-check"><input type="checkbox" id="fl-p-perfil" ${f.puede_editar_perfil ? 'checked' : ''}/> Puede editar su nombre y teléfono</label>
        <div class="form-group"><label for="fl-p-politica">Si se suspende, sus códigos sin usar…</label>
          <select class="form-control" id="fl-p-politica">
            <option value="revocar" ${f.politica_suspension === 'revocar' ? 'selected' : ''}>Se revocan (recomendado)</option>
            <option value="conservar" ${f.politica_suspension === 'conservar' ? 'selected' : ''}>Siguen funcionando</option>
          </select></div>
        <h4 class="fl-h4">Comisión</h4>
        <div class="fl-nota">Decisión comercial pendiente: Negocio360 todavía no tiene una regla de comisión definida. Mientras esté apagada no se calcula nada. Si la activas, se genera una comisión <b>pendiente</b> solo cuando un administrador marca un pago de un cliente de este freelancer; luego tú la apruebas y la liquidas. No es retroactiva.</div>
        <div class="form-row">
          <label class="fl-check"><input type="checkbox" id="fl-p-com" ${f.comision_activa ? 'checked' : ''}/> Comisión activa</label>
          <div class="form-group"><label for="fl-p-pct">% sobre cada pago confirmado</label><input class="form-control" type="number" min="0.01" max="100" step="0.01" id="fl-p-pct" value="${esc(f.comision_pct ?? '')}" /></div>
        </div>
        <div class="fl-acciones"><button class="btn-icon btn-primary btn-sm" type="button" id="fl-p-guardar">Guardar permisos</button></div>
      </div>`;
  }

  function tabCodigos() {
    const l = FLA.ficha.codigos || [];
    if (!l.length) return '<div class="fl-vacio">Este freelancer aún no ha generado códigos.</div>';
    return `<div class="table-responsive"><table class="data-table"><thead><tr><th>Código</th><th>Plan</th><th>Estado</th><th>Usos</th><th>Vence</th><th>Creado</th><th>Cuenta(s) creada(s)</th><th></th></tr></thead><tbody>
      ${l.map(c => `<tr><td><code class="fl-cod">${esc(c.codigo)}</code>${c.descripcion ? `<div class="fl-mini">${esc(c.descripcion)}</div>` : ''}</td>
        <td>${esc(c.plan)}</td><td>${badgeCodigo(c.estado)}${c.revocado_por ? `<div class="fl-mini">${esc(c.revocado_por)}</div>` : ''}</td>
        <td>${num(c.usos_actuales)} / ${num(c.usos_maximos)}</td><td>${fecha(c.fecha_expiracion)}</td><td>${fecha(c.created_at)}</td>
        <td>${(c.cuentas || []).map(u => `${esc(u.negocio || 'Cuenta')} <span class="fl-mini">${fecha(u.usado_en)}</span>`).join('<br>') || '—'}</td>
        <td>${c.estado === 'disponible' ? `<button class="btn-icon btn-danger btn-sm" type="button" data-fl-revocar="${esc(c.id)}" data-fl-cod="${esc(c.codigo)}">Revocar</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>`;
  }

  function tabClientes() {
    const l = FLA.ficha.clientes || [];
    const pagosDe = id => FLA.pagosFicha.filter(p => p.auth_user_id === id);
    return `<div class="fl-atribuir">
        <input class="form-control" id="fl-a-email" type="email" placeholder="Correo de una cuenta existente" aria-label="Correo del cliente" />
        <button class="btn-icon btn-ghost btn-sm" type="button" id="fl-a-buscar">Atribuir cliente existente a este freelancer</button>
      </div>
      ${l.length ? `<div class="table-responsive"><table class="data-table"><thead><tr><th>Cliente</th><th>Contacto</th><th>Cuenta</th><th>Plan</th><th>Captado</th><th>Origen</th><th>Pagos confirmados</th><th></th></tr></thead><tbody>
      ${l.map(c => { const p = pagosDe(c.auth_user_id); return `<tr>
        <td><b>${esc(c.negocio || '—')}</b><div class="fl-mini">${esc(c.nombre || '')}</div></td>
        <td>${esc(c.email || '')}<div class="fl-mini">${esc(c.telefono || '')}</div></td>
        <td>${badgeCuenta(c.estado_cuenta)}<div class="fl-mini">Alta ${fecha(c.alta)}</div></td>
        <td>${esc(c.plan || '—')}</td><td>${fecha(c.captado_en)}</td>
        <td>${c.origen === 'codigo' ? `Código <code class="fl-cod">${esc(c.codigo || '')}</code>` : 'Asignado por admin'}${c.notas_admin ? `<div class="fl-mini">${esc(c.notas_admin)}</div>` : ''}</td>
        <td><b>${usd(c.pagos_monto)}</b><div class="fl-mini">${num(c.pagos)} pago(s)${p.length ? ' · último ' + esc(p.map(x => x.ciclo).sort().pop()) : ''}</div></td>
        <td><button class="btn-icon btn-ghost btn-sm" type="button" data-fl-reasignar="${esc(c.auth_user_id)}" data-fl-neg="${esc(c.negocio || '')}">Cambiar responsable</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<div class="fl-vacio">Aún no tiene clientes atribuidos.</div>'}
      ${(FLA.ficha.historial_atribuciones || []).length ? `<h4 class="fl-h4">Historial de cambios de responsable</h4><table class="data-table"><thead><tr><th>Fecha</th><th>Antes</th><th>Después</th><th>Motivo</th><th>Por</th></tr></thead><tbody>
        ${FLA.ficha.historial_atribuciones.map(h => `<tr><td>${fechaHora(h.created_at)}</td><td>${esc(nombreFl(h.freelancer_anterior))}</td><td>${esc(nombreFl(h.freelancer_nuevo))}</td><td>${esc(h.motivo)}</td><td>${esc(h.cambiado_por || '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }
  const nombreFl = id => id ? (FLA.lista.find(f => f.id === id)?.nombre || 'Otro freelancer') : 'Sin responsable';

  function tabActividad() {
    const l = FLA.ficha.actividad || [];
    return `<div class="fl-acciones"><button class="btn-icon btn-ghost btn-sm" type="button" id="fl-act-csv">Exportar CSV</button><span class="fl-mini">Registro de solo lectura (nadie puede editarlo ni borrarlo). Últimos 300 eventos.</span></div>
      ${l.length ? `<div class="table-responsive"><table class="data-table"><thead><tr><th>Fecha</th><th>Acción</th><th>Resultado</th><th>Quién</th><th>Detalle</th></tr></thead><tbody>
      ${l.map(a => `<tr><td>${fechaHora(a.created_at)}</td><td>${esc(ACCIONES[a.accion] || a.accion)}</td>
        <td>${a.resultado === 'ok' ? '<span class="badge badge-success">OK</span>' : `<span class="badge badge-danger">${esc(a.resultado)}</span>`}</td>
        <td>${esc(a.actor_tipo)}${a.actor_email ? `<div class="fl-mini">${esc(a.actor_email)}</div>` : ''}</td><td class="fl-detalle">${esc(resumenDetalle(a.detalle))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="fl-vacio">Sin actividad.</div>'}`;
  }

  function tabRendimiento() {
    const { codigos = [], clientes = [] } = FLA.ficha;
    const hoy = new Date(), meses = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const por = (lista, campo) => meses.map(m => lista.filter(x => String(x[campo] || '').slice(0, 7) === m).length);
    const cod = por(codigos, 'created_at'), cli = por(clientes, 'captado_en');
    const pag = meses.map(m => FLA.pagosFicha.filter(p => String(p.created_at || '').slice(0, 7) === m).reduce((s, p) => s + Number(p.monto || 0), 0));
    const max = Math.max(1, ...cod, ...cli);
    const maxP = Math.max(1, ...pag);
    const nombreMes = m => new Date(m + '-15').toLocaleDateString('es-NI', { month: 'short', year: '2-digit' });
    const usados = codigos.filter(c => Number(c.usos_actuales) > 0).length;
    const conv = codigos.length ? Math.round(100 * usados / codigos.length) + '%' : '—';
    return `<div class="fl-mini-kpis"><div><b>${conv}</b><span>códigos que terminaron en cuenta</span><small>${usados} de ${codigos.length}</small></div>
        <div><b>${clientes.filter(c => c.estado_cuenta === 'activa').length}</b><span>clientes activos hoy</span><small>de ${clientes.length}</small></div>
        <div><b>${clientes.filter(c => Number(c.pagos) > 1).length}</b><span>clientes que renovaron</span><small>más de un pago confirmado</small></div></div>
      <h4 class="fl-h4">Últimos 6 meses</h4>
      <div class="fl-barras">${meses.map((m, i) => `<div class="fl-barra-col">
          <div class="fl-barra-par"><i class="b1" style="height:${(100 * cod[i] / max).toFixed(0)}%" title="${cod[i]} códigos"></i><i class="b2" style="height:${(100 * cli[i] / max).toFixed(0)}%" title="${cli[i]} clientes"></i></div>
          <small>${esc(nombreMes(m))}</small><small>${cod[i]} · ${cli[i]}</small></div>`).join('')}</div>
      <div class="fl-leyenda"><span><i class="b1"></i> Códigos generados</span><span><i class="b2"></i> Clientes captados</span></div>
      <h4 class="fl-h4">Pagos confirmados de sus clientes por mes (USD)</h4>
      <div class="fl-barras">${meses.map((m, i) => `<div class="fl-barra-col"><div class="fl-barra-par"><i class="b3" style="height:${(100 * pag[i] / maxP).toFixed(0)}%"></i></div><small>${esc(nombreMes(m))}</small><small>${usd(pag[i])}</small></div>`).join('')}</div>`;
  }

  function tabComisiones() {
    const f = FLA.ficha.freelancer, l = FLA.ficha.comisiones || [], liq = FLA.ficha.liquidaciones || [];
    const suma = e => l.filter(c => c.estado === e).reduce((s, c) => s + Number(c.monto), 0);
    return `${!f.comision_activa ? '<div class="fl-nota">La comisión de este freelancer está <b>apagada</b> (pestaña Permisos). No se generan comisiones nuevas.</div>' : `<div class="fl-nota">${esc(f.comision_pct)}% sobre cada pago confirmado de sus clientes. Flujo: <b>pendiente → aprobada → pagada</b> (en una liquidación). Calcular no es pagar.</div>`}
      <div class="fl-mini-kpis"><div><b>${usd(suma('pendiente'))}</b><span>pendiente de aprobar</span></div><div><b>${usd(suma('aprobada'))}</b><span>aprobada, por pagar</span></div><div><b>${usd(suma('pagada'))}</b><span>pagada</span></div><div><b>${usd(suma('anulada') + suma('revertida'))}</b><span>anulada / revertida</span></div></div>
      ${l.length ? `<div class="fl-acciones">
          <button class="btn-icon btn-primary btn-sm" type="button" data-fl-com="aprobada">Aprobar seleccionadas</button>
          <button class="btn-icon btn-success btn-sm" type="button" id="fl-com-liquidar">Liquidar (pagar) las aprobadas seleccionadas</button>
          <button class="btn-icon btn-warning btn-sm" type="button" data-fl-com="anulada">Anular</button>
          <button class="btn-icon btn-danger btn-sm" type="button" data-fl-com="revertida">Revertir pagadas</button></div>
        <div class="table-responsive"><table class="data-table"><thead><tr><th><input type="checkbox" id="fl-com-todas" aria-label="Seleccionar todas" /></th><th>Cliente</th><th>Ciclo pagado</th><th>Base</th><th>%</th><th>Comisión</th><th>Estado</th><th>Generada</th></tr></thead><tbody>
        ${l.map(c => `<tr><td><input type="checkbox" class="fl-com-sel" value="${esc(c.id)}" data-estado="${esc(c.estado)}" aria-label="Seleccionar" /></td><td>${esc(c.negocio || '—')}</td><td>${esc(c.ciclo)}</td><td>${usd(c.base)}</td><td>${esc(c.porcentaje)}%</td><td><b>${usd(c.monto)}</b></td><td>${badgeComision(c.estado)}${c.motivo ? `<div class="fl-mini">${esc(c.motivo)}</div>` : ''}</td><td>${fecha(c.created_at)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="fl-vacio">Sin comisiones.</div>'}
      ${liq.length ? `<h4 class="fl-h4">Liquidaciones</h4><table class="data-table"><thead><tr><th>Fecha</th><th>Comisiones</th><th>Total</th><th>Nota</th><th>Por</th></tr></thead><tbody>
        ${liq.map(x => `<tr><td>${fechaHora(x.created_at)}</td><td>${num(x.cantidad)}</td><td><b>${usd(x.total)}</b></td><td>${esc(x.nota || '')}</td><td>${esc(x.creado_por || '')}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }

  // ── Acciones de la ficha ─────────────────────────────────
  async function guardarDatos() {
    const id = FLA.fichaId;
    try {
      const r = await rpc('admin_fl_actualizar', { p_id: id, p_datos: { nombre: $('fl-e-nombre').value, telefono: $('fl-e-tel').value, identificacion: $('fl-e-ident').value, notas_admin: $('fl-e-notas').value } });
      if (!r?.ok) { aviso('No se guardó', msg(r), 'error'); return; }
      aviso('Datos guardados'); await cargarLista(); await abrirFicha(id, 'resumen');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  async function nuevaInvitacion() {
    try {
      const r = await rpc('admin_fl_nueva_invitacion', { p_id: FLA.fichaId });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      const f = FLA.ficha.freelancer;
      $('fl-e-invitacion').innerHTML = htmlInvitacion(f.nombre, f.email, r.invitacion, r.expira) + '<p class="fl-mini">La invitación anterior dejó de servir.</p>';
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  async function guardarPermisos() {
    const planes = [$('fl-p-prueba').checked && 'prueba', $('fl-p-premium').checked && 'premium'].filter(Boolean);
    const pct = $('fl-p-pct').value.trim();
    const p = {
      puede_generar_codigos: $('fl-p-generar').checked, planes_permitidos: planes,
      max_usos_por_codigo: parseInt($('fl-p-usos').value, 10), max_codigos_mes: parseInt($('fl-p-mes').value, 10), max_dias_expiracion: parseInt($('fl-p-dias').value, 10),
      puede_ver_estado_clientes: $('fl-p-vercli').checked, puede_editar_perfil: $('fl-p-perfil').checked, politica_suspension: $('fl-p-politica').value,
      comision_activa: $('fl-p-com').checked, comision_pct: pct === '' ? '' : Number(pct),
    };
    if (p.puede_generar_codigos && !planes.length) { aviso('Elige al menos un plan', 'Si puede generar códigos necesita al menos un plan permitido', 'warning'); return; }
    if (p.comision_activa && !(Number(pct) > 0 && Number(pct) <= 100)) { aviso('Porcentaje no válido', 'Para activar la comisión pon un % entre 0.01 y 100', 'warning'); return; }
    if ([p.max_usos_por_codigo, p.max_codigos_mes, p.max_dias_expiracion].some(n => !Number.isFinite(n))) { aviso('Revisa los límites', '', 'warning'); return; }
    try {
      const r = await rpc('admin_fl_permisos', { p_id: FLA.fichaId, p_permisos: p });
      if (!r?.ok) { aviso('No se guardó', (r?.detalle ? r.detalle.replace('PERMISO:', 'Revisa: ') : msg(r)), 'error'); return; }
      aviso('Permisos guardados'); await cargarLista(); await abrirFicha(FLA.fichaId, 'permisos');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  async function revocarCodigo(id, codigo) {
    const r0 = await pedirMotivo({ titulo: 'Revocar código', texto: `¿Revocar el código <b>${esc(codigo)}</b>? Ya no podrá usarse para crear cuentas.`, minimo: 0, boton: 'Revocar' });
    if (!r0) return;
    try {
      const r = await rpc('admin_fl_revocar_codigo', { p_codigo_id: id, p_motivo: r0.motivo || null });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      aviso('Código revocado'); await cargarLista(); await abrirFicha(FLA.fichaId, 'codigos');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  async function reasignar(authUserId, negocio) {
    const opciones = FLA.lista.filter(f => f.id !== FLA.fichaId && f.estado !== 'desactivado')
      .map(f => `<option value="${esc(f.id)}">${esc(f.nombre)} (${esc(ESTADOS[f.estado]?.[0] || f.estado)})</option>`).join('');
    const r0 = await pedirMotivo({ titulo: 'Cambiar responsable', texto: `Cliente <b>${esc(negocio || 'sin nombre')}</b>. El cambio queda registrado con el responsable anterior y el nuevo.`,
      minimo: 5, boton: 'Cambiar', peligro: false,
      extraHtml: `<label for="fl-r-nuevo">Nuevo responsable</label><select class="form-control" id="fl-r-nuevo" name="nuevo"><option value="">— Sin responsable —</option>${opciones}</select>` });
    if (!r0) return;
    try {
      const r = await rpc('admin_fl_atribuir', { p_auth_user_id: authUserId, p_freelancer_id: r0.extra.nuevo || null, p_motivo: r0.motivo });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      aviso('Responsable cambiado'); await cargar(); await abrirFicha(FLA.fichaId, 'clientes');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  async function atribuirExistente() {
    const email = $('fl-a-email').value.trim().toLowerCase();
    if (!email) { aviso('Escribe el correo de la cuenta', '', 'warning'); return; }
    try {
      const { data, error } = await sb.from('usuarios').select('auth_user_id,nombre,apellido,nombre_negocio,email,created_at').eq('email', email).limit(1);
      if (error) throw error;
      if (!data?.length) { aviso('No existe una cuenta con ese correo', '', 'warning'); return; }
      const u = data[0];
      const { data: at } = await sb.from('plataforma_atribuciones').select('freelancer_id').eq('auth_user_id', u.auth_user_id).maybeSingle();
      const antes = at?.freelancer_id ? `Hoy su responsable es <b>${esc(nombreFl(at.freelancer_id))}</b>.` : 'Hoy no tiene responsable.';
      const r0 = await pedirMotivo({ titulo: 'Atribuir cliente existente', texto: `<b>${esc(u.nombre_negocio || '—')}</b> (${esc(u.email)}, alta ${fecha(u.created_at)}). ${antes}<br>Pasará a <b>${esc(FLA.ficha.freelancer.nombre)}</b>.`, minimo: 5, boton: 'Atribuir', peligro: false });
      if (!r0) return;
      const r = await rpc('admin_fl_atribuir', { p_auth_user_id: u.auth_user_id, p_freelancer_id: FLA.fichaId, p_motivo: r0.motivo });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      aviso(r.sin_cambios ? 'Ya era su cliente' : 'Cliente atribuido'); await cargar(); await abrirFicha(FLA.fichaId, 'clientes');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  const seleccionadas = () => [...document.querySelectorAll('.fl-com-sel:checked')].map(x => ({ id: x.value, estado: x.dataset.estado }));
  async function comisionesEstado(estado) {
    const sel = seleccionadas();
    const validas = sel.filter(c => (estado === 'aprobada' && c.estado === 'pendiente') || (estado === 'anulada' && ['pendiente', 'aprobada'].includes(c.estado)) || (estado === 'revertida' && c.estado === 'pagada'));
    if (!validas.length) { aviso('Nada que cambiar', estado === 'aprobada' ? 'Selecciona comisiones pendientes' : estado === 'anulada' ? 'Selecciona comisiones pendientes o aprobadas' : 'Selecciona comisiones pagadas', 'warning'); return; }
    const r0 = await pedirMotivo({ titulo: { aprobada: 'Aprobar comisiones', anulada: 'Anular comisiones', revertida: 'Revertir comisiones pagadas' }[estado],
      texto: `${validas.length} comisión(es) seleccionada(s).`, minimo: estado === 'aprobada' ? 0 : 3, boton: 'Confirmar', peligro: estado !== 'aprobada' });
    if (!r0) return;
    try {
      const r = await rpc('admin_fl_comisiones_estado', { p_ids: validas.map(c => c.id), p_estado: estado, p_motivo: r0.motivo || null });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      aviso(`${r.cambiadas} comisión(es) actualizada(s)`); await cargar(); await abrirFicha(FLA.fichaId, 'comisiones');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  async function liquidar() {
    const sel = seleccionadas().filter(c => c.estado === 'aprobada');
    if (!sel.length) { aviso('Selecciona comisiones APROBADAS', 'Solo se liquida lo aprobado', 'warning'); return; }
    const total = (FLA.ficha.comisiones || []).filter(c => sel.some(s => s.id === c.id)).reduce((s, c) => s + Number(c.monto), 0);
    const r0 = await pedirMotivo({ titulo: 'Registrar liquidación', texto: `Vas a marcar como <b>pagadas</b> ${sel.length} comisión(es) por <b>${usd(total)}</b>. Hazlo solo si ya le pagaste al freelancer.`, label: 'Nota (forma de pago, referencia…)', minimo: 0, boton: 'Registrar pago', peligro: false });
    if (!r0) return;
    try {
      const r = await rpc('admin_fl_liquidar', { p_freelancer_id: FLA.fichaId, p_ids: sel.map(c => c.id), p_nota: r0.motivo || null });
      if (!r?.ok) { aviso('No se pudo', msg(r), 'error'); return; }
      aviso('Liquidación registrada', usd(r.total)); await cargar(); await abrirFicha(FLA.fichaId, 'comisiones');
    } catch (e) { aviso('Error', e.message, 'error'); }
  }
  function exportarActividad() {
    const f = FLA.ficha.freelancer;
    csv(`actividad-${(f.nombre || 'freelancer').replace(/\W+/g, '-')}-${isoLocal(new Date())}.csv`, [['Fecha', 'Acción', 'Resultado', 'Actor', 'Correo actor', 'Entidad', 'Id', 'Detalle'],
      ...(FLA.ficha.actividad || []).map(a => [a.created_at, ACCIONES[a.accion] || a.accion, a.resultado, a.actor_tipo, a.actor_email || '', a.entidad || '', a.entidad_id || '', a.detalle ? JSON.stringify(a.detalle) : ''])]);
  }

  // ── Eventos ───────────────────────────────────────────────
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-fl-ver],[data-fl-estado-ir],[data-fl-tab],[data-fl-copiar],[data-fl-cerrar],[data-fl-revocar],[data-fl-reasignar],[data-fl-com],[data-fl-periodo],[data-fl-estado],#fl-btn-nuevo,#fl-n-guardar,#fl-btn-csv,#fl-btn-seguridad,#fl-rango-aplicar,#fl-e-guardar,#fl-e-invitar,#fl-p-guardar,#fl-a-buscar,#fl-com-liquidar,#fl-act-csv');
    if (!t || !t.closest('#page-freelancers,#fl-modal-nuevo,#fl-modal-ficha,#fl-modal-motivo')) return;
    if (t.tagName === 'A') e.preventDefault();
    const d = t.dataset;
    if (d.flVer) abrirFicha(d.flVer, d.flTabIr);
    else if (d.flEstadoIr) cambiarEstado(d.flId, d.flEstadoIr);
    else if (d.flTab) { FLA.tab = d.flTab; if (FLA.ficha) renderTab(); }
    else if (d.flCopiar) navigator.clipboard.writeText(d.flCopiar).then(() => aviso('Copiado', '', 'info')).catch(() => aviso('Cópialo manualmente', '', 'warning'));
    else if (d.flCerrar) closeModal(d.flCerrar);
    else if (d.flRevocar) revocarCodigo(d.flRevocar, d.flCod);
    else if (d.flReasignar) reasignar(d.flReasignar, d.flNeg);
    else if (d.flCom) comisionesEstado(d.flCom);
    else if (d.flPeriodo) {
      FLA.periodo = d.flPeriodo;
      document.querySelectorAll('[data-fl-periodo]').forEach(b => b.classList.toggle('active', b === t));
      $('fl-rango').style.display = FLA.periodo === 'rango' ? 'flex' : 'none';
      if (FLA.periodo !== 'rango') cargarResumen();
    }
    else if (d.flEstado !== undefined) {
      FLA.estado = d.flEstado;
      document.querySelectorAll('[data-fl-estado]').forEach(b => b.classList.toggle('active', b === t));
      renderLista();
    }
    else if (t.id === 'fl-btn-nuevo') abrirNuevo();
    else if (t.id === 'fl-n-guardar') guardarNuevo();
    else if (t.id === 'fl-btn-csv') exportarLista();
    else if (t.id === 'fl-btn-seguridad') cargarSeguridad();
    else if (t.id === 'fl-rango-aplicar') { if (!$('fl-desde').value || !$('fl-hasta').value) { aviso('Elige ambas fechas', '', 'warning'); return; } cargarResumen(); }
    else if (t.id === 'fl-e-guardar') guardarDatos();
    else if (t.id === 'fl-e-invitar') nuevaInvitacion();
    else if (t.id === 'fl-p-guardar') guardarPermisos();
    else if (t.id === 'fl-a-buscar') atribuirExistente();
    else if (t.id === 'fl-com-liquidar') liquidar();
    else if (t.id === 'fl-act-csv') exportarActividad();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'fl-com-todas') document.querySelectorAll('.fl-com-sel').forEach(x => { x.checked = e.target.checked; });
    if (e.target.id === 'fl-inc-desde' || e.target.id === 'fl-inc-hasta') renderLista();
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'fl-buscar') { FLA.busqueda = e.target.value; renderLista(); }
  });

  window.AdminFL = { cargar, _estado: FLA };
})();
