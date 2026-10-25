/* =====================================================
   AGENDA-CITAS.JS — NEGOCIO360 (23-oct-2026)
   Citas por profesional dentro de la Agenda:
     * Vista "Día" por horas con una columna por profesional (y una
       columna "General" con lo que ya tenía la agenda: eventos,
       cuotas, pagos...), línea roja de la hora actual.
     * Cita = cliente + uno o varios servicios; cada servicio con su
       profesional (opcional), hora de inicio y duración LIBRE.
     * Estados (reservada, confirmada, en atención, completada,
       no asistió, cancelada), bloqueos "No disponible", búsqueda de
       hora libre y configuración de profesionales.
     * "Cobrar" abre Ventas con el cliente y los servicios cargados:
       el dinero entra por el camino normal de Ventas (Caja, IVA y
       reportes cuadran igual que siempre). Aquí NUNCA se mueve dinero.
   Usa lo que agenda.js ya tiene (sb, STATE, esc, fmt, openModal,
   closeModal, showToast, ymdLocal, todayLocalISO, cargarAgenda).
===================================================== */
(function () {
  'use strict';

  const ESTADOS = {
    reservada:   { label: 'Reservada',   fondo: '#ead7fb', texto: '#4c1d95' },
    confirmada:  { label: 'Confirmada',  fondo: '#cfe3ff', texto: '#1e3a8a' },
    en_atencion: { label: 'En atención', fondo: '#fde68a', texto: '#78350f' },
    completada:  { label: 'Completada',  fondo: '#c9f2d6', texto: '#14532d' },
    no_asistio:  { label: 'No asistió',  fondo: '#fecaca', texto: '#7f1d1d' },
    cancelada:   { label: 'Cancelada',   fondo: '#e5e7eb', texto: '#4b5563' },
  };
  const COLORES_PROF = ['#a855f7', '#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#14b8a6', '#6366f1', '#84cc16', '#f97316'];
  const PX_MIN = 1.6;               // alto en píxeles de cada minuto en la vista del día

  const C = {
    cargado: false,
    profesionales: [], servicios: [], empleados: [],
    config: { hora_inicio: '08:00', hora_fin: '18:00', intervalo_min: 15 },
    citasDia: [], bloqueosDia: [], ventasEstado: {},
    filtroProf: '', filtroEstado: 'activas',
    edit: null,                     // cita que se está editando en el modal
  };

  /* ---------------- utilidades ---------------- */
  const $ = id => document.getElementById(id);
  const aMin = hhmm => { const [h, m] = String(hhmm || '0:0').slice(0, 5).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const aHHMM = min => { min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min))); return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); };
  const hora12 = hhmm => { const m = aMin(hhmm); const h = Math.floor(m / 60), mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`; };
  const fechaLarga = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { weekday: 'long', day: 'numeric', month: 'long' });
  const perfilActivo = () => { try { return JSON.parse(sessionStorage.getItem('n360_perfil_activo') || 'null')?.nombre || null; } catch (_) { return null; } };
  const profPorId = id => C.profesionales.find(p => p.id === id) || null;
  const servPorId = id => C.servicios.find(s => s.id === id) || null;
  function ventaVigente(cita) { return !!cita.venta_id && C.ventasEstado[cita.venta_id] !== 'anulada'; }

  async function cargarBase(forzar) {
    if (C.cargado && !forzar) return;
    const uid = STATE.userId;
    const [pr, sv, em, cf] = await Promise.all([
      sb.from('agenda_profesionales').select('*').eq('auth_user_id', uid).order('orden').order('nombre'),
      sb.from('productos').select('id,nombre,precio,tipo,activo').eq('auth_user_id', uid).eq('tipo', 'servicio').eq('activo', true).order('nombre'),
      sb.from('empleados').select('id,nombre,cargo,estado').eq('auth_user_id', uid).order('nombre'),
      sb.from('agenda_configuracion').select('*').eq('auth_user_id', uid).maybeSingle(),
    ]);
    C.profesionales = pr.data || [];
    C.servicios = sv.data || [];
    C.empleados = (em.data || []).filter(e => e.estado !== 'inactivo');
    if (cf.data) C.config = { hora_inicio: String(cf.data.hora_inicio).slice(0, 5), hora_fin: String(cf.data.hora_fin).slice(0, 5), intervalo_min: cf.data.intervalo_min || 15 };
    C.cargado = true;
  }
  const profesionalesActivos = () => C.profesionales.filter(p => p.activo);

  async function citasDelRango(desde, hasta) {
    const { data, error } = await sb.from('agenda_citas')
      .select('*, agenda_citas_servicios(*)').eq('auth_user_id', STATE.userId)
      .gte('fecha', desde).lte('fecha', hasta).order('fecha');
    if (error) throw error;
    const citas = data || [];
    citas.forEach(c => (c.agenda_citas_servicios || []).sort((a, b) => aMin(a.hora_inicio) - aMin(b.hora_inicio) || a.orden - b.orden));
    const ventaIds = [...new Set(citas.map(c => c.venta_id).filter(Boolean))];
    if (ventaIds.length) {
      const { data: vs } = await sb.from('ventas').select('id,estado,numero_venta').in('id', ventaIds);
      (vs || []).forEach(v => { C.ventasEstado[v.id] = v.estado; C.ventasEstado['n_' + v.id] = v.numero_venta; });
    }
    return citas;
  }

  /* ---------------- integración con el calendario mes/semana ---------------- */
  async function itemsParaCalendario(desde, hasta) {
    try {
      await cargarBase();
      const citas = await citasDelRango(desde, hasta);
      return citas.filter(c => c.estado !== 'cancelada').map(c => {
        const lin = c.agenda_citas_servicios || [];
        const primera = lin[0];
        return {
          fecha: c.fecha, tipo: 'cita', categoria: 'cita', id: c.id, clickeable: true,
          titulo: `${c.cliente_nombre}${lin.length ? ' — ' + lin.map(l => l.servicio_nombre).join(', ') : ''}`,
          hora: primera ? String(primera.hora_inicio).slice(0, 5) : null,
          sub: ESTADOS[c.estado]?.label || '', completado: c.estado === 'completada' || c.estado === 'no_asistio',
          color: '#a855f7',
        };
      });
    } catch (e) { console.warn('citas para calendario:', e); return []; }
  }

  /* ---------------- VISTA DEL DÍA ---------------- */
  async function renderDia(cont, iso, itemsGenerales) {
    cont.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px">Cargando el día…</div>';
    try {
      await cargarBase();
      const [citas, bl] = await Promise.all([
        citasDelRango(iso, iso),
        sb.from('agenda_bloqueos').select('*').eq('auth_user_id', STATE.userId).eq('fecha', iso).order('hora_inicio'),
      ]);
      C.citasDia = citas; C.bloqueosDia = bl.data || [];
    } catch (e) {
      console.error('renderDia:', e);
      cont.innerHTML = '<p style="color:var(--danger);font-size:13px;padding:12px">No se pudo cargar el día.</p>';
      return;
    }
    C.diaIso = iso; C.itemsGenerales = itemsGenerales || [];
    pintarDia(cont);
  }

  function pintarDia(cont) {
    const iso = C.diaIso;
    const profs = profesionalesActivos().filter(p => !C.filtroProf || C.filtroProf === p.id);
    const estadosVisibles = C.filtroEstado === 'todas' ? Object.keys(ESTADOS)
      : C.filtroEstado === 'activas' ? ['reservada', 'confirmada', 'en_atencion', 'completada'] : [C.filtroEstado];

    // Bloques de servicio (una cita con 3 servicios = 3 bloques, cada uno en su columna)
    const bloques = [];
    C.citasDia.filter(c => estadosVisibles.includes(c.estado)).forEach(c => {
      (c.agenda_citas_servicios || []).forEach(l => {
        if (C.filtroProf && l.profesional_id !== C.filtroProf) return;
        bloques.push({ cita: c, l, col: l.profesional_id && profPorId(l.profesional_id)?.activo ? l.profesional_id : '_sin',
          ini: aMin(l.hora_inicio), fin: aMin(l.hora_inicio) + Number(l.duracion_min) });
      });
    });
    const generalesConHora = (C.itemsGenerales || []).filter(it => it.hora);
    const generalesSinHora = (C.itemsGenerales || []).filter(it => !it.hora);

    // Rango de horas: el horario configurado, ampliado si algo queda fuera
    let ini = aMin(C.config.hora_inicio), fin = aMin(C.config.hora_fin);
    bloques.forEach(b => { ini = Math.min(ini, b.ini); fin = Math.max(fin, b.fin); });
    C.bloqueosDia.forEach(b => { ini = Math.min(ini, aMin(b.hora_inicio)); fin = Math.max(fin, aMin(b.hora_fin)); });
    generalesConHora.forEach(it => { ini = Math.min(ini, aMin(it.hora)); fin = Math.max(fin, aMin(it.hora) + 30); });
    ini = Math.floor(ini / 60) * 60; fin = Math.min(24 * 60, Math.ceil(fin / 60) * 60);
    const alto = (fin - ini) * PX_MIN;

    const columnas = [];
    if (generalesConHora.length) columnas.push({ id: '_gen', nombre: 'General', color: '#64748b', esGeneral: true });
    profs.forEach(p => columnas.push({ id: p.id, nombre: p.nombre, color: p.color }));
    if (bloques.some(b => b.col === '_sin')) columnas.push({ id: '_sin', nombre: 'Sin asignar', color: '#94a3b8' });

    const opcionesProf = `<option value="">Todos los profesionales</option>` + profesionalesActivos().map(p => `<option value="${p.id}" ${C.filtroProf === p.id ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
    const opcionesEstado = [['activas', 'Citas activas'], ['todas', 'Todas (incluye canceladas)'], ...Object.entries(ESTADOS).map(([k, v]) => [k, 'Solo ' + v.label.toLowerCase()])]
      .map(([k, v]) => `<option value="${k}" ${C.filtroEstado === k ? 'selected' : ''}>${v}</option>`).join('');
    const totalCitas = C.citasDia.filter(c => c.estado !== 'cancelada').length;
    const cobradas = C.citasDia.filter(c => ventaVigente(c)).length;

    let html = `
      <div class="ac-barra">
        <select class="ac-sel" onchange="N360Citas.filtrar('prof', this.value)">${opcionesProf}</select>
        <select class="ac-sel" onchange="N360Citas.filtrar('estado', this.value)">${opcionesEstado}</select>
        <span class="ac-resumen">${totalCitas} cita${totalCitas === 1 ? '' : 's'} · ${cobradas} cobrada${cobradas === 1 ? '' : 's'}</span>
        <span style="flex:1"></span>
        <button class="btn-secondary btn-sm" onclick="N360Citas.abrirBuscarHora()">🔎 Buscar hora libre</button>
        <button class="btn-secondary btn-sm" onclick="N360Citas.abrirBloqueo()">⛔ Bloquear horario</button>
        <button class="btn-secondary btn-sm" onclick="N360Citas.abrirProfesionales()">👥 Profesionales</button>
      </div>`;

    if (generalesSinHora.length) {
      html += `<div class="ac-todo-dia"><span class="ac-todo-dia-t">Pendientes del día:</span>${generalesSinHora.map(it =>
        `<span class="ac-chip" style="border-color:${it.color};color:${it.color}" ${it.tipo === 'evento' ? `onclick="abrirEditarEvento('${it.id}')"` : (it.urlDestino ? `onclick="navigate('${it.urlDestino}')"` : '')}>${esc(it.titulo)}${it.sub ? ' · ' + esc(it.sub) : ''}</span>`).join('')}</div>`;
    }

    if (!profesionalesActivos().length) {
      html += `<div class="ac-aviso">Para ver la agenda por profesional, primero agrega quién atiende (tus empleados).
        <button class="btn-primary btn-sm" style="margin-left:8px" onclick="N360Citas.abrirProfesionales()">👥 Agregar profesionales</button>
        <div style="margin-top:6px;font-size:12px">También puedes crear citas sin profesional: aparecen en la columna "Sin asignar".</div></div>`;
    }

    if (!columnas.length) {
      html += `<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">Nada agendado este día.
        <div style="margin-top:10px"><button class="btn-primary btn-sm" onclick="N360Citas.nuevaCita({fecha:'${iso}'})">+ Nueva cita</button></div></div>`;
      cont.innerHTML = html; return;
    }

    // Hora actual (solo si es hoy): línea roja en cada columna y etiqueta en el eje
    let ahoraTop = null, ahoraMin = 0;
    if (iso === todayLocalISO()) {
      const d = new Date(); ahoraMin = d.getHours() * 60 + d.getMinutes();
      if (ahoraMin >= ini && ahoraMin <= fin) ahoraTop = (ahoraMin - ini) * PX_MIN;
    }
    const lineaAhora = ahoraTop === null ? '' : `<div class="ac-ahora" style="top:${ahoraTop}px"></div>`;

    // Eje de horas
    let eje = '';
    for (let m = ini; m <= fin; m += 15) {
      const top = (m - ini) * PX_MIN;
      eje += `<div class="ac-hora ${m % 60 === 0 ? 'ac-hora-llena' : ''}" style="top:${top}px">${m % 60 === 0 || PX_MIN * 15 >= 20 ? aHHMM(m) : ''}</div>`;
    }
    let lineas = '';
    for (let m = ini; m <= fin; m += 15) lineas += `<div class="ac-linea ${m % 60 === 0 ? 'ac-linea-hora' : ''}" style="top:${(m - ini) * PX_MIN}px"></div>`;

    const cabeceras = columnas.map(c => `<div class="ac-col-cab" style="--c:${c.color}">
        <span class="ac-avatar" style="background:${c.color}">${esc((c.nombre || '?').trim()[0] || '?').toUpperCase()}</span>
        <span class="ac-col-nombre">${esc(c.nombre)}</span></div>`).join('');

    const cuerpos = columnas.map(col => {
      let dentro = lineas;
      if (col.esGeneral) {
        generalesConHora.forEach(it => {
          const top = (aMin(it.hora) - ini) * PX_MIN;
          dentro += `<div class="ac-bloque ac-general" style="top:${top}px;height:${Math.max(26, 30 * PX_MIN)}px;left:3px;right:3px;border-left-color:${it.color}"
            ${it.tipo === 'evento' ? `onclick="event.stopPropagation();abrirEditarEvento('${it.id}')"` : (it.urlDestino ? `onclick="event.stopPropagation();navigate('${it.urlDestino}')"` : '')}>
            <b>${esc(it.titulo)}</b><span>${esc(it.hora)}${it.sub ? ' · ' + esc(it.sub) : ''}</span></div>`;
        });
      } else {
        // Bloqueos de este profesional (o de todos)
        C.bloqueosDia.filter(b => col.id !== '_sin' && (!b.profesional_id || b.profesional_id === col.id)).forEach(b => {
          const top = (aMin(b.hora_inicio) - ini) * PX_MIN, h = (aMin(b.hora_fin) - aMin(b.hora_inicio)) * PX_MIN;
          dentro += `<div class="ac-bloqueo" style="top:${top}px;height:${h}px" onclick="event.stopPropagation();N360Citas.verBloqueo('${b.id}')">
            <span>${esc(b.motivo || 'Profesional no disponible')}</span><span>${String(b.hora_inicio).slice(0, 5)} - ${String(b.hora_fin).slice(0, 5)}</span></div>`;
        });
        // Citas: si se enciman en la misma columna, se ponen lado a lado
        const enCol = bloques.filter(b => b.col === col.id).sort((a, b) => a.ini - b.ini || b.fin - a.fin);
        const carriles = [];
        enCol.forEach(b => { let k = carriles.findIndex(f => f <= b.ini); if (k < 0) { k = carriles.length; carriles.push(0); } carriles[k] = b.fin; b.carril = k; });
        enCol.forEach(b => { b.n = Math.max(...enCol.filter(o => o.ini < b.fin && b.ini < o.fin).map(o => o.carril)) + 1; });
        enCol.forEach(b => {
          const est = ESTADOS[b.cita.estado] || ESTADOS.reservada;
          const top = (b.ini - ini) * PX_MIN, h = Math.max(22, (b.fin - b.ini) * PX_MIN - 2);
          const ancho = 100 / b.n;
          const prof = profPorId(b.l.profesional_id);
          const compacto = h < 40;   // cita corta: todo en una línea para que no se encime el texto
          dentro += `<div class="ac-bloque${compacto ? ' ac-compacto' : ''}" title="${esc(b.cita.cliente_nombre)} · ${esc(b.l.servicio_nombre)} · ${est.label}"
              style="top:${top}px;height:${h}px;left:calc(${b.carril * ancho}% + 3px);width:calc(${ancho}% - 6px);background:${est.fondo};color:${est.texto};border-left-color:${prof?.color || '#94a3b8'}"
              onclick="event.stopPropagation();N360Citas.abrirCita('${b.cita.id}')">
              ${ventaVigente(b.cita) ? '<span class="ac-pagado" title="Cobrada">$</span>' : ''}
              ${compacto ? `<span><b>${esc(b.cita.cliente_nombre)}</b> · ${esc(b.l.servicio_nombre)} · ${aHHMM(b.ini)}</span>`
                : `<b>${esc(b.cita.cliente_nombre)}</b><span>${esc(b.l.servicio_nombre)}</span><span>${aHHMM(b.ini)} - ${aHHMM(b.fin)}</span>`}</div>`;
        });
      }
      const clic = col.esGeneral ? '' : `onclick="N360Citas.clicEnColumna(event,'${col.id}',${ini})"`;
      return `<div class="ac-col" style="height:${alto}px" ${clic}>${dentro}${lineaAhora}</div>`;
    }).join('');
    if (ahoraTop !== null) eje += `<div class="ac-ahora-etq" style="top:${ahoraTop}px">${aHHMM(ahoraMin)}</div>`;

    html += `<div class="ac-scroll"><div class="ac-tabla" style="--ncols:${columnas.length}">
        <div class="ac-esquina"></div>${cabeceras}
        <div class="ac-eje" style="height:${alto}px">${eje}</div>${cuerpos}
      </div></div>
      <div class="ac-leyenda">${Object.entries(ESTADOS).map(([k, v]) => `<span><span class="cal-dot" style="background:${v.fondo};border:1px solid ${v.texto}55"></span>${v.label}</span>`).join('')}
        <span><span class="ac-pagado" style="position:static;display:inline-flex;margin-right:4px">$</span>Cobrada</span></div>`;
    cont.innerHTML = html;
    // Si es hoy, desplazar hasta la hora actual
    if (ahoraTop !== null) {
      const sc = cont.querySelector('.ac-scroll'), l = cont.querySelector('.ac-ahora');
      if (sc && l) sc.scrollTop = Math.max(0, l.getBoundingClientRect().top - sc.getBoundingClientRect().top - 140);
    }
  }

  function filtrar(tipo, valor) {
    if (tipo === 'prof') C.filtroProf = valor; else C.filtroEstado = valor;
    const cont = $('calendario-contenedor'); if (cont) pintarDia(cont);
  }

  function clicEnColumna(ev, colId, ini) {
    const r = ev.currentTarget.getBoundingClientRect();
    const min = ini + (ev.clientY - r.top) / PX_MIN;
    const paso = C.config.intervalo_min || 15;
    const hora = aHHMM(Math.floor(min / paso) * paso);
    nuevaCita({ fecha: C.diaIso, hora, profesional_id: colId.startsWith('_') ? '' : colId });
  }

  /* ---------------- MODAL DE CITA ---------------- */
  function asegurarModales() {
    if ($('modal-cita')) return;
    const div = document.createElement('div');
    div.innerHTML = `
    <div class="modal-overlay" id="modal-cita" onclick="if(event.target===this)closeModal('modal-cita')">
      <div class="modal-box" style="max-width:760px">
        <div class="modal-header"><span class="modal-title" id="ct-titulo">Nueva cita</span>
          <button class="modal-close" onclick="closeModal('modal-cita')">✕</button></div>
        <div class="modal-body">
          <div id="ct-pagada" class="ac-nota-verde" style="display:none"></div>
          <div class="form-row">
            <div><label>Fecha *</label><input type="date" id="ct-fecha"/></div>
            <div><label>Estado</label><select id="ct-estado">${Object.entries(ESTADOS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
          </div>
          <div class="form-group">
            <label>Cliente *</label>
            <select id="ct-cliente"><option value="">— Escribir nombre (cliente nuevo o de paso) —</option></select>
            <div class="form-row" id="ct-libre-wrap" style="margin-top:6px">
              <div id="ct-nombre-wrap"><input type="text" id="ct-cliente-nombre" placeholder="Nombre del cliente"/></div>
              <div><input type="tel" id="ct-cliente-tel" placeholder="Teléfono (opcional)"/></div>
            </div>
            <label id="ct-guardar-cliente-wrap" style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12.5px;cursor:pointer">
              <input type="checkbox" id="ct-guardar-cliente" style="width:18px;height:18px;flex:none;margin:0"/> <span style="flex:1;min-width:0">Guardar como cliente nuevo (aparece en Clientes y en las próximas citas)</span></label>
          </div>
          <div class="form-group">
            <label style="display:flex;align-items:center;justify-content:space-between">Servicios *
              <button type="button" class="btn-secondary btn-sm" id="ct-btn-agregar" onclick="N360Citas.agregarLinea()">+ Agregar servicio</button></label>
            <div class="ac-lineas-cab"><span>Servicio</span><span>Profesional</span><span>Hora</span><span>Minutos</span><span>Precio</span><span></span></div>
            <div id="ct-lineas"></div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:4px">La duración es libre: escribe los minutos que tomará. Puedes poner varios servicios con distintos profesionales en la misma cita.</div>
            <div id="ct-total" style="text-align:right;font-weight:700;font-size:13px;margin-top:6px"></div>
          </div>
          <div class="form-group"><label>Notas (opcional)</label><textarea id="ct-notas" rows="2" placeholder="Preferencias, alergias, indicaciones..."></textarea></div>
          <div id="ct-cruces" class="ac-nota-roja" style="display:none"></div>
          <p id="ct-error" style="color:var(--danger);font-size:12.5px;margin-top:6px"></p>
        </div>
        <div class="modal-footer" style="flex-wrap:wrap;gap:6px">
          <button class="btn-ghost" id="ct-btn-cancelar-cita" style="color:var(--danger);margin-right:auto;display:none" onclick="N360Citas.cambiarEstado('cancelada')">Cancelar cita</button>
          <button class="btn-secondary" id="ct-btn-cobrar" style="display:none" onclick="N360Citas.cobrar()">💲 Cobrar en Ventas</button>
          <button class="btn-ghost" onclick="closeModal('modal-cita')">Cerrar</button>
          <button class="btn-primary" id="ct-btn-guardar" onclick="N360Citas.guardar(false)">Guardar cita</button>
        </div>
      </div>
    </div>
    <div class="modal-overlay" id="modal-ac-prof" onclick="if(event.target===this)closeModal('modal-ac-prof')">
      <div class="modal-box" style="max-width:720px">
        <div class="modal-header"><span class="modal-title">Profesionales y horario de la agenda</span>
          <button class="modal-close" onclick="closeModal('modal-ac-prof')">✕</button></div>
        <div class="modal-body">
          <div class="form-row" style="grid-template-columns:1fr 1fr 1fr">
            <div><label>La agenda empieza</label><input type="time" id="acp-ini"/></div>
            <div><label>La agenda termina</label><input type="time" id="acp-fin"/></div>
            <div><label>Saltos al tocar</label><select id="acp-int">${[5, 10, 15, 20, 30, 60].map(n => `<option value="${n}">${n} min</option>`).join('')}</select></div>
          </div>
          <div style="display:flex;gap:6px;align-items:flex-end;flex-wrap:wrap;margin:10px 0">
            <div style="flex:1;min-width:200px"><label>Agregar desde tus empleados</label><select id="acp-emp"></select></div>
            <button class="btn-primary btn-sm" onclick="N360Citas.agregarProfesional('emp')">+ Agregar</button>
            <div style="flex:1;min-width:160px"><label>…o escribir un nombre</label><input type="text" id="acp-nombre" placeholder="Ej: Cabina 1"/></div>
            <button class="btn-secondary btn-sm" onclick="N360Citas.agregarProfesional('nombre')">+ Agregar</button>
          </div>
          <div id="acp-lista"></div>
          <p id="acp-error" style="color:var(--danger);font-size:12.5px;margin-top:6px"></p>
        </div>
        <div class="modal-footer"><button class="btn-ghost" onclick="closeModal('modal-ac-prof')">Cerrar</button>
          <button class="btn-primary" id="acp-btn" onclick="N360Citas.guardarProfesionales()">Guardar cambios</button></div>
      </div>
    </div>
    <div class="modal-overlay" id="modal-ac-bloq" onclick="if(event.target===this)closeModal('modal-ac-bloq')">
      <div class="modal-box modal-sm">
        <div class="modal-header"><span class="modal-title" id="acb-titulo">Bloquear horario</span>
          <button class="modal-close" onclick="closeModal('modal-ac-bloq')">✕</button></div>
        <div class="modal-body">
          <input type="hidden" id="acb-id"/>
          <div class="form-group"><label>Profesional</label><select id="acb-prof"></select></div>
          <div class="form-group"><label>Fecha</label><input type="date" id="acb-fecha"/></div>
          <div class="form-row"><div><label>Desde</label><input type="time" id="acb-ini"/></div><div><label>Hasta</label><input type="time" id="acb-fin"/></div></div>
          <div class="form-group"><label>Motivo (opcional)</label><input type="text" id="acb-motivo" placeholder="Almuerzo, permiso, capacitación..."/></div>
          <p id="acb-error" style="color:var(--danger);font-size:12.5px"></p>
        </div>
        <div class="modal-footer">
          <button class="btn-ghost" id="acb-btn-quitar" style="display:none;color:var(--danger);margin-right:auto" onclick="N360Citas.quitarBloqueo()">Quitar bloqueo</button>
          <button class="btn-ghost" onclick="closeModal('modal-ac-bloq')">Cancelar</button>
          <button class="btn-primary" id="acb-btn" onclick="N360Citas.guardarBloqueo()">Guardar</button></div>
      </div>
    </div>
    <div class="modal-overlay" id="modal-ac-buscar" onclick="if(event.target===this)closeModal('modal-ac-buscar')">
      <div class="modal-box modal-sm">
        <div class="modal-header"><span class="modal-title">Buscar hora libre</span>
          <button class="modal-close" onclick="closeModal('modal-ac-buscar')">✕</button></div>
        <div class="modal-body">
          <div class="form-group"><label>Profesional</label><select id="acs-prof"></select></div>
          <div class="form-row"><div><label>Desde el día</label><input type="date" id="acs-fecha"/></div><div><label>Minutos que necesita</label><input type="number" id="acs-min" min="1" max="1440" value="60"/></div></div>
          <button class="btn-primary btn-sm" onclick="N360Citas.buscarHora()">Buscar</button>
          <div id="acs-res" style="margin-top:10px"></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div);
    $('ct-cliente').addEventListener('change', alCambiarCliente);
  }

  // Con el Módulo de Clínica: los pacientes que todavía no son clientes también se pueden agendar
  // (al guardar la cita se les crea su cliente y quedan ligados a su expediente).
  const usaClinica = () => STATE.empresaConfig?.usa_modulo_clinica === true;
  async function pacientesSinCliente() {
    if (!usaClinica()) return [];
    try {
      const { data, error } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, telefono, numero_expediente, cliente_id')
        .eq('auth_user_id', STATE.userId).eq('activo', true).is('cliente_id', null).order('nombres').limit(5000);
      if (error) throw error;
      return data || [];
    } catch (e) { console.warn('pacientes para la agenda:', e); return []; }
  }
  async function llenarClientes() {
    const sel = $('ct-cliente');
    if (sel.dataset.lleno === '1') return;
    C.pacientes = await pacientesSinCliente();
    const nombrePac = p => [p.nombres, p.apellidos].filter(Boolean).join(' ');
    sel.innerHTML = '<option value="">— Escribir nombre (cliente nuevo o de paso) —</option>' +
      (STATE.clientes || []).map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('') +
      C.pacientes.map(p => `<option value="pac:${p.id}">🩺 ${esc(nombrePac(p))} (paciente${p.numero_expediente ? ' ' + esc(p.numero_expediente) : ''})</option>`).join('');
    sel.dataset.lleno = '1';
    // Un solo campo: se busca el cliente (o paciente) y, si no está, lo escrito queda como persona nueva.
    if (window.N360SelectBuscable) {
      N360SelectBuscable.mejorar(sel, { placeholder: 'Busca el cliente o escribe el nombre de una persona nueva…', anchoCompleto: true,
        textoLibre: { leer: () => $('ct-cliente-nombre').value, escribir: t => { $('ct-cliente-nombre').value = t; } } });
      $('ct-nombre-wrap').style.display = 'none'; $('ct-libre-wrap').style.gridTemplateColumns = '1fr';
    }
  }
  // Vuelve a mostrar en el buscador el cliente elegido o el nombre escrito.
  function refrescarBuscador() { const s = $('ct-cliente'); s.value = s.value; }
  function alCambiarCliente() {
    const id = $('ct-cliente').value;
    $('ct-libre-wrap').style.display = id ? 'none' : '';
    $('ct-guardar-cliente-wrap').style.display = id ? 'none' : 'flex';
  }
  // Antes de guardar: si se eligió un paciente de la Clínica o se pidió guardar a la persona nueva como
  // cliente, se crea ese cliente (y se liga al expediente). Queda elegido en la lista, así un segundo
  // intento (p. ej. "Guardar de todas formas" por un cruce de horario) no lo vuelve a crear.
  async function asegurarCliente() {
    const sel = $('ct-cliente'), val = sel.value;
    let nuevo = null, pac = null;
    if (val.startsWith('pac:')) {
      pac = (C.pacientes || []).find(p => p.id === val.slice(4));
      if (!pac) throw new Error('No se encontró el paciente.');
      const { data: actual } = await sb.from('clinica_pacientes').select('cliente_id').eq('id', pac.id).eq('auth_user_id', STATE.userId).maybeSingle();
      if (actual?.cliente_id) { const { data: c } = await sb.from('clientes').select('id, nombre').eq('id', actual.cliente_id).eq('auth_user_id', STATE.userId).maybeSingle(); nuevo = c; }
      if (!nuevo) nuevo = { nombre: [pac.nombres, pac.apellidos].filter(Boolean).join(' ').slice(0, 100), apellido: null, telefono: pac.telefono || null };
    } else if (!val && $('ct-guardar-cliente').checked) {
      const nombre = $('ct-cliente-nombre').value.trim();
      if (!nombre) return;
      const igual = (STATE.clientes || []).find(c => String(c.nombre || '').trim().toLowerCase() === nombre.toLowerCase());
      if (igual) throw new Error(`Ya tienes un cliente llamado "${igual.nombre}": elígelo en la lista o quita la casilla para agendarlo solo de paso.`);
      nuevo = { nombre: nombre.slice(0, 100), apellido: null, telefono: $('ct-cliente-tel').value.trim() || null };
    } else return;
    if (!nuevo.id) {
      const { data, error } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre: nuevo.nombre, apellido: nuevo.apellido, telefono: nuevo.telefono }).select('id, nombre').single();
      if (error) throw error;
      nuevo = { ...nuevo, ...data };
    }
    if (pac) {
      const { error } = await sb.from('clinica_pacientes').update({ cliente_id: nuevo.id }).eq('id', pac.id).eq('auth_user_id', STATE.userId);
      if (error) console.warn('ligar paciente con su cliente:', error);
      C.pacientes = C.pacientes.filter(p => p.id !== pac.id);
      sel.querySelector(`option[value="pac:${pac.id}"]`)?.remove();
    }
    STATE.clientes = [...(STATE.clientes || []), { id: nuevo.id, nombre: nuevo.nombre }];
    if (!sel.querySelector(`option[value="${nuevo.id}"]`)) sel.insertAdjacentHTML('beforeend', `<option value="${nuevo.id}">${esc(nuevo.nombre)}</option>`);
    sel.value = nuevo.id; sel.dispatchEvent(new Event('change'));
    if (!C.edit) C.telNuevo = nuevo.telefono || '';
  }

  function opcionesServicio(sel) {
    return `<option value="">— Escribir otro —</option>` + C.servicios.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.nombre)}</option>`).join('');
  }
  function opcionesProfesional(servicioId, sel) {
    const lista = profesionalesActivos().filter(p => !servicioId || !(p.servicios || []).length || p.servicios.includes(servicioId) || p.id === sel);
    // Si el profesional elegido ya no está activo, se muestra igual para no perder el dato
    const extra = sel && !lista.some(p => p.id === sel) && profPorId(sel) ? [profPorId(sel)] : [];
    return `<option value="">Sin asignar</option>` + [...lista, ...extra].map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  }

  function lineaHTML(l, idx, soloLectura) {
    const dis = soloLectura ? 'disabled' : '';
    return `<div class="ac-linea-form" data-idx="${idx}">
      <div><select class="lc-serv" ${dis} onchange="N360Citas.alCambiarServicio(this)">${opcionesServicio(l.producto_id)}</select>
        <input type="text" class="lc-nombre" ${dis} placeholder="Nombre del servicio" value="${esc(l.servicio_nombre || '')}" style="margin-top:4px;${l.producto_id ? 'display:none' : ''}"/></div>
      <div><select class="lc-prof" ${dis}>${opcionesProfesional(l.producto_id, l.profesional_id)}</select></div>
      <div><input type="time" class="lc-hora" ${dis} value="${esc(String(l.hora_inicio || '').slice(0, 5))}"/></div>
      <div><input type="number" class="lc-min" ${dis} min="1" max="1440" step="1" value="${esc(l.duracion_min || 60)}" oninput="N360Citas.total()"/></div>
      <div><input type="number" class="lc-precio" ${dis} min="0" step="0.01" value="${esc(l.precio ?? 0)}" oninput="N360Citas.total()"/></div>
      <div>${soloLectura ? '' : `<button type="button" class="btn-ghost btn-sm" title="Quitar" onclick="N360Citas.quitarLinea(this)">✕</button>`}</div>
    </div>`;
  }

  function leerLineas() {
    return [...document.querySelectorAll('#ct-lineas .ac-linea-form')].map(f => {
      const prodId = f.querySelector('.lc-serv').value;
      const s = servPorId(prodId);
      return {
        producto_id: prodId || null,
        servicio_nombre: s ? s.nombre : f.querySelector('.lc-nombre').value.trim(),
        profesional_id: f.querySelector('.lc-prof').value || null,
        hora_inicio: f.querySelector('.lc-hora').value,
        duracion_min: parseInt(f.querySelector('.lc-min').value, 10),
        precio: Math.round((parseFloat(f.querySelector('.lc-precio').value) || 0) * 100) / 100,
      };
    });
  }
  function total() {
    const t = leerLineas().reduce((a, l) => a + (Number(l.precio) || 0), 0);
    const min = leerLineas().reduce((a, l) => a + (Number(l.duracion_min) || 0), 0);
    $('ct-total').textContent = `Total: ${fmt(t)} · ${min} min`;
  }
  function alCambiarServicio(sel) {
    const fila = sel.closest('.ac-linea-form');
    const s = servPorId(sel.value);
    fila.querySelector('.lc-nombre').style.display = s ? 'none' : '';
    if (s) { fila.querySelector('.lc-precio').value = Number(s.precio || 0); }
    const profSel = fila.querySelector('.lc-prof');
    profSel.innerHTML = opcionesProfesional(sel.value, profSel.value);
    total();
  }
  function agregarLinea() {
    const lineas = leerLineas();
    const ult = lineas[lineas.length - 1];
    const hora = ult && ult.hora_inicio ? aHHMM(aMin(ult.hora_inicio) + (Number(ult.duracion_min) || 0)) : (C.config.hora_inicio || '08:00');
    $('ct-lineas').insertAdjacentHTML('beforeend', lineaHTML({ hora_inicio: hora, duracion_min: 60, precio: 0, profesional_id: ult?.profesional_id || '' }, lineas.length, false));
    total();
  }
  function quitarLinea(btn) {
    if (document.querySelectorAll('#ct-lineas .ac-linea-form').length <= 1) { showToast('La cita necesita al menos un servicio', 'error'); return; }
    btn.closest('.ac-linea-form').remove(); total();
  }

  async function nuevaCita(pre = {}) {
    await cargarBase(); asegurarModales(); await llenarClientes();
    C.edit = null; C.telNuevo = '';
    $('ct-guardar-cliente').checked = usaClinica();
    $('ct-titulo').textContent = 'Nueva cita';
    $('ct-fecha').value = pre.fecha || (STATE.calVista === 'dia' ? ymdLocal(STATE.calFecha) : todayLocalISO());
    $('ct-estado').value = 'reservada';
    $('ct-cliente').value = ''; alCambiarCliente();
    $('ct-cliente-nombre').value = ''; $('ct-cliente-tel').value = ''; refrescarBuscador();
    $('ct-notas').value = '';
    $('ct-lineas').innerHTML = lineaHTML({ hora_inicio: pre.hora || C.config.hora_inicio, duracion_min: 60, precio: 0, profesional_id: pre.profesional_id || '' }, 0, false);
    prepararModal(false);
    openModal('modal-cita');
  }

  async function abrirCita(id) {
    await cargarBase(); asegurarModales(); await llenarClientes();
    $('ct-guardar-cliente').checked = false; C.telNuevo = '';
    const { data: c, error } = await sb.from('agenda_citas').select('*, agenda_citas_servicios(*)').eq('id', id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (error || !c) { showToast('No se encontró la cita', 'error'); return; }
    if (c.venta_id && !C.ventasEstado[c.venta_id]) {
      const { data: v } = await sb.from('ventas').select('estado,numero_venta').eq('id', c.venta_id).maybeSingle();
      if (v) { C.ventasEstado[c.venta_id] = v.estado; C.ventasEstado['n_' + c.venta_id] = v.numero_venta; }
    }
    C.edit = c;
    const lin = (c.agenda_citas_servicios || []).sort((a, b) => a.orden - b.orden);
    const cobrada = ventaVigente(c);
    $('ct-titulo').textContent = `Cita de ${c.cliente_nombre} · ${fechaLarga(c.fecha)}`;
    $('ct-fecha').value = c.fecha;
    $('ct-estado').value = c.estado;
    $('ct-cliente').value = c.cliente_id || ''; alCambiarCliente();
    $('ct-cliente-nombre').value = c.cliente_id ? '' : c.cliente_nombre; refrescarBuscador();
    $('ct-cliente-tel').value = c.cliente_telefono || '';
    $('ct-notas').value = c.notas || '';
    $('ct-lineas').innerHTML = lin.map((l, i) => lineaHTML(l, i, cobrada)).join('');
    prepararModal(true, cobrada, c);
    openModal('modal-cita');
  }

  function prepararModal(existe, cobrada, c) {
    $('ct-error').textContent = ''; $('ct-cruces').style.display = 'none'; $('ct-cruces').innerHTML = '';
    $('ct-btn-guardar').textContent = existe ? (cobrada ? 'Guardar notas y estado' : 'Guardar cambios') : 'Guardar cita';
    $('ct-btn-cancelar-cita').style.display = existe && c?.estado !== 'cancelada' && !cobrada ? '' : 'none';
    $('ct-btn-cobrar').style.display = existe && !cobrada && c?.estado !== 'cancelada' ? '' : 'none';
    $('ct-btn-agregar').style.display = cobrada ? 'none' : '';
    ['ct-fecha', 'ct-cliente', 'ct-cliente-nombre', 'ct-cliente-tel'].forEach(id => { $(id).disabled = !!cobrada; });
    const buscador = $('ct-cliente').parentElement.querySelector('.sb-input'); if (buscador) buscador.disabled = !!cobrada;
    const nota = $('ct-pagada');
    if (existe && c?.venta_id) {
      const num = C.ventasEstado['n_' + c.venta_id] || '';
      nota.style.display = '';
      nota.className = cobrada ? 'ac-nota-verde' : 'ac-nota-roja';
      nota.textContent = cobrada ? `✅ Cobrada con la venta ${num}. Los servicios y precios ya no se cambian aquí; solo notas y estado.`
        : `⚠️ La venta ${num} con que se cobró esta cita fue anulada. Puedes volver a cobrarla.`;
    } else nota.style.display = 'none';
    total();
  }

  function datosFormulario() {
    const valor = $('ct-cliente').value || null;
    const pac = valor && valor.startsWith('pac:') ? (C.pacientes || []).find(p => p.id === valor.slice(4)) : null;   // se vuelve cliente al guardar
    const clienteId = pac ? null : valor;
    const cli = clienteId ? (STATE.clientes || []).find(x => x.id === clienteId) : null;
    return {
      fecha: $('ct-fecha').value,
      cliente_id: clienteId,
      cliente_nombre: pac ? [pac.nombres, pac.apellidos].filter(Boolean).join(' ') : cli ? cli.nombre : $('ct-cliente-nombre').value.trim(),
      cliente_telefono: clienteId ? (C.edit?.cliente_telefono || C.telNuevo || '') : $('ct-cliente-tel').value.trim(),
      estado: $('ct-estado').value,
      notas: $('ct-notas').value.trim(),
      creado_por: C.edit?.creado_por || perfilActivo(),
    };
  }

  async function guardar(permitirCruce) {
    const err = $('ct-error'); err.textContent = '';
    let datos = datosFormulario();
    const lineas = leerLineas();
    if (!datos.fecha) { err.textContent = 'Elige la fecha.'; return; }
    if (!datos.cliente_nombre) { err.textContent = 'Elige un cliente o escribe su nombre.'; return; }
    for (const l of lineas) {
      if (!l.servicio_nombre) { err.textContent = 'Cada servicio necesita un nombre.'; return; }
      if (!l.hora_inicio) { err.textContent = `Falta la hora de "${l.servicio_nombre}".`; return; }
      if (!(l.duracion_min >= 1 && l.duracion_min <= 1440)) { err.textContent = `Escribe los minutos de "${l.servicio_nombre}" (de 1 a 1440).`; return; }
    }
    const btn = $('ct-btn-guardar'); btn.disabled = true;
    try {
      if ($('ct-cliente').value.startsWith('pac:') || (!$('ct-cliente').value && $('ct-guardar-cliente').checked)) {
        try { await asegurarCliente(); } catch (e) { err.textContent = e?.message || 'No se pudo guardar el cliente.'; return; }
        datos = datosFormulario();
      }
      const { data, error } = await sb.rpc('agenda_cita_guardar', { p_cita_id: C.edit?.id || null, p_datos: datos, p_servicios: lineas, p_permitir_cruce: !!permitirCruce });
      if (error) throw error;
      if (!data?.ok) {
        const lista = (data?.cruces || []).map(x => x.tipo === 'bloqueo'
          ? `• ${esc(x.profesional)} no está disponible de ${x.hora} a ${x.hasta} (${esc(x.motivo)})`
          : x.tipo === 'misma_cita' ? `• Esta misma cita tiene dos servicios a la vez con el mismo profesional (${esc(x.servicio)} ${esc(x.hora)})`
          : `• ${esc(x.profesional)} ya atiende a ${esc(x.cliente)} (${esc(x.servicio)}) de ${x.hora} a ${x.hasta}`).join('<br>');
        const caja = $('ct-cruces');
        caja.innerHTML = `<b>Ese horario se cruza:</b><br>${lista}<div style="margin-top:8px"><button class="btn-secondary btn-sm" onclick="N360Citas.guardar(true)">Guardar de todas formas</button> <span style="font-size:11.5px">o cambia la hora / el profesional.</span></div>`;
        caja.style.display = '';
        return;
      }
      showToast(data.solo_notas ? 'Notas y estado guardados' : (C.edit ? 'Cita actualizada' : 'Cita agendada'));
      closeModal('modal-cita');
      await refrescar();
    } catch (e) {
      console.error('guardar cita:', e);
      err.textContent = e?.message && !/fetch/i.test(e.message) ? e.message : 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.';
    } finally { btn.disabled = false; }
  }

  async function cambiarEstado(estado) {
    if (!C.edit) return;
    if (estado === 'cancelada' && !window.confirm('¿Cancelar esta cita? Quedará en el historial como cancelada.')) return;
    const { error } = await sb.from('agenda_citas').update({ estado, updated_at: new Date().toISOString() }).eq('id', C.edit.id).eq('auth_user_id', STATE.userId);
    if (error) { showToast('No se pudo cambiar el estado', 'error'); return; }
    showToast(`Cita ${ESTADOS[estado].label.toLowerCase()}`);
    closeModal('modal-cita');
    await refrescar();
  }

  // Cobrar: se arma la venta con cliente y servicios (mismo camino que la veterinaria).
  async function cobrar() {
    const c = C.edit; if (!c) return;
    const lin = c.agenda_citas_servicios || [];
    const conCatalogo = lin.filter(l => l.producto_id);
    const sinCatalogo = lin.filter(l => !l.producto_id);
    if (!conCatalogo.length) {
      showToast('Ningún servicio de esta cita está en tu catálogo: en Ventas agrégalos a mano.', 'error');
    }
    const items = [];
    conCatalogo.forEach(l => {
      const ya = items.find(x => x.producto_id === l.producto_id);
      if (ya) { ya.cantidad += 1; ya.total = Math.round((ya.total + Number(l.precio || 0)) * 100) / 100; }
      else items.push({ producto_id: l.producto_id, cantidad: 1, total: Number(l.precio || 0) });
    });
    // Clínica (solo si la cuenta la usa): lo que el médico agregó a la cuenta de la visita
    // (p. ej. medicamentos de la receta) se cobra junto con la cita, al precio del catálogo.
    if (STATE.empresaConfig?.usa_modulo_clinica === true) {
      try {
        const { data: cargos } = await sb.from('clinica_cita_cargos').select('producto_id, descripcion, cantidad, productos(precio)')
          .eq('auth_user_id', STATE.userId).eq('agenda_cita_id', c.id);
        (cargos || []).forEach(x => {
          if (!x.producto_id || !x.productos) return;          // el producto ya no existe en el catálogo
          const cant = Number(x.cantidad) || 1, monto = Math.round(cant * Number(x.productos.precio || 0) * 100) / 100;
          const ya = items.find(i => i.producto_id === x.producto_id);
          if (ya) { ya.cantidad += cant; ya.total = Math.round((ya.total + monto) * 100) / 100; }
          else items.push({ producto_id: x.producto_id, cantidad: cant, total: monto });
        });
        // Desde la Agenda se cobra el total al paciente: se borra un reparto con seguro que se haya preparado antes.
        await sb.from('clinica_cita_info').update({ convenio_id: null, cobertura_pct: null, monto_cubierto: null, cubierto_servicios: null })
          .eq('auth_user_id', STATE.userId).eq('agenda_cita_id', c.id);
      } catch (e) { console.warn('cuenta de la clínica:', e); }
    }
    sessionStorage.setItem('n360_agenda_cobro', JSON.stringify({
      citaId: c.id, clienteId: c.cliente_id || null, cliente: c.cliente_nombre, items,
      sinCatalogo: sinCatalogo.map(l => `${l.servicio_nombre} (${fmt(l.precio)})`),
    }));
    window.location.href = 'ventas.html';
  }

  async function refrescar() {
    if (typeof cargarAgenda === 'function') await cargarAgenda();
  }

  /* ---------------- PROFESIONALES ---------------- */
  async function abrirProfesionales() {
    await cargarBase(true); asegurarModales();
    $('acp-ini').value = C.config.hora_inicio; $('acp-fin').value = C.config.hora_fin; $('acp-int').value = String(C.config.intervalo_min);
    llenarEmpleadosSel();
    pintarProfesionales();
    $('acp-error').textContent = '';
    openModal('modal-ac-prof');
  }
  function llenarEmpleadosSel() {
    const usados = new Set(C.profesionales.map(p => p.empleado_id).filter(Boolean));
    const libres = C.empleados.filter(e => !usados.has(e.id));
    $('acp-emp').innerHTML = libres.length ? libres.map(e => `<option value="${e.id}">${esc(e.nombre)}${e.cargo ? ' · ' + esc(e.cargo) : ''}</option>`).join('')
      : '<option value="">(todos tus empleados ya están agregados)</option>';
  }
  function pintarProfesionales() {
    const cont = $('acp-lista');
    if (!C.profesionales.length) { cont.innerHTML = '<p style="font-size:12.5px;color:var(--text-muted)">Todavía no hay profesionales.</p>'; return; }
    cont.innerHTML = C.profesionales.map((p, i) => `
      <div class="ac-prof-fila" data-id="${p.id}">
        <input type="color" class="pf-color" value="${esc(p.color || '#a855f7')}" title="Color"/>
        <input type="text" class="pf-nombre" value="${esc(p.nombre)}"/>
        <input type="number" class="pf-orden" value="${p.orden || i}" title="Orden en la agenda" style="width:60px"/>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap"><input type="checkbox" class="pf-activo" ${p.activo ? 'checked' : ''}/> Activo</label>
        <details style="grid-column:1/-1"><summary style="font-size:12px;cursor:pointer">Servicios que hace (${(p.servicios || []).length ? (p.servicios || []).length + ' elegidos' : 'todos'})</summary>
          <div class="ac-serv-grid">${C.servicios.length ? C.servicios.map(s => `<label><input type="checkbox" class="pf-serv" value="${s.id}" ${(p.servicios || []).includes(s.id) ? 'checked' : ''}/> ${esc(s.nombre)}</label>`).join('')
            : '<span style="font-size:12px;color:var(--text-muted)">No tienes servicios en Productos/Servicios.</span>'}</div>
          <div style="font-size:11px;color:var(--text-muted)">Si no marcas ninguno, puede hacer todos.</div></details>
      </div>`).join('');
  }
  async function agregarProfesional(modo) {
    const err = $('acp-error'); err.textContent = '';
    let fila;
    if (modo === 'emp') {
      const id = $('acp-emp').value; const e = C.empleados.find(x => x.id === id);
      if (!e) { err.textContent = 'Elige un empleado.'; return; }
      fila = { empleado_id: e.id, nombre: e.nombre };
    } else {
      const n = $('acp-nombre').value.trim(); if (!n) { err.textContent = 'Escribe el nombre.'; return; }
      fila = { nombre: n };
    }
    fila.color = COLORES_PROF[C.profesionales.length % COLORES_PROF.length];
    fila.orden = C.profesionales.length;
    const { error } = await sb.from('agenda_profesionales').insert({ ...fila, auth_user_id: STATE.userId });
    if (error) { err.textContent = /duplicate|unique/i.test(error.message) ? 'Ese empleado ya está en la agenda.' : 'No se pudo agregar.'; return; }
    $('acp-nombre').value = '';
    await cargarBase(true); llenarEmpleadosSel(); pintarProfesionales();
  }
  async function guardarProfesionales() {
    const err = $('acp-error'); err.textContent = '';
    const ini = $('acp-ini').value, fin = $('acp-fin').value, intv = parseInt($('acp-int').value, 10);
    if (!ini || !fin || aMin(fin) <= aMin(ini)) { err.textContent = 'La hora en que termina debe ser después de la hora en que empieza.'; return; }
    const btn = $('acp-btn'); btn.disabled = true;
    try {
      const { error: e1 } = await sb.from('agenda_configuracion').upsert({ auth_user_id: STATE.userId, hora_inicio: ini, hora_fin: fin, intervalo_min: intv, updated_at: new Date().toISOString() }, { onConflict: 'auth_user_id' });
      if (e1) throw e1;
      for (const f of document.querySelectorAll('#acp-lista .ac-prof-fila')) {
        const nombre = f.querySelector('.pf-nombre').value.trim();
        if (!nombre) { err.textContent = 'Un profesional quedó sin nombre.'; return; }
        const { error } = await sb.from('agenda_profesionales').update({
          nombre, color: f.querySelector('.pf-color').value, orden: parseInt(f.querySelector('.pf-orden').value, 10) || 0,
          activo: f.querySelector('.pf-activo').checked,
          servicios: [...f.querySelectorAll('.pf-serv:checked')].map(x => x.value),
          updated_at: new Date().toISOString(),
        }).eq('id', f.dataset.id).eq('auth_user_id', STATE.userId);
        if (error) throw error;
      }
      showToast('Agenda configurada');
      closeModal('modal-ac-prof');
      await cargarBase(true);
      await refrescar();
    } catch (e) { console.error('guardarProfesionales:', e); err.textContent = 'No se pudo guardar. Intenta de nuevo.'; }
    finally { btn.disabled = false; }
  }

  /* ---------------- BLOQUEOS ---------------- */
  function opcionesProfTodos(sel) {
    return `<option value="">Todos los profesionales</option>` + profesionalesActivos().map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
  }
  async function abrirBloqueo(b) {
    await cargarBase(); asegurarModales();
    $('acb-id').value = b?.id || '';
    $('acb-titulo').textContent = b ? 'Horario bloqueado' : 'Bloquear horario';
    $('acb-prof').innerHTML = opcionesProfTodos(b?.profesional_id || C.filtroProf || '');
    $('acb-fecha').value = b?.fecha || C.diaIso || todayLocalISO();
    $('acb-ini').value = b ? String(b.hora_inicio).slice(0, 5) : '12:00';
    $('acb-fin').value = b ? String(b.hora_fin).slice(0, 5) : '13:00';
    $('acb-motivo').value = b?.motivo || '';
    $('acb-error').textContent = '';
    $('acb-btn-quitar').style.display = b ? '' : 'none';
    openModal('modal-ac-bloq');
  }
  function verBloqueo(id) { const b = C.bloqueosDia.find(x => x.id === id); if (b) abrirBloqueo(b); }
  async function guardarBloqueo() {
    const err = $('acb-error'); err.textContent = '';
    const fila = { profesional_id: $('acb-prof').value || null, fecha: $('acb-fecha').value, hora_inicio: $('acb-ini').value, hora_fin: $('acb-fin').value, motivo: $('acb-motivo').value.trim() || null };
    if (!fila.fecha || !fila.hora_inicio || !fila.hora_fin) { err.textContent = 'Completa fecha y horas.'; return; }
    if (aMin(fila.hora_fin) <= aMin(fila.hora_inicio)) { err.textContent = '"Hasta" debe ser después de "Desde".'; return; }
    const id = $('acb-id').value;
    const q = id ? sb.from('agenda_bloqueos').update(fila).eq('id', id).eq('auth_user_id', STATE.userId)
                 : sb.from('agenda_bloqueos').insert({ ...fila, auth_user_id: STATE.userId });
    const { error } = await q;
    if (error) { err.textContent = 'No se pudo guardar.'; return; }
    showToast('Horario bloqueado'); closeModal('modal-ac-bloq'); await refrescar();
  }
  async function quitarBloqueo() {
    const id = $('acb-id').value; if (!id) return;
    const { error } = await sb.from('agenda_bloqueos').delete().eq('id', id).eq('auth_user_id', STATE.userId);
    if (error) { $('acb-error').textContent = 'No se pudo quitar.'; return; }
    showToast('Bloqueo quitado'); closeModal('modal-ac-bloq'); await refrescar();
  }

  /* ---------------- BUSCAR HORA LIBRE ---------------- */
  async function abrirBuscarHora() {
    await cargarBase(); asegurarModales();
    $('acs-prof').innerHTML = `<option value="">Cualquier profesional</option>` + profesionalesActivos().map(p => `<option value="${p.id}" ${p.id === C.filtroProf ? 'selected' : ''}>${esc(p.nombre)}</option>`).join('');
    $('acs-fecha').value = C.diaIso || todayLocalISO();
    $('acs-res').innerHTML = '';
    openModal('modal-ac-buscar');
  }
  async function buscarHora() {
    const res = $('acs-res');
    const minNec = parseInt($('acs-min').value, 10);
    const desde = $('acs-fecha').value;
    if (!desde || !(minNec >= 1)) { res.innerHTML = '<p style="color:var(--danger);font-size:12.5px">Elige el día y los minutos.</p>'; return; }
    const profs = $('acs-prof').value ? profesionalesActivos().filter(p => p.id === $('acs-prof').value) : profesionalesActivos();
    if (!profs.length) { res.innerHTML = '<p style="font-size:12.5px">Primero agrega profesionales.</p>'; return; }
    res.innerHTML = 'Buscando…';
    const d0 = new Date(desde + 'T12:00:00'), hasta = ymdLocal(new Date(d0.getTime() + 13 * 86400000));
    let citas, bloqs;
    try {
      citas = await citasDelRango(desde, hasta);
      const { data } = await sb.from('agenda_bloqueos').select('*').eq('auth_user_id', STATE.userId).gte('fecha', desde).lte('fecha', hasta);
      bloqs = data || [];
    } catch (e) { res.innerHTML = '<p style="color:var(--danger)">No se pudo buscar.</p>'; return; }
    const ini = aMin(C.config.hora_inicio), fin = aMin(C.config.hora_fin), paso = C.config.intervalo_min || 15;
    const ahoraMin = new Date().getHours() * 60 + new Date().getMinutes();
    const hallados = [];
    for (let k = 0; k < 14 && hallados.length < 8; k++) {
      const iso = ymdLocal(new Date(d0.getTime() + k * 86400000));
      for (let m = ini; m + minNec <= fin && hallados.length < 8; m += paso) {
        if (iso === todayLocalISO() && m < ahoraMin) continue;
        const libre = profs.find(p => {
          const ocupadoCita = citas.some(c => c.fecha === iso && !['cancelada', 'no_asistio'].includes(c.estado) && (c.agenda_citas_servicios || []).some(l =>
            l.profesional_id === p.id && aMin(l.hora_inicio) < m + minNec && m < aMin(l.hora_inicio) + Number(l.duracion_min)));
          const ocupadoBloq = bloqs.some(b => b.fecha === iso && (!b.profesional_id || b.profesional_id === p.id) && aMin(b.hora_inicio) < m + minNec && m < aMin(b.hora_fin));
          return !ocupadoCita && !ocupadoBloq;
        });
        if (libre) { hallados.push({ iso, m, p: libre }); if (!$('acs-prof').value) m += minNec - paso; }
      }
    }
    res.innerHTML = hallados.length ? hallados.map(h => `<div class="ac-hueco" onclick="closeModal('modal-ac-buscar');N360Citas.nuevaCita({fecha:'${h.iso}',hora:'${aHHMM(h.m)}',profesional_id:'${h.p.id}'})">
        <b>${fechaLarga(h.iso)}</b> · ${hora12(aHHMM(h.m))} – ${hora12(aHHMM(h.m + minNec))} · ${esc(h.p.nombre)}</div>`).join('')
      : '<p style="font-size:12.5px">No hay espacio libre en los próximos 14 días dentro del horario de la agenda.</p>';
  }

  window.N360Citas = {
    itemsParaCalendario, renderDia, filtrar, clicEnColumna,
    nuevaCita, abrirCita, guardar, cambiarEstado, cobrar, total, agregarLinea, quitarLinea, alCambiarServicio,
    abrirProfesionales, agregarProfesional, guardarProfesionales,
    abrirBloqueo, verBloqueo, guardarBloqueo, quitarBloqueo, abrirBuscarHora, buscarHora,
    _C: C,
  };
})();
