/* ============================================================
   FREELANCER.JS — NEGOCIO360 (panel del vendedor)
   El freelancer solo ve y hace lo que el administrador le
   permitió. Todo pasa por funciones del servidor (freelancer_*)
   que validan su cuenta y sus permisos en cada llamada; aquí solo
   se muestra la información y se piden las acciones.
   ============================================================ */
(function () {
  'use strict';

  const sb = window.supabase.createClient('https://zvlincmqmmoclqhykejv.supabase.co', 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t');
  const ST = { panel: null, tab: 'resumen', ultimoCodigo: null };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => (Number(n) || 0).toLocaleString('es-NI');
  const usd = n => '$' + (Number(n) || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fecha = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const fechaHora = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  let toastT = null;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3200); }
  function mensaje(id, texto, tipo) { const el = $(id); el.textContent = texto || ''; el.className = 'msg' + (texto ? ' on ' + (tipo === 'ok' ? 'okm' : 'err') : ''); }
  function vista(id) { ['v-cargando', 'v-acceso', 'v-vincular', 'v-bloqueado', 'v-panel'].forEach(v => { $(v).style.display = v === id ? '' : 'none'; }); }

  // ── Tema ──────────────────────────────────────────────────
  function aplicarTema(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }
  try { aplicarTema(localStorage.getItem('n360_theme')); } catch (_) {}
  $('btn-tema').addEventListener('click', () => {
    const actual = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nuevo = actual === 'dark' ? 'light' : 'dark';
    aplicarTema(nuevo); try { localStorage.setItem('n360_theme', nuevo); } catch (_) {}
  });

  const TEXTOS = {
    no_autorizado: 'No tienes permiso para esta acción.', sin_permiso: 'El administrador no te habilitó para generar códigos.',
    plan_no_permitido: 'No puedes ofrecer ese plan.', usos: 'Cantidad de usos fuera de tu límite.', dias: 'Vencimiento fuera de tu límite.',
    limite_mes: 'Llegaste a tu límite de códigos de este mes.', cuenta_suspendido: 'Tu cuenta está suspendida.', cuenta_desactivado: 'Tu cuenta está desactivada.',
    no_encontrado: 'No se encontró ese código.', no_disponible: 'Ese código ya no está disponible.', datos_invalidos: 'Revisa los datos.',
    invitacion_invalida: 'La invitación no es válida, ya venció o no corresponde a este correo.', bloqueado: 'Demasiados intentos. Espera un rato e intenta de nuevo.',
    ya_es_freelancer: 'Esta cuenta ya es de vendedor.', es_admin: 'Una cuenta de administrador no puede ser vendedor.', reintentar: 'Intenta de nuevo.',
  };
  const texto = r => TEXTOS[r?.motivo] || 'No se pudo completar.';
  async function rpc(n, p) { const { data, error } = await sb.rpc(n, p || {}); if (error) throw error; return data; }

  // ── Arranque ──────────────────────────────────────────────
  async function iniciar() {
    vista('v-cargando');
    const inv = new URLSearchParams(location.search).get('inv');
    if (inv) { $('a-token').value = inv; $('vin-token').value = inv; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { $('btn-salir').style.display = 'none'; $('quien').textContent = ''; vista('v-acceso'); if (inv) modoAcceso('activar'); return; }
    $('btn-salir').style.display = ''; $('quien').textContent = session.user.email || '';
    let estado = null;
    try { estado = await rpc('freelancer_estado'); } catch (e) { console.error(e); }
    if (!estado) { $('vin-email').textContent = session.user.email || ''; vista('v-vincular'); return; }
    // inicio de sesión: una vez por pestaña
    try { if (!sessionStorage.getItem('n360_fl_sesion')) { await rpc('freelancer_evento', { p_tipo: 'inicio_sesion' }); sessionStorage.setItem('n360_fl_sesion', '1'); } } catch (_) {}
    if (estado !== 'activo') { bloqueado(estado); return; }
    await cargarPanel();
  }
  function bloqueado(estado) {
    $('blo-titulo').textContent = estado === 'desactivado' ? 'Cuenta desactivada' : 'Cuenta suspendida';
    $('blo-texto').textContent = estado === 'desactivado'
      ? 'Tu acceso como vendedor fue dado de baja. Si crees que es un error, comunícate con Negocio360.'
      : 'Tu acceso como vendedor está suspendido por el momento. Comunícate con Negocio360.';
    vista('v-bloqueado');
  }

  async function cargarPanel() {
    try {
      const r = await rpc('freelancer_mi_panel');
      if (!r?.ok) { if (r?.motivo === 'suspendido' || r?.motivo === 'desactivado') { bloqueado(r.motivo); return; } throw new Error(texto(r)); }
      ST.panel = r;
      $('p-hola').textContent = `Hola, ${r.perfil.nombre.split(' ')[0]}`;
      $('p-sub').textContent = `Vendedor de Negocio360 desde ${fecha(r.perfil.desde)}.`;
      $('tab-comisiones').style.display = (r.permisos.comision_activa || (r.comisiones || []).length) ? '' : 'none';
      vista('v-panel');
      render();
    } catch (e) {
      console.error(e);
      $('v-cargando').textContent = 'No se pudo cargar tu panel. Revisa tu conexión y recarga la página.';
      vista('v-cargando');
    }
  }

  function render() {
    document.querySelectorAll('#p-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ST.tab));
    $('p-cuerpo').innerHTML = ({ resumen: tResumen, codigos: tCodigos, clientes: tClientes, comisiones: tComisiones, actividad: tActividad, perfil: tPerfil }[ST.tab] || tResumen)();
  }

  // ── Pestañas ──────────────────────────────────────────────
  const ESTC = { disponible: ['Disponible', 't-ok'], utilizado: ['Utilizado', 't-info'], expirado: ['Expirado', 't-warn'], revocado: ['Revocado', 't-bad'] };
  const tagCod = e => { const x = ESTC[e] || [e, 't-info']; return `<span class="tag ${x[1]}">${esc(x[0])}</span>`; };
  const ESTK = { pendiente: ['Por aprobar (estimada)', 't-warn'], aprobada: ['Aprobada (confirmada)', 't-info'], pagada: ['Pagada', 't-ok'], anulada: ['Anulada', 't-bad'], revertida: ['Revertida', 't-bad'] };
  const tagCom = e => { const x = ESTK[e] || [e, 't-info']; return `<span class="tag ${x[1]}">${esc(x[0])}</span>`; };

  function tResumen() {
    const { codigos = [], clientes = [], comisiones = [], permisos: p } = ST.panel;
    const usados = codigos.filter(c => Number(c.usos_actuales) > 0).length;
    const disp = codigos.filter(c => c.estado === 'disponible').length;
    const conv = codigos.length ? Math.round(100 * usados / codigos.length) + '%' : '—';
    const verEstado = p.puede_ver_estado_clientes;
    const activos = clientes.filter(c => c.estado_cuenta === 'activa').length;
    const pagos = clientes.reduce((s, c) => s + (Number(c.pagos) || 0), 0);
    const suma = e => comisiones.filter(c => c.estado === e).reduce((s, c) => s + Number(c.monto), 0);
    const hoy = new Date(), meses = [];
    for (let i = 5; i >= 0; i--) { const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    const cuenta = (l, campo) => meses.map(m => l.filter(x => String(x[campo] || '').slice(0, 7) === m).length);
    const cod = cuenta(codigos, 'created_at'), cli = cuenta(clientes, 'captado_en'), max = Math.max(1, ...cod, ...cli);
    const nm = m => new Date(m + '-15').toLocaleDateString('es-NI', { month: 'short' });
    return `<div class="kpis">
        <div class="kpi"><b>${num(codigos.length)}</b><span>Códigos generados</span><small>${num(ST.panel.codigos_mes)} de ${num(p.max_codigos_mes)} este mes</small></div>
        <div class="kpi"><b>${num(usados)}</b><span>Códigos usados</span><small>${num(disp)} disponibles · conversión ${conv}</small></div>
        <div class="kpi"><b>${num(clientes.length)}</b><span>Clientes captados</span><small>${verEstado ? num(activos) + ' activos hoy' : 'registrados con tus códigos'}</small></div>
        ${verEstado ? `<div class="kpi"><b>${num(pagos)}</b><span>Pagos confirmados</span><small>de tus clientes (marcados por Negocio360)</small></div>` : ''}
        ${p.comision_activa || comisiones.length ? `<div class="kpi"><b>${usd(suma('aprobada'))}</b><span>Comisión confirmada por cobrar</span><small>Estimada por aprobar: ${usd(suma('pendiente'))} · Pagada: ${usd(suma('pagada'))}</small></div>` : ''}
      </div>
      <div class="card"><h2>Tu evolución (últimos 6 meses)</h2>
        <div class="barras">${meses.map((m, i) => `<div class="bcol"><div class="bpar"><i class="i1" style="height:${(100 * cod[i] / max).toFixed(0)}%"></i><i class="i2" style="height:${(100 * cli[i] / max).toFixed(0)}%"></i></div><small>${esc(nm(m))}</small><small>${cod[i]} · ${cli[i]}</small></div>`).join('')}</div>
        <div class="ley"><span><i class="i1"></i> Códigos generados</span><span><i class="i2"></i> Clientes captados</span></div>
      </div>
      <div class="card"><h2>Tus permisos</h2>
        <ul class="sub" style="margin:0;padding-left:18px">
          <li>${p.puede_generar_codigos ? `Puedes generar códigos para el plan ${esc((p.planes_permitidos || []).join(' / ') || '—')}` : 'Por ahora no puedes generar códigos'}.</li>
          ${p.puede_generar_codigos ? `<li>Hasta ${num(p.max_codigos_mes)} códigos al mes, de hasta ${num(p.max_usos_por_codigo)} uso(s), que vencen en máximo ${num(p.max_dias_expiracion)} días.</li>` : ''}
          <li>${p.puede_ver_estado_clientes ? 'Puedes ver el estado y el plan de tus clientes.' : 'Ves la lista de tus clientes, sin su estado.'}</li>
          <li>${p.comision_activa ? `Comisión: ${esc(p.comision_pct)}% sobre cada pago confirmado de tus clientes.` : 'Sin comisión configurada.'}</li>
        </ul></div>`;
  }

  function tCodigos() {
    const { codigos = [], permisos: p } = ST.panel;
    const gen = p.puede_generar_codigos ? `<div class="card"><h2>Generar código de acceso</h2>
        <p class="sub">Cada código permite crear una cuenta nueva de Negocio360. El cliente quedará registrado como tuyo.</p>
        <div class="fila">
          <div class="campo"><label for="g-plan">Plan</label><select class="inp" id="g-plan">${(p.planes_permitidos || []).map(x => `<option value="${esc(x)}">${x === 'prueba' ? 'Prueba' : x === 'premium' ? 'Premium' : esc(x)}</option>`).join('')}</select></div>
          <div class="campo"><label for="g-dias">Vence en (días)</label><input class="inp" id="g-dias" type="number" min="1" max="${esc(p.max_dias_expiracion)}" value="${esc(p.max_dias_expiracion)}" /></div>
          <div class="campo"><label for="g-usos">Usos</label><input class="inp" id="g-usos" type="number" min="1" max="${esc(p.max_usos_por_codigo)}" value="1" /></div>
        </div>
        <div class="campo"><label for="g-nota">Nota para ti (opcional)</label><input class="inp" id="g-nota" maxlength="200" placeholder="Ej.: Ferretería El Clavo" /></div>
        <div class="acciones"><button class="btn btn-p" type="button" id="g-btn">Generar código</button><span class="mini">Llevas ${num(ST.panel.codigos_mes)} de ${num(p.max_codigos_mes)} este mes.</span></div>
        <div id="g-res">${ST.ultimoCodigo ? htmlNuevo(ST.ultimoCodigo) : ''}</div></div>`
      : '<div class="nota">El administrador no te ha habilitado para generar códigos.</div>';
    return gen + `<div class="card"><h2>Mis códigos</h2>${codigos.length ? `<div class="tabla-wrap"><table><thead><tr><th>Código</th><th>Plan</th><th>Estado</th><th>Usos</th><th>Vence</th><th>Creado</th><th></th></tr></thead><tbody>
      ${codigos.map(c => `<tr><td><span class="cod">${esc(c.codigo)}</span>${c.nota ? `<div class="mini">${esc(c.nota)}</div>` : ''}</td><td>${esc(c.plan)}</td><td>${tagCod(c.estado)}</td>
        <td>${num(c.usos_actuales)} / ${num(c.usos_maximos)}</td><td>${fecha(c.fecha_expiracion)}</td><td>${fecha(c.created_at)}</td>
        <td>${c.estado === 'disponible' ? `<div class="acciones"><button class="btn btn-s" type="button" data-copiar="${esc(enlace(c.codigo))}">Copiar enlace</button><button class="btn btn-s btn-d" type="button" data-revocar="${esc(c.id)}" data-cod="${esc(c.codigo)}">Revocar</button></div>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="vacio">Aún no generas códigos.</div>'}</div>`;
  }
  const enlace = cod => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}register.html?codigo=${encodeURIComponent(cod)}`;
  function htmlNuevo(c) {
    const link = enlace(c.codigo);
    const wa = 'https://wa.me/?text=' + encodeURIComponent(`Te invito a Negocio360. Crea tu cuenta aquí: ${link} (código ${c.codigo})`);
    return `<div class="nuevo-cod"><div>Tu nuevo código (vence ${fecha(c.expira)}):</div><span class="cod">${esc(c.codigo)}</span>
      <div class="acciones"><button class="btn btn-s" type="button" data-copiar="${esc(c.codigo)}">Copiar código</button><button class="btn btn-s" type="button" data-copiar="${esc(link)}">Copiar enlace de registro</button>
      <a class="btn btn-s" href="${esc(wa)}" target="_blank" rel="noopener">Enviar por WhatsApp</a></div></div>`;
  }

  function tClientes() {
    const { clientes = [], permisos: p } = ST.panel;
    if (!clientes.length) return '<div class="card"><div class="vacio">Aún no tienes clientes. Cuando alguien cree su cuenta con uno de tus códigos aparecerá aquí.</div></div>';
    return `<div class="card"><h2>Mis clientes (${num(clientes.length)})</h2>
      <p class="mini">Un cliente queda a tu nombre cuando crea su cuenta con tu código. Solo Negocio360 puede cambiar el responsable.</p>
      <div class="tabla-wrap"><table><thead><tr><th>Negocio</th><th>Captado</th><th>Código</th>${p.puede_ver_estado_clientes ? '<th>Cuenta</th><th>Plan</th><th>Pagos confirmados</th>' : ''}</tr></thead><tbody>
      ${clientes.map(c => `<tr><td><b>${esc(c.negocio || '—')}</b><div class="mini">${esc(c.nombre || '')}</div></td><td>${fecha(c.captado_en)}</td><td>${c.codigo ? `<span class="cod">${esc(c.codigo)}</span>` : '<span class="mini">Asignado por Negocio360</span>'}</td>
        ${p.puede_ver_estado_clientes ? `<td>${c.estado_cuenta === 'activa' ? '<span class="tag t-ok">Activa</span>' : `<span class="tag t-warn">${esc(c.estado_cuenta || '—')}</span>`}</td><td>${esc(c.plan || '—')}</td><td>${num(c.pagos)}</td>` : ''}</tr>`).join('')}
      </tbody></table></div></div>`;
  }

  function tComisiones() {
    const { comisiones = [], permisos: p } = ST.panel;
    const suma = e => comisiones.filter(c => c.estado === e).reduce((s, c) => s + Number(c.monto), 0);
    return `<div class="nota">${p.comision_activa ? `Tu comisión es ${esc(p.comision_pct)}% de cada pago <b>confirmado</b> de tus clientes. Primero aparece como <b>estimada (por aprobar)</b>, Negocio360 la <b>aprueba</b> y luego la <b>paga</b>.` : 'Ahora mismo no tienes comisión activa; abajo ves el historial.'}</div>
      <div class="kpis"><div class="kpi"><b>${usd(suma('pendiente'))}</b><span>Estimada, por aprobar</span></div><div class="kpi"><b>${usd(suma('aprobada'))}</b><span>Confirmada, por cobrar</span></div><div class="kpi"><b>${usd(suma('pagada'))}</b><span>Pagada</span></div></div>
      <div class="card">${comisiones.length ? `<div class="tabla-wrap"><table><thead><tr><th>Cliente</th><th>Ciclo pagado</th><th>Base</th><th>%</th><th>Comisión</th><th>Estado</th></tr></thead><tbody>
      ${comisiones.map(c => `<tr><td>${esc(c.negocio || '—')}</td><td>${esc(c.ciclo)}</td><td>${usd(c.base)}</td><td>${esc(c.porcentaje)}%</td><td><b>${usd(c.monto)}</b></td><td>${tagCom(c.estado)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="vacio">Sin comisiones todavía.</div>'}</div>`;
  }

  const ACC = { inicio_sesion: 'Iniciaste sesión', cierre_sesion: 'Cerraste sesión', consulta_panel: 'Consultaste tu panel', codigo_generado: 'Generaste un código',
    codigo_revocado: 'Código revocado', codigo_usado: 'Un cliente usó tu código', cliente_captado: 'Nuevo cliente captado', codigo_rechazado: 'Alguien intentó usar un código no válido',
    perfil_editado: 'Perfil actualizado', permisos_cambiados: 'Negocio360 cambió tus permisos', suspendido: 'Cuenta suspendida', reactivado: 'Cuenta reactivada',
    cuenta_activada: 'Activaste tu cuenta', freelancer_creado: 'Negocio360 te registró', atribucion_cambiada: 'Cambio de responsable de un cliente', comision_generada: 'Comisión generada',
    comision_aprobada: 'Comisión aprobada', comision_anulada: 'Comisión anulada', comision_revertida: 'Comisión revertida', liquidacion_pagada: 'Te pagaron comisiones',
    generar_codigo: 'Intento de generar código', revocar_codigo: 'Intento de revocar código', editar_perfil: 'Intento de editar perfil' };
  function tActividad() {
    const l = ST.panel.actividad || [];
    return `<div class="card"><h2>Mi actividad</h2><p class="mini">Últimos 100 movimientos. Este historial es de solo lectura.</p>${l.length ? `<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Qué pasó</th><th>Resultado</th></tr></thead><tbody>
      ${l.map(a => `<tr><td>${fechaHora(a.fecha)}</td><td>${esc(ACC[a.accion] || a.accion)}${a.por === 'admin' ? ' <span class="mini">(Negocio360)</span>' : ''}</td><td>${a.resultado === 'ok' ? '<span class="tag t-ok">OK</span>' : '<span class="tag t-bad">Rechazado</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="vacio">Sin actividad.</div>'}</div>`;
  }

  function tPerfil() {
    const { perfil: f, permisos: p } = ST.panel;
    return `<div class="card"><h2>Mi perfil</h2>
      ${p.puede_editar_perfil ? '' : '<div class="nota">El administrador no te permite editar tus datos. Pídele el cambio a Negocio360.</div>'}
      <div class="fila">
        <div class="campo"><label for="pf-nombre">Nombre</label><input class="inp" id="pf-nombre" maxlength="80" value="${esc(f.nombre)}" ${p.puede_editar_perfil ? '' : 'disabled'} /></div>
        <div class="campo"><label for="pf-tel">Teléfono</label><input class="inp" id="pf-tel" maxlength="30" value="${esc(f.telefono || '')}" ${p.puede_editar_perfil ? '' : 'disabled'} /></div>
      </div>
      <div class="fila">
        <div class="campo"><label>Correo</label><input class="inp" value="${esc(f.email)}" disabled /></div>
        <div class="campo"><label>Identificación</label><input class="inp" value="${esc(f.identificacion || '—')}" disabled /></div>
      </div>
      ${p.puede_editar_perfil ? '<button class="btn btn-p" type="button" id="pf-btn">Guardar</button>' : ''}
      <p class="mini" style="margin-top:12px">El correo y la identificación solo los cambia Negocio360.</p></div>`;
  }

  // ── Acciones ──────────────────────────────────────────────
  async function generar() {
    const btn = $('g-btn'); btn.disabled = true;
    try {
      const r = await rpc('freelancer_generar_codigo', { p_plan: $('g-plan').value, p_dias: parseInt($('g-dias').value, 10) || null,
        p_usos: parseInt($('g-usos').value, 10) || 1, p_nota: $('g-nota').value.trim() || null });
      if (!r?.ok) { toast(texto(r) + (r?.maximo ? ` (máximo ${r.maximo})` : '')); if (/^cuenta_/.test(r?.motivo || '')) await iniciar(); return; }
      ST.ultimoCodigo = r;
      await cargarPanel();
      toast('Código generado');
    } catch (e) { toast('Error: ' + e.message); }
    finally { if ($('g-btn')) $('g-btn').disabled = false; }
  }
  async function revocar(id, cod) {
    if (!confirm(`¿Revocar el código ${cod}? Ya no servirá para crear cuentas.`)) return;
    try {
      const r = await rpc('freelancer_revocar_codigo', { p_codigo_id: id });
      if (!r?.ok) { toast(texto(r)); return; }
      if (ST.ultimoCodigo?.id === id) ST.ultimoCodigo = null;
      await cargarPanel(); toast('Código revocado');
    } catch (e) { toast('Error: ' + e.message); }
  }
  async function guardarPerfil() {
    try {
      const r = await rpc('freelancer_actualizar_perfil', { p_nombre: $('pf-nombre').value, p_telefono: $('pf-tel').value });
      if (!r?.ok) { toast(texto(r)); return; }
      await cargarPanel(); toast('Perfil guardado');
    } catch (e) { toast('Error: ' + e.message); }
  }

  // ── Acceso ────────────────────────────────────────────────
  function modoAcceso(m) {
    document.querySelectorAll('[data-modo]').forEach(b => b.classList.toggle('on', b.dataset.modo === m));
    $('f-login').style.display = m === 'login' ? '' : 'none';
    $('f-activar').style.display = m === 'activar' ? '' : 'none';
    mensaje('acc-msg', '');
  }
  $('f-login').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('l-btn'); btn.disabled = true; mensaje('acc-msg', '');
    try {
      const { error } = await sb.auth.signInWithPassword({ email: $('l-email').value.trim().toLowerCase(), password: $('l-pass').value });
      if (error) { mensaje('acc-msg', /invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.' : 'No se pudo iniciar sesión: ' + error.message); return; }
      sessionStorage.removeItem('n360_fl_sesion');
      await iniciar();
    } finally { btn.disabled = false; }
  });
  $('f-activar').addEventListener('submit', async e => {
    e.preventDefault(); mensaje('acc-msg', '');
    const token = $('a-token').value.trim().toUpperCase(), email = $('a-email').value.trim().toLowerCase();
    if ($('a-pass').value.length < 8) { mensaje('acc-msg', 'La contraseña debe tener al menos 8 caracteres.'); return; }
    if ($('a-pass').value !== $('a-pass2').value) { mensaje('acc-msg', 'Las contraseñas no coinciden.'); return; }
    if (!/^INV-/.test(token)) { mensaje('acc-msg', 'El código de invitación empieza con INV-.'); return; }
    const btn = $('a-btn'); btn.disabled = true;
    try {
      const { data, error } = await sb.auth.signUp({ email, password: $('a-pass').value, options: { data: { tipo_cuenta: 'freelancer', invitacion: token } } });
      if (error) {
        if (/already registered/i.test(error.message)) mensaje('acc-msg', 'Ese correo ya tiene una cuenta en Negocio360: inicia sesión y luego pega tu código de invitación.');
        else if (/Database error/i.test(error.message)) mensaje('acc-msg', 'La invitación no es válida, ya venció o no corresponde a este correo. No se creó ninguna cuenta.');
        else mensaje('acc-msg', 'No se pudo activar: ' + error.message);
        return;
      }
      if (!data.session) { mensaje('acc-msg', 'Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.', 'ok'); modoAcceso('login'); return; }
      sessionStorage.removeItem('n360_fl_sesion');
      await iniciar();
    } finally { btn.disabled = false; }
  });
  $('vin-btn').addEventListener('click', async () => {
    const btn = $('vin-btn'); btn.disabled = true; mensaje('vin-msg', '');
    try {
      const r = await rpc('freelancer_activar_invitacion', { p_token: $('vin-token').value.trim().toUpperCase() });
      if (!r?.ok) { mensaje('vin-msg', texto(r)); return; }
      sessionStorage.removeItem('n360_fl_sesion');
      await iniciar();
    } catch (e) { mensaje('vin-msg', 'Error: ' + e.message); }
    finally { btn.disabled = false; }
  });
  $('btn-salir').addEventListener('click', async () => {
    try { await rpc('freelancer_evento', { p_tipo: 'cierre_sesion' }); } catch (_) {}
    sessionStorage.removeItem('n360_fl_sesion');
    await sb.auth.signOut();
    ST.panel = null; ST.ultimoCodigo = null;
    iniciar();
  });

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-modo],[data-tab],[data-copiar],[data-revocar],#g-btn,#pf-btn'); if (!t) return;
    if (t.dataset.modo) modoAcceso(t.dataset.modo);
    else if (t.dataset.tab) { ST.tab = t.dataset.tab; render(); }
    else if (t.dataset.copiar) navigator.clipboard.writeText(t.dataset.copiar).then(() => toast('Copiado')).catch(() => toast('Cópialo manualmente'));
    else if (t.dataset.revocar) revocar(t.dataset.revocar, t.dataset.cod);
    else if (t.id === 'g-btn') generar();
    else if (t.id === 'pf-btn') guardarPerfil();
  });

  iniciar();
})();
