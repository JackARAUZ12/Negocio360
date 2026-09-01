/* =====================================================
   ASISTENTE.JS — NEGOCIO360
   Módulo aparte, dedicado al Asistente Inteligente. El dueño elige
   una pregunta rápida (botón) o escribe la suya, y el sistema
   responde con datos REALES de su negocio -- sin ninguna API
   externa, sin ningún costo, corriendo 100% aquí mismo.
===================================================== */

const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const sbClient = sb; // alias, la lógica del asistente se escribió usando este nombre

let STATE = { userId: null, empresaConfig: {}, currentUser: {} };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* =====================================================
   SHELL: TEMA, SIDEBAR, NAVEGACIÓN (idéntico al resto del sistema)
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

function openModal(id) { const el = document.getElementById(id); if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; } }
function closeModal(id) { const el = document.getElementById(id); if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; } }
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.className = `toast toast-${type === 'error' ? 'error' : 'success'} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* =====================================================
   INICIALIZACIÓN
===================================================== */
async function loadEmpresaConfig(userId) {
  try {
    const { data } = await sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.empresaConfig = data || {};
    if (data) {
      const bizName = data.nombre_comercial || data.nombre_negocio || 'Mi negocio';
      const lt = document.getElementById('sidebar-logo-text'); if (lt) lt.textContent = bizName;
    }
  } catch (e) {}
}
async function loadUserProfile(userId) {
  try {
    const { data } = await sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
    STATE.currentUser = data || {};
    return data;
  } catch (e) { return null; }
}
function renderUserInfo(profile, email) {
  const name = profile?.nombre || email?.split('@')[0] || 'Usuario';
  const hName = document.getElementById('header-name'); if (hName) hName.textContent = name;
  const hAv = document.getElementById('header-avatar'); if (hAv) hAv.textContent = (name||'U')[0].toUpperCase();
}

async function init() {
  applyTheme(localStorage.getItem('n360_theme') || 'light');
  const fechaEl = document.getElementById('header-fecha');
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });

  try {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) { window.location.href = 'login.html'; return; }
    STATE.userId = user.id;

    await loadEmpresaConfig(user.id);
    const profile = await loadUserProfile(user.id);
    if (profile) renderUserInfo(profile, user.email);

    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';

    renderListaModulosIA();
    document.getElementById('ia-input')?.focus();
  } catch (e) {
    console.error('init asistente:', e);
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').style.display = 'flex';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init();
  if (window.lucide) lucide.createIcons();
});

/* ============================================================
   MODAL DE MONEDA DE VISUALIZACION -- mismo patrón usado en todo
   el sistema, para que este módulo también pueda mostrar en otra
   moneda (nunca toca los datos reales, solo cómo se muestran).
   ============================================================ */
function abrirModalMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  document.getElementById('mv-moneda-oficial').textContent = oficial;
  document.getElementById('mv-select-moneda').value = monedaVisualizacionActiva() || '';
  document.getElementById('mv-tasa').value = tasaVisualizacionActiva() || '';
  document.getElementById('mv-error').textContent = '';
  onCambiarSelectMonedaVis();
  document.getElementById('modal-moneda-vis').style.display = 'flex';
}
function onCambiarSelectMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  document.getElementById('mv-wrap-tasa').style.display = (elegida && elegida !== oficial) ? '' : 'none';
}
function guardarMonedaVis() {
  const oficial = STATE.empresaConfig?.moneda || 'NIO';
  const elegida = document.getElementById('mv-select-moneda').value;
  const errEl = document.getElementById('mv-error');
  errEl.textContent = '';
  if (!elegida || elegida === oficial) {
    desactivarMonedaVisualizacion();
  } else {
    const tasa = parseFloat(document.getElementById('mv-tasa').value);
    if (!tasa || tasa <= 0) { errEl.textContent = 'Escribe tu tasa de cambio (cordobas por 1 dolar).'; return; }
    activarMonedaVisualizacion(elegida, tasa);
  }
  location.reload();
}
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const btn = document.getElementById('btn-moneda-vis-texto');
    if (btn) btn.textContent = monedaParaMostrar(STATE.empresaConfig?.moneda);
  }, 800);
});

/* =====================================================
   ASISTENTE INTELIGENTE — motor de detección de intención, 100%
   independiente (sin API externa, sin costo). Reconoce palabras
   clave en la pregunta, busca el dato REAL en Supabase (siempre vía
   RLS normal, nunca ve datos de otro negocio), y responde con una
   plantilla natural.
===================================================== */
function agregarBurbujaIA(texto, tipo) {
  const cont = document.getElementById('ia-mensajes');
  const div = document.createElement('div');
  div.className = `ia-burbuja ${tipo}`;
  div.textContent = texto;
  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
  return div;
}
function preguntaRapidaIA(texto) {
  document.getElementById('ia-input').value = texto;
  enviarPreguntaIA();
}

/* =====================================================
   NAVEGACIÓN POR MÓDULO — se muestra la lista de TODOS los módulos
   reales del sistema (mismo registro que usa el resto de Negocio360
   para menús y permisos); al elegir uno, se muestra un submenú de
   preguntas ya preparadas para ESE módulo en concreto.
===================================================== */
const MODULO_PREGUNTAS = {
  dashboard: [
    '¿Cuánto vendí hoy?', '¿Cuánto vendí ayer?', '¿Cuánto vendí esta semana?', '¿Cuánto vendí este mes?', '¿Cuánto vendí el mes pasado?',
    '¿Cuál es mi saldo de caja?',
    '¿Cómo van mis gastos este mes?', '¿Cuánto gasté hoy?',
    '¿Cuánto compré este mes?',
    '¿Cuánto he pagado en salarios este mes?',
    '¿Cuánto me deben mis clientes?',
    '¿Cuánto debo a mis proveedores?',
    '¿Qué productos tienen poco stock?', '¿Qué producto es el más vendido este mes?',
    '¿Quiénes son mis mejores clientes?',
  ],
  ventas:            ['¿Cuánto vendí hoy?', '¿Cuánto vendí este mes?', '¿Cuánto vendí ayer?'],
  gastos:            ['¿Cómo van mis gastos este mes?', '¿Cuánto gasté hoy?'],
  compras:           ['¿Cuánto compré este mes?', '¿Cuánto compré hoy?'],
  salarios:          ['¿Cuánto he pagado en salarios este mes?', '¿Cuánto pagué en salarios esta semana?'],
  caja:              ['¿Cuál es mi saldo de caja?'],
  productos:         ['¿Qué productos tienen poco stock?', '¿Qué producto es el más vendido este mes?', 'Precio de (escribe el nombre)'],
  creditos:          ['¿Cuánto me deben mis clientes?'],
  cuentas_por_pagar: ['¿Cuánto debo a mis proveedores?'],
  clientes:          ['¿Quiénes son mis mejores clientes?', 'Información de (escribe el nombre)'],
};

function renderListaModulosIA() {
  const cont = document.getElementById('ia-lista-modulos');
  const registro = window.NEGOCIO360_MODULOS || {};
  const modulos = Object.values(registro).filter(m => !m.soloAdmin);
  cont.innerHTML = modulos.map(m => `
    <button class="ia-chip" onclick="seleccionarModuloIA('${m.key}', '${esc(m.label)}')">${m.icon} ${esc(m.label)}</button>
  `).join('');
}

function seleccionarModuloIA(key, label) {
  document.getElementById('ia-nivel-modulos').style.display = 'none';
  document.getElementById('ia-nivel-preguntas').style.display = 'block';
  document.getElementById('ia-titulo-modulo-elegido').textContent = `Preguntas de ${label}`;

  const preguntas = MODULO_PREGUNTAS[key] || [];
  const cont = document.getElementById('ia-lista-preguntas');
  if (!preguntas.length) {
    cont.innerHTML = `<p style="font-size:12.5px;color:var(--text-muted);margin:0">Todavía no tengo preguntas preparadas para este módulo — pero puedes escribir tu pregunta directamente abajo.</p>`;
    return;
  }
  cont.innerHTML = preguntas.map(p => `<button class="ia-chip" onclick="preguntaRapidaIA('${esc(p)}')">${esc(p)}</button>`).join('');
}

function volverAModulosIA() {
  document.getElementById('ia-nivel-preguntas').style.display = 'none';
  document.getElementById('ia-nivel-modulos').style.display = 'block';
}


function fechaLocalISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function detectarRangoFechas(texto) {
  const hoy = new Date();
  if (/\bayer\b/.test(texto)) {
    const ayer = new Date(hoy); ayer.setDate(ayer.getDate()-1);
    return { desde: fechaLocalISO(ayer), hasta: fechaLocalISO(ayer), etiqueta: 'ayer' };
  }
  if (/\besta semana\b/.test(texto)) {
    const inicio = new Date(hoy); inicio.setDate(hoy.getDate() - hoy.getDay());
    return { desde: fechaLocalISO(inicio), hasta: fechaLocalISO(hoy), etiqueta: 'esta semana' };
  }
  if (/\bmes pasado\b/.test(texto)) {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth()-1, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
    return { desde: fechaLocalISO(inicio), hasta: fechaLocalISO(fin), etiqueta: 'el mes pasado' };
  }
  if (/\beste mes\b|\bdel mes\b|\bmensual\b/.test(texto)) {
    const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: fechaLocalISO(inicio), hasta: fechaLocalISO(hoy), etiqueta: 'este mes' };
  }
  return { desde: fechaLocalISO(hoy), hasta: fechaLocalISO(hoy), etiqueta: 'hoy' };
}
function fmtC(n) { return 'C$' + Number(n||0).toLocaleString('es-NI', {minimumFractionDigits:2, maximumFractionDigits:2}); }

const INTENCIONES_IA = [
  {
    nombre: 'ventas',
    palabras: ['vend', 'venta'],
    async responder(texto, userId) {
      const { desde, hasta, etiqueta } = detectarRangoFechas(texto);
      const { data } = await sbClient.from('ventas').select('total')
        .eq('auth_user_id', userId).eq('estado', 'completada')
        .gte('fecha', desde).lte('fecha', `${hasta} 23:59:59`);
      const total = (data||[]).reduce((s,v)=>s+Number(v.total||0),0);
      const cantidad = (data||[]).length;
      if (!cantidad) return `No encontré ventas registradas ${etiqueta}.`;
      return `${etiqueta === 'hoy' ? 'Hoy' : 'En ' + etiqueta} has vendido ${fmtC(total)} en ${cantidad} venta${cantidad===1?'':'s'} (ticket promedio: ${fmtC(total/cantidad)}).`;
    },
  },
  {
    nombre: 'gastos',
    palabras: ['gast'],
    async responder(texto, userId) {
      const { desde, hasta, etiqueta } = detectarRangoFechas(texto);
      const { data } = await sbClient.from('gastos').select('monto')
        .eq('auth_user_id', userId).eq('estado', 'activo')
        .gte('fecha', desde).lte('fecha', hasta);
      const total = (data||[]).reduce((s,g)=>s+Number(g.monto||0),0);
      if (!(data||[]).length) return `No tienes gastos registrados ${etiqueta}.`;
      return `${etiqueta === 'hoy' ? 'Hoy' : 'En ' + etiqueta} has gastado ${fmtC(total)} en ${(data||[]).length} gasto${(data||[]).length===1?'':'s'}.`;
    },
  },
  {
    nombre: 'compras',
    palabras: ['compr'],
    async responder(texto, userId) {
      const { desde, hasta, etiqueta } = detectarRangoFechas(texto);
      const { data } = await sbClient.from('compras').select('total')
        .eq('auth_user_id', userId).eq('estado', 'completada')
        .gte('fecha', desde).lte('fecha', hasta);
      const total = (data||[]).reduce((s,c)=>s+Number(c.total||0),0);
      if (!(data||[]).length) return `No tienes compras registradas ${etiqueta}.`;
      return `${etiqueta === 'hoy' ? 'Hoy' : 'En ' + etiqueta} has comprado ${fmtC(total)} en ${(data||[]).length} compra${(data||[]).length===1?'':'s'}.`;
    },
  },
  {
    nombre: 'salarios',
    palabras: ['salario', 'sueldo', 'planilla', 'nomina', 'nómina', 'personal', 'empleado', 'trabajador'],
    async responder(texto, userId) {
      const { desde, hasta, etiqueta } = detectarRangoFechas(texto);
      const { data } = await sbClient.from('empleados_pagos').select('total_pagado')
        .eq('auth_user_id', userId).eq('estado', 'pagado')
        .gte('fecha', desde).lte('fecha', hasta);
      const total = (data||[]).reduce((s,p)=>s+Number(p.total_pagado||0),0);
      if (!(data||[]).length) return `No hay pagos de salario registrados ${etiqueta}.`;
      return `${etiqueta === 'hoy' ? 'Hoy' : 'En ' + etiqueta} has pagado ${fmtC(total)} en salarios (${(data||[]).length} pago${(data||[]).length===1?'':'s'}).`;
    },
  },
  {
    nombre: 'caja',
    palabras: ['caja', 'efectivo', 'saldo'],
    async responder(texto, userId) {
      const { data } = await sbClient.from('movimientos_financieros').select('saldo_resultante')
        .eq('auth_user_id', userId).eq('estado', 'completado')
        .order('created_at', { ascending:false }).limit(1).maybeSingle();
      return `Tu saldo actual en Caja es ${fmtC(data?.saldo_resultante || 0)}.`;
    },
  },
  {
    nombre: 'stock_bajo',
    palabras: ['stock bajo', 'poco stock', 'se me acaba', 'agotand', 'inventario bajo'],
    async responder(texto, userId) {
      const { data } = await sbClient.from('productos').select('nombre, stock_actual, stock_minimo')
        .eq('auth_user_id', userId).eq('activo', true).not('stock_minimo','is',null)
        .order('stock_actual', { ascending:true }).limit(30);
      const bajos = (data||[]).filter(p => Number(p.stock_actual) <= Number(p.stock_minimo)).slice(0,8);
      if (!bajos.length) return 'Ningún producto está por debajo de su stock mínimo ahora mismo. 👍';
      return `Productos con poco stock:\n` + bajos.map(p => `• ${p.nombre}: ${p.stock_actual} (mínimo ${p.stock_minimo})`).join('\n');
    },
  },
  {
    nombre: 'productos_mas_vendidos',
    palabras: ['mas vendid', 'más vendid', 'que se vende mas', 'qué se vende más', 'producto estrella'],
    async responder(texto, userId) {
      const { desde, hasta, etiqueta } = detectarRangoFechas(texto);
      const { data, error } = await sbClient.rpc('asistente_productos_mas_vendidos', {
        p_auth_user_id: userId, p_desde: desde, p_hasta: hasta, p_limite: 5,
      });
      if (error || !(data||[]).length) return `No encontré productos vendidos ${etiqueta}.`;
      return `Tus productos más vendidos ${etiqueta}:\n` + data.map((p,i) => `${i+1}. ${p.producto} — ${p.cantidad_vendida} unidades`).join('\n');
    },
  },
  {
    nombre: 'creditos',
    palabras: ['credito', 'crédito', 'cobrar', 'me deben', 'deuda de client'],
    async responder(texto, userId) {
      const { data } = await sbClient.from('ventas').select('total, monto_pagado')
        .eq('auth_user_id', userId).eq('estado','completada').eq('metodo_pago','credito').neq('estado_credito','pagado');
      const total = (data||[]).reduce((s,v)=>s+(Number(v.total||0)-Number(v.monto_pagado||0)),0);
      if (!(data||[]).length) return 'No tienes créditos pendientes de cobrar ahora mismo. 👍';
      return `Tienes ${fmtC(total)} pendientes de cobrar en ${(data||[]).length} crédito${(data||[]).length===1?'':'s'}.`;
    },
  },
  {
    nombre: 'cuentas_por_pagar',
    palabras: ['cuenta por pagar', 'cuentas por pagar', 'debo a', 'le debo', 'pagar a proveedor'],
    async responder(texto, userId) {
      const { data } = await sbClient.from('cuentas_por_pagar').select('saldo_pendiente').eq('auth_user_id', userId).gt('saldo_pendiente', 0);
      const total = (data||[]).reduce((s,c)=>s+Number(c.saldo_pendiente||0),0);
      if (!(data||[]).length) return 'No tienes cuentas por pagar pendientes ahora mismo. 👍';
      return `Debes ${fmtC(total)} en ${(data||[]).length} cuenta${(data||[]).length===1?'':'s'} por pagar.`;
    },
  },
  {
    nombre: 'top_clientes',
    palabras: ['mejor cliente', 'mejores clientes', 'cliente que mas compra', 'cliente que más compra'],
    async responder(texto, userId) {
      const { data, error } = await sbClient.rpc('asistente_top_clientes', { p_auth_user_id: userId, p_limite: 5 });
      if (error || !(data||[]).length) return 'Todavía no tengo suficientes ventas con cliente registrado para mostrarte esto.';
      return `Tus mejores clientes:\n` + data.map((c,i) => `${i+1}. ${c.cliente} — ${fmtC(c.total_comprado)}`).join('\n');
    },
  },
];

function detectarIntencion(texto) {
  const limpio = texto.toLowerCase();
  let mejor = null, mejorLargo = 0;
  for (const intento of INTENCIONES_IA) {
    for (const p of intento.palabras) {
      if (limpio.includes(p) && p.length > mejorLargo) { mejor = intento; mejorLargo = p.length; }
    }
  }
  return mejor;
}

const PATRONES_CLIENTE = [
  /(?:cliente|informaci[oó]n de|datos de|historial de)\s+([a-záéíóúñ0-9 .'-]{3,40})/i,
  /cu[aá]nto (?:me )?debe\s+([a-záéíóúñ0-9 .'-]{3,40})/i,
  /cu[aá]nto (?:le debo a|debo a)\s+([a-záéíóúñ0-9 .'-]{3,40})/i,
];
const PATRONES_PRODUCTO = [
  /precio de\s+([a-záéíóúñ0-9 .'-]{2,40})/i,
  /stock de\s+([a-záéíóúñ0-9 .'-]{2,40})/i,
  /cu[aá]nto (?:tengo|hay|queda[n]?) de\s+([a-záéíóúñ0-9 .'-]{2,40})/i,
  /cu[aá]nto cuesta\s+([a-záéíóúñ0-9 .'-]{2,40})/i,
];
function extraerNombre(texto, patrones) {
  for (const p of patrones) {
    const m = texto.match(p);
    if (m && m[1]) return m[1].trim().replace(/[?¿.!]+$/, '').replace(/^(el|la|los|las|mi|mis)\s+/i, '').trim();
  }
  return null;
}

async function buscarClienteEspecifico(texto, userId) {
  const nombre = extraerNombre(texto, PATRONES_CLIENTE);
  if (!nombre) return null;
  const { data: candidatos } = await sbClient.from('clientes')
    .select('id, nombre, telefono, whatsapp, email')
    .eq('auth_user_id', userId).ilike('nombre', `%${nombre}%`).limit(5);
  if (!candidatos || !candidatos.length) return `No encontré ningún cliente que se llame "${nombre}".`;
  if (candidatos.length > 1) return `Encontré varios clientes parecidos a "${nombre}": ` + candidatos.map(c=>c.nombre).join(', ') + '. Sé más específico.';

  const cliente = candidatos[0];
  const { data: ventas } = await sbClient.from('ventas').select('total, monto_pagado, metodo_pago, estado_credito, fecha')
    .eq('auth_user_id', userId).eq('cliente_id', cliente.id).eq('estado', 'completada')
    .order('fecha', { ascending: false });
  const totalComprado = (ventas||[]).reduce((s,v)=>s+Number(v.total||0),0);
  const creditoPendiente = (ventas||[]).filter(v=>v.metodo_pago==='credito' && v.estado_credito!=='pagado')
    .reduce((s,v)=>s+(Number(v.total||0)-Number(v.monto_pagado||0)),0);
  const ultimaCompra = ventas && ventas.length ? ventas[0].fecha : null;

  let resp = `📋 ${cliente.nombre}\n`;
  resp += `Total comprado: ${fmtC(totalComprado)} en ${(ventas||[]).length} compra${(ventas||[]).length===1?'':'s'}\n`;
  if (creditoPendiente > 0) resp += `Crédito pendiente: ${fmtC(creditoPendiente)}\n`;
  if (ultimaCompra) resp += `Última compra: ${new Date(ultimaCompra).toLocaleDateString('es-NI')}\n`;
  if (cliente.telefono || cliente.whatsapp) resp += `Contacto: ${cliente.whatsapp || cliente.telefono}`;
  return resp.trim();
}

async function buscarProductoEspecifico(texto, userId) {
  const nombre = extraerNombre(texto, PATRONES_PRODUCTO);
  if (!nombre) return null;
  const { data: candidatos } = await sbClient.from('productos')
    .select('nombre, precio, costo, stock_actual, sku')
    .eq('auth_user_id', userId).eq('activo', true).ilike('nombre', `%${nombre}%`).limit(5);
  if (!candidatos || !candidatos.length) return `No encontré ningún producto que se llame "${nombre}".`;
  if (candidatos.length > 1) return `Encontré varios productos parecidos a "${nombre}": ` + candidatos.map(p=>p.nombre).join(', ') + '. Sé más específico.';

  const p = candidatos[0];
  return `📦 ${p.nombre}${p.sku ? ' ('+p.sku+')' : ''}\nPrecio: ${fmtC(p.precio)}\nStock actual: ${p.stock_actual}`;
}

async function enviarPreguntaIA() {
  const input = document.getElementById('ia-input');
  const pregunta = input.value.trim();
  if (!pregunta) return;
  input.value = '';
  input.disabled = true;
  const btnEnviar = document.querySelector('.ia-btn-enviar');
  if (btnEnviar) btnEnviar.disabled = true;
  agregarBurbujaIA(pregunta, 'usuario');
  const burbujaCargando = agregarBurbujaIA('Buscando…', 'asistente cargando');

  try {
    const { data: sesion } = await sbClient.auth.getSession();
    const userId = sesion?.session?.user?.id;
    if (!userId) { burbujaCargando.textContent = 'No se pudo verificar tu sesión, intenta recargar la página.'; return; }

    let respuesta = await buscarClienteEspecifico(pregunta, userId);
    if (!respuesta) respuesta = await buscarProductoEspecifico(pregunta, userId);

    if (!respuesta) {
      const intento = detectarIntencion(pregunta);
      if (!intento) {
        burbujaCargando.remove();
        agregarBurbujaIA('No entendí bien esa pregunta. Puedo ayudarte con: ventas, gastos, compras, salarios, saldo de caja, stock bajo, productos más vendidos, créditos pendientes, cuentas por pagar, tus mejores clientes, o buscar un cliente/producto específico por nombre.', 'asistente');
        return;
      }
      respuesta = await intento.responder(pregunta.toLowerCase(), userId);
    }
    burbujaCargando.remove();
    agregarBurbujaIA(respuesta, 'asistente');
  } catch (e) {
    burbujaCargando.remove();
    agregarBurbujaIA('Ocurrió un error buscando esa información, intenta de nuevo.', 'asistente');
    console.error('Asistente IA:', e);
  } finally {
    input.disabled = false;
    if (btnEnviar) btnEnviar.disabled = false;
    input.focus();
  }
}
