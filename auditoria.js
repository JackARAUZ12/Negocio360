/* =====================================================
   AUDITORIA.JS — NEGOCIO360
   Visor de la bitácora de movimientos (llenada automáticamente
   por auditoria-guard.js en TODOS los módulos). Este archivo solo
   LEE de auditoria_log — nunca inserta nada aquí.

   Acceso: requiere el código de administrador (mismo candado que
   Configuración), sin importar qué perfil haya iniciado sesión.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbClient     = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =====================================================
   ESTADO GLOBAL
===================================================== */
let STATE = {
  userId: null, userEmail: null, empresaConfig: {}, currentUser: {},

  logs: [],
  eventos: [],          // logs agrupados en eventos de negocio (para mostrar)
  filtro: 'todos',      // todos | INSERT | UPDATE | DELETE
  filtroUsuario: '',
  filtroModulo: '',
  search: '',
  page: 1,
  perPage: 20,
};

/* =====================================================
   HELPERS
===================================================== */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtFecha(iso) {
  if (!iso) return '—';
  // BUG REAL CORREGIDO: new Date("2026-08-28") (sin hora) se
  // interpreta como medianoche UTC, no medianoche local -- al
  // mostrarla en Nicaragua (UTC-6) retrocede 6 horas, cayendo en el
  // dia anterior (aparecia "27 ago" en vez de "28 ago"). Si el texto
  // viene como fecha pura "YYYY-MM-DD", se arma la fecha con
  // año/mes/día LOCAL directamente, sin pasar por el constructor
  // ambiguo de Date(). Las fechas con hora completa (ej. created_at
  // real) siguen igual, esas SI tienen zona horaria explícita.
  const soloFecha = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = soloFecha
    ? (() => { const [y,m,day] = iso.split('-').map(Number); return new Date(y, m-1, day); })()
    : new Date(iso);
  return d.toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-NI', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
function fmtNum(v) { return Number(v || 0).toLocaleString('es-NI'); }
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
// Nombre legible de un módulo (usa el registro central si está disponible).
function labelModulo(archivo) {
  const m = window.NEGOCIO360_MODULOS?.[archivo];
  return m ? `${m.icon} ${m.label}` : archivo;
}

/* =====================================================
   THEME / SIDEBAR / NAV (idéntico al resto del sistema)
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
  if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
}
function toggleTheme() {
  const curr = document.documentElement.getAttribute('data-theme');
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}
function isMobileViewport() { return window.innerWidth <= 860; }
function toggleSidebar() {
  if (isMobileViewport()) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
  } else {
    document.getElementById('sidebar').classList.toggle('collapsed');
    document.getElementById('main').classList.toggle('sidebar-collapsed');
  }
}
function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}
function navigate(url) { closeMobileSidebar(); window.location.href = url; }

/* =====================================================
   CONFIG EMPRESA / PERFIL / ADMIN (idéntico al resto del sistema)
===================================================== */
/* =====================================================
   VENTAS POR USUARIO — cuánto vendió cada perfil de personal,
   con productos/cantidades de cada venta, y el total del día y
   del mes. A diferencia de la bitácora de arriba, esto lee
   directo de la tabla ventas (dato permanente, sin límite de
   24 horas) usando el campo creado_por_nombre que cada venta
   guarda desde que se crea.
===================================================== */
/* =====================================================
   RESUMEN MENSUAL — cuenta y suma movimientos de TODO el mes,
   pero sin guardar nada extra: lee directo de las tablas reales
   (ventas, gastos, compras, pagos de credito), que YA se guardan
   para siempre sin costo adicional -- a diferencia de la bitacora
   de auditoria de abajo, que solo dura 24h a proposito (para no
   acumular almacenamiento indefinidamente).
===================================================== */
async function cargarResumenMensual() {
  const mesInput = document.getElementById('rm-mes');
  let mes = mesInput.value;
  if (!mes) { mes = todayISO().slice(0,7); mesInput.value = mes; }
  const inicio = `${mes}-01`;
  const [anio, mesNum] = mes.split('-').map(Number);
  const finMes = fechaLocalISO(new Date(anio, mesNum, 0)); // último día real de ese mes, sin .toISOString()
  const limiteExclusivo = siguienteDiaISO(finMes); // primer día del mes siguiente -- cubre TODO el último día, sin importar la hora exacta guardada

  try {
    // Cada consulta solo trae la columna de monto (no la fila completa)
    // -- minimiza los datos transferidos, el conteo/suma se hace aquí.
    const [ventas, gastos, compras, pagos] = await Promise.all([
      sbClient.from('ventas').select('total').eq('auth_user_id', STATE.userId).eq('estado','completada').gte('fecha', inicio).lt('fecha', limiteExclusivo),
      sbClient.from('gastos').select('monto').eq('auth_user_id', STATE.userId).eq('estado','activo').gte('fecha', inicio).lt('fecha', limiteExclusivo),
      sbClient.from('compras').select('total').eq('auth_user_id', STATE.userId).eq('estado','completada').gte('fecha', inicio).lt('fecha', limiteExclusivo),
      sbClient.from('creditos_pagos').select('monto').eq('auth_user_id', STATE.userId).eq('estado','completado').gte('fecha', inicio).lt('fecha', limiteExclusivo),
    ]);

    const sumar = (res, campo) => (res.data||[]).reduce((s,r) => s + (Number(r[campo])||0), 0);
    const pintar = (idValor, idLabel, res, campo, etiqueta) => {
      const n = (res.data||[]).length;
      document.getElementById(idValor).textContent = fmtMonto(sumar(res, campo));
      document.getElementById(idLabel).textContent = `${etiqueta} (${n})`;
    };

    pintar('rm-ventas',  'rm-label-ventas',  ventas,  'total', 'Ventas');
    pintar('rm-gastos',  'rm-label-gastos',  gastos,  'monto', 'Gastos');
    pintar('rm-compras', 'rm-label-compras', compras, 'total', 'Compras');
    pintar('rm-pagos',   'rm-label-pagos',   pagos,   'monto', 'Pagos de crédito recibidos');
  } catch (e) {
    console.error('cargarResumenMensual:', e);
  }
}

/* =====================================================
   CONSULTA: ¿cuánto vendió un usuario de VARIOS productos en un mes?
   Reutiliza el MISMO dato de creado_por_nombre -- por eso solo
   funciona para ventas de despues de que este seguimiento se
   activo (mas las que se pudieron recuperar de la bitacora
   mientras aun estaba disponible). Las ventas mas viejas de eso
   nunca guardaron quien las hizo, no hay forma de recuperarlo.
===================================================== */
let TODOS_LOS_PRODUCTOS_CONSULTA = [];
let PRODUCTOS_SELECCIONADOS_CONSULTA = new Set();

async function cargarOpcionesConsultaProducto() {
  try {
    const { data: productos } = await sbClient.from('productos')
      .select('id, nombre').eq('auth_user_id', STATE.userId).order('nombre');
    TODOS_LOS_PRODUCTOS_CONSULTA = productos || [];
    renderListaProductosConsulta(TODOS_LOS_PRODUCTOS_CONSULTA);

    const { data: perfiles } = await sbClient.from('perfiles_acceso')
      .select('nombre').eq('auth_user_id', STATE.userId).eq('activo', true);
    const nombres = [...new Set((perfiles||[]).map(p => p.nombre).filter(Boolean))].sort();
    const selUser = document.getElementById('cpu-usuario');
    if (selUser) {
      selUser.innerHTML = '<option value="">Elige un usuario…</option>' +
        nombres.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    }

    elegirPeriodoConsulta('hoy'); // estado inicial: hoy, con su texto de rango
  } catch (e) { console.warn('cargarOpcionesConsultaProducto:', e); }
}

function renderListaProductosConsulta(lista) {
  const cont = document.getElementById('cpu-lista-productos');
  if (!cont) return;
  if (!lista.length) { cont.innerHTML = '<p style="color:var(--text-muted);font-size:12.5px;margin:2px 0">Sin productos que coincidan</p>'; return; }
  cont.innerHTML = lista.map(p => `
    <label style="display:flex;align-items:center;gap:7px;padding:3px 0;font-size:13px;cursor:pointer">
      <input type="checkbox" value="${p.id}" ${PRODUCTOS_SELECCIONADOS_CONSULTA.has(p.id) ? 'checked' : ''} onchange="toggleProductoConsulta('${p.id}', this.checked)"/>
      <span>${esc(p.nombre)}</span>
    </label>`).join('');
}

// El check se guarda aparte (no solo en el DOM) para que no se
// pierda al filtrar con el buscador -- un producto elegido sigue
// elegido aunque se filtre de la vista y luego vuelva a aparecer.
function toggleProductoConsulta(id, marcado) {
  if (marcado) PRODUCTOS_SELECCIONADOS_CONSULTA.add(id);
  else PRODUCTOS_SELECCIONADOS_CONSULTA.delete(id);
}

function filtrarListaProductosConsulta() {
  const texto = (document.getElementById('cpu-buscar-producto')?.value || '').toLowerCase();
  const filtrados = TODOS_LOS_PRODUCTOS_CONSULTA.filter(p => (p.nombre||'').toLowerCase().includes(texto));
  renderListaProductosConsulta(filtrados);
}

// Misma fórmula segura que ya usa todayISO() -- SIEMPRE con
// getFullYear/getMonth/getDate (hora local real del navegador),
// nunca con .toISOString() (que convierte a UTC y puede correr la
// fecha un día, sobre todo de noche en Nicaragua).
function fechaLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// BUG REAL CORREGIDO: la columna "fecha" es timestamptz -- algunas
// ventas se guardan a la hora exacta (ej. "2026-08-26 21:31:15"), no
// a medianoche. Filtrar con .lte('fecha', '2026-08-26') se traduce a
// "hasta las 00:00:00 de ese día EXACTO", excluyendo cualquier venta
// hecha despues de medianoche ese mismo día -- justo el caso de una
// venta reciente de "hoy". La forma correcta: pedir ESTRICTAMENTE
// MENOS que el dia SIGUIENTE (limite exclusivo), que sí cubre todo
// el día completo sin importar la hora exacta guardada.
function siguienteDiaISO(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  const siguiente = new Date(anio, mes - 1, dia + 1);
  return fechaLocalISO(siguiente);
}

function calcularRangoFechas(preset) {
  const hoy = new Date();
  const hoyISO = fechaLocalISO(hoy);

  if (preset === 'ayer') {
    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    const ayerISO = fechaLocalISO(ayer);
    return { desde: ayerISO, hasta: ayerISO };
  }
  if (preset === 'semana') {
    // Semana actual: de este lunes a hoy (no la semana completa si
    // aún faltan días por pasar).
    const diaSemana = hoy.getDay(); // 0=domingo … 6=sabado
    const diasDesdeLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunes = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - diasDesdeLunes);
    return { desde: fechaLocalISO(lunes), hasta: hoyISO };
  }
  if (preset === 'mes') {
    const inicioMes = hoyISO.slice(0,7) + '-01';
    const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); // día 0 del mes siguiente = último día real de este mes
    return { desde: inicioMes, hasta: fechaLocalISO(finMes) };
  }
  if (preset === 'personalizado') {
    // El usuario elige libremente -- puede ser una sola fecha
    // especifica (desde=hasta) o un periodo completo. Si por
    // cualquier motivo un campo esta vacio, se usa hoy como
    // respaldo seguro, para nunca mandar una fecha invalida.
    const desdeInput = document.getElementById('cpu-personalizado-desde')?.value || hoyISO;
    const hastaInput = document.getElementById('cpu-personalizado-hasta')?.value || hoyISO;
    // Si "hasta" quedo antes que "desde" por error del usuario, se
    // intercambian -- nunca se manda un rango invertido a la consulta.
    return desdeInput <= hastaInput ? { desde: desdeInput, hasta: hastaInput } : { desde: hastaInput, hasta: desdeInput };
  }
  // 'hoy' (por defecto)
  return { desde: hoyISO, hasta: hoyISO };
}

