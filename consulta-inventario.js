/* =====================================================
   CONSULTA-INVENTARIO.JS — NEGOCIO360
   Busca cualquier producto/servicio por nombre, SKU o código de
   barras, y muestra cómo está repartido entre TODA la Central,
   sucursales y bodegas del mismo grupo — reutilizando el mismo
   mecanismo ya probado de Reporte General (reporte-grupo-shim.js +
   la función obtener_datos_grupo() de la base de datos).

   Si la cuenta no tiene ninguna sucursal/bodega, simplemente muestra
   su propia información — funciona igual para todos.
===================================================== */

'use strict';

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sbReal = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
// Envuelto con el adaptador de grupo — sb.from('productos') ya trae
// combinados los productos de toda la Central + sucursales + bodegas.
const sb = crearClienteGrupo(sbReal);

let STATE = {
  userId: null, empresaConfig: {}, currentUser: {},
  productos: [], cuentas: [], mapaCuentas: {},
  itemSeleccionado: null,
};

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(n) {
  const v = parseFloat(n || 0), sym = STATE.empresaConfig?.moneda_simbolo || STATE.empresaConfig?.moneda || 'C$';
  return `${sym} ${v.toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtNum(n) { return Number(n || 0).toLocaleString('es-NI', { maximumFractionDigits: 2 }); }

/* =====================================================
   THEME / SIDEBAR (idéntico al resto del sistema)
===================================================== */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('n360_theme', theme);
  const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
  if (sun) sun.style.display = theme === 'dark' ? 'block' : 'none';
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

async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sbReal.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text');
      if (lt) lt.textContent = bizName;
      const col = data.color_principal || data.color_primario;
      if (col) {
        document.documentElement.style.setProperty('--accent', col);
        document.documentElement.style.setProperty('--accent-soft', col + '22');
      }
    }
  } catch (e) { console.warn('loadEmpresaConfig:', e); }
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sbReal.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hBiz  = document.getElementById('header-biz');  if (hBiz)  hBiz.textContent  = STATE.empresaConfig?.nombre_comercial || 'Mi negocio';
  const hAv   = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name || 'U')[0].toUpperCase();
}
async function checkAdminAccess(email) {
  try {
    const { data } = await sbReal.from('administradores').select('email, activo').eq('email', email).eq('activo', true).maybeSingle();
    if (data) { const nav = document.getElementById('nav-admin'); if (nav) nav.style.display = 'flex'; }
  } catch (e) { /* silencioso */ }
}

/* =====================================================
   CARGA DE DATOS (una sola vez): productos de todo el grupo, y el
   nombre de cada cuenta (sucursal/bodega/Central) para mostrarlo.
===================================================== */
async function cargarTodo() {
  const { data: productos, error } = await sb.from('productos').select('*');
  if (error) { console.error('cargarTodo productos:', error); STATE.productos = []; return; }
  STATE.productos = productos || [];

  try {
    const { data: grupo } = await sb.rpc('listar_sucursales_grupo');
    STATE.cuentas = grupo || [];
    // Igual que en Reporte General: mapear "id de la fila en
    // sucursales" -> "auth_user_id real", en solo lectura.
    const { data: filas } = await sbReal.from('sucursales')
      .select('id, auth_user_id_central, auth_user_id_sucursal, es_central')
      .or(`auth_user_id_central.eq.${STATE.userId},auth_user_id_sucursal.eq.${STATE.userId}`);
    (filas || []).forEach(f => { STATE.mapaCuentas[f.auth_user_id_sucursal] = f; });
  } catch (e) {
    console.warn('cargarTodo grupo:', e);
    STATE.cuentas = [];
  }
}

function nombreDeCuenta(authUserId) {
  const fila = STATE.mapaCuentas[authUserId];
  if (fila) {
    const infoGrupo = (STATE.cuentas || []).find(c => c.id === fila.id);
    if (infoGrupo) return { nombre: infoGrupo.nombre, tipo: infoGrupo.tipo, esCentral: infoGrupo.es_central };
  }
  return { nombre: 'Esta cuenta', tipo: 'sucursal', esCentral: authUserId === STATE.userId };
}

/* =====================================================
   BUSCADORES
===================================================== */
function agruparPorNombre() {
  const grupos = {};
  STATE.productos.forEach(p => {
    const clave = (p.nombre || '').trim().toLowerCase();
    if (!clave) return;
    if (!grupos[clave]) grupos[clave] = [];
    grupos[clave].push(p);
  });
  return grupos;
}

function buscarPorNombre(q) {
  const cont = document.getElementById('ci-resultados');
  document.getElementById('ci-clear-nombre').classList.toggle('visible', !!q);
  q = (q || '').trim().toLowerCase();
  if (!q) { cont.style.display = 'none'; cont.innerHTML = ''; return; }

  const grupos = agruparPorNombre();
  const coincidencias = Object.keys(grupos)
    .filter(clave => clave.includes(q) || grupos[clave].some(p => (p.sku || '').toLowerCase().includes(q)))
    .slice(0, 12);

  if (!coincidencias.length) {
    cont.style.display = 'block';
    cont.innerHTML = `<div class="ci-sri" style="color:var(--text-muted);cursor:default">Sin resultados</div>`;
    return;
  }
  cont.style.display = 'block';
  cont.innerHTML = coincidencias.map(clave => {
    const filas = grupos[clave];
    const nombreReal = filas[0].nombre;
    const esProducto = filas[0].tipo === 'producto';
    const totalStock = esProducto ? filas.reduce((s, p) => s + Number(p.stock_actual || 0), 0) : null;
    return `<div class="ci-sri" onclick="seleccionarItem('${esc(clave).replace(/'/g,"\\'")}')">
      <strong>${esc(nombreReal)}</strong>
      <div style="font-size:11.5px;color:var(--text-muted)">
        ${esProducto ? `Stock total: ${fmtNum(totalStock)} · ` : 'Servicio · '}${filas.length} registro(s) en el grupo
      </div>
    </div>`;
  }).join('');
}

function limpiarBusquedaNombre() {
  document.getElementById('ci-buscar-nombre').value = '';
  document.getElementById('ci-clear-nombre').classList.remove('visible');
  document.getElementById('ci-resultados').style.display = 'none';
}
function limpiarBusquedaCodigo() {
  document.getElementById('ci-buscar-codigo').value = '';
  document.getElementById('ci-clear-codigo').classList.remove('visible');
}

function seleccionarItem(clave) {
  const grupos = agruparPorNombre();
  const filas = grupos[clave];
  if (!filas) return;
  limpiarBusquedaNombre();
  mostrarDetalle(filas);
}

/* =====================================================
   DETALLE DEL PRODUCTO/SERVICIO SELECCIONADO
===================================================== */
function mostrarDetalle(filas) {
  document.getElementById('ci-vacio').style.display = 'none';
  const wrap = document.getElementById('ci-detalle-wrap');
  wrap.style.display = 'block';

  const nombre = filas[0].nombre;
  const esProducto = filas[0].tipo === 'producto';
  const precios = filas.map(p => Number(p.precio || 0)).filter(v => v > 0);
  const precioMin = precios.length ? Math.min(...precios) : 0;
  const precioMax = precios.length ? Math.max(...precios) : 0;

  const filasConCuenta = filas.map(p => ({ ...p, _cuenta: nombreDeCuenta(p.auth_user_id) }))
    .sort((a, b) => (b.es_central === a.es_central ? 0 : (a._cuenta.esCentral ? -1 : 1)));

  const totalStock = esProducto ? filas.reduce((s, p) => s + Number(p.stock_actual || 0), 0) : null;
  const valorTotalInventario = esProducto ? filas.reduce((s, p) => s + Number(p.stock_actual || 0) * Number(p.costo || 0), 0) : null;

  const filasHtml = filasConCuenta.map(p => `
    <tr>
      <td style="font-weight:600">${p._cuenta.tipo === 'bodega' ? '📦' : (p._cuenta.esCentral ? '🏠' : '🏬')} ${esc(p._cuenta.nombre)}</td>
      ${esProducto ? `<td>${fmtNum(p.stock_actual)}</td><td>${fmt(p.costo)}</td>` : ''}
      <td>${fmt(p.precio)}</td>
      <td><span class="status-badge ${p.activo !== false ? 'badge-activo' : 'badge-inactivo'}">${p.activo !== false ? 'Activo' : 'Inactivo'}</span></td>
    </tr>`).join('');

  // ---- Análisis, comentarios y consejos ----
  let consejos = '';
  if (esProducto) {
    const conStock = filasConCuenta.filter(p => Number(p.stock_actual || 0) > 0);
    const sinStock = filasConCuenta.filter(p => Number(p.stock_actual || 0) <= 0);
    if (sinStock.length && conStock.length) {
      const nombresConStock = conStock.map(p => p._cuenta.nombre).join(', ');
      const nombresSinStock = sinStock.map(p => p._cuenta.nombre).join(', ');
      consejos += `<div class="ci-consejo alerta">⚠️ <strong>${esc(nombresSinStock)}</strong> no tiene existencias de este producto, mientras que <strong>${esc(nombresConStock)}</strong> sí — considera usar "Mover productos" para repartirlo mejor.</div>`;
    }
    if (filasConCuenta.length > 1 && totalStock > 0) {
      const mayor = [...filasConCuenta].sort((a,b)=>Number(b.stock_actual||0)-Number(a.stock_actual||0))[0];
      const participacion = (Number(mayor.stock_actual||0) / totalStock * 100);
      if (participacion > 70) {
        consejos += `<div class="ci-consejo">📦 Casi todo el stock (${participacion.toFixed(0)}%) está concentrado en <strong>${esc(mayor._cuenta.nombre)}</strong> — si otra sucursal empieza a venderlo más, puede que necesite pedirle traslado a esta.</div>`;
      }
    }
    const minStockCfg = filas.find(p => p.stock_minimo > 0);
    if (minStockCfg && totalStock <= minStockCfg.stock_minimo) {
      consejos += `<div class="ci-consejo alerta">🔻 El stock total en todo el grupo (${fmtNum(totalStock)}) ya está en o por debajo del mínimo configurado (${fmtNum(minStockCfg.stock_minimo)}) — es buen momento para comprar más.</div>`;
    }
    if (totalStock === 0) {
      consejos += `<div class="ci-consejo alerta">❌ No queda ni una unidad de este producto en ninguna sucursal ni bodega del grupo.</div>`;
    }
  }
  if (precioMin > 0 && precioMax > 0 && precioMax > precioMin * 1.02) {
    consejos += `<div class="ci-consejo alerta">💲 El precio de este producto/servicio no es el mismo en todas las cuentas (va de ${fmt(precioMin)} a ${fmt(precioMax)}) — revisa si esa diferencia es intencional o hay que igualarla.</div>`;
  }
  if (!consejos) {
    consejos = `<div class="ci-consejo bien">✅ No encontramos ninguna alerta para este producto/servicio por ahora.</div>`;
  }

  document.getElementById('ci-detalle-body').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="font-size:18px;margin-bottom:2px">${esProducto ? '📦' : '🛠️'} ${esc(nombre)}</h2>
        <p style="font-size:12.5px;color:var(--text-muted)">Encontrado en <strong>${filas.length}</strong> cuenta(s) de tu grupo (Central, sucursales y/o bodegas)</p>
      </div>
      <button class="btn-secondary" onclick="cerrarDetalle()">✕ Cerrar</button>
    </div>

    <div class="ci-kpis">
      ${esProducto ? `
        <div class="ci-kpi"><div class="lbl">Stock total (todo el grupo)</div><div class="val">${fmtNum(totalStock)}</div></div>
        <div class="ci-kpi"><div class="lbl">Valor total de inventario</div><div class="val">${fmt(valorTotalInventario)}</div></div>
      ` : ''}
      <div class="ci-kpi"><div class="lbl">Precio</div><div class="val">${precioMin === precioMax ? fmt(precioMin) : `${fmt(precioMin)} – ${fmt(precioMax)}`}</div></div>
      <div class="ci-kpi"><div class="lbl">Registrado en</div><div class="val">${filas.length} cuenta(s)</div></div>
    </div>

    <div class="table-wrap">
      <table class="ci-tabla">
        <thead><tr><th>Cuenta</th>${esProducto ? '<th>Stock</th><th>Costo</th>' : ''}<th>Precio</th><th>Estado</th></tr></thead>
        <tbody>${filasHtml}</tbody>
      </table>
    </div>

    <h3 style="font-size:14.5px;margin:16px 0 8px">💬 Análisis y consejos</h3>
    ${consejos}

    <h3 style="font-size:14.5px;margin:20px 0 8px">📊 Ventas de este producto</h3>
    <div id="ci-ventas-filtros" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn-secondary btn-sm ci-vf-btn" data-periodo="hoy" onclick="cambiarPeriodoVentas('hoy')">Hoy</button>
      <button class="btn-secondary btn-sm ci-vf-btn" data-periodo="semana" onclick="cambiarPeriodoVentas('semana')">Esta semana</button>
      <button class="btn-secondary btn-sm ci-vf-btn active" data-periodo="mes" onclick="cambiarPeriodoVentas('mes')">Este mes</button>
      <button class="btn-secondary btn-sm ci-vf-btn" data-periodo="anio" onclick="cambiarPeriodoVentas('anio')">Este año</button>
      <button class="btn-secondary btn-sm ci-vf-btn" data-periodo="personalizado" onclick="cambiarPeriodoVentas('personalizado')">Personalizado</button>
      <input type="date" id="ci-ventas-desde" style="display:none;max-width:140px" onchange="recargarVentasPersonalizado()"/>
      <input type="date" id="ci-ventas-hasta" style="display:none;max-width:140px" onchange="recargarVentasPersonalizado()"/>
    </div>
    <div id="ci-ventas-seccion">Cargando ventas…</div>
  `;

  // Se guarda para poder recalcular al cambiar el período, sin tener
  // que volver a buscar el producto.
  STATE.filasDetalleActual = filas;
  cambiarPeriodoVentas('mes');
}

function cerrarDetalle() {
  document.getElementById('ci-detalle-wrap').style.display = 'none';
  document.getElementById('ci-vacio').style.display = 'block';
}

/* =====================================================
   VENTAS DE ESTE PRODUCTO — solo lectura, nunca modifica nada.
   Reutiliza el mismo cliente "sb" (crearClienteGrupo) que ya usa
   este archivo para productos — venta_detalles y ventas ya están
   habilitadas ahí, así que esto trae datos de TODO el grupo
   (Central + sucursales + bodegas) igual que el resto de la pantalla.
===================================================== */
function calcularRangoFechas(periodo) {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  const iso = (dt) => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  if (periodo === 'hoy') return { desde: iso(hoy), hasta: iso(hoy) };
  if (periodo === 'semana') {
    const diaSemana = hoy.getDay(); // 0=domingo
    const inicio = new Date(y, m, d - diaSemana);
    return { desde: iso(inicio), hasta: iso(hoy) };
  }
  if (periodo === 'mes') return { desde: iso(new Date(y, m, 1)), hasta: iso(hoy) };
  if (periodo === 'anio') return { desde: iso(new Date(y, 0, 1)), hasta: iso(hoy) };
  return null; // personalizado: se lee de los inputs
}

function cambiarPeriodoVentas(periodo) {
  document.querySelectorAll('.ci-vf-btn').forEach(b => b.classList.toggle('active', b.dataset.periodo === periodo));
  const inputDesde = document.getElementById('ci-ventas-desde');
  const inputHasta = document.getElementById('ci-ventas-hasta');

  if (periodo === 'personalizado') {
    inputDesde.style.display = ''; inputHasta.style.display = '';
    if (!inputDesde.value) inputDesde.value = calcularRangoFechas('mes').desde;
    if (!inputHasta.value) inputHasta.value = calcularRangoFechas('mes').hasta;
    cargarVentasDelProducto(STATE.filasDetalleActual, inputDesde.value, inputHasta.value);
    return;
  }
  inputDesde.style.display = 'none'; inputHasta.style.display = 'none';
  const { desde, hasta } = calcularRangoFechas(periodo);
  cargarVentasDelProducto(STATE.filasDetalleActual, desde, hasta);
}
function recargarVentasPersonalizado() {
  const desde = document.getElementById('ci-ventas-desde').value;
  const hasta = document.getElementById('ci-ventas-hasta').value;
  if (!desde || !hasta) return;
  cargarVentasDelProducto(STATE.filasDetalleActual, desde, hasta);
}