let PERIODO_CONSULTA_ACTUAL = 'hoy';

function elegirPeriodoConsulta(preset) {
  PERIODO_CONSULTA_ACTUAL = preset;
  ['hoy','ayer','semana','mes','personalizado'].forEach(p => {
    document.getElementById(`cpu-periodo-${p}`)?.classList.toggle('active', p === preset);
  });

  const wrapFechas = document.getElementById('cpu-personalizado-fechas');
  if (wrapFechas) wrapFechas.style.display = preset === 'personalizado' ? 'flex' : 'none';

  // Al entrar recién a "Personalizado", si los campos están vacíos se
  // sugiere el día de hoy en ambos — el usuario los ajusta desde ahí,
  // en vez de empezar con un campo vacío que no significa nada todavía.
  if (preset === 'personalizado') {
    const hoyISO = fechaLocalISO(new Date());
    const desdeInput = document.getElementById('cpu-personalizado-desde');
    const hastaInput = document.getElementById('cpu-personalizado-hasta');
    if (desdeInput && !desdeInput.value) desdeInput.value = hoyISO;
    if (hastaInput && !hastaInput.value) hastaInput.value = hoyISO;
  }

  const { desde, hasta } = calcularRangoFechas(preset);
  const texto = document.getElementById('cpu-rango-texto');
  if (texto) {
    texto.textContent = desde === hasta
      ? `Del ${fmtFecha(desde)}`
      : `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}`;
  }
}