async function cargarVentasDelProducto(filas, desde, hasta) {
  const cont = document.getElementById('ci-ventas-seccion');
  if (!cont) return; // se cerró el detalle mientras cargaba
  cont.innerHTML = 'Calculando…';

  try {
    // Un mismo producto ("Camisa azul") puede tener un id DISTINTO en
    // cada cuenta del grupo — se buscan ventas de TODOS esos ids a la
    // vez, no solo el de la cuenta actual.
    const idsProducto = filas.map(p => p.id);

    const { data: detalles } = await sb.from('venta_detalles').select('*').in('producto_id', idsProducto);
    const { data: ventasTodas } = await sb.from('ventas').select('id, fecha, estado, auth_user_id');
    const mapaVentas = new Map((ventasTodas||[]).map(v => [v.id, v]));

    const filtrados = (detalles||[]).filter(d => {
      const venta = mapaVentas.get(d.venta_id);
      if (!venta || venta.estado !== 'completada') return false;
      const fechaVenta = String(venta.fecha).slice(0,10);
      return fechaVenta >= desde && fechaVenta <= hasta;
    });

    if (cont !== document.getElementById('ci-ventas-seccion')) return; // el usuario cambió de producto mientras cargaba

    if (!filtrados.length) {
      cont.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:10px">
        No se vendió nada de este producto en el período elegido.</div>`;
      return;
    }

    const unidadesVendidas = filtrados.reduce((s,d) => s + Number(d.cantidad||0), 0);
    const ingresoTotal = filtrados.reduce((s,d) => s + Number(d.subtotal||0), 0);
    const numVentasUnicas = new Set(filtrados.map(d => d.venta_id)).size;
    const precioPromedio = unidadesVendidas > 0 ? ingresoTotal / unidadesVendidas : 0;

    // Desglose por cuenta del grupo — igual que ya hace con el stock.
    const porCuenta = new Map();
    filtrados.forEach(d => {
      const venta = mapaVentas.get(d.venta_id);
      const cuentaInfo = nombreDeCuenta(venta.auth_user_id);
      const clave = venta.auth_user_id;
      const acc = porCuenta.get(clave) || { nombre: cuentaInfo.nombre, tipo: cuentaInfo.tipo, esCentral: cuentaInfo.esCentral, unidades: 0, ingreso: 0 };
      acc.unidades += Number(d.cantidad||0);
      acc.ingreso += Number(d.subtotal||0);
      porCuenta.set(clave, acc);
    });
    const filasCuenta = Array.from(porCuenta.values()).sort((a,b) => b.ingreso - a.ingreso);

    cont.innerHTML = `
      <div class="ci-kpis">
        <div class="ci-kpi"><div class="lbl">Unidades vendidas</div><div class="val">${fmtNum(unidadesVendidas)}</div></div>
        <div class="ci-kpi"><div class="lbl">Ingreso generado</div><div class="val">${fmt(ingresoTotal)}</div></div>
        <div class="ci-kpi"><div class="lbl">Ventas donde apareció</div><div class="val">${numVentasUnicas}</div></div>
        <div class="ci-kpi"><div class="lbl">Precio promedio de venta</div><div class="val">${fmt(precioPromedio)}</div></div>
      </div>
      <div class="table-wrap" style="margin-top:10px">
        <table class="ci-tabla">
          <thead><tr><th>Cuenta</th><th>Unidades</th><th>Ingreso</th></tr></thead>
          <tbody>${filasCuenta.map(c => `
            <tr>
              <td style="font-weight:600">${c.tipo==='bodega'?'📦':(c.esCentral?'🏠':'🏬')} ${esc(c.nombre)}</td>
              <td>${fmtNum(c.unidades)}</td>
              <td>${fmt(c.ingreso)}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch (e) {
    console.error('cargarVentasDelProducto:', e);
    if (cont === document.getElementById('ci-ventas-seccion')) {
      cont.innerHTML = `<div style="padding:14px;color:var(--danger);font-size:13px">No se pudo cargar el historial de ventas.</div>`;
    }
  }
}


/* =====================================================
   ESCÁNER DE CÓDIGO DE BARRAS
===================================================== */
function initEscaner() {
  const input = document.getElementById('ci-buscar-codigo');
  if (!input) return;
  input.addEventListener('input', () => {
    document.getElementById('ci-clear-codigo').classList.toggle('visible', !!input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const codigo = input.value.trim();
    if (!codigo) return;

    const coincidencias = STATE.productos.filter(p => (p.codigo_barras || '').trim() === codigo);
    input.value = '';
    document.getElementById('ci-clear-codigo').classList.remove('visible');

    if (!coincidencias.length) {
      showToast(`No se encontró ningún producto con el código "${esc(codigo)}"`);
      return;
    }
    // Se agrupa igual que en la búsqueda por nombre, para mostrar el
    // reparto completo de ESE producto (no solo la fila escaneada).
    const clave = (coincidencias[0].nombre || '').trim().toLowerCase();
    const grupos = agruparPorNombre();
    mostrarDetalle(grupos[clave] || coincidencias);
  });
}

function showToast(msg) {
  // Aviso simple, no bloqueante — este módulo no tiene un sistema de
  // toast propio todavía, así que se usa una alerta discreta.
  const existente = document.getElementById('ci-toast-simple');
  if (existente) existente.remove();
  const div = document.createElement('div');
  div.id = 'ci-toast-simple';
  div.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--text-primary);color:var(--bg-surface);padding:10px 18px;border-radius:10px;font-size:13px;z-index:999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

/* =====================================================
   INIT
===================================================== */
async function init() {
  const savedTheme = localStorage.getItem('n360_theme') || 'light';
  applyTheme(savedTheme);
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const { data: { user }, error } = await sbReal.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;
    if (user.email) checkAdminAccess(user.email);

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    await cargarTodo();
    initEscaner();
  } catch (err) {
    console.error('init consulta-inventario:', err);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

sbReal.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') window.location.href = 'login.html'; });

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});