// Se llama cada vez que el usuario cambia manualmente "Desde" o
// "Hasta" en modo Personalizado -- solo actualiza el texto de vista
// previa, la consulta real se recalcula al presionar "Consultar".
function onCambiarFechaPersonalizada() {
  const { desde, hasta } = calcularRangoFechas('personalizado');
  const texto = document.getElementById('cpu-rango-texto');
  if (texto) {
    texto.textContent = desde === hasta
      ? `Del ${fmtFecha(desde)}`
      : `Del ${fmtFecha(desde)} al ${fmtFecha(hasta)}`;
  }
}

async function consultarProductoPorUsuario() {
  const idsProductos = [...PRODUCTOS_SELECCIONADOS_CONSULTA];
  const usuario = document.getElementById('cpu-usuario')?.value;
  const resultDiv = document.getElementById('cpu-resultado');
  if (!resultDiv) return;

  if (!idsProductos.length || !usuario) {
    resultDiv.innerHTML = '<p style="color:var(--text-muted);padding:12px 0;margin:0">Marca uno o varios productos y elige un usuario.</p>';
    return;
  }

  resultDiv.innerHTML = '<p style="padding:12px 0;margin:0;color:var(--text-muted)">Calculando…</p>';

  try {
    const { desde, hasta } = calcularRangoFechas(PERIODO_CONSULTA_ACTUAL);

    const { data: ventas } = await sbClient.from('ventas')
      .select('id').eq('auth_user_id', STATE.userId).eq('estado','completada')
      .eq('creado_por_nombre', usuario).gte('fecha', desde).lt('fecha', siguienteDiaISO(hasta));

    if (!ventas || !ventas.length) {
      resultDiv.innerHTML = `<p style="padding:12px 0;margin:0">No hay ventas de <b>${esc(usuario)}</b> con usuario asignado en ese período — puede que no haya vendido nada, o que esas ventas sean de antes de que este seguimiento se activara.</p>`;
      return;
    }

    // Una sola consulta trae los detalles de TODOS los productos
    // elegidos a la vez, sin importar cuantos sean.
    const idsVentas = ventas.map(v => v.id);
    const { data: detalles } = await sbClient.from('venta_detalles')
      .select('producto_id, cantidad, subtotal')
      .in('venta_id', idsVentas).in('producto_id', idsProductos);

    const porProducto = {};
    (detalles||[]).forEach(d => {
      const acc = (porProducto[d.producto_id] ||= { cantidad:0, monto:0 });
      acc.cantidad += Number(d.cantidad)||0;
      acc.monto += Number(d.subtotal)||0;
    });

    const nombresPorId = Object.fromEntries(TODOS_LOS_PRODUCTOS_CONSULTA.map(p => [p.id, p.nombre]));
    const filas = idsProductos
      .map(id => ({ nombre: nombresPorId[id] || '—', cantidad: (porProducto[id]?.cantidad)||0, monto: (porProducto[id]?.monto)||0 }))
      .sort((a,b) => b.cantidad - a.cantidad);

    const totalGeneral = filas.reduce((s,f) => s + f.monto, 0);

    resultDiv.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Monto</th></tr></thead>
          <tbody>
            ${filas.map(f => `<tr><td>${esc(f.nombre)}</td><td style="text-align:right">${fmtNum(f.cantidad)}</td><td style="text-align:right">${fmtMonto(f.monto)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="padding:10px 4px 0;font-weight:600;font-size:13.5px">Total: ${fmtMonto(totalGeneral)}</div>`;
  } catch (e) {
    console.error('consultarProductoPorUsuario:', e);
    resultDiv.innerHTML = '<p style="color:var(--danger);padding:12px 0;margin:0">No se pudo calcular, intenta de nuevo.</p>';
  }
}

async function cargarUsuariosParaFiltroVentas() {
  try {
    // Se traen TODOS los perfiles de personal registrados (activos),
    // no solo los que ya tienen alguna venta -- así aparece cualquier
    // usuario aunque todavía no haya vendido nada, mostrando 0.
    const { data: perfiles } = await sbClient.from('perfiles_acceso')
      .select('nombre').eq('auth_user_id', STATE.userId).eq('activo', true);
    const nombres = [...new Set((perfiles||[]).map(p => p.nombre).filter(Boolean))].sort();

    const sel = document.getElementById('vpu-filtro-usuario');
    if (!sel) return;
    const valorActual = sel.value;
    sel.innerHTML = '<option value="">Todos los usuarios</option>' +
      nombres.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = valorActual;
    cargarVentasPorUsuario();
  } catch (e) { console.warn('cargarUsuariosParaFiltroVentas:', e); }
}

async function cargarVentasPorUsuario() {
  const usuarioElegido = document.getElementById('vpu-filtro-usuario')?.value || '';
  const tbody = document.getElementById('vpu-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Cargando…</td></tr>';

  try {
    const hoy = todayISO();
    const inicioMes = hoy.slice(0,7) + '-01';

    let qMes = sbClient.from('ventas').select('id, numero_venta, fecha, total, created_at')
      .eq('auth_user_id', STATE.userId).eq('estado','completada').gte('fecha', inicioMes).order('created_at',{ascending:false});
    if (usuarioElegido) qMes = qMes.eq('creado_por_nombre', usuarioElegido);
    const { data: ventasMes } = await qMes;

    const totalMes = (ventasMes||[]).reduce((s,v) => s + (Number(v.total)||0), 0);
    const totalHoy = (ventasMes||[]).filter(v => (v.fecha||'').slice(0,10) === hoy).reduce((s,v) => s + (Number(v.total)||0), 0);

    document.getElementById('vpu-total-hoy').textContent = fmtMonto(totalHoy);
    document.getElementById('vpu-total-mes').textContent = fmtMonto(totalMes);

    if (!ventasMes || !ventasMes.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted)">Sin ventas este mes' + (usuarioElegido ? ' para este usuario' : '') + '</td></tr>';
      return;
    }

    // Traer los productos de todas estas ventas de una sola vez
    const idsVentas = ventasMes.map(v => v.id);
    const { data: detalles } = await sbClient.from('venta_detalles')
      .select('venta_id, producto_nombre, cantidad, subtotal').in('venta_id', idsVentas).order('created_at');
    const detallesPorVenta = {};
    (detalles||[]).forEach(d => { (detallesPorVenta[d.venta_id] ||= []).push(d); });

    // Una fila por CADA producto, no una fila por venta -- si una
    // venta tiene 3 productos, salen 3 filas, con la fecha/hora/N°
    // venta repetidos para dar contexto.
    tbody.innerHTML = ventasMes.map(v => {
      const items = detallesPorVenta[v.id] || [];
      if (!items.length) {
        return `<tr>
          <td>${fmtFecha(v.fecha)}</td><td>${fmtHora(v.created_at || v.fecha)}</td><td>${esc(v.numero_venta)}</td>
          <td>—</td><td>—</td><td style="text-align:right;font-weight:600">${fmtMonto(v.total)}</td>
        </tr>`;
      }
      return items.map((d) => `<tr>
        <td>${fmtFecha(v.fecha)}</td>
        <td>${fmtHora(v.created_at || v.fecha)}</td>
        <td>${esc(v.numero_venta)}</td>
        <td>${fmtNum(d.cantidad)}</td>
        <td style="max-width:220px;white-space:normal">${esc(d.producto_nombre)}</td>
        <td style="text-align:right">${fmtMonto(d.subtotal)}</td>
      </tr>`).join('');
    }).join('');
  } catch (e) {
    console.error('cargarVentasPorUsuario:', e);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--danger)">No se pudo cargar</td></tr>';
  }
}

function fmtMonto(n) {
  const sym = STATE.empresaConfig?.moneda || 'C$';
  return `${sym} ${Number(n||0).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbClient.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || data.nombre || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      if (data.color_principal || data.color_primario) {
        const col = data.color_principal || data.color_primario;
        document.documentElement.style.setProperty('--accent', col);
        document.documentElement.style.setProperty('--accent-soft', col + '22');
        document.documentElement.style.setProperty('--border-focus', col);
      }
      if (data.logo_principal_url || data.logo_url) {
        const li = document.querySelector('.logo-icon');
        if (li) li.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sbClient.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { console.warn('loadUserProfile:', e); return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const biz  = STATE.empresaConfig?.nombre_comercial || 'Mi negocio';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hBiz  = document.getElementById('header-biz');  if (hBiz)  hBiz.textContent  = biz;
  const hAv   = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sbClient.from('administradores').select('email, activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const nav = document.getElementById('nav-admin'); if (nav) nav.style.display = 'flex'; }
  } catch (e) { /* silencioso */ }
}

/* =====================================================
   CARGA DE LA BITÁCORA
===================================================== */
function rangoFechasPorDefecto() {
  const desdeEl = document.getElementById('aud-fecha-desde');
  const hastaEl = document.getElementById('aud-fecha-hasta');
  if (desdeEl && !desdeEl.value) {
    const hace30 = new Date(); hace30.setDate(hace30.getDate() - 30);
    desdeEl.value = `${hace30.getFullYear()}-${String(hace30.getMonth()+1).padStart(2,'0')}-${String(hace30.getDate()).padStart(2,'0')}`;
  }
  if (hastaEl && !hastaEl.value) hastaEl.value = todayISO();
}

// Convierte una fecha "YYYY-MM-DD" (elegida en el filtro, en hora LOCAL)
// al instante UTC real de su inicio o fin de día — así la comparación
// contra created_at (guardado en UTC) siempre cae en el día correcto,
// sin importar el huso horario del navegador. Sin esto, cualquier
// movimiento después de las 6pm en Nicaragua (UTC-6) queda con fecha
// UTC del día siguiente y el filtro "hasta hoy" lo excluía.
function limiteDiaLocalISO(fechaStr, finDelDia) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = finDelDia
    ? new Date(y, m - 1, d, 23, 59, 59, 999)
    : new Date(y, m - 1, d, 0, 0, 0, 0);
  return dt.toISOString();
}

async function cargarAuditoria() {
  const tbody = document.getElementById('aud-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">Cargando auditoría…</td></tr>`;
  try {
    const desde = document.getElementById('aud-fecha-desde')?.value;
    const hasta = document.getElementById('aud-fecha-hasta')?.value;

    let q = sbClient.from('auditoria_log').select('*')
      .eq('auth_user_id', STATE.userId)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (desde) q = q.gte('created_at', limiteDiaLocalISO(desde, false));
    if (hasta) q = q.lte('created_at', limiteDiaLocalISO(hasta, true));

    const { data, error } = await q;
    if (error) throw error;

    STATE.logs = data || [];
    // Un solo clic del usuario (ej. "Registrar venta") suele generar VARIAS
    // escrituras internas (venta, detalle, caja, impuestos…). Se agrupan en
    // UN solo evento para que se lea "Luis vendió esto", no 5 líneas técnicas.
    STATE.eventos = agruparEventos(STATE.logs);
    STATE.page = 1;
    poblarFiltrosAud();
    renderTablaAud();
    renderKPIsAud();
  } catch (e) {
    console.error('cargarAuditoria:', e);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No se pudo cargar la auditoría</td></tr>`;
  }
}

// Llena los selects de "Usuario" y "Módulo" con los valores que
// realmente aparecen en el rango cargado (evita listas gigantes con
// opciones que nunca tendrían resultados).
function poblarFiltrosAud() {
  const selUsuario = document.getElementById('aud-filtro-usuario');
  const selModulo  = document.getElementById('aud-filtro-modulo');
  if (!selUsuario || !selModulo) return;

  const usuarios = [...new Set(STATE.eventos.map(l => l.perfil_nombre).filter(Boolean))].sort();
  const modulos  = [...new Set(STATE.eventos.map(l => l.modulo).filter(Boolean))].sort();

  const valUsuarioActual = selUsuario.value;
  selUsuario.innerHTML = `<option value="">Todos los usuarios</option>` +
    usuarios.map(u => `<option value="${esc(u)}">${esc(u)}</option>`).join('');
  if (usuarios.includes(valUsuarioActual)) selUsuario.value = valUsuarioActual;

  const valModuloActual = selModulo.value;
  selModulo.innerHTML = `<option value="">Todos los módulos</option>` +
    modulos.map(m => `<option value="${esc(m)}">${esc(labelModulo(m))}</option>`).join('');
  if (modulos.includes(valModuloActual)) selModulo.value = valModuloActual;
}

/* =====================================================
   AGRUPAR ESCRITURAS TÉCNICAS EN UN SOLO EVENTO DE NEGOCIO
   Una sola acción del usuario (ej. registrar una venta) casi
   siempre dispara varias escrituras: la venta, sus líneas, el
   movimiento de caja, el impuesto, el contador del cliente…
   Cada una queda en auditoria_log por separado (así funciona el
   interceptor genérico, sin que ningún módulo tenga que avisar
   nada). Aquí, solo para MOSTRAR, se agrupan las escrituras del
   MISMO usuario + MISMO módulo que ocurren a pocos segundos de
   diferencia, y se elige la más representativa (la tabla
   "principal" de esa operación) para redactar UNA sola frase.
   ===================================================== */
// Tablas que representan la acción principal que le importa al
// dueño del negocio. Las que no están aquí (detalles, caja,
// impuestos, cuotas, etc.) solo se usan como respaldo si no hay
// ninguna tabla principal en el mismo grupo.
const TABLA_INFO = {
  ventas:                     { nombre: 'una venta',                 principal: true,  crear: 'vendió' },
  compras:                    { nombre: 'una compra',                principal: true,  crear: 'compró' },
  clientes:                   { nombre: 'un cliente',                principal: true,  crear: 'registró un cliente' },
  productos:                  { nombre: 'un producto/servicio',      principal: true,  crear: 'agregó un producto/servicio' },
  gastos:                     { nombre: 'un gasto',                  principal: true,  crear: 'registró un gasto' },
  proveedores:                { nombre: 'un proveedor',              principal: true,  crear: 'registró un proveedor' },
  creditos:                   { nombre: 'un crédito',                principal: true,  crear: 'creó un crédito' },
  creditos_pagos:             { nombre: 'un pago de crédito',        principal: true,  crear: 'cobró un pago de crédito' },
  cuentas_por_pagar:          { nombre: 'una cuenta por pagar',      principal: true,  crear: 'registró una compra a crédito' },
  cuentas_por_pagar_pagos:    { nombre: 'un pago a proveedor',       principal: true,  crear: 'pagó a un proveedor' },
  empleados:                  { nombre: 'un empleado',               principal: true,  crear: 'registró un empleado' },
  empleados_pagos:            { nombre: 'un pago de salario',        principal: true,  crear: 'pagó un salario' },
  empleados_adelantos:        { nombre: 'un adelanto de salario',    principal: true,  crear: 'registró un adelanto' },
  configuracion_empresa:      { nombre: 'la configuración del negocio', principal: true, crear: 'ajustó la configuración' },
  metodos_pago:               { nombre: 'un método de pago',         principal: true,  crear: 'agregó un método de pago' },
  impuestos:                  { nombre: 'un impuesto',               principal: true,  crear: 'agregó un impuesto' },
  notificaciones:             { nombre: 'una notificación',          principal: true,  crear: 'publicó una notificación' },
  anuncios_sistema:           { nombre: 'un anuncio',                principal: true,  crear: 'publicó un anuncio' },
  // Secundarias: efecto de la acción principal, no se muestran si ya
  // hay una tabla principal en el mismo grupo.
  venta_detalles:             { nombre: 'un detalle de venta' },
  detalle_compras:            { nombre: 'un detalle de compra' },
  creditos_cuotas:            { nombre: 'una cuota de crédito' },
  cuentas_por_pagar_cuotas:   { nombre: 'una cuota de cuenta por pagar' },
  movimientos_financieros:    { nombre: 'un movimiento de caja' },
  movimientos_impuestos:      { nombre: 'un movimiento de impuestos' },
  pagos_clientes_recurrentes: { nombre: 'un pago recurrente' },
};
const VERBO_ACCION = { INSERT: 'creó', UPDATE: 'editó', DELETE: 'eliminó' };
const VENTANA_AGRUPACION_MS = 6000; // escrituras a ≤6s de la anterior = mismo evento

function infoTabla(tabla) {
  return TABLA_INFO[tabla] || { nombre: tabla };
}

// Redacta la frase final: "vendió (numero_venta: V-1, total: 100)",
// "editó un cliente (nombre: Ana)", "eliminó un gasto", etc.
function fraseEvento(ev) {
  const info = infoTabla(ev.tabla);
  let verbo;
  if (ev.accion === 'INSERT' && info.crear) verbo = info.crear;
  else verbo = `${VERBO_ACCION[ev.accion] || ev.accion.toLowerCase()} ${info.nombre}`;
  return ev.resumen ? `${verbo} — ${ev.resumen}` : verbo;
}

// STATE.logs viene ordenado por created_at DESC (el más reciente primero).
function agruparEventos(logs) {
  const eventos = [];
  let grupo = null;
  let tUltimo = null;
  for (const l of logs) {
    const t = new Date(l.created_at).getTime();
    if (grupo && grupo.perfil_nombre === l.perfil_nombre && grupo.modulo === l.modulo &&
        Math.abs(tUltimo - t) <= VENTANA_AGRUPACION_MS) {
      grupo._entradas.push(l);
    } else {
      if (grupo) eventos.push(cerrarGrupoEvento(grupo));
      grupo = { perfil_nombre: l.perfil_nombre, perfil_tipo: l.perfil_tipo, modulo: l.modulo, created_at: l.created_at, _entradas: [l] };
    }
    tUltimo = t;
  }
  if (grupo) eventos.push(cerrarGrupoEvento(grupo));
  return eventos;
}

function cerrarGrupoEvento(g) {
  const entradas = g._entradas;
  const mejor =
    entradas.find(e => infoTabla(e.tabla).principal && e.accion === 'INSERT') ||
    entradas.find(e => infoTabla(e.tabla).principal) ||
    entradas[0];
  return {
    created_at: g.created_at,
    perfil_nombre: g.perfil_nombre,
    perfil_tipo: g.perfil_tipo,
    modulo: g.modulo,
    tabla: mejor.tabla,
    accion: mejor.accion,
    resumen: mejor.resumen,
    cantidadEscrituras: entradas.length,
  };
}

/* =====================================================
   FILTROS / BÚSQUEDA / TABLA
===================================================== */
function eventosFiltrados() {
  const q = STATE.search.toLowerCase().trim();
  return STATE.eventos.filter(ev => {
    if (STATE.filtro !== 'todos' && ev.accion !== STATE.filtro) return false;
    if (STATE.filtroUsuario && ev.perfil_nombre !== STATE.filtroUsuario) return false;
    if (STATE.filtroModulo && ev.modulo !== STATE.filtroModulo) return false;
    if (!q) return true;
    return fraseEvento(ev).toLowerCase().includes(q);
  });
}

function renderTablaAud() {
  const tbody = document.getElementById('aud-tbody');
  if (!tbody) return;
  const filtrados = eventosFiltrados();
  const totalPag = Math.max(1, Math.ceil(filtrados.length / STATE.perPage));
  STATE.page = Math.min(STATE.page, totalPag);
  const inicio = (STATE.page-1)*STATE.perPage;
  const pagina = filtrados.slice(inicio, inicio+STATE.perPage);

  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No hay movimientos con estos filtros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(ev => `
      <tr>
        <td>${fmtFecha(ev.created_at)}</td>
        <td style="font-family:var(--font-mono);font-size:12.5px">${fmtHora(ev.created_at)}</td>
        <td style="font-weight:500">${esc(ev.perfil_nombre)}${ev.perfil_tipo==='admin'?' <span style="font-size:10px;color:var(--text-muted)">(admin)</span>':''}</td>
        <td>${esc(labelModulo(ev.modulo))}</td>
        <td style="font-size:13px;color:var(--text-secondary)">${esc(fraseEvento(ev))}</td>
      </tr>`).join('');
  }

  const info = document.getElementById('paginacion-info');
  if (info) info.textContent = filtrados.length ? `${inicio+1}–${Math.min(inicio+STATE.perPage,filtrados.length)} de ${filtrados.length}` : '—';
  const prev = document.getElementById('btn-pag-prev'); if (prev) prev.disabled = STATE.page<=1;
  const next = document.getElementById('btn-pag-next'); if (next) next.disabled = STATE.page>=totalPag;
}

function setFiltroAud(f) {
  STATE.filtro = f; STATE.page = 1;
  document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===f));
  renderTablaAud();
}
function filtrarPorSelectAud() {
  STATE.filtroUsuario = document.getElementById('aud-filtro-usuario')?.value || '';
  STATE.filtroModulo  = document.getElementById('aud-filtro-modulo')?.value || '';
  STATE.page = 1;
  renderTablaAud();
}
function buscarAud() { STATE.search = document.getElementById('aud-search')?.value || ''; STATE.page = 1; renderTablaAud(); }
function paginaAnterior() { if (STATE.page>1) { STATE.page--; renderTablaAud(); } }
function paginaSiguiente() { STATE.page++; renderTablaAud(); }

/* =====================================================
   KPIs
===================================================== */
// Compara si un timestamp (guardado en UTC) cae HOY en la fecha
// LOCAL del navegador — evita el mismo problema de huso horario
// que el filtro de fechas.
function esHoyLocal(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
}

function renderKPIsAud() {
  const deHoy = STATE.eventos.filter(ev => esHoyLocal(ev.created_at));
  const usuariosHoy = new Set(deHoy.map(ev => ev.perfil_nombre)).size;
  const ultimo = STATE.eventos[0]; // ya viene ordenado desc

  const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('kpi-hoy', fmtNum(deHoy.length));
  set('kpi-mes', fmtNum(STATE.eventos.length));
  set('kpi-usuarios', fmtNum(usuariosHoy));
  set('kpi-ultimo', ultimo ? `${esc(ultimo.perfil_nombre)} · ${fmtHora(ultimo.created_at)}` : '—');
}

/* =====================================================
   INIT — requiere el código de administrador para entrar
===================================================== */
async function initAuditoria() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);

  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sbClient.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id; STATE.userEmail = user.email;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    const mostrarApp = () => {
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
      rangoFechasPorDefecto();
      cargarAuditoria();
      cargarUsuariosParaFiltroVentas();
      cargarResumenMensual();
      cargarOpcionesConsultaProducto();
    };

    // Auditoría SIEMPRE exige el código de administrador, sin importar
    // qué perfil haya iniciado sesión (igual que Configuración). Si
    // perfiles-guard.js no cargó por algún motivo, no se bloquea el
    // acceso del dueño por un fallo externo.
    if (window.PerfilesGuardConfig) {
      window.PerfilesGuardConfig.requerirCodigoAdmin(mostrarApp);
    } else {
      mostrarApp();
    }
  } catch (err) {
    console.error('initAuditoria:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbClient.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  initAuditoria();
  if (window.lucide) lucide.createIcons();
});
