/* =====================================================
   CREDITOS.JS — NEGOCIO360  v1.0
   Módulo de Créditos: crédito por venta y crédito financiero,
   con y sin intereses, prima, frecuencia, cuotas, pagos,
   historial/auditoría, integración con Caja (movimientos_financieros)
   e integración con Ventas (solo al crear un crédito por venta).

   IIFE wrapper: mismo patrón que gastos.js / ventas.js para no
   chocar con variables globales de otros scripts.
===================================================== */

(function () {
  'use strict';

  /* ===================================================
     SUPABASE CLIENT — reutiliza el de cajaAPI.js
  =================================================== */
  const _sb = window.__cajaSB || window.supabase.createClient(
    'https://zvlincmqmmoclqhykejv.supabase.co',
    'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t'
  );
  window.__cajaSB = _sb;

  // Se declaran aquí arriba (no donde se usan más abajo) para que
  // nunca queden en "zona muerta temporal" — si algo entre este punto
  // y donde se usaban antes fallara, estas quedaban inaccesibles y
  // rompían silenciosamente el botón de Registrar pago.
  let _bancosCacheCred = null;
  let _bancoElegidoIdCred = null;
  let _montoBancoConvertidoCred = null;

  /* ===================================================
     ESTADO LOCAL
  =================================================== */
  const CS = {
    userId: null, userEmail: null,
    empresaConfig: {}, currentUser: {},
    metodosPago: [], clientes: [], productos: [], productosFinancieros: [], impuestos: [],
    creditos: [], creditosPage: 1, creditosPerPage: 15, creditosTotal: 0,
    creditosFiltro: 'todos', creditosSearch: '',
    pagosRecientes: [],
    kpis: {},
    activeSection: 'creditos',

    // Stock Compartido — grupo (Sucursales/Bodegas), mismo mecanismo de Ventas
    stockCompartidoActivo: false,
    miSucursalId:          null,
    stockOrigenPendiente:  null,
    origenStockElegido:    null,
    productosCacheGrupo:   [],
    ncItems: [],          // ítems agregados al crédito por venta en curso
    ncAmortizacionPreview: [],
    ultimoComprobante: null,
    escalasPorProducto: {}, // { producto_id: [{id,nombre,precio}, ...] } — solo tipo_precio='escala'
    escalaPendiente: null,  // { productoId, cantidad } mientras el selector de escala está abierto
  };

  /* ===================================================
     HELPERS FECHA (mismo fix de zona horaria que el resto del ERP)
  =================================================== */
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function todayISO() { return ymd(new Date()); }
  function startOfMonthISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

  function sumarFrecuencia(fechaISO, frecuencia, veces) {
    const d = new Date(fechaISO + 'T12:00:00');
    for (let i = 0; i < veces; i++) {
      switch (frecuencia) {
        case 'diaria':     d.setDate(d.getDate() + 1);        break;
        case 'semanal':    d.setDate(d.getDate() + 7);        break;
        case 'quincenal':  d.setDate(d.getDate() + 15);       break;
        case 'mensual':    d.setMonth(d.getMonth() + 1);      break;
        case 'bimestral':  d.setMonth(d.getMonth() + 2);      break;
        case 'trimestral': d.setMonth(d.getMonth() + 3);      break;
        case 'anual':      d.setFullYear(d.getFullYear() + 1); break;
        default:           d.setMonth(d.getMonth() + 1);
      }
    }
    return ymd(d);
  }

  function daysDiff(dateISO) {
    const t = new Date(todayISO()+'T00:00:00');
    const x = new Date(dateISO+'T00:00:00');
    return Math.round((x - t) / 86400000);
  }

  /* ===================================================
     HELPERS FORMATO
  =================================================== */
  function sym() { return CS.empresaConfig?.moneda || 'C$'; }
  function fmt(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) return `${sym()} 0.00`;
    return `${sym()} ${Number(amount).toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
  }
  function fmtDate(isoDate) {
    if (!isoDate) return '—';
    return new Date(isoDate + 'T12:00:00').toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
  }
  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function round2(n) { return Math.round((Number(n)||0) * 100) / 100; }
  function setBtnLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      if (!btn.dataset.textoOriginal) btn.dataset.textoOriginal = btn.textContent;
      btn.textContent = 'Guardando…';
    } else if (btn.dataset.textoOriginal) {
      btn.textContent = btn.dataset.textoOriginal;
    }
  }

  const LABEL_TIPO_FIN = { sin_interes:'Sin intereses', con_interes:'Con intereses' };
  const LABEL_ESTADO   = { en_proceso:'En proceso', activo:'Activo', al_dia:'Al día', con_atraso:'Con atraso', cancelado:'Cancelado', refinanciado:'Refinanciado' };
  const LABEL_FREC     = { diaria:'Diaria', semanal:'Semanal', quincenal:'Quincenal', mensual:'Mensual', bimestral:'Bimestral', trimestral:'Trimestral', anual:'Anual' };

  /* ===================================================
     NOMBRE DEL NEGOCIO / THEME / SIDEBAR (boilerplate estándar del ERP)
  =================================================== */
  function nombreNegocio() {
    return CS.empresaConfig?.nombre_comercial || CS.empresaConfig?.nombre_negocio ||
           CS.currentUser?.nombre_negocio || 'Mi negocio';
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('n360_theme', theme);
    const sun = document.getElementById('icon-sun'), moon = document.getElementById('icon-moon');
    if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
    if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
  }
  function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }

  let _sidebarCollapsed = false;
  function isMobileViewport() { return window.matchMedia('(max-width: 768px)').matches; }
  function toggleSidebar() {
    if (isMobileViewport()) {
      const sb = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
      const isOpen = sb.classList.toggle('mobile-open');
      if (ov) ov.classList.toggle('show', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    } else {
      _sidebarCollapsed = !_sidebarCollapsed;
      document.getElementById('sidebar').classList.toggle('collapsed', _sidebarCollapsed);
      document.getElementById('main').classList.toggle('sidebar-collapsed', _sidebarCollapsed);
    }
  }
  function closeMobileSidebar() {
    const sb = document.getElementById('sidebar'), ov = document.getElementById('sidebar-overlay');
    sb.classList.remove('mobile-open'); if (ov) ov.classList.remove('show');
    document.body.style.overflow = '';
  }
  function navigate(url) { closeMobileSidebar(); window.location.href = url; }
  window.addEventListener('resize', () => { if (!isMobileViewport()) closeMobileSidebar(); });

  async function loadEmpresaConfig(userId) {
    try {
      const { data } = await _sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
      if (data) {
        CS.empresaConfig = data;
        const logoText = document.getElementById('sidebar-logo-text');
        if (logoText) logoText.textContent = nombreNegocio();
        const color = data.color_principal || data.color_primario;
        if (color) {
          document.documentElement.style.setProperty('--accent', color);
          document.documentElement.style.setProperty('--accent-soft', color + '22');
          document.documentElement.style.setProperty('--border-focus', color);
        }
        if (data.logo_principal_url) {
          const li = document.querySelector('.logo-icon');
          if (li) li.innerHTML = `<img src="${data.logo_principal_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
        }
      }
    } catch(e) { console.warn('loadEmpresaConfig:', e); }
  }
  async function loadUserProfile(userId) {
    try { const { data } = await _sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle(); return data; }
    catch(e) { return null; }
  }
  function renderUserInfo(user, email) {
    if (!user) return;
    CS.currentUser = user;
    const nombre = user.nombre || email?.split('@')[0] || 'Usuario';
    const apellido = user.apellido || '';
    const plan = user.plan || 'Gratuito';
    const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();
    document.getElementById('header-name').textContent   = `${nombre} ${apellido}`.trim();
    document.getElementById('header-biz').textContent    = nombreNegocio();
    document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
    document.getElementById('plan-text').textContent     = plan.charAt(0).toUpperCase() + plan.slice(1);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
    document.getElementById('greeting-text').textContent = `${greet}, ${nombre.split(' ')[0]}`;
  }
  async function checkAdminAccess(email) {
    try {
      const { data } = await _sb.from('administradores').select('email,activo').eq('email', email).eq('activo', true).maybeSingle();
      if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; }
    } catch(e) {}
  }

  /* ===================================================
     CAJA API (reutiliza cajaAPI.js — nunca duplicar lógica de caja)
  =================================================== */
  async function registrarEnCaja(params) {
    if (!window.CajaAPI || typeof window.CajaAPI.registrarMovimiento !== 'function') {
      console.error('CajaAPI no disponible');
      return { ok:false, error:'CajaAPI no disponible' };
    }
    return window.CajaAPI.registrarMovimiento(params);
  }

  /* ===================================================
     IMPUESTOS.HTML — acumulación por cobro real (no por creación del crédito)
     Mismo patrón/tabla que usa Ventas (movimientos_impuestos), encadenando
     saldo_anterior/saldo_resultante. Solo se llama con la porción de impuesto
     efectivamente cobrada en cada pago de cuota, nunca con el total del crédito.
  =================================================== */
  async function registrarImpuestoCredito(montoImpuesto, credito, impuestoNombre, impuestoId) {
    if (!montoImpuesto || montoImpuesto <= 0) return;
    try {
      const { data: ultMov } = await _sb.from('movimientos_impuestos')
        .select('saldo_resultante').eq('auth_user_id', CS.userId)
        .order('created_at', { ascending:false }).limit(1).maybeSingle();
      const saldoAnt = ultMov ? Number(ultMov.saldo_resultante) : 0;
      const saldoRes = round2(saldoAnt + montoImpuesto);
      await _sb.from('movimientos_impuestos').insert({
        auth_user_id: CS.userId, tipo_movimiento: 'IVA_VENTA',
        concepto: `${impuestoNombre || 'Impuesto'} cobrado en cuota de crédito ${credito.numero_credito}`,
        monto: montoImpuesto, saldo_anterior: saldoAnt, saldo_resultante: saldoRes,
        impuesto_id: impuestoId || null, impuesto_nombre: impuestoNombre || null,
        referencia_venta_id: credito.venta_id || null, fecha: todayISO(),
      });
    } catch (e) { console.warn('registrarImpuestoCredito:', e); }
  }

  /* ===================================================
     CATÁLOGOS: clientes, productos/servicios, financieros, métodos, impuestos
  =================================================== */
  async function loadClientes() {
    const { data } = await _sb.from('clientes').select('id,nombre,apellido,telefono')
      .eq('auth_user_id', CS.userId).eq('activo', true).order('nombre');
    CS.clientes = data || [];
    const opts = '<option value="">Selecciona un cliente…</option>' +
      CS.clientes.map(c => `<option value="${c.id}">${esc(c.nombre)} ${esc(c.apellido||'')}</option>`).join('');
    ['nc-cliente','ce-cliente','rp-cliente'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = opts; });
  }

  async function loadProductosYServicios() {
    const { data } = await _sb.from('productos').select('id,tipo,nombre,precio,costo,stock_actual,sku,tipo_precio')
      .eq('auth_user_id', CS.userId).eq('activo', true).order('nombre');
    const todos = data || [];
    CS.productos = todos.filter(p => p.tipo === 'producto' || p.tipo === 'servicio');
    // Los "productos financieros" ya no se seleccionan de un catálogo aparte: el usuario
    // simplemente escribe el nombre en el modal de Nuevo Crédito (ver confirmarNuevoCredito).
    // Aquí solo se cachean para reutilizar el mismo registro si el usuario repite un nombre.
    CS.productosFinancieros = todos.filter(p => p.tipo === 'financiero');

    // Combos: se agregan al mismo catálogo (mismo patrón que Ventas y
    // Proformas) — tipo:'producto' para que las validaciones de stock
    // ya existentes se apliquen igual, marcados con esCombo:true.
    try {
      const { data: combos } = await _sb.from('combos')
        .select('id,nombre,sku,codigo_barras,precio,costo,tipo_precio,activo')
        .eq('auth_user_id', CS.userId).eq('activo', true).order('nombre');
      if (combos && combos.length) {
        const comboIds = combos.map(c => c.id);
        const { data: items } = await _sb.from('combo_items')
          .select('combo_id, cantidad, productos(stock_actual, costo)').in('combo_id', comboIds);
        const itemsPorCombo = {};
        (items||[]).forEach(it => {
          if (!itemsPorCombo[it.combo_id]) itemsPorCombo[it.combo_id] = [];
          itemsPorCombo[it.combo_id].push(it);
        });
        const combosCache = combos.map(c => {
          const suyos = itemsPorCombo[c.id] || [];
          const stockDisponible = suyos.length
            ? Math.min(...suyos.map(it => Math.floor(Number(it.productos?.stock_actual || 0) / (Number(it.cantidad) || 1))))
            : 0;
          const costoActual = suyos.reduce((s, it) => s + Number(it.cantidad||0) * Number(it.productos?.costo || 0), 0);
          return {
            id: c.id, nombre: c.nombre, sku: c.sku || c.codigo_barras || '',
            tipo: 'producto', precio: c.precio, costo: costoActual, tipo_precio: c.tipo_precio,
            stock_actual: stockDisponible, activo: c.activo, esCombo: true,
          };
        });
        CS.productos = [...CS.productos, ...combosCache];
      }
    } catch (eCombo) { console.warn('No se pudieron cargar los combos para Créditos:', eCombo); }

    await loadEscalasDePrecios();
  }

  // Precios por escala (Detalle/Mayorista/etc.) — mismo patrón que Ventas: los productos
  // con tipo_precio='escala' no tienen un precio único en `productos.precio` (queda en 0),
  // el precio real vive en `precios_escala` y el usuario debe elegir cuál usar.
  async function loadEscalasDePrecios() {
    CS.escalasPorProducto = {};
    const idsConEscala = CS.productos.filter(p => p.tipo_precio === 'escala').map(p => p.id);
    if (!idsConEscala.length) return;
    const { data } = await _sb.from('precios_escala').select('id,producto_id,nombre,precio,orden')
      .in('producto_id', idsConEscala).order('orden');
    (data || []).forEach(e => {
      if (!CS.escalasPorProducto[e.producto_id]) CS.escalasPorProducto[e.producto_id] = [];
      CS.escalasPorProducto[e.producto_id].push(e);
    });

    // Escalas de combos (si algún combo tiene tipo_precio='escala', aunque
    // en Créditos hoy no se usa su precio propio — solo el de sus
    // componentes — se deja cargado por si se necesita más adelante).
    const idsCombosConEscala = CS.productos.filter(p => p.esCombo && p.tipo_precio === 'escala').map(p => p.id);
    if (idsCombosConEscala.length) {
      try {
        const { data: comboEscalas } = await _sb.from('combo_precios_escala')
          .select('id,combo_id,nombre,precio,orden').in('combo_id', idsCombosConEscala).order('orden');
        (comboEscalas || []).forEach(e => {
          if (!CS.escalasPorProducto[e.combo_id]) CS.escalasPorProducto[e.combo_id] = [];
          CS.escalasPorProducto[e.combo_id].push(e);
        });
      } catch (eCombo) { /* si falla, no rompe el resto */ }
    }
  }

  async function loadMetodosPago() {
    const { data } = await _sb.from('metodos_pago').select('*').eq('auth_user_id', CS.userId).eq('activo', true).order('orden');
    CS.metodosPago = data || [];
    const sel = document.getElementById('rp-metodo');
    if (sel) sel.innerHTML = CS.metodosPago.map(m => `<option value="${m.id}" data-nombre="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('') || '<option value="">Efectivo</option>';
  }

  async function loadImpuestos() {
    await asegurarIvaEnCatalogo();
    const { data } = await _sb.from('impuestos').select('*').eq('auth_user_id', CS.userId).eq('estado', true).order('nombre');
    CS.impuestos = data || [];
    renderImpuestosCheck();
  }

  // El IVA ahora vive dentro del mismo catálogo flexible de impuestos (tabla `impuestos`),
  // así aparece como una opción más — seleccionable o editable — igual que cualquier
  // impuesto personalizado. Solo se crea una vez por negocio, la primera vez que hace falta.
  async function asegurarIvaEnCatalogo() {
    try {
      const { data: existente } = await _sb.from('impuestos').select('id')
        .eq('auth_user_id', CS.userId).ilike('nombre', 'IVA').limit(1).maybeSingle();
      if (existente) return;
      await _sb.from('impuestos').insert({
        auth_user_id: CS.userId, nombre: 'IVA', categoria: 'iva', tipo_valor: 'porcentaje',
        valor: Number(CS.empresaConfig?.porcentaje_iva) || 15, estado: true,
        descripcion: 'Impuesto al Valor Agregado',
      });
    } catch (e) { console.warn('asegurarIvaEnCatalogo:', e); }
  }

  function renderImpuestosCheck() {
    const wrap = document.getElementById('nc-impuestos-check');
    if (!wrap) return;
    // Los de tabla progresiva (como el IR de nómina) no aplican a una
    // venta puntual — se calculan sobre ingresos totales, no por
    // transacción, así que no se muestran aquí como opción marcable.
    const disponibles = CS.impuestos.filter(i => i.tipo_valor !== 'tabla_progresiva');
    wrap.innerHTML = (disponibles.length
      ? disponibles.map(i => `
          <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;color:var(--text-secondary)">
            <input type="checkbox" class="nc-impuesto-chk" value="${i.id}" data-valor="${i.valor}" data-tipo="${i.tipo_valor}" data-nombre="${esc(i.nombre)}" style="width:auto" onchange="recalcularCredito()" />
            ${esc(i.nombre)} (${i.tipo_valor==='porcentaje' ? i.valor+'%' : fmt(i.valor)})
          </label>`).join('')
      : '<span style="font-size:12.5px;color:var(--text-muted)">Sin impuestos disponibles.</span>')
      + `<button type="button" class="btn-secondary btn-sm" onclick="abrirCrearImpuestoRapido()" style="padding:3px 10px;font-size:11.5px">+ Nuevo impuesto</button>`;
  }

  // Crear un impuesto sin salir del formulario de crédito — se agrega
  // al mismo catálogo que usa todo el sistema (Ventas, Impuestos,
  // Salarios), nunca uno aparte.
  function abrirCrearImpuestoRapido() {
    const nombre = prompt('Nombre del nuevo impuesto (ej: IR, Retención en la fuente):');
    if (!nombre || !nombre.trim()) return;
    const valorStr = prompt(`¿Qué porcentaje aplica "${nombre.trim()}"? (ej: 15)`);
    const valor = parseFloat(valorStr);
    if (isNaN(valor) || valor < 0) { showToast('Porcentaje inválido', 'error'); return; }
    (async () => {
      try {
        const { data: existente } = await _sb.from('impuestos').select('id')
          .eq('auth_user_id', CS.userId).ilike('nombre', nombre.trim()).maybeSingle();
        if (existente) { showToast('Ya existe un impuesto con ese nombre — lo puedes marcar de la lista', 'error'); return; }
        const { error } = await _sb.from('impuestos').insert({
          auth_user_id: CS.userId, nombre: nombre.trim(), categoria: 'otro',
          tipo_valor: 'porcentaje', valor, estado: true,
        });
        if (error) throw error;
        showToast(`Impuesto "${nombre.trim()}" creado`);
        const { data } = await _sb.from('impuestos').select('*').eq('auth_user_id', CS.userId).eq('estado', true);
        CS.impuestos = data || [];
        renderImpuestosCheck();
      } catch (e) { showToast('Error al crear el impuesto: ' + (e.message||''), 'error'); }
    })();
  }
  window.abrirCrearImpuestoRapido = abrirCrearImpuestoRapido;

  // Crear un impuesto nuevo sin salir del modal de Nuevo Crédito (igual que el
  // producto financiero: el usuario lo nombra ahí mismo). También queda disponible
  // de inmediato en el módulo Impuestos.
  async function agregarImpuestoInline() {
    const nombre = document.getElementById('nc-nuevo-impuesto-nombre').value.trim();
    const tipoValor = document.getElementById('nc-nuevo-impuesto-tipo').value;
    const valor = parseFloat(document.getElementById('nc-nuevo-impuesto-valor').value) || 0;
    if (!nombre) { showToast('Escribe el nombre del impuesto', 'error'); return; }
    if (valor <= 0) { showToast('El valor del impuesto debe ser mayor a cero', 'error'); return; }
    try {
      const { data, error } = await _sb.from('impuestos').insert({
        auth_user_id: CS.userId, nombre, categoria: 'otro', tipo_valor: tipoValor, valor, estado: true,
      }).select().single();
      if (error) throw error;
      CS.impuestos.push(data);
      renderImpuestosCheck();
      document.getElementById('nc-nuevo-impuesto-nombre').value = '';
      document.getElementById('nc-nuevo-impuesto-valor').value = '';
      // Deja el nuevo impuesto ya seleccionado
      const chk = wrapQuery(`.nc-impuesto-chk[value="${data.id}"]`);
      if (chk) chk.checked = true;
      recalcularCredito();
      showToast(`Impuesto "${nombre}" creado`, 'success');
    } catch (e) {
      console.error('agregarImpuestoInline:', e);
      showToast('Error al crear el impuesto: ' + (e.message||e), 'error');
    }
  }
  window.agregarImpuestoInline = agregarImpuestoInline;
  function wrapQuery(sel) { return document.querySelector(sel); }

  /* ===================================================
     MOTOR DE AMORTIZACIÓN
     - "simple": interés fijo calculado sobre el capital financiado,
       repartido en partes iguales entre las cuotas (junto con el capital).
     - "frances": cuota fija, interés sobre saldo insoluto.
     Diseñado para poder agregar más métodos sin reescribir el resto.
  =================================================== */
  function calcularPrima(monto, tipo, valor) {
    monto = Number(monto)||0; valor = Number(valor)||0;
    if (tipo === 'fija') return Math.min(round2(valor), monto);
    if (tipo === 'porcentual') return round2(monto * valor / 100);
    return 0;
  }

  function prorratearFijo(total, numCuotas) {
    const base = round2(Number(total||0) / numCuotas);
    const arr = new Array(numCuotas).fill(base);
    arr[numCuotas-1] = round2(Number(total||0) - base*(numCuotas-1));
    return arr;
  }

  function generarAmortizacion({ capitalFinanciado, tipoFinanciamiento, tasaInteres, metodo, frecuencia, numCuotas, fechaInicio, impuestosLista, baseImpuesto }) {
    capitalFinanciado = Number(capitalFinanciado)||0;
    numCuotas = Math.max(1, parseInt(numCuotas)||1);
    tasaInteres = Number(tasaInteres)||0;
    baseImpuesto = baseImpuesto || 'capital'; // 'capital' (créditos por venta) | 'interes' (créditos financieros)
    impuestosLista = impuestosLista || [];

    // Impuestos de monto fijo (no porcentuales) se prorratean en partes iguales entre
    // las cuotas, igual que el capital; los porcentuales se calculan cuota por cuota.
    const fijosPorCuota = {};
    impuestosLista.forEach(t => { if (t.tipo_valor === 'fijo') fijosPorCuota[t.id || t.nombre] = prorratearFijo(t.valor, numCuotas); });

    function detalleImpuestos(base, indiceCuota) {
      const detalle = []; let total = 0;
      impuestosLista.forEach(t => {
        const key = t.id || t.nombre;
        const monto = t.tipo_valor === 'fijo' ? fijosPorCuota[key][indiceCuota-1] : round2(base * (Number(t.valor)||0) / 100);
        if (monto) { detalle.push({ impuesto_id: t.id||null, nombre: t.nombre, tipo_valor: t.tipo_valor, valor: t.valor, monto }); total = round2(total+monto); }
      });
      return { detalle, total };
    }

    const cuotas = [];
    let totalIntereses = 0;

    if (tipoFinanciamiento === 'sin_interes') {
      const capitalCuota = round2(capitalFinanciado / numCuotas);
      let saldo = capitalFinanciado;
      for (let i = 1; i <= numCuotas; i++) {
        const esUltima = i === numCuotas;
        const cap = esUltima ? round2(saldo) : capitalCuota;
        const { detalle, total: impuesto } = detalleImpuestos(cap, i);
        saldo = round2(saldo - cap);
        cuotas.push({
          numero: i,
          fecha_vencimiento: sumarFrecuencia(fechaInicio, frecuencia, i),
          capital: cap, interes: 0, impuesto, impuestos_detalle: detalle,
          monto_total: round2(cap + impuesto),
          saldo: saldo,
        });
      }
    } else if (metodo === 'frances') {
      const tasaPeriodo = tasaInteres / 100;
      let cuotaFija;
      if (tasaPeriodo > 0) {
        cuotaFija = capitalFinanciado * (tasaPeriodo * Math.pow(1+tasaPeriodo, numCuotas)) / (Math.pow(1+tasaPeriodo, numCuotas) - 1);
      } else {
        cuotaFija = capitalFinanciado / numCuotas;
      }
      let saldo = capitalFinanciado;
      for (let i = 1; i <= numCuotas; i++) {
        const interes = round2(saldo * tasaPeriodo);
        let cap = round2(cuotaFija - interes);
        const esUltima = i === numCuotas;
        if (esUltima) cap = round2(saldo);
        saldo = round2(saldo - cap);
        totalIntereses += interes;
        const { detalle, total: impuesto } = detalleImpuestos(baseImpuesto === 'interes' ? interes : cap, i);
        cuotas.push({
          numero: i,
          fecha_vencimiento: sumarFrecuencia(fechaInicio, frecuencia, i),
          capital: cap, interes, impuesto, impuestos_detalle: detalle,
          monto_total: round2(cap + interes + impuesto),
          saldo: saldo,
        });
      }
    } else {
      // "simple": interés total = capital * tasa (una sola vez), prorrateado en partes iguales
      totalIntereses = round2(capitalFinanciado * tasaInteres / 100);
      const interesCuota = round2(totalIntereses / numCuotas);
      const capitalCuota = round2(capitalFinanciado / numCuotas);
      let saldo = capitalFinanciado;
      for (let i = 1; i <= numCuotas; i++) {
        const esUltima = i === numCuotas;
        const cap = esUltima ? round2(saldo) : capitalCuota;
        const interes = esUltima ? round2(totalIntereses - interesCuota*(numCuotas-1)) : interesCuota;
        const { detalle, total: impuesto } = detalleImpuestos(baseImpuesto === 'interes' ? interes : cap, i);
        saldo = round2(saldo - cap);
        cuotas.push({
          numero: i,
          fecha_vencimiento: sumarFrecuencia(fechaInicio, frecuencia, i),
          capital: cap, interes, impuesto, impuestos_detalle: detalle,
          monto_total: round2(cap + interes + impuesto),
          saldo: saldo,
        });
      }
    }

    if (tipoFinanciamiento !== 'sin_interes' && metodo !== 'frances') {
      // ya calculado arriba (rama "simple")
    } else if (tipoFinanciamiento !== 'sin_interes') {
      totalIntereses = round2(cuotas.reduce((s,c)=>s+c.interes,0));
    }

    const totalFinanciado = round2(capitalFinanciado + totalIntereses);
    const valorCuotaAprox = round2(cuotas.reduce((s,c)=>s+c.monto_total,0) / numCuotas);
    return { cuotas, totalIntereses, totalFinanciado, valorCuotaAprox };
  }

  /* ===================================================
     NUMERACIÓN (RPC dedicada, mismo patrón que ventas)
  =================================================== */
  async function generarNumeroCredito() {
    try {
      const { data, error } = await _sb.rpc('generar_numero_credito', { p_user_id: CS.userId });
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('generarNumeroCredito fallback:', e);
      return 'CR-' + Date.now().toString().slice(-6);
    }
  }
  async function generarNumeroVenta() {
    const { data, error } = await _sb.rpc('generar_numero_venta', { p_user_id: CS.userId });
    if (error) throw error;
    return data;
  }

  /* ===================================================
     HISTORIAL / AUDITORÍA
  =================================================== */
  async function registrarHistorial(creditoId, tipoEvento, descripcion, data) {
    try {
      await _sb.from('creditos_historial').insert({
        auth_user_id: CS.userId, credito_id: creditoId,
        tipo_evento: tipoEvento, descripcion, data: data || {},
      });
    } catch (e) { console.warn('registrarHistorial:', e); }
  }

  /* ===================================================
     UI: TOGGLES DEL FORMULARIO "NUEVO CRÉDITO"
  =================================================== */
  function setTipoCredito(tipo) {
    document.getElementById('nc-tipo').value = tipo;
    document.getElementById('tipo-credito-venta-btn').classList.toggle('active', tipo==='venta');
    document.getElementById('tipo-credito-financiero-btn').classList.toggle('active', tipo==='financiero');
    document.getElementById('nc-bloque-venta').style.display = tipo==='venta' ? 'block' : 'none';
    document.getElementById('nc-bloque-financiero').style.display = tipo==='financiero' ? 'block' : 'none';
    actualizarVisibilidadImpuestosFinanciero();
    recalcularCredito();
  }
  window.setTipoCredito = setTipoCredito;

  function setTipoFinanciamiento(tipo) {
    document.getElementById('nc-tipo-financiamiento').value = tipo;
    document.getElementById('nc-sin-interes-btn').classList.toggle('active', tipo==='sin_interes');
    document.getElementById('nc-con-interes-btn').classList.toggle('active', tipo==='con_interes');
    document.getElementById('nc-bloque-interes').style.display = tipo==='con_interes' ? 'block' : 'none';
    actualizarVisibilidadImpuestosFinanciero();
    recalcularCredito();
  }
  window.setTipoFinanciamiento = setTipoFinanciamiento;

  // El impuesto de un crédito financiero solo tiene sentido si hay interés
  // (se calcula sobre el interés, nunca sobre el capital prestado).
  function actualizarVisibilidadImpuestosFinanciero() {
    const tipo = document.getElementById('nc-tipo').value;
    const tipoFin = document.getElementById('nc-tipo-financiamiento').value;
    const wrap = document.getElementById('nc-fin-impuestos-wrap');
    if (!wrap) return;
    const mostrar = tipo === 'financiero' && tipoFin === 'con_interes';
    wrap.style.display = mostrar ? 'block' : 'none';
    if (!mostrar) document.querySelectorAll('.nc-impuesto-chk:checked').forEach(chk => chk.checked = false);
  }

  function toggleNCPrima() {
    const tipo = document.getElementById('nc-prima-tipo').value;
    document.getElementById('nc-prima-valor-wrap').style.display = tipo === 'ninguna' ? 'none' : 'block';
  }
  window.toggleNCPrima = toggleNCPrima;

  function buscarProductoCredito(q) {
    const cont = document.getElementById('nc-producto-resultados');
    if (!cont) return;
    const texto = (q || '').trim().toLowerCase();
    if (!texto) { cont.innerHTML = ''; return; }

    const resultados = CS.productos.filter(p =>
      (p.nombre || '').toLowerCase().includes(texto) || (p.sku || '').toLowerCase().includes(texto)
    ).slice(0, 10);

    let resultadosGrupo = [];
    if (CS.stockCompartidoActivo) {
      const nombresLocales = new Set(CS.productos.map(p => (p.nombre||'').trim().toLowerCase()));
      const vistos = new Set();
      resultadosGrupo = CS.productosCacheGrupo.filter(p => {
        const clave = (p.nombre||'').trim().toLowerCase();
        if (p.tipo !== 'producto' || !clave || nombresLocales.has(clave) || vistos.has(clave)) return false;
        const coincide = clave.includes(texto) || (p.sku||'').toLowerCase().includes(texto);
        if (coincide) vistos.add(clave);
        return coincide;
      }).slice(0, 10 - resultados.length);
    }

    if (!resultados.length && !resultadosGrupo.length) { cont.innerHTML = `<div class="search-no-results">Sin resultados para "${esc(texto)}"</div>`; return; }

    const htmlLocal = resultados.map(p => {
      const esEscala = p.tipo_precio === 'escala';
      return `
      <div class="search-result-item" onclick="agregarItemCredito('${p.id}')">
        <div class="sri-info">
          <span class="sri-nombre">${p.esCombo ? '📦 ' : ''}${esc(p.nombre)}${esEscala ? ' <span style="font-size:10px;color:var(--accent)">📊 escala</span>' : ''}</span>
          <span class="sri-meta">${p.esCombo ? 'Combo' : (p.tipo === 'servicio' ? 'Servicio' : 'Producto')}${p.sku ? ' · SKU: ' + esc(p.sku) : ''}${p.tipo === 'producto' ? ' · Stock: ' + (p.stock_actual || 0) : ''}</span>
        </div>
        <span class="sri-costo">${esEscala ? 'Elegir precio' : fmt(p.precio)}</span>
      </div>`;
    }).join('');

    const htmlGrupo = resultadosGrupo.map(p => `
      <div class="search-result-item" onclick="agregarProductoSoloEnGrupoCredito('${esc(p.nombre).replace(/'/g,"\\'")}')">
        <div class="sri-info">
          <span class="sri-nombre">${esc(p.nombre)} <span style="font-size:10px;color:var(--accent-3,#e08e0b)">📦 en otra cuenta</span></span>
          <span class="sri-meta">Producto · Solo en otra sucursal/bodega</span>
        </div>
        <span class="sri-costo">${fmt(p.precio)}</span>
      </div>`).join('');

    cont.innerHTML = htmlLocal + htmlGrupo;
  }
  window.buscarProductoCredito = buscarProductoCredito;

  function limpiarBusquedaProductoCredito() {
    const s = document.getElementById('nc-producto-search'); if (s) s.value = '';
    const r = document.getElementById('nc-producto-resultados'); if (r) r.innerHTML = '';
  }

  /* ===================================================
     STOCK COMPARTIDO — mismo mecanismo ya construido en Ventas.
     Si está desactivado, ninguna de estas funciones se dispara y el
     módulo funciona exactamente como antes.
  =================================================== */
  async function cargarEstadoStockCompartido() {
    try {
      const { data: activo, error } = await _sb.rpc('obtener_stock_compartido');
      if (error) throw error;
      CS.stockCompartidoActivo = !!activo;

      const { data: miFila } = await _sb.from('sucursales')
        .select('id').eq('auth_user_id_sucursal', CS.userId).maybeSingle();
      CS.miSucursalId = miFila?.id || null;

      const wrap = document.getElementById('stock-compartido-wrap');
      const chk  = document.getElementById('chk-stock-compartido');
      if (wrap && CS.miSucursalId) wrap.style.display = 'flex';
      if (chk) chk.checked = CS.stockCompartidoActivo;

      if (CS.stockCompartidoActivo) await cargarProductosGrupoCredito();
    } catch (e) {
      console.warn('cargarEstadoStockCompartido (creditos):', e);
      CS.stockCompartidoActivo = false;
    }
  }
  window.cargarEstadoStockCompartido = cargarEstadoStockCompartido;

  async function cargarProductosGrupoCredito() {
    try {
      const sbGrupo = crearClienteGrupo(_sb);
      const { data, error } = await sbGrupo.from('productos').select('*');
      if (error) throw error;
      CS.productosCacheGrupo = data || [];
    } catch (e) {
      console.warn('cargarProductosGrupoCredito:', e);
      CS.productosCacheGrupo = [];
    }
  }

  async function toggleStockCompartido(activo) {
    try {
      const { error } = await _sb.rpc('establecer_stock_compartido', { p_activo: activo });
      if (error) throw error;
      CS.stockCompartidoActivo = activo;
      if (activo) await cargarProductosGrupoCredito();
      showToast(activo ? 'Stock Compartido activado para todo el grupo' : 'Stock Compartido desactivado', 'success');
    } catch (e) {
      console.error('toggleStockCompartido (creditos):', e);
      showToast('No se pudo cambiar Stock Compartido', 'error');
      const chk = document.getElementById('chk-stock-compartido');
      if (chk) chk.checked = !activo;
    }
  }
  window.toggleStockCompartido = toggleStockCompartido;

  async function abrirSelectorStockOrigen(nombreProducto, callbackContinuar) {
    try {
      const { data, error } = await _sb.rpc('stock_grupo_por_nombre', { p_nombre: nombreProducto });
      if (error) throw error;
      const opciones = data || [];
      if (!opciones.length) { callbackContinuar(null); return; }

      CS.stockOrigenPendiente = { callback: callbackContinuar };
      document.getElementById('stock-origen-title').textContent = nombreProducto;
      document.getElementById('stock-origen-lista').innerHTML = opciones.map((o, i) => `
        <label class="esc-precio-opcion" style="${o.stock_actual<=0 ? 'opacity:.5' : ''}">
          <input type="radio" name="stock-origen-radio" value="${o.sucursal_id}"
                 data-stock="${o.stock_actual}" data-nombre="${esc(o.nombre_cuenta)}"
                 ${i===0 ? 'checked' : ''} ${o.stock_actual<=0 ? 'disabled' : ''}/>
          <span class="esc-precio-nombre">${o.tipo_cuenta==='bodega'?'📦':(o.es_central?'🏠':'🏬')} ${esc(o.nombre_cuenta)}</span>
          <span class="esc-precio-valor">${Number(o.stock_actual||0).toLocaleString('es-NI',{maximumFractionDigits:2})} disp.</span>
        </label>
      `).join('');
      openModal('modal-stock-origen');
    } catch (e) {
      console.error('abrirSelectorStockOrigen (creditos):', e);
      showToast('No se pudo consultar el stock del grupo', 'error');
      callbackContinuar(null);
    }
  }

  function confirmarSeleccionStockOrigen() {
    const pend = CS.stockOrigenPendiente;
    if (!pend) return;
    const radio = document.querySelector('input[name="stock-origen-radio"]:checked');
    if (!radio) { showToast('Elige de dónde sacar el stock', 'error'); return; }
    const stockDisp = parseFloat(radio.dataset.stock || 0);
    if (stockDisp <= 0) { showToast('Esa cuenta no tiene stock disponible de este producto', 'error'); return; }

    const origen = {
      sucursalId: radio.value, stockDisponible: stockDisp,
      nombreCuenta: radio.dataset.nombre, esLocal: radio.value === CS.miSucursalId,
    };
    closeModal('modal-stock-origen');
    CS.stockOrigenPendiente = null;
    pend.callback(origen);
  }
  window.confirmarSeleccionStockOrigen = confirmarSeleccionStockOrigen;

  function cerrarSelectorStockOrigen() {
    const pend = CS.stockOrigenPendiente;
    closeModal('modal-stock-origen');
    CS.stockOrigenPendiente = null;
    if (pend) pend.callback(null);
  }
  window.cerrarSelectorStockOrigen = cerrarSelectorStockOrigen;

  // Un producto que solo existe en OTRA cuenta del grupo — se salta
  // directo al selector de origen (no hay fila local que buscar).
  function agregarProductoSoloEnGrupoCredito(nombreProducto) {
    abrirSelectorStockOrigen(nombreProducto, async (origen) => {
      if (!origen || origen.esLocal) return;
      const refGrupo = CS.productosCacheGrupo.find(p => (p.nombre||'').trim().toLowerCase() === nombreProducto.trim().toLowerCase());
      if (!refGrupo) { showToast('No se pudo encontrar ese producto', 'error'); return; }

      CS.origenStockElegido = origen;
      const prodTemporal = {
        id: refGrupo.id, nombre: refGrupo.nombre, sku: refGrupo.sku,
        tipo: 'producto', tipo_precio: refGrupo.tipo_precio || 'fijo',
        precio: refGrupo.precio, costo: refGrupo.costo, stock_actual: origen.stockDisponible,
      };
      const yaEstaEnCache = CS.productos.some(p => p.id === prodTemporal.id);
      if (!yaEstaEnCache) CS.productos.push(prodTemporal);

      if (prodTemporal.tipo_precio === 'escala') {
        // Traer las escalas del producto remoto — antes se quedaban
        // vacías porque solo se cacheaban las de esta misma cuenta.
        if (!CS.escalasPorProducto[refGrupo.id]) {
          try {
            const sbGrupo = crearClienteGrupo(_sb);
            const { data } = await sbGrupo.from('precios_escala').select('*');
            CS.escalasPorProducto[refGrupo.id] = (data || []).filter(e => e.producto_id === refGrupo.id);
          } catch (e) {
            console.warn('No se pudieron cargar las escalas remotas:', e);
            CS.escalasPorProducto[refGrupo.id] = [];
          }
        }
        abrirSelectorEscalaCredito(prodTemporal.id, 1);
      } else {
        agregarItemCreditoConPrecio(prodTemporal, 1, null);
      }
      limpiarBusquedaProductoCredito();
    });
  }
  window.agregarProductoSoloEnGrupoCredito = agregarProductoSoloEnGrupoCredito;

  function agregarItemCredito(prodId) {
    const prod = CS.productos.find(p => p.id === prodId);
    if (!prod) return;

    const continuarNormal = () => {
      // Si es escala de precios, SIEMPRE se pregunta qué precio usar —
      // nunca se asume el que se eligió antes (igual que en Ventas).
      if (prod.tipo_precio === 'escala') {
        abrirSelectorEscalaCredito(prodId, 1);
        limpiarBusquedaProductoCredito();
        return;
      }
      agregarItemCreditoConPrecio(prod, 1, null);
      limpiarBusquedaProductoCredito();
    };

    // Stock Compartido activo: se pregunta primero de cuál sucursal/
    // bodega del grupo se va a descontar — si está desactivado, nunca
    // se ejecuta este bloque.
    if (CS.stockCompartidoActivo && prod.tipo === 'producto') {
      abrirSelectorStockOrigen(prod.nombre, (origen) => {
        if (!origen) return;
        CS.origenStockElegido = origen;
        continuarNormal();
      });
      return;
    }

    if (prod.tipo === 'producto' && Number(prod.stock_actual || 0) <= 0) {
      showToast(`"${prod.nombre}" no tiene stock disponible`, 'error'); return;
    }

    CS.origenStockElegido = null;
    continuarNormal();
  }
  window.agregarItemCredito = agregarItemCredito;

  function agregarItemCreditoConPrecio(prod, cantidad, escalaElegida) {
    const origen = CS.origenStockElegido; CS.origenStockElegido = null;
    const esRemoto = !!(origen && !origen.esLocal);

    const precioUsar = escalaElegida ? Number(escalaElegida.precio||0) : Number(prod.precio||0);
    const existente = CS.ncItems.find(i => i.producto_id === prod.id && (i.escala_id || null) === (escalaElegida?.id || null) && (i.origen_stock_id || null) === (esRemoto ? origen.sucursalId : null));
    if (existente) existente.cantidad += cantidad;
    else CS.ncItems.push({
      producto_id: prod.id, nombre: prod.nombre, tipo_item: prod.tipo,
      precio: precioUsar, costo: Number(prod.costo)||0, cantidad,
      escala_id: escalaElegida ? escalaElegida.id : null,
      escala_nombre: escalaElegida ? escalaElegida.nombre : null,
      esCombo: !!prod.esCombo,
      origen_stock_id:     esRemoto ? origen.sucursalId   : null,
      origen_stock_nombre: esRemoto ? origen.nombreCuenta : null,
    });
    renderNCItems();
    recalcularCredito();
  }

  // Cambiar la cantidad directo en la tabla de ítems ya agregados (antes
  // se fijaba solo al agregar; ahora que se agrega de a 1 con un clic,
  // esto es lo que reemplaza al campo "Cantidad" que tenía el selector).
  // Ajustar el precio de una línea SOLO para este crédito — nunca
  // cambia el precio ni la escala real del producto en Productos/Servicios.
  function actualizarPrecioItemCredito(idx, valor) {
    const it = CS.ncItems[idx];
    if (!it) return;
    const n = parseFloat(valor);
    if (isNaN(n) || n < 0) { renderNCItems(); return; }
    it.precio = round2(n);
    it.precio_editado = true;
    renderNCItems();
    recalcularCredito();
  }
  window.actualizarPrecioItemCredito = actualizarPrecioItemCredito;

  function actualizarCantidadItemCredito(idx, valor) {
    const it = CS.ncItems[idx];
    if (!it) return;
    let n = parseFloat(valor);
    if (isNaN(n) || n <= 0) n = 1;
    if (!it.esCombo) {
      const prod = CS.productos.find(p => p.id === it.producto_id);
      if (prod && prod.tipo === 'producto' && n > Number(prod.stock_actual||0)) {
        showToast(`Stock insuficiente (disponible: ${prod.stock_actual||0})`, 'error');
        n = Number(prod.stock_actual||0) || 1;
      }
    }
    it.cantidad = n;
    renderNCItems();
    recalcularCredito();
  }
  window.actualizarCantidadItemCredito = actualizarCantidadItemCredito;

  /* ===================================================
     SELECTOR DE ESCALA DE PRECIOS (crédito por venta)
     Se muestra únicamente cuando el producto tiene tipo_precio='escala';
     antes esos productos quedaban en C$0.00 porque su precio no vive en
     productos.precio sino en precios_escala. Mismo patrón que Ventas.
  =================================================== */
  function abrirSelectorEscalaCredito(productoId, cantidad) {
    const prod = CS.productos.find(p => p.id === productoId);
    const escalas = CS.escalasPorProducto[productoId] || [];
    if (!prod || !escalas.length) {
      showToast('Este producto no tiene precios de escala configurados', 'error');
      return;
    }
    CS.escalaPendiente = { productoId, cantidad };
    document.getElementById('esc-precio-title').textContent = prod.nombre;
    document.getElementById('esc-precio-lista').innerHTML = escalas.map((e, i) => `
      <label class="esc-precio-opcion">
        <input type="radio" name="esc-precio-radio-credito" value="${e.id}" ${i===0 ? 'checked' : ''} />
        <span class="esc-precio-nombre">${esc(e.nombre)}</span>
        <span class="esc-precio-valor">${fmt(e.precio)}</span>
      </label>`).join('');
    openModal('modal-escala-precio-credito');
  }
  window.abrirSelectorEscalaCredito = abrirSelectorEscalaCredito;

  function confirmarSeleccionEscalaCredito() {
    const pend = CS.escalaPendiente;
    if (!pend) return;
    const radio = document.querySelector('input[name="esc-precio-radio-credito"]:checked');
    if (!radio) { showToast('Selecciona un precio', 'error'); return; }
    const escalas = CS.escalasPorProducto[pend.productoId] || [];
    const escalaElegida = escalas.find(e => e.id === radio.value);
    const prod = CS.productos.find(p => p.id === pend.productoId);
    if (!escalaElegida || !prod) return;
    agregarItemCreditoConPrecio(prod, pend.cantidad, escalaElegida);
    closeModal('modal-escala-precio-credito');
    CS.escalaPendiente = null;
  }
  window.confirmarSeleccionEscalaCredito = confirmarSeleccionEscalaCredito;

  function cerrarSelectorEscalaCredito() {
    closeModal('modal-escala-precio-credito');
    CS.escalaPendiente = null;
  }
  window.cerrarSelectorEscalaCredito = cerrarSelectorEscalaCredito;

  function quitarItemCredito(idx) { CS.ncItems.splice(idx,1); renderNCItems(); recalcularCredito(); }
  window.quitarItemCredito = quitarItemCredito;

  function renderNCItems() {
    const tbody = document.getElementById('nc-items-tbody');
    if (!CS.ncItems.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Sin ítems agregados</td></tr>'; return; }
    tbody.innerHTML = CS.ncItems.map((it, idx) => `
      <tr>
        <td>${esc(it.nombre)}${it.esCombo ? `<div style="font-size:11px;color:var(--accent-4,var(--accent));font-weight:600">📦 Combo</div>` : ''}${it.escala_nombre ? `<div style="font-size:11px;color:var(--accent);font-weight:600">📊 ${esc(it.escala_nombre)}</div>` : ''}${it.precio_editado ? `<div style="font-size:10px;color:var(--text-muted)">✏️ Precio ajustado</div>` : ''}</td>
        <td><input type="number" value="${it.cantidad}" min="0.01" step="0.01"
              style="width:64px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg-app);color:var(--text-primary)"
              onchange="actualizarCantidadItemCredito(${idx}, this.value)"/></td>
        <td><input type="number" value="${it.precio}" min="0" step="0.01"
              title="Ajustar el precio solo para este crédito"
              style="width:78px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg-app);color:var(--text-primary);font-family:var(--font-mono)"
              onchange="actualizarPrecioItemCredito(${idx}, this.value)"/></td>
        <td>${fmt(round2(it.precio * it.cantidad))}</td>
        <td><button class="btn-ghost" style="padding:3px 8px" onclick="quitarItemCredito(${idx})">✕</button></td>
      </tr>`).join('');
  }

  /* ===================================================
     RECALCULAR CRÉDITO (preview en vivo)
  =================================================== */
  function calcularMontoOriginal() {
    const tipo = document.getElementById('nc-tipo').value;
    if (tipo === 'venta') {
      return round2(CS.ncItems.reduce((s,i)=>s + i.precio*i.cantidad, 0));
    }
    return parseFloat(document.getElementById('nc-monto-financiero').value) || 0;
  }

  function obtenerImpuestosSeleccionados() {
    const tipo = document.getElementById('nc-tipo').value;
    if (tipo === 'venta') {
      const ivaActivo = document.getElementById('nc-iva-activo')?.checked;
      if (!ivaActivo) return [];
      const ivaCatalogo = CS.impuestos.find(i => (i.nombre||'').toLowerCase() === 'iva');
      return [{ id: ivaCatalogo?.id || null, nombre: 'IVA', tipo_valor: 'porcentaje', valor: Number(CS.empresaConfig?.porcentaje_iva || 15) }];
    }
    // financiero: el impuesto solo aplica sobre el interés, y solo si hay interés
    const tipoFin = document.getElementById('nc-tipo-financiamiento').value;
    if (tipoFin !== 'con_interes') return [];
    const seleccionados = [];
    document.querySelectorAll('.nc-impuesto-chk:checked').forEach(chk => {
      seleccionados.push({ id: chk.value, nombre: chk.dataset.nombre, tipo_valor: chk.dataset.tipo, valor: Number(chk.dataset.valor)||0 });
    });
    return seleccionados;
  }

  function baseImpuestoActual() {
    return document.getElementById('nc-tipo').value === 'financiero' ? 'interes' : 'capital';
  }

  function recalcularCredito() {
    const montoOriginal = calcularMontoOriginal();
    document.getElementById('nc-monto-original').textContent = fmt(montoOriginal);

    if (document.getElementById('nc-tipo').value === 'venta') {
      const ivaPct = document.getElementById('nc-iva-activo')?.checked ? Number(CS.empresaConfig?.porcentaje_iva||15) : 0;
      document.getElementById('nc-subtotal').textContent = fmt(montoOriginal);
      document.getElementById('nc-iva-monto').textContent = fmt(montoOriginal * ivaPct/100);
    }

    const primaTipo = document.getElementById('nc-prima-tipo').value;
    const primaValor = parseFloat(document.getElementById('nc-prima-valor').value) || 0;
    const primaMonto = calcularPrima(montoOriginal, primaTipo, primaValor);
    const capitalFinanciado = round2(montoOriginal - primaMonto);
    document.getElementById('nc-capital-financiado').textContent = fmt(capitalFinanciado);

    const tipoFin = document.getElementById('nc-tipo-financiamiento').value;
    const tasa = parseFloat(document.getElementById('nc-tasa-interes').value) || 0;
    const metodo = document.getElementById('nc-metodo-amortizacion').value;
    const frecuencia = document.getElementById('nc-frecuencia').value;
    const numCuotas = parseInt(document.getElementById('nc-num-cuotas').value) || 1;
    const fechaInicio = document.getElementById('nc-fecha-inicio').value || todayISO();
    const impuestosLista = obtenerImpuestosSeleccionados();

    const { cuotas, totalIntereses, totalFinanciado, valorCuotaAprox } = generarAmortizacion({
      capitalFinanciado, tipoFinanciamiento: tipoFin, tasaInteres: tasa, metodo, frecuencia, numCuotas, fechaInicio, impuestosLista, baseImpuesto: baseImpuestoActual(),
    });
    CS.ncAmortizacionPreview = cuotas;
    document.getElementById('nc-total-intereses').textContent = fmt(totalIntereses);
    document.getElementById('nc-total-financiado').textContent = fmt(totalFinanciado);
    document.getElementById('nc-valor-cuota').textContent = fmt(valorCuotaAprox);
  }
  window.recalcularCredito = recalcularCredito;

  function previsualizarAmortizacion() {
    recalcularCredito();
    const wrap = document.getElementById('nc-amortizacion-wrap');
    const tbody = document.getElementById('nc-amortizacion-tbody');
    tbody.innerHTML = CS.ncAmortizacionPreview.map(c => `
      <tr>
        <td>${c.numero}</td><td>${fmtDate(c.fecha_vencimiento)}</td>
        <td>${fmt(c.capital)}</td><td>${fmt(c.interes)}</td><td>${fmt(c.impuesto)}</td>
        <td>${fmt(c.monto_total)}</td><td>${fmt(c.saldo)}</td>
      </tr>`).join('');
    wrap.style.display = 'block';
  }
  window.previsualizarAmortizacion = previsualizarAmortizacion;

  /* ===================================================
     ABRIR MODALES
  =================================================== */
  /* ===================================================
     EDITAR PRODUCTOS DE UN CRÉDITO (solo antes de cualquier pago)
     Reutiliza el MISMO modal de "Nuevo crédito" (mismo buscador de
     productos, misma lista) -- solo cambia qué pasa al guardar.
     Para las cuotas, en vez de duplicar esa lógica, se reutiliza el
     flujo de "Renegociar saldo restante" que ya existe y ya maneja
     bien los casos raros (cuotas pagadas, carrera con un pago, etc).
  =================================================== */
  let EDITANDO_PRODUCTOS_CREDITO_ID = null;

  // El botón del modal compartido llama a esto -- decide si crea un
  // crédito nuevo o guarda los cambios de uno existente.
  function guardarCredito() {
    if (EDITANDO_PRODUCTOS_CREDITO_ID) confirmarEditarProductosCredito();
    else confirmarNuevoCredito();
  }
  window.guardarCredito = guardarCredito;

  async function abrirEditarProductosCredito(creditoId) {
    const { data: credito } = await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle();
    if (!credito) { showToast('Crédito no encontrado', 'error'); return; }
    if (credito.estado !== 'en_proceso') {
      showToast('Ya no se pueden editar los productos — este crédito ya tiene pagos registrados. Usa "Renegociar saldo restante" en su lugar.', 'error');
      return;
    }
    const { data: detalles } = await _sb.from('venta_detalles').select('*').eq('venta_id', credito.venta_id).order('created_at');

    EDITANDO_PRODUCTOS_CREDITO_ID = creditoId;
    CS.ncItems = (detalles||[]).map(d => ({
      producto_id: d.combo_id || d.producto_id, nombre: d.producto_nombre, tipo_item: d.tipo_item,
      precio: Number(d.precio)||0, costo: Number(d.costo)||0, cantidad: Number(d.cantidad)||1,
      escala_id: d.escala_id || null, escala_nombre: d.escala_nombre || null,
      esCombo: !!d.combo_id, origen_stock_id: null, origen_stock_nombre: null,
    }));
    renderNCItems();
    document.getElementById('nc-cliente').value = credito.cliente_id;
    document.getElementById('nc-observaciones').value = credito.observaciones || '';
    setTipoCredito('venta');
    const selTipo = document.getElementById('nc-tipo');
    if (selTipo) selTipo.disabled = true; // editando productos no se cambia si era venta o financiero
    document.getElementById('nc-modal-titulo').textContent = `Editar productos — ${credito.numero_credito}`;
    document.getElementById('btn-crear-credito').textContent = 'Guardar cambios';
    recalcularCredito();
    closeModal('modal-detalle-credito');
    openModal('modal-nuevo-credito');
  }
  window.abrirEditarProductosCredito = abrirEditarProductosCredito;

  async function confirmarEditarProductosCredito() {
    const creditoId = EDITANDO_PRODUCTOS_CREDITO_ID;
    if (!CS.ncItems.length) { showToast('Agrega al menos un producto o servicio', 'error'); return; }

    const btn = document.getElementById('btn-crear-credito');
    btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const { data: credito } = await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle();
      if (!credito) throw new Error('Crédito no encontrado');
      if (credito.estado !== 'en_proceso') throw new Error('Este crédito ya tiene pagos registrados — ya no se puede editar así');

      const { data: detallesViejos } = await _sb.from('venta_detalles').select('*').eq('venta_id', credito.venta_id);

      // Devolver al inventario lo que tenía la venta ANTES de editar
      // (productos normales y componentes de combos), luego descontar
      // lo que corresponde a la lista NUEVA -- así el stock siempre
      // queda igual de exacto que si se hubiera vendido así desde el
      // principio, sin importar cuántas veces se edite.
      for (const d of (detallesViejos||[])) {
        if (d.tipo_item !== 'producto') continue;
        if (d.combo_id) {
          const { data: itemsCombo } = await _sb.from('combo_items').select('producto_id, cantidad').eq('combo_id', d.combo_id).eq('auth_user_id', CS.userId);
          for (const compItem of (itemsCombo||[])) {
            const { data: prodActual } = await _sb.from('productos').select('stock_actual').eq('id', compItem.producto_id).eq('auth_user_id', CS.userId).maybeSingle();
            if (!prodActual) continue;
            const devolver = Number(compItem.cantidad) * d.cantidad;
            await _sb.from('productos').update({ stock_actual: Number(prodActual.stock_actual||0) + devolver }).eq('id', compItem.producto_id).eq('auth_user_id', CS.userId);
          }
        } else if (d.producto_id) {
          const { data: prodActual } = await _sb.from('productos').select('stock_actual').eq('id', d.producto_id).eq('auth_user_id', CS.userId).maybeSingle();
          if (!prodActual) continue;
          await _sb.from('productos').update({ stock_actual: Number(prodActual.stock_actual||0) + Number(d.cantidad||0) }).eq('id', d.producto_id).eq('auth_user_id', CS.userId);
        }
      }

      // Descontar la lista NUEVA
      for (const it of CS.ncItems) {
        if (it.tipo_item !== 'producto' || it.esCombo) continue;
        const prod = CS.productos.find(p => p.id === it.producto_id);
        if (!prod) continue;
        const nuevoStock = Math.max(0, Number(prod.stock_actual||0) - it.cantidad);
        await _sb.from('productos').update({ stock_actual: nuevoStock }).eq('id', it.producto_id).eq('auth_user_id', CS.userId);
      }
      for (const it of CS.ncItems.filter(i => i.esCombo)) {
        const { data: itemsCombo } = await _sb.from('combo_items').select('producto_id, cantidad').eq('combo_id', it.producto_id).eq('auth_user_id', CS.userId);
        for (const compItem of (itemsCombo||[])) {
          const { data: prodActual } = await _sb.from('productos').select('stock_actual').eq('id', compItem.producto_id).eq('auth_user_id', CS.userId).maybeSingle();
          if (!prodActual) continue;
          const descontar = Number(compItem.cantidad) * it.cantidad;
          await _sb.from('productos').update({ stock_actual: Math.max(0, Number(prodActual.stock_actual||0) - descontar) }).eq('id', compItem.producto_id).eq('auth_user_id', CS.userId);
        }
      }

      // Reemplazar los detalles de la venta
      await _sb.from('venta_detalles').delete().eq('venta_id', credito.venta_id);
      const nuevosDetalles = CS.ncItems.map(it => ({
        venta_id: credito.venta_id, auth_user_id: CS.userId, producto_id: it.esCombo ? null : it.producto_id,
        combo_id: it.esCombo ? it.producto_id : null, producto_nombre: it.nombre, tipo_item: it.esCombo ? 'combo' : it.tipo_item,
        cantidad: it.cantidad, precio: it.precio, costo: it.costo, subtotal: round2(it.precio*it.cantidad),
        ganancia: round2((it.precio-it.costo)*it.cantidad), escala_id: it.escala_id||null, escala_nombre: it.escala_nombre||null,
      }));
      let { error: errDet } = await _sb.from('venta_detalles').insert(nuevosDetalles);
      if (errDet) ({ error: errDet } = await _sb.from('venta_detalles').insert(nuevosDetalles.map(({combo_id,...r}) => r)));
      if (errDet) throw errDet;

      // Recalcular subtotal/impuesto/total de la venta con la lista nueva
      const { data: venta } = await _sb.from('ventas').select('*').eq('id', credito.venta_id).maybeSingle();
      const subtotal = round2(CS.ncItems.reduce((s,i)=>s+i.precio*i.cantidad,0));
      const ivaPct = Number(venta?.iva_porcentaje || 0);
      const ivaMonto = round2(subtotal * ivaPct/100);
      const total = round2(subtotal + ivaMonto);
      const costoTotal = round2(CS.ncItems.reduce((s,i)=>s+i.costo*i.cantidad,0));
      await _sb.from('ventas').update({ subtotal, impuesto: ivaMonto, total, costo_total: costoTotal }).eq('id', credito.venta_id);

      // El nuevo capital financiado = nuevo total menos la MISMA prima que ya tenía
      const nuevoCapitalFinanciado = round2(total - Number(credito.prima_monto||0));
      await _sb.from('creditos').update({
        monto_original: total, capital_financiado: nuevoCapitalFinanciado, updated_at: new Date().toISOString(),
      }).eq('id', creditoId);

      await registrarHistorial(creditoId, 'editado', `Productos editados — nuevo capital financiado: ${fmt(nuevoCapitalFinanciado)}`, { nuevoCapitalFinanciado });

      showToast('Productos actualizados — ahora define cómo quedan las cuotas');
      EDITANDO_PRODUCTOS_CREDITO_ID = null;
      closeModal('modal-nuevo-credito');
      document.getElementById('nc-tipo').disabled = false;

      // Las cuotas se definen reutilizando el flujo de "Renegociar
      // saldo restante" ya existente -- como este crédito nunca tuvo
      // pagos, ahí simplemente regenera todas las cuotas desde cero.
      await abrirEditarCredito(creditoId);
    } catch (e) {
      console.error('confirmarEditarProductosCredito:', e);
      showToast('Error al guardar los cambios: ' + (e.message||''), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear crédito';
    }
  }
  window.confirmarEditarProductosCredito = confirmarEditarProductosCredito;

  function abrirNuevoCredito() {
    EDITANDO_PRODUCTOS_CREDITO_ID = null;
    document.getElementById('nc-modal-titulo').textContent = 'Nuevo crédito';
    document.getElementById('btn-crear-credito').textContent = 'Crear crédito';
    const selTipo = document.getElementById('nc-tipo');
    if (selTipo) selTipo.disabled = false;
    CS.ncItems = [];
    CS.escalaPendiente = null;
    renderNCItems();
    document.getElementById('nc-fecha-inicio').value = todayISO();
    document.getElementById('nc-monto-financiero').value = '';
    document.getElementById('nc-producto-financiero-nombre').value = '';
    document.getElementById('nc-prima-tipo').value = 'ninguna';
    document.getElementById('nc-prima-valor').value = '';
    document.getElementById('nc-tasa-interes').value = '';
    document.getElementById('nc-num-cuotas').value = 12;
    document.getElementById('nc-observaciones').value = '';
    document.getElementById('nc-amortizacion-wrap').style.display = 'none';
    setTipoCredito('venta');
    setTipoFinanciamiento('sin_interes');
    toggleNCPrima();
    recalcularCredito();
    openModal('modal-nuevo-credito');
  }
  window.abrirNuevoCredito = abrirNuevoCredito;

  // Abre "Nuevo crédito" prellenado con el cliente y los productos de
  // una proforma — el usuario solo decide cuánto le están dando ahora
  // (la "prima") y cómo queda el resto (fecha fija o cuotas). El
  // crédito se crea con la MISMA función de siempre (confirmarNuevoCredito),
  // nunca con un cálculo aparte.
  CS.proformaOrigenId = null;
  function abrirNuevoCreditoDesdeProforma(payloadEncoded) {
    let payload;
    try { payload = JSON.parse(decodeURIComponent(escape(atob(payloadEncoded)))); }
    catch (e) { console.error('No se pudo leer la proforma:', e); return; }

    abrirNuevoCredito();
    CS.proformaOrigenId = payload.proformaId;
    document.getElementById('nc-cliente').value = payload.clienteId || '';
    CS.ncItems = (payload.items || []).map(it => ({
      producto_id: it.producto_id, nombre: it.nombre, tipo_item: it.tipo_item,
      precio: Number(it.precio) || 0, costo: Number(it.costo) || 0, cantidad: Number(it.cantidad) || 1,
      escala_id: it.escala_id || null, escala_nombre: it.escala_nombre || null,
      esCombo: !!it.combo_id,
      origen_stock_id: it.origen_stock_id || null, origen_stock_nombre: it.origen_stock_nombre || null,
    }));
    renderNCItems();
    recalcularCredito();

    const aviso = document.getElementById('nc-aviso-proforma');
    if (aviso) { aviso.style.display = ''; aviso.textContent = `📋 Creando este crédito a partir de la proforma ${payload.numeroProforma || ''} — el pago que registres ahora será la prima inicial.`; }
  }
  window.abrirNuevoCreditoDesdeProforma = abrirNuevoCreditoDesdeProforma;

  function abrirCreditoExistente() {
    document.getElementById('ce-fecha-original').value = todayISO();
    document.getElementById('ce-proximo-vencimiento').value = sumarFrecuencia(todayISO(),'mensual',1);
    ['ce-capital-original','ce-saldo-pendiente','ce-observaciones'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('ce-num-cuotas').value = 1;
    document.getElementById('ce-cuotas-restantes').value = 1;
    openModal('modal-credito-existente');
  }
  window.abrirCreditoExistente = abrirCreditoExistente;

  async function abrirRegistrarPago(creditoId) {
    // Se usa un helper seguro en vez de asumir que el elemento
    // siempre existe — si el navegador tiene una versión vieja
    // cacheada del HTML (desfasada del JS más nuevo), esto evita que
    // TODO el botón se rompa por un solo elemento que falte.
    const ocultar = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
    const vaciar = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };

    ocultar('rp-resumen');
    vaciar('rp-monto');
    vaciar('rp-observaciones');
    _bancoElegidoIdCred = null;
    ocultar('rp-banco-elegir-wrap');
    ocultar('rp-banco-elegido-wrap');
    openModal('modal-registrar-pago');
    if (creditoId) {
      const credito = CS.creditos.find(c => c.id === creditoId) || (await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle()).data;
      if (credito) {
        document.getElementById('rp-cliente').value = credito.cliente_id;
        await cargarCreditosDelCliente();
        document.getElementById('rp-credito').value = credito.id;
        await cargarResumenCredito();
      }
    }
  }
  window.abrirRegistrarPago = abrirRegistrarPago;

  async function cargarCreditosDelCliente() {
    const clienteId = document.getElementById('rp-cliente').value;
    const sel = document.getElementById('rp-credito');
    sel.innerHTML = '<option value="">Cargando…</option>';
    document.getElementById('rp-resumen').style.display = 'none';
    if (!clienteId) { sel.innerHTML = '<option value="">Selecciona un cliente primero…</option>'; return; }
    const { data } = await _sb.from('creditos').select('*')
      .eq('auth_user_id', CS.userId).eq('cliente_id', clienteId)
      .not('estado', 'in', '("cancelado")').order('created_at', { ascending:false });
    const abiertos = data || [];
    sel.innerHTML = abiertos.length
      ? abiertos.map(c => `<option value="${c.id}">${esc(c.numero_credito)} — ${fmt(c.saldo_pendiente)} pendiente</option>`).join('')
      : '<option value="">Este cliente no tiene créditos activos</option>';
  }
  window.cargarCreditosDelCliente = cargarCreditosDelCliente;

  async function cargarResumenCredito() {
    const creditoId = document.getElementById('rp-credito').value;
    if (!creditoId) { document.getElementById('rp-resumen').style.display = 'none'; return; }
    const { data: credito } = await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle();
    const { data: cuotas } = await _sb.from('creditos_cuotas').select('*')
      .eq('credito_id', creditoId).neq('estado','pagada').order('numero');
    if (!credito) return;
    document.getElementById('rp-resumen').style.display = 'grid';
    document.getElementById('rp-saldo').textContent = fmt(credito.saldo_pendiente);
    document.getElementById('rp-cuotas-pendientes').textContent = (cuotas||[]).length;
    const prox = (cuotas||[])[0];
    document.getElementById('rp-proxima-cuota').textContent = prox ? `${fmtDate(prox.fecha_vencimiento)} · ${fmt(prox.monto_total - prox.monto_pagado)}` : '—';
    document.getElementById('rp-monto').value = prox ? round2(prox.monto_total - prox.monto_pagado) : '';
  }
  window.cargarResumenCredito = cargarResumenCredito;

  /* ===================================================
     CONFIRMAR NUEVO CRÉDITO
  =================================================== */
  async function confirmarNuevoCredito() {
    const btn = document.getElementById('btn-crear-credito');
    const tipo = document.getElementById('nc-tipo').value;
    const clienteId = document.getElementById('nc-cliente').value;
    if (!clienteId) { showToast('Selecciona un cliente', 'error'); return; }
    if (tipo === 'venta' && !CS.ncItems.length) { showToast('Agrega al menos un producto o servicio', 'error'); return; }
    if (tipo === 'financiero' && !document.getElementById('nc-producto-financiero-nombre').value.trim()) { showToast('Escribe el nombre del préstamo o financiamiento', 'error'); return; }

    const montoOriginal = calcularMontoOriginal();
    if (montoOriginal <= 0) { showToast('El monto debe ser mayor a cero', 'error'); return; }

    // Un préstamo/financiamiento sale de Caja: si no hay fondos suficientes, no se crea el crédito.
    if (tipo === 'financiero') {
      const saldoCaja = await window.CajaAPI.getCapital(CS.userId);
      if (montoOriginal > saldoCaja + 0.01) {
        showToast(`Fondos insuficientes en caja para este préstamo. Saldo disponible: ${fmt(saldoCaja)}`, 'error');
        return;
      }
    }

    const primaTipo = document.getElementById('nc-prima-tipo').value;
    const primaValor = parseFloat(document.getElementById('nc-prima-valor').value) || 0;
    const primaMonto = calcularPrima(montoOriginal, primaTipo, primaValor);
    const capitalFinanciado = round2(montoOriginal - primaMonto);
    const tipoFin = document.getElementById('nc-tipo-financiamiento').value;
    const tasa = parseFloat(document.getElementById('nc-tasa-interes').value) || 0;
    const metodo = document.getElementById('nc-metodo-amortizacion').value;
    const frecuencia = document.getElementById('nc-frecuencia').value;
    const numCuotas = parseInt(document.getElementById('nc-num-cuotas').value) || 1;
    const fechaInicio = document.getElementById('nc-fecha-inicio').value || todayISO();
    const impuestosLista = obtenerImpuestosSeleccionados();
    const observaciones = document.getElementById('nc-observaciones').value.trim() || null;

    const { cuotas, totalIntereses, totalFinanciado, valorCuotaAprox } = generarAmortizacion({
      capitalFinanciado, tipoFinanciamiento: tipoFin, tasaInteres: tasa, metodo, frecuencia, numCuotas, fechaInicio, impuestosLista, baseImpuesto: baseImpuestoActual(),
    });

    btn.disabled = true; btn.textContent = 'Creando…';
    try {
      let ventaId = null;
      const cliente = CS.clientes.find(c => c.id === clienteId);

      if (tipo === 'venta') {
        // 1) Crear la venta (reutiliza exactamente la lógica de Ventas: descuenta stock, calcula impuesto)
        const numeroVenta = await generarNumeroVenta();
        const ivaActivo = document.getElementById('nc-iva-activo')?.checked || false;
        const ivaPct = ivaActivo ? Number(CS.empresaConfig?.porcentaje_iva || 15) : 0;
        const subtotal = round2(CS.ncItems.reduce((s,i)=>s+i.precio*i.cantidad,0));
        const costoTotal = round2(CS.ncItems.reduce((s,i)=>s+i.costo*i.cantidad,0));
        const ivaMonto = round2(subtotal * ivaPct/100);
        const total = round2(subtotal + ivaMonto);

        const { data: venta, error: errVenta } = await _sb.from('ventas').insert({
          auth_user_id: CS.userId, cliente_id: clienteId, cliente_nombre: `${cliente?.nombre||''} ${cliente?.apellido||''}`.trim(),
          numero_venta: numeroVenta, subtotal, impuesto: ivaMonto, total, costo_total: costoTotal,
          metodo_pago: 'credito', estado_pago: 'credito', estado: 'completada',
          iva_activo: ivaActivo, iva_porcentaje: ivaPct,
          categoria: 'credito', notas: 'Venta generada automáticamente por el módulo de Créditos',
        }).select().single();
        if (errVenta) throw errVenta;
        ventaId = venta.id;

        const detalles = CS.ncItems.map(it => ({
          venta_id: ventaId, auth_user_id: CS.userId, producto_id: it.esCombo ? null : it.producto_id,
          combo_id: it.esCombo ? it.producto_id : null,
          producto_nombre: it.nombre, tipo_item: it.esCombo ? 'combo' : it.tipo_item, cantidad: it.cantidad,
          precio: it.precio, costo: it.costo, subtotal: round2(it.precio*it.cantidad),
          ganancia: round2((it.precio-it.costo)*it.cantidad),
          escala_id: it.escala_id || null, escala_nombre: it.escala_nombre || null,
        }));
        let { error: errDet } = await _sb.from('venta_detalles').insert(detalles);
        if (errDet) {
          // Reintentar sin combo_id por si la migración aún no llegó a este entorno
          ({ error: errDet } = await _sb.from('venta_detalles').insert(
            detalles.map(({ combo_id, ...resto }) => resto)
          ));
        }
        if (errDet) throw errDet;

        // Descontar stock solo de productos normales (no servicios, no combos)
        for (const it of CS.ncItems) {
          if (it.tipo_item !== 'producto' || it.esCombo) continue;
          if (it.origen_stock_id) {
            // Stock Compartido: se descuenta de OTRA cuenta del grupo.
            try {
              const { error: errRemoto } = await _sb.rpc('descontar_stock_remoto', {
                p_sucursal_id: it.origen_stock_id, p_nombre_producto: it.nombre, p_cantidad: it.cantidad,
              });
              if (errRemoto) console.warn('Error descontando stock remoto:', it.nombre, errRemoto);
            } catch (eRemoto) { console.warn('Error descontando stock remoto:', it.nombre, eRemoto); }
            continue;
          }
          const prod = CS.productos.find(p => p.id === it.producto_id);
          if (!prod) continue;
          const nuevoStock = Math.max(0, Number(prod.stock_actual||0) - it.cantidad);
          await _sb.from('productos').update({ stock_actual: nuevoStock }).eq('id', it.producto_id).eq('auth_user_id', CS.userId);
        }

        // Combos vendidos a crédito: descontar el stock de CADA producto
        // que los compone (cantidad del componente × cantidad vendida).
        for (const it of CS.ncItems.filter(i => i.esCombo)) {
          try {
            const { data: itemsCombo } = await _sb.from('combo_items')
              .select('producto_id, cantidad').eq('combo_id', it.producto_id).eq('auth_user_id', CS.userId);
            for (const compItem of (itemsCombo || [])) {
              const { data: prodActual } = await _sb.from('productos')
                .select('stock_actual').eq('id', compItem.producto_id).eq('auth_user_id', CS.userId).maybeSingle();
              if (!prodActual) continue;
              const descuentoTotal = Number(compItem.cantidad) * it.cantidad;
              const nuevoStock = Math.max(0, Number(prodActual.stock_actual || 0) - descuentoTotal);
              await _sb.from('productos').update({ stock_actual: nuevoStock })
                .eq('id', compItem.producto_id).eq('auth_user_id', CS.userId);
            }
          } catch (eCombo) {
            console.warn('No se pudo descontar el stock de los componentes del combo:', it.nombre, eCombo);
          }
        }

        // Un crédito por venta SÍ es una compra real del cliente — se
        // suma a su ficha igual que ya pasa en Ventas y Proformas. Antes
        // esto no se hacía, así que el "total comprado" de un cliente
        // que compraba a crédito se veía incompleto (le faltaba justo
        // eso: sus compras a crédito).
        try {
          const { data: cliActualizar } = await _sb.from('clientes')
            .select('total_compras, num_compras').eq('id', clienteId).eq('auth_user_id', CS.userId).maybeSingle();
          if (cliActualizar) {
            await _sb.from('clientes').update({
              total_compras: round2(Number(cliActualizar.total_compras||0) + total),
              num_compras: Number(cliActualizar.num_compras||0) + 1,
            }).eq('id', clienteId).eq('auth_user_id', CS.userId);
          }
        } catch (eCli) {
          console.warn('No se pudo actualizar el contador del cliente:', eCli);
        }
      }

      // 2) Producto financiero: el usuario solo escribe el nombre; se reutiliza o se crea
      //    automáticamente en el catálogo de Productos/Servicios (tipo "financiero"), sin
      //    obligar al usuario a salir de este modal.
      let productoFinancieroId = null;
      if (tipo === 'financiero') {
        const nombreFin = document.getElementById('nc-producto-financiero-nombre').value.trim();
        const existente = CS.productosFinancieros.find(p => (p.nombre||'').trim().toLowerCase() === nombreFin.toLowerCase());
        if (existente) {
          productoFinancieroId = existente.id;
        } else {
          const { data: nuevoProd, error: errProd } = await _sb.from('productos').insert({
            auth_user_id: CS.userId, tipo: 'financiero', nombre: nombreFin, activo: true,
          }).select().single();
          if (errProd) throw errProd;
          productoFinancieroId = nuevoProd.id;
          CS.productosFinancieros.push(nuevoProd);
        }
      }

      // 3) Crear el crédito
      const numeroCredito = await generarNumeroCredito();
      const { data: credito, error: errCredito } = await _sb.from('creditos').insert({
        auth_user_id: CS.userId, numero_credito: numeroCredito, tipo, cliente_id: clienteId,
        venta_id: ventaId, producto_financiero_id: productoFinancieroId,
        monto_original: montoOriginal, prima_tipo: primaTipo, prima_valor: primaValor, prima_monto: primaMonto,
        capital_financiado: capitalFinanciado, tipo_financiamiento: tipoFin,
        tasa_interes: tipoFin==='con_interes' ? tasa : null, tipo_interes: tipoFin==='con_interes' ? metodo : null,
        metodo_amortizacion: metodo, frecuencia, num_cuotas: numCuotas, fecha_inicio: fechaInicio,
        total_intereses: totalIntereses, total_financiado: totalFinanciado, valor_cuota_aprox: valorCuotaAprox,
        saldo_pendiente: totalFinanciado, estado: 'en_proceso', observaciones,
      }).select().single();
      if (errCredito) throw errCredito;

      // 3) Crear cuotas
      const cuotasInsert = cuotas.map(c => ({
        auth_user_id: CS.userId, credito_id: credito.id, numero: c.numero,
        fecha_vencimiento: c.fecha_vencimiento, capital: c.capital, interes: c.interes,
        impuesto: c.impuesto, impuestos_detalle: c.impuestos_detalle || [], monto_total: c.monto_total, saldo: c.saldo, estado: 'pendiente',
      }));
      const { error: errCuotas } = await _sb.from('creditos_cuotas').insert(cuotasInsert);
      if (errCuotas) throw errCuotas;

      // 4) Activar el crédito y registrar historial
      await _sb.from('creditos').update({ estado: 'activo' }).eq('id', credito.id);
      await registrarHistorial(credito.id, 'creado', `Crédito ${numeroCredito} creado (${tipo}) por ${fmt(totalFinanciado)}`, { numeroCredito, tipo, totalFinanciado });

      // 5) Si es un préstamo financiero, el monto entregado sale de Caja (egreso).
      //    El saldo ya se validó al inicio, así que esto no debería fallar por fondos
      //    insuficientes, pero se avisa igual si CajaAPI no pudo registrar el movimiento.
      if (tipo === 'financiero') {
        const cajaRes = await registrarEnCaja({
          auth_user_id: CS.userId, tipo_flujo: 'EGRESO', tipo_movimiento: 'CREDITO_OTORGADO',
          concepto: `Préstamo otorgado — crédito ${numeroCredito}`, monto: montoOriginal,
          referencia_tipo: 'credito', referencia_id: credito.id, observaciones,
        });
        if (!cajaRes.ok) {
          showToast('El crédito se creó, pero no se pudo descontar de caja: ' + cajaRes.error, 'error');
        } else {
          await registrarHistorial(credito.id, 'desembolso', `Se descontaron ${fmt(montoOriginal)} de Caja por el préstamo otorgado`, {});
        }
      }

      showToast(`Crédito ${numeroCredito} creado correctamente`, 'success');
      closeModal('modal-nuevo-credito');

      // Si este crédito se creó desde una Proforma (iframe incrustado),
      // se le avisa al padre — Proformas nunca calcula el crédito, solo
      // reacciona cuando de verdad ya se creó.
      if (CS.proformaOrigenId && window.self !== window.top) {
        try { window.parent.postMessage({ tipo: 'n360_credito_desde_proforma', creditoId: credito.id, proformaId: CS.proformaOrigenId }, '*'); } catch(e) {}
      }

      await refrescarTodo();
    } catch (e) {
      console.error('confirmarNuevoCredito:', e);
      showToast('Error al crear el crédito: ' + (e.message||e), 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Crear crédito';
    }
  }
  window.confirmarNuevoCredito = confirmarNuevoCredito;

  /* ===================================================
     REGISTRAR CRÉDITO EXISTENTE (fiados previos a Negocio360)
  =================================================== */
  async function confirmarCreditoExistente() {
    const clienteId = document.getElementById('ce-cliente').value;
    const capitalOriginal = parseFloat(document.getElementById('ce-capital-original').value) || 0;
    const saldoPendiente = parseFloat(document.getElementById('ce-saldo-pendiente').value) || 0;
    const cuotasRestantes = parseInt(document.getElementById('ce-cuotas-restantes').value) || 1;
    const numCuotasOriginal = parseInt(document.getElementById('ce-num-cuotas').value) || cuotasRestantes;
    const frecuencia = document.getElementById('ce-frecuencia').value;
    const fechaOriginal = document.getElementById('ce-fecha-original').value || todayISO();
    const proximoVencimiento = document.getElementById('ce-proximo-vencimiento').value || todayISO();
    const observaciones = document.getElementById('ce-observaciones').value.trim() || null;

    if (!clienteId) { showToast('Selecciona un cliente', 'error'); return; }
    if (saldoPendiente <= 0) { showToast('El saldo pendiente debe ser mayor a cero', 'error'); return; }

    try {
      const numeroCredito = await generarNumeroCredito();
      const { data: credito, error } = await _sb.from('creditos').insert({
        auth_user_id: CS.userId, numero_credito: numeroCredito, tipo: 'financiero', cliente_id: clienteId,
        monto_original: capitalOriginal || saldoPendiente, prima_tipo: 'ninguna', prima_monto: 0,
        capital_financiado: capitalOriginal || saldoPendiente, tipo_financiamiento: 'sin_interes',
        metodo_amortizacion: 'simple', frecuencia, num_cuotas: numCuotasOriginal, fecha_inicio: fechaOriginal,
        total_intereses: 0, total_financiado: saldoPendiente, valor_cuota_aprox: round2(saldoPendiente/cuotasRestantes),
        saldo_pendiente: saldoPendiente, estado: 'activo', es_existente: true, observaciones,
      }).select().single();
      if (error) throw error;

      // Reparte el saldo restante en las cuotas restantes, comenzando en el próximo vencimiento
      const cuotaBase = round2(saldoPendiente / cuotasRestantes);
      let saldo = saldoPendiente;
      const cuotasInsert = [];
      for (let i = 1; i <= cuotasRestantes; i++) {
        const esUltima = i === cuotasRestantes;
        const monto = esUltima ? round2(saldo) : cuotaBase;
        saldo = round2(saldo - monto);
        cuotasInsert.push({
          auth_user_id: CS.userId, credito_id: credito.id, numero: i,
          fecha_vencimiento: i===1 ? proximoVencimiento : sumarFrecuencia(proximoVencimiento, frecuencia, i-1),
          capital: monto, interes: 0, impuesto: 0, monto_total: monto, saldo, estado: 'pendiente',
        });
      }
      await _sb.from('creditos_cuotas').insert(cuotasInsert);
      await registrarHistorial(credito.id, 'creado', `Crédito existente ${numeroCredito} registrado con saldo ${fmt(saldoPendiente)}`, {});

      showToast(`Crédito existente ${numeroCredito} registrado`, 'success');
      closeModal('modal-credito-existente');
      await refrescarTodo();
    } catch (e) {
      console.error('confirmarCreditoExistente:', e);
      showToast('Error al registrar el crédito existente: ' + (e.message||e), 'error');
    }
  }
  window.confirmarCreditoExistente = confirmarCreditoExistente;

  /* ===================================================
     REGISTRAR PAGO
  =================================================== */
  /* ===================================================
     ¿A QUÉ BANCO ENTRA? — aparece EN EL MOMENTO de elegir Tarjeta o
     Transferencia en el select de método (no al final, al
     confirmar), con tarjetas para tocar y una "✕" para regresar.
     Sin bancos creados, esto nunca aparece.
  =================================================== */
  async function cargarBancosDisponiblesCred() {
    if (_bancosCacheCred) return _bancosCacheCred;
    try {
      const { data } = await _sb.from('bancos').select('*').eq('auth_user_id', CS.userId).eq('activo', true).order('created_at');
      _bancosCacheCred = data || [];
    } catch (e) { _bancosCacheCred = []; }
    return _bancosCacheCred;
  }
  window.mostrarSelectorBancoCred = async function(metodoPagoNombre) {
    const elById = (id) => document.getElementById(id);
    const ocultar = (id) => { const el = elById(id); if (el) el.style.display = 'none'; };

    ocultar('rp-banco-elegir-wrap');
    ocultar('rp-banco-elegido-wrap');
    _bancoElegidoIdCred = null;
    const metodo = (metodoPagoNombre || '').toLowerCase();
    if (!metodo.includes('tarjeta') && !metodo.includes('transferencia')) return;

    const bancos = await cargarBancosDisponiblesCred();
    if (!bancos.length) return; // sin bancos creados, sigue todo normal

    const monedaBase = CS.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    const elMetodo = elById('rp-banco-elegir-metodo'); if (elMetodo) elMetodo.textContent = metodoPagoNombre;
    const elGrid = elById('rp-banco-elegir-grid');
    if (elGrid) elGrid.innerHTML = bancos.map(b => `
      <div class="metodo-card" onclick="elegirBancoCred('${b.id}','${esc(b.nombre)}','${b.moneda||'NIO'}')">
        <span class="mc-icon">🏦</span>
        <span class="mc-name">${esc(b.nombre)}${(b.moneda||'NIO')!==monedaBase ? ` <b style="color:var(--accent)">(${b.moneda})</b>` : ''}</span>
      </div>`).join('');
    const elWrap = elById('rp-banco-elegir-wrap'); if (elWrap) elWrap.style.display = '';
  };
  window.elegirBancoCred = function(bancoId, bancoNombre, monedaBanco) {
    _bancoElegidoIdCred = bancoId;
    const elWrap = document.getElementById('rp-banco-elegir-wrap'); if (elWrap) elWrap.style.display = 'none';

    const monedaBase = CS.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
    const esOtraMoneda = (monedaBanco||'NIO') !== monedaBase;
    const montoPago = parseFloat(document.getElementById('rp-monto')?.value) || 0;
    const elNombre = document.getElementById('rp-banco-elegido-nombre');

    if (esOtraMoneda) {
      const tasa = Number(CS.empresaConfig?.tasa_cambio_usd || 0);
      if (!tasa) {
        if (elNombre) elNombre.innerHTML = `${esc(bancoNombre)} <span style="color:var(--danger)">— falta configurar tu tasa de cambio en Caja › Bancos</span>`;
        _montoBancoConvertidoCred = null;
      } else {
        const montoConvertido = Math.round((monedaBase === 'NIO' ? montoPago / tasa : montoPago * tasa) * 100) / 100;
        _montoBancoConvertidoCred = montoConvertido;
        if (elNombre) elNombre.innerHTML = `${esc(bancoNombre)} — se registrará como ${monedaBanco==='USD'?'$':'C$'} ${montoConvertido.toLocaleString('es-NI',{minimumFractionDigits:2})}`;
      }
    } else {
      _montoBancoConvertidoCred = null;
      if (elNombre) elNombre.textContent = bancoNombre;
    }

    const elElegido = document.getElementById('rp-banco-elegido-wrap'); if (elElegido) elElegido.style.display = 'flex';
  };
  window.cancelarSeleccionBancoCred = function() {
    _bancoElegidoIdCred = null;
    const elMetodo = document.getElementById('rp-metodo'); if (elMetodo) elMetodo.value = '';
    const elWrap = document.getElementById('rp-banco-elegir-wrap'); if (elWrap) elWrap.style.display = 'none';
    const elElegido = document.getElementById('rp-banco-elegido-wrap'); if (elElegido) elElegido.style.display = 'none';
  };

  async function confirmarRegistrarPagoCredito() {
    const btn = document.getElementById('btn-confirmar-pago');
    const creditoId = document.getElementById('rp-credito').value;
    const monto = round2(parseFloat(document.getElementById('rp-monto').value) || 0);
    const metodoSel = document.getElementById('rp-metodo');
    const metodoId = metodoSel.value || null;
    const metodoNombre = metodoSel.selectedOptions[0]?.dataset.nombre || metodoSel.selectedOptions[0]?.textContent || 'Efectivo';
    const observaciones = document.getElementById('rp-observaciones').value.trim() || null;

    if (!creditoId) { showToast('Selecciona un crédito', 'error'); return; }
    if (monto <= 0) { showToast('El monto debe ser mayor a cero', 'error'); return; }

    // El banco ya se eligió al momento de cambiar el método a
    // Tarjeta/Transferencia (no aquí al final) — esto es solo un
    // candado de seguridad, por si alguien llegó hasta aquí sin
    // completar ese paso.
    const metodoActualCred = (metodoNombre||'').toLowerCase();
    if ((metodoActualCred.includes('tarjeta') || metodoActualCred.includes('transferencia')) && (await cargarBancosDisponiblesCred()).length && !_bancoElegidoIdCred) {
      showToast('Elige a qué banco entra este pago', 'error');
      return;
    }
    const bancoElegidoPago = _bancoElegidoIdCred || null;

    // Si el banco elegido es en otra moneda y no hay tasa de cambio
    // configurada, no se deja continuar — mejor pedirla ahora que
    // guardar un pago sin la conversión correcta.
    if (bancoElegidoPago) {
      const bancoInfo = (await cargarBancosDisponiblesCred()).find(b => b.id === bancoElegidoPago);
      const monedaBase = CS.empresaConfig?.moneda === 'USD' ? 'USD' : 'NIO';
      if (bancoInfo && (bancoInfo.moneda||'NIO') !== monedaBase && !CS.empresaConfig?.tasa_cambio_usd) {
        showToast('Falta configurar tu tasa de cambio en Caja › Bancos antes de registrar este pago', 'error');
        return;
      }
    }

    btn.disabled = true; btn.textContent = 'Registrando…';
    try {
      const { data: credito } = await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle();
      if (!credito) throw new Error('Crédito no encontrado');
      if (monto > credito.saldo_pendiente + 0.01) throw new Error('El monto excede el saldo pendiente');

      const { data: cuotasPendientes } = await _sb.from('creditos_cuotas').select('*')
        .eq('credito_id', creditoId).neq('estado','pagada').order('numero');

      let restante = monto;
      let impuestoAcreditadoEstaVez = 0;
      const porImpuesto = new Map(); // key: impuesto_id||nombre -> { nombre, id, monto }
      for (const cuota of (cuotasPendientes||[])) {
        if (restante <= 0) break;
        const debeCuota = round2(cuota.monto_total - cuota.monto_pagado);
        if (debeCuota <= 0) continue;
        const aplicar = Math.min(restante, debeCuota);
        const nuevoPagado = round2(cuota.monto_pagado + aplicar);
        const nuevoEstado = nuevoPagado >= cuota.monto_total - 0.01 ? 'pagada' : 'parcial';

        // El impuesto de la cuota se acredita en la misma proporción en que se está
        // pagando su saldo (no todo de una vez): así, si el cliente paga en abonos,
        // el impuesto también se acumula a impuestos.html en abonos. Si la cuota tiene
        // más de un impuesto (ej. IVA + otro), cada uno se reparte y se registra por separado.
        const impuestoPendienteCuota = round2((cuota.impuesto||0) - (cuota.impuesto_acreditado||0));
        const fraccionPagada = aplicar / debeCuota;
        const impuestoEstaVez = round2(impuestoPendienteCuota * fraccionPagada);
        impuestoAcreditadoEstaVez = round2(impuestoAcreditadoEstaVez + impuestoEstaVez);

        const detalle = Array.isArray(cuota.impuestos_detalle) ? cuota.impuestos_detalle : [];
        if (detalle.length && impuestoEstaVez > 0) {
          detalle.forEach(d => {
            // Reparte impuestoEstaVez entre los impuestos de la cuota según su peso relativo
            const peso = (cuota.impuesto > 0) ? (Number(d.monto)||0) / cuota.impuesto : 0;
            const parte = round2(impuestoEstaVez * peso);
            if (parte <= 0) return;
            const key = d.impuesto_id || d.nombre;
            const acc = porImpuesto.get(key) || { nombre: d.nombre, id: d.impuesto_id, monto: 0 };
            acc.monto = round2(acc.monto + parte);
            porImpuesto.set(key, acc);
          });
        }

        await _sb.from('creditos_cuotas').update({
          monto_pagado: nuevoPagado, estado: nuevoEstado,
          impuesto_acreditado: round2((cuota.impuesto_acreditado||0) + impuestoEstaVez),
          updated_at: new Date().toISOString(),
        }).eq('id', cuota.id);
        restante = round2(restante - aplicar);
      }

      const saldoAnterior = credito.saldo_pendiente;
      const saldoNuevo = round2(Math.max(0, saldoAnterior - monto));
      const nuevoEstadoCredito = saldoNuevo <= 0.01 ? 'cancelado' : (credito.estado === 'en_proceso' ? 'activo' : credito.estado);
      await _sb.from('creditos').update({ saldo_pendiente: saldoNuevo, estado: nuevoEstadoCredito, updated_at: new Date().toISOString() }).eq('id', creditoId);

      // Registrar en Caja (nunca crea una venta nueva)
      const cajaRes = await registrarEnCaja({
        auth_user_id: CS.userId, tipo_flujo: 'INGRESO', tipo_movimiento: 'PAGO_CREDITO',
        concepto: `Pago crédito ${credito.numero_credito}`, monto, metodo_pago_id: metodoId,
        metodo_pago_nombre: metodoNombre, banco_id: bancoElegidoPago,
        monto_moneda_banco: bancoElegidoPago ? _montoBancoConvertidoCred : null,
        referencia_tipo: 'credito', referencia_id: creditoId, observaciones,
      });
      if (!cajaRes.ok) console.warn('No se pudo registrar en caja:', cajaRes.error);

      // El impuesto NO se manda completo a impuestos.html al crear el crédito: solo la
      // porción correspondiente a lo efectivamente cobrado en este pago, y cada impuesto
      // (IVA, retención, u otro) se registra en su propia línea, no mezclados.
      for (const { nombre, id, monto: montoTax } of porImpuesto.values()) {
        await registrarImpuestoCredito(montoTax, credito, nombre, id);
      }

      const comprobanteNumero = `PAG-${credito.numero_credito}-${Date.now().toString().slice(-5)}`;
      const { data: pago, error: errPago } = await _sb.from('creditos_pagos').insert({
        auth_user_id: CS.userId, credito_id: creditoId, cliente_id: credito.cliente_id, monto,
        metodo_pago_id: metodoId, metodo_pago_nombre: metodoNombre, observaciones,
        saldo_anterior: saldoAnterior, saldo_nuevo: saldoNuevo, comprobante_numero: comprobanteNumero,
      }).select().single();
      if (errPago) throw errPago;

      await registrarHistorial(creditoId, 'pago', `Pago de ${fmt(monto)} registrado`, { monto, saldoNuevo });
      if (nuevoEstadoCredito === 'cancelado') await registrarHistorial(creditoId, 'cancelado', 'Crédito cancelado — saldo en cero', {});

      showToast('Pago registrado correctamente', 'success');
      closeModal('modal-registrar-pago');

      // Si esta pantalla se abrió incrustada desde Rutas (iframe), se
      // le avisa al padre que el pago sí se registró — Rutas nunca
      // calcula el pago, solo reacciona quando de verdad ya pasó.
      if (window.self !== window.top) {
        try { window.parent.postMessage({ tipo: 'n360_operacion_completada', monto, nota: observaciones }, '*'); } catch(e) {}
      }

      const cliente = CS.clientes.find(c => c.id === credito.cliente_id);
      const proximaCuota = (await _sb.from('creditos_cuotas').select('*').eq('credito_id', creditoId).neq('estado','pagada').order('numero').limit(1).maybeSingle()).data;
      let productosComprobante = [];
      if (credito.venta_id) {
        const { data: detalles } = await _sb.from('venta_detalles').select('producto_nombre,cantidad').eq('venta_id', credito.venta_id);
        productosComprobante = detalles || [];
      }
      mostrarComprobante({
        titulo: 'Pago de crédito', numero: comprobanteNumero, credito: credito.numero_credito,
        cliente: cliente ? `${cliente.nombre} ${cliente.apellido||''}` : '—', fecha: todayISO(),
        usuario: CS.currentUser?.nombre || CS.userEmail, monto, metodo: metodoNombre,
        saldoAnterior, saldoNuevo, proximaCuota: proximaCuota ? `${fmtDate(proximaCuota.fecha_vencimiento)} · ${fmt(proximaCuota.monto_total)}` : 'Sin cuotas pendientes',
        estado: LABEL_ESTADO[nuevoEstadoCredito] || nuevoEstadoCredito,
        productos: productosComprobante,
      });

      await refrescarTodo();
    } catch (e) {
      console.error('confirmarRegistrarPagoCredito:', e);
      showToast('Error al registrar el pago: ' + (e.message||e), 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Registrar pago';
    }
  }
  window.confirmarRegistrarPagoCredito = confirmarRegistrarPagoCredito;

  /* ===================================================
     CONFIGURAR TICKET DE IMPRESIÓN — misma tabla que usa Ventas
     (configuracion_venta_rapida), compartida por todo el sistema.
  =================================================== */
  CS.configTicket = null;
  async function cargarConfigTicket() {
    try {
      const { data } = await _sb.from('configuracion_venta_rapida').select('*').eq('auth_user_id', CS.userId).maybeSingle();
      CS.configTicket = data || null;
    } catch (e) { CS.configTicket = null; }
  }
  async function abrirConfigTicket() {
    if (!CS.configTicket) await cargarConfigTicket();
    const c = CS.configTicket || {};
    document.querySelectorAll('input[name="ct-ancho"]').forEach(r => { r.checked = (r.value === (c.ancho_ticket || '80mm')); });
    document.getElementById('ct-nombre').value    = c.nombre_ticket    || '';
    document.getElementById('ct-ruc').value       = c.ruc_ticket       || '';
    document.getElementById('ct-telefono').value  = c.telefono_ticket || '';
    document.getElementById('ct-direccion').value = c.direccion_ticket|| '';
    document.getElementById('ct-mensaje').value   = c.mensaje_pie_ticket || 'Gracias por su compra';
    openModal('modal-config-ticket');
  }
  window.abrirConfigTicket = abrirConfigTicket;

  async function guardarConfigTicket() {
    const ancho = document.querySelector('input[name="ct-ancho"]:checked')?.value || '80mm';
    const payload = {
      auth_user_id: CS.userId, configurado: true,
      ancho_ticket: ancho,
      nombre_ticket: document.getElementById('ct-nombre').value.trim() || null,
      ruc_ticket: document.getElementById('ct-ruc').value.trim() || null,
      telefono_ticket: document.getElementById('ct-telefono').value.trim() || null,
      direccion_ticket: document.getElementById('ct-direccion').value.trim() || null,
      mensaje_pie_ticket: document.getElementById('ct-mensaje').value.trim() || 'Gracias por su compra',
      updated_at: new Date().toISOString(),
    };
    try {
      const { data, error } = await _sb.from('configuracion_venta_rapida')
        .upsert(payload, { onConflict: 'auth_user_id' }).select('*').single();
      if (error) throw error;
      CS.configTicket = data;
      closeModal('modal-config-ticket');
      showToast('Configuración del ticket guardada', 'success');
    } catch (e) {
      console.error('guardarConfigTicket:', e);
      showToast('No se pudo guardar la configuración', 'error');
    }
  }
  window.guardarConfigTicket = guardarConfigTicket;

  /* ===================================================
     COMPROBANTE / TICKET
  =================================================== */
  function mostrarComprobante(c) {
    CS.ultimoComprobante = c;

    // Si el negocio eligió "Carta / A4", nunca se arma la vista
    // previa de ticket angosto — se genera y descarga directo el
    // comprobante profesional real, igual que ya pasa en Ventas.
    if (CS.configTicket?.ancho_ticket === 'carta') {
      (async () => {
        try {
          const doc = await generarComprobanteCartaPDF('credito', {
            userId: CS.userId, numero: c.numero, fecha: fmtDate(c.fecha),
            cliente_nombre: c.cliente, subtotal: c.monto, descuento: 0, impuesto: 0, total: c.monto,
            metodo_pago: c.metodo, observaciones: `Crédito ${c.credito || ''} — Saldo nuevo: ${fmt(c.saldoNuevo)}`,
            empresaNombre: CS.empresaConfig?.nombre_comercial || CS.currentUser?.nombre_negocio || 'Mi Negocio',
            empresaDireccion: CS.empresaConfig?.direccion || '', empresaTelefono: CS.empresaConfig?.telefono || CS.empresaConfig?.whatsapp || '',
            empresaRuc: CS.empresaConfig?.ruc || '', moneda_simbolo: CS.empresaConfig?.moneda_simbolo || 'C$',
          }, [{ nombre: `Pago de cuota — ${c.credito || 'crédito'}`, cantidad: 1, precio: c.monto, descuento: 0, subtotal: c.monto }]);
          doc.save(`Comprobante_pago_${c.numero || Date.now()}.pdf`);
          showToast('Comprobante generado');
        } catch (e) {
          console.warn('No se pudo generar el comprobante carta:', e);
          showToast('No se pudo generar el comprobante', 'error');
        }
      })();
      return;
    }

    const logoUrl = CS.empresaConfig?.logo_principal_url || CS.empresaConfig?.logo_url || '';
    const anchoTicket = CS.configTicket?.ancho_ticket || '80mm';
    const logoMaxW = anchoTicket === '58mm' ? 70 : anchoTicket === '76mm' ? 85 : anchoTicket === 'carta' ? 130 : 95;
    document.getElementById('comprobante-body').innerHTML = `
      <div class="ticket-print">
        ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" style="display:block;max-width:${logoMaxW}px;max-height:70px;object-fit:contain;margin:0 auto 6px" onerror="this.style.display='none'"/>` : ''}
        <div style="text-align:center;font-weight:800;margin-bottom:4px">${esc(CS.configTicket?.nombre_ticket || nombreNegocio())}</div>
        ${CS.configTicket?.ruc_ticket ? `<div style="text-align:center;font-size:11px;color:var(--text-muted)">RUC: ${esc(CS.configTicket.ruc_ticket)}</div>` : ''}
        ${CS.configTicket?.telefono_ticket ? `<div style="text-align:center;font-size:11px;color:var(--text-muted)">Tel: ${esc(CS.configTicket.telefono_ticket)}</div>` : ''}
        ${CS.configTicket?.direccion_ticket ? `<div style="text-align:center;font-size:11px;color:var(--text-muted)">${esc(CS.configTicket.direccion_ticket)}</div>` : ''}
        <div style="text-align:center;color:var(--text-muted);margin-bottom:8px">${esc(c.titulo)}</div>
        <hr/>
        <div class="tp-row"><span>N° comprobante:</span><b>${esc(c.numero)}</b></div>
        <div class="tp-row"><span>N° crédito:</span><b>${esc(c.credito)}</b></div>
        <div class="tp-row"><span>Cliente:</span><b>${esc(c.cliente)}</b></div>
        <div class="tp-row"><span>Fecha:</span><b>${fmtDate(c.fecha)}</b></div>
        <div class="tp-row"><span>Usuario:</span><b>${esc(c.usuario)}</b></div>
        ${(c.productos && c.productos.length) ? `
        <hr/>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:3px">Productos financiados:</div>
        ${c.productos.map(p => `<div style="font-size:11.5px;display:flex;justify-content:space-between;gap:8px"><span>${esc(p.producto_nombre)}</span><span>x${Number(p.cantidad)}</span></div>`).join('')}
        ` : ''}
        <hr/>
        <div class="tp-row"><span>Monto pagado:</span><b>${fmt(c.monto)}</b></div>
        <div class="tp-row"><span>Método de pago:</span><b>${esc(c.metodo)}</b></div>
        <div class="tp-row"><span>Saldo anterior:</span><b>${fmt(c.saldoAnterior)}</b></div>
        <div class="tp-row"><span>Saldo nuevo:</span><b>${fmt(c.saldoNuevo)}</b></div>
        <hr/>
        <div class="tp-row"><span>Próxima cuota:</span><b>${esc(c.proximaCuota)}</b></div>
        <div class="tp-row"><span>Estado del crédito:</span><b>${esc(c.estado)}</b></div>
        ${CS.configTicket?.mensaje_pie_ticket ? `<hr/><div style="text-align:center;font-size:11px;color:var(--text-muted)">${esc(CS.configTicket.mensaje_pie_ticket)}</div>` : ''}
      </div>`;
    openModal('modal-comprobante');
  }
  function imprimirComprobante() {
    const esEpson = CS.configTicket?.ancho_ticket === 'epson_tmu220';
    const ancho = esEpson ? '76mm' : (CS.configTicket?.ancho_ticket || '80mm');
    const fontFamily = esEpson ? "'Courier New', Courier, monospace" : 'Arial,Helvetica,sans-serif';

    // Si el negocio eligió "Carta / A4", se genera el comprobante
    // profesional real (con logo, color de marca y tabla), no solo
    // el mismo recibo angosto ensanchado — nunca se activa para quien
    // tenga 58/76/80mm configurado.
    if (ancho === 'carta') {
      (async () => {
        try {
          const c = CS.ultimoComprobante;
          if (!c) throw new Error('No hay comprobante para imprimir');
          const doc = await generarComprobanteCartaPDF('credito', {
            userId: CS.userId, numero: c.numero, fecha: fmtDate(c.fecha),
            cliente_nombre: c.cliente, subtotal: c.monto, descuento: 0, impuesto: 0, total: c.monto,
            metodo_pago: c.metodo, observaciones: `Crédito ${c.credito || ''} — Saldo nuevo: ${fmt(c.saldoNuevo)}`,
            empresaNombre: CS.empresaConfig?.nombre_comercial || CS.currentUser?.nombre_negocio || 'Mi Negocio',
            empresaDireccion: CS.empresaConfig?.direccion || '', empresaTelefono: CS.empresaConfig?.telefono || CS.empresaConfig?.whatsapp || '',
            empresaRuc: CS.empresaConfig?.ruc || '', moneda_simbolo: CS.empresaConfig?.moneda_simbolo || 'C$',
          }, [{ nombre: `Pago de cuota — ${c.credito || 'crédito'}`, cantidad: 1, precio: c.monto, descuento: 0, subtotal: c.monto }]);
          doc.save(`Comprobante_pago_${c.numero || Date.now()}.pdf`);
        } catch (e) {
          console.warn('No se pudo generar el comprobante carta:', e);
          showToast('No se pudo generar el comprobante', 'error');
        }
      })();
      return;
    }

    const html = document.getElementById('comprobante-body').innerHTML;
    const anchoPx = ancho === '58mm' ? '220px' : ancho === '76mm' ? '280px' : '300px';
    // En 58mm hay menos ancho real de impresión — con la misma letra
    // que 80mm, el texto se ve apretado o se corta en impresoras
    // térmicas baratas de bajo DPI (como la Hoin HOP-E58, 203dpi/58mm).
    const fs = ancho === '58mm' ? 11 : 12.5;
    const w = window.open('', '_blank', 'width=380,height=600');
    w.document.write(`<html><head><meta charset="UTF-8"><title>Comprobante</title>
      <style>body{font-family:${fontFamily};font-size:${fs}px;padding:16px;max-width:${anchoPx};margin:0 auto${esEpson ? ';line-height:1.3' : ''}}.tp-row{display:flex;justify-content:space-between;gap:10px}hr{border:none;border-top:1px dashed #999;margin:8px 0}</style>
      </head><body>${html}<script>window.print();</script></body></html>`);
    w.document.close();
  }
  window.imprimirComprobante = imprimirComprobante;

  /* ===================================================
     DETALLE DE CRÉDITO (cuotas + historial)
  =================================================== */
  window._creditoDetalleActual = null;
  /* ===================================================
     PAGARÉ / CONTRATO DE CRÉDITO — se llena solo con los datos ya
     guardados del crédito, cliente y sus cuotas, sin tener que
     redactarlo desde cero cada vez. Plantilla base — el negocio
     puede ajustarla según sus necesidades específicas.
  =================================================== */
  window.generarPagareCredito = function(credito, cliente, cuotas) {
    const bizName = CS.empresaConfig?.nombre_comercial || CS.currentUser?.nombre_negocio || 'La Empresa';
    const bizRuc = CS.empresaConfig?.ruc || '';
    const bizDireccion = CS.empresaConfig?.direccion || '';
    const moneda = CS.empresaConfig?.moneda_simbolo || 'C$';
    const nombreCliente = cliente ? `${cliente.nombre||''} ${cliente.apellido||''}`.trim() : '________________';
    const hoy = new Date().toLocaleDateString('es-NI', { day:'numeric', month:'long', year:'numeric' });
    const numCuotas = (cuotas||[]).length || credito.num_cuotas || 0;
    const valorCuota = numCuotas ? (Number(credito.total_financiado||0) / numCuotas) : Number(credito.valor_cuota_aprox||0);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W = doc.internal.pageSize.getWidth();
    const M = 20;
    let y = 20;

    doc.setFontSize(14); doc.setFont(undefined,'bold');
    doc.text('PAGARÉ', W/2, y, { align:'center' }); y += 8;
    doc.setFontSize(10); doc.setFont(undefined,'normal');
    doc.text(`N.º ${credito.numero_credito}`, W/2, y, { align:'center' }); y += 12;

    const parrafo1 = `Yo, ${nombreCliente}${cliente?.direccion ? ', con domicilio en ' + cliente.direccion : ''}${cliente?.telefono ? ', teléfono ' + cliente.telefono : ''}, por medio del presente documento me comprometo a pagar incondicionalmente a la orden de ${bizName}${bizRuc ? ', con RUC ' + bizRuc : ''}${bizDireccion ? ', con domicilio en ' + bizDireccion : ''}, la cantidad de ${moneda} ${Number(credito.total_financiado||0).toLocaleString('es-NI',{minimumFractionDigits:2})} (${numeroALetrasSimple(Number(credito.total_financiado||0))}), correspondiente a la compra/financiamiento detallado a continuación.`;
    const lineas1 = doc.splitTextToSize(parrafo1, W - M*2);
    doc.text(lineas1, M, y); y += lineas1.length * 5 + 8;

    doc.setFont(undefined,'bold'); doc.text('CONDICIONES DEL PAGO:', M, y); y += 6;
    doc.setFont(undefined,'normal'); doc.setFontSize(9.5);
    const condiciones = [
      `Capital financiado: ${moneda} ${Number(credito.capital_financiado||0).toLocaleString('es-NI',{minimumFractionDigits:2})}`,
      `Total a pagar (con intereses/impuestos si aplica): ${moneda} ${Number(credito.total_financiado||0).toLocaleString('es-NI',{minimumFractionDigits:2})}`,
      `Número de cuotas: ${numCuotas}`,
      `Valor aproximado por cuota: ${moneda} ${valorCuota.toLocaleString('es-NI',{minimumFractionDigits:2})}`,
      `Fecha de inicio: ${credito.fecha_inicio ? fmtDate(credito.fecha_inicio) : '—'}`,
    ];
    condiciones.forEach(c => { doc.text('• ' + c, M+2, y); y += 5.5; });
    y += 4;

    if ((cuotas||[]).length) {
      doc.setFontSize(9); doc.setFont(undefined,'bold'); doc.text('CALENDARIO DE PAGOS:', M, y); y += 3;
      doc.autoTable({
        startY: y, head: [['Cuota', 'Vencimiento', 'Monto']],
        body: cuotas.map(c => [c.numero, fmtDate(c.fecha_vencimiento), `${moneda} ${Number(c.monto_total).toLocaleString('es-NI',{minimumFractionDigits:2})}`]),
        theme:'grid', styles:{ fontSize:8.5, cellPadding:2 }, headStyles:{ fillColor:[108,99,255] }, margin:{ left:M, right:M },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    doc.setFontSize(9.5); doc.setFont(undefined,'normal');
    const parrafo2 = 'En caso de incumplimiento en el pago de cualquiera de las cuotas señaladas, EL ACREEDOR podrá exigir el pago inmediato del saldo total pendiente, sin necesidad de requerimiento judicial previo, quedando este pagaré sujeto a las leyes de la República de Nicaragua.';
    const lineas2 = doc.splitTextToSize(parrafo2, W - M*2);
    doc.text(lineas2, M, y); y += lineas2.length * 5 + 14;

    doc.text(`Firmado en la ciudad de _________________, a los ${hoy}.`, M, y); y += 20;
    doc.text('_____________________________', M, y);
    doc.text('_____________________________', W - M - 70, y);
    y += 5;
    doc.setFont(undefined,'bold');
    doc.text('EL DEUDOR', M, y);
    doc.text('EL ACREEDOR', W - M - 70, y);
    y += 5;
    doc.setFont(undefined,'normal'); doc.setFontSize(9);
    doc.text(nombreCliente, M, y);
    doc.text(bizName, W - M - 70, y);

    doc.setFontSize(7.5); doc.setTextColor(150,150,150);
    doc.text('Este documento es una plantilla base generada automáticamente — revísala y ajústala según las necesidades específicas de tu negocio antes de usarla.', M, doc.internal.pageSize.getHeight() - 10);

    doc.save(`Pagare_${credito.numero_credito}.pdf`);
    showToast('Pagaré generado', 'success');
  };

  // Conversión simple de número a letras, solo para el monto del
  // pagaré — cubre los montos típicos de un crédito comercial.
  function numeroALetrasSimple(n) {
    n = Math.round(n);
    if (n === 0) return 'cero córdobas';
    const UNIDADES = ['','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve'];
    const DECENAS = ['','diez','veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
    const ESPECIALES = {11:'once',12:'doce',13:'trece',14:'catorce',15:'quince',16:'dieciséis',17:'diecisiete',18:'dieciocho',19:'diecinueve',21:'veintiuno',22:'veintidós',23:'veintitrés',24:'veinticuatro',25:'veinticinco',26:'veintiséis',27:'veintisiete',28:'veintiocho',29:'veintinueve'};
    function centenas(num) {
      if (num === 0) return '';
      if (num === 100) return 'cien';
      const c = Math.floor(num/100), resto = num%100;
      const CENT = ['','ciento','doscientos','trescientos','cuatrocientos','quinientos','seiscientos','setecientos','ochocientos','novecientos'];
      let texto = CENT[c];
      if (resto > 0) {
        let parteResto;
        if (ESPECIALES[resto]) parteResto = ESPECIALES[resto];
        else {
          const d = Math.floor(resto/10), u = resto%10;
          parteResto = d === 0 ? UNIDADES[u] : DECENAS[d] + (u>0?' y '+UNIDADES[u]:'');
        }
        texto += (texto?' ':'') + parteResto;
      }
      return texto;
    }
    function miles(num) {
      if (num < 1000) return centenas(num);
      const m = Math.floor(num/1000), resto = num%1000;
      return (m===1?'mil':centenas(m)+' mil') + (resto>0?' '+centenas(resto):'');
    }
    const millones = Math.floor(n/1000000), resto = n%1000000;
    let texto = millones > 0 ? (millones===1?'un millón':miles(millones)+' millones') + (resto>0?' ':'') : '';
    texto += miles(resto);
    return (texto.trim() || 'cero') + ' córdobas';
  }

  window.descargarComprobanteCartaCredito = async function(credito, cliente, productos) {
    try {
      const doc = await generarComprobanteCartaPDF('credito', {
        userId: CS.userId,
        numero: credito.numero_credito,
        fecha: fmtDate(credito.fecha_inicio || credito.created_at),
        cliente_nombre: cliente ? `${cliente.nombre||''} ${cliente.apellido||''}`.trim() : 'Cliente',
        cliente_telefono: cliente?.telefono || '',
        cliente_direccion: cliente?.direccion || '',
        subtotal: credito.capital_financiado,
        descuento: 0,
        impuesto: Number(credito.total_financiado||0) - Number(credito.capital_financiado||0),
        total: credito.total_financiado,
        metodo_pago: 'Crédito',
        observaciones: `Saldo pendiente: ${fmt(credito.saldo_pendiente)}`,
        empresaNombre: CS.empresaConfig?.nombre_comercial || CS.currentUser?.nombre_negocio || 'Mi Negocio',
        empresaDireccion: CS.empresaConfig?.direccion || '',
        empresaTelefono: CS.empresaConfig?.telefono || CS.empresaConfig?.whatsapp || '',
        empresaRuc: CS.empresaConfig?.ruc || '',
        moneda_simbolo: CS.empresaConfig?.moneda_simbolo || 'C$',
      }, (productos||[]).map(p => ({
        nombre: p.producto_nombre, cantidad: p.cantidad, precio: p.precio, descuento: 0, subtotal: p.subtotal,
      })));
      doc.save(`Comprobante_${credito.numero_credito}.pdf`);
    } catch (e) {
      console.error('descargarComprobanteCartaCredito:', e);
      showToast('No se pudo generar el comprobante', 'error');
    }
  };

  async function abrirDetalleCredito(creditoId) {
    window._creditoDetalleActual = creditoId;
    openModal('modal-detalle-credito');
    document.getElementById('detalle-credito-body').innerHTML = 'Cargando…';
    const { data: credito } = await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle();
    if (!credito) return;
    const cliente = CS.clientes.find(c => c.id === credito.cliente_id);
    const { data: cuotas } = await _sb.from('creditos_cuotas').select('*').eq('credito_id', creditoId).order('numero');
    const { data: historial } = await _sb.from('creditos_historial').select('*').eq('credito_id', creditoId).order('created_at', { ascending:false });
    const { data: pagos } = await _sb.from('creditos_pagos').select('*').eq('credito_id', creditoId).eq('estado','completado').order('created_at', { ascending:false });

    // Productos financiados — se leen de la venta que originó el
    // crédito (creditos NUNCA guarda productos directamente). Si el
    // crédito se creó sin venta (ej. deuda existente migrada), no hay
    // nada que traer, y esa sección simplemente no aparece.
    let productosFinanciados = [];
    if (credito.venta_id) {
      const { data: detalles } = await _sb.from('venta_detalles').select('*').eq('venta_id', credito.venta_id).order('created_at');
      productosFinanciados = detalles || [];
    }

    document.getElementById('det-credito-title').textContent = `Crédito ${credito.numero_credito}`;
    document.getElementById('detalle-credito-body').innerHTML = `
      <div class="form-row" style="margin-bottom:14px">
        <div><label>Cliente</label><div class="stat-readonly">${esc(cliente ? cliente.nombre+' '+(cliente.apellido||'') : '—')}</div></div>
        <div><label>Tipo</label><div class="stat-readonly">${credito.tipo==='venta'?'Por venta':'Financiero'}</div></div>
        <div><label>Estado</label><div><span class="badge-credito badge-${credito.estado}">${LABEL_ESTADO[credito.estado]||credito.estado}</span></div></div>
      </div>
      <div class="form-row" style="margin-bottom:14px">
        <div><label>Capital financiado</label><div class="stat-readonly">${fmt(credito.capital_financiado)}</div></div>
        <div><label>Total financiado</label><div class="stat-readonly">${fmt(credito.total_financiado)}</div></div>
        <div><label>Saldo pendiente</label><div class="stat-readonly">${fmt(credito.saldo_pendiente)}</div></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        <button class="btn-secondary btn-sm" onclick='generarPagareCredito(${JSON.stringify(credito).replace(/'/g,"&apos;")}, ${JSON.stringify(cliente||{}).replace(/'/g,"&apos;")}, ${JSON.stringify(cuotas||[]).replace(/'/g,"&apos;")})'>📄 Generar pagaré</button>
        <button class="btn-secondary btn-sm" onclick='descargarComprobanteCartaCredito(${JSON.stringify(credito).replace(/'/g,"&apos;")}, ${JSON.stringify(cliente||{}).replace(/'/g,"&apos;")}, ${JSON.stringify(productosFinanciados||[]).replace(/'/g,"&apos;")})'>📄 Comprobante tamaño carta</button>
        ${credito.tipo === 'venta' && credito.venta_id && credito.estado === 'en_proceso' ? `<button class="btn-secondary btn-sm" onclick="abrirEditarProductosCredito('${credito.id}')">🛒 Editar productos</button>` : ''}
        ${Number(credito.saldo_pendiente) > 0 ? `<button class="btn-secondary btn-sm" onclick="abrirEditarCredito('${credito.id}')">✏️ Renegociar saldo restante</button>` : ''}
      </div>
      ${Number(credito.saldo_pendiente) <= 0 ? `<p style="font-size:11.5px;color:var(--text-muted);margin-bottom:14px">✅ Este crédito ya está totalmente pagado.</p>` : ''}
      ${productosFinanciados.length ? `
        <label>Productos financiados</label>
        <div class="table-wrap" style="margin-bottom:16px">
          <table>
            <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead>
            <tbody>
              ${productosFinanciados.map(d => `<tr>
                <td>${esc(d.producto_nombre || '—')}</td>
                <td>${Number(d.cantidad||0).toLocaleString('es-NI',{maximumFractionDigits:2})}</td>
                <td>${fmt(d.precio)}</td>
                <td>${fmt(d.subtotal)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      <label>Cuotas</label>
      <div class="table-wrap" style="margin-bottom:16px">
        <table>
          <thead><tr><th>#</th><th>Vence</th><th>Capital</th><th>Interés</th><th>Impuesto</th><th>Cuota</th><th>Pagado</th><th>Estado</th></tr></thead>
          <tbody>
            ${(cuotas||[]).map(c => `<tr>
              <td>${c.numero}</td><td>${fmtDate(c.fecha_vencimiento)}</td>
              <td>${fmt(c.capital)}</td><td>${fmt(c.interes)}</td><td>${fmt(c.impuesto)}</td>
              <td>${fmt(c.monto_total)}</td><td>${fmt(c.monto_pagado)}</td>
              <td><span class="badge-credito badge-${c.estado==='vencida'?'con_atraso':c.estado==='pagada'?'al_dia':'en_proceso'}">${c.estado}</span></td>
            </tr>`).join('') || '<tr><td colspan="8" class="empty-cell">Sin cuotas</td></tr>'}
          </tbody>
        </table>
      </div>
      <label>Historial de pagos ${(pagos||[]).length ? `(${pagos.length})` : ''}</label>
      <div class="table-wrap" style="margin-bottom:16px">
        <table>
          <thead><tr><th>Fecha</th><th>N° comprobante</th><th>Monto</th><th>Método</th><th>Observaciones</th><th></th></tr></thead>
          <tbody>
            ${(pagos||[]).map(p => `<tr>
              <td>${fmtDate(p.fecha)}</td><td>${esc(p.comprobante_numero||'—')}</td>
              <td>${fmt(p.monto)}</td><td>${esc(p.metodo_pago_nombre||'—')}</td>
              <td style="max-width:220px;white-space:normal;font-size:12.5px;color:var(--text-secondary)">${p.observaciones ? esc(p.observaciones) : '—'}</td>
              <td><button class="btn-icon" title="Volver a descargar comprobante" onclick="reimprimirComprobantePago('${p.id}')">🖨️</button></td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty-cell">Todavía no hay pagos registrados</td></tr>'}
          </tbody>
        </table>
      </div>
      <label>Historial</label>
      <ul class="timeline">
        ${(historial||[]).map(h => `<li><span class="t-dot"></span><div><b>${esc(h.descripcion||h.tipo_evento)}</b><br><span style="color:var(--text-muted);font-size:11.5px">${new Date(h.created_at).toLocaleString('es-NI')}</span></div></li>`).join('') || '<li>Sin eventos</li>'}
      </ul>`;
  }
  window.abrirDetalleCredito = abrirDetalleCredito;

  // Reconstruye y muestra de nuevo el mismo comprobante de un pago ya
  // hecho — los datos numéricos vienen tal cual quedaron guardados en
  // creditos_pagos en el momento real del pago, nunca se recalculan.
  async function reimprimirComprobantePago(pagoId) {
    try {
      const { data: p } = await _sb.from('creditos_pagos').select('*').eq('id', pagoId).eq('auth_user_id', CS.userId).maybeSingle();
      if (!p) { showToast('No se encontró ese pago', 'error'); return; }
      const { data: credito } = await _sb.from('creditos').select('*').eq('id', p.credito_id).maybeSingle();
      const cliente = CS.clientes.find(c => c.id === p.cliente_id) || {};
      const proximaCuota = (await _sb.from('creditos_cuotas').select('*').eq('credito_id', p.credito_id).neq('estado','pagada').order('numero').limit(1).maybeSingle()).data;
      let productosComprobante = [];
      if (credito?.venta_id) {
        const { data: detalles } = await _sb.from('venta_detalles').select('producto_nombre,cantidad').eq('venta_id', credito.venta_id);
        productosComprobante = detalles || [];
      }
      mostrarComprobante({
        titulo: 'Pago de crédito (reimpresión)', numero: p.comprobante_numero || '—', credito: credito?.numero_credito || '—',
        cliente: cliente ? `${cliente.nombre||''} ${cliente.apellido||''}`.trim() : '—', fecha: p.fecha,
        usuario: CS.currentUser?.nombre || CS.userEmail, monto: p.monto, metodo: p.metodo_pago_nombre || '—',
        saldoAnterior: p.saldo_anterior, saldoNuevo: p.saldo_nuevo,
        proximaCuota: proximaCuota ? `${fmtDate(proximaCuota.fecha_vencimiento)} · ${fmt(proximaCuota.monto_total)}` : 'Sin cuotas pendientes',
        estado: credito ? (LABEL_ESTADO[credito.estado] || credito.estado) : '—',
        productos: productosComprobante,
      });
    } catch (e) {
      console.error('reimprimirComprobantePago:', e);
      showToast('No se pudo reconstruir el comprobante', 'error');
    }
  }
  window.reimprimirComprobantePago = reimprimirComprobantePago;

  // Editar el SALDO RESTANTE de un crédito — nunca toca las cuotas ya
  // pagadas (esas quedan intactas, con su historial real de pago).
  // Sirve para renegociar: el cliente da menos de lo acordado, más de
  // lo acordado, o simplemente cambia el plan de lo que falta.
  let CREDITO_EDITANDO = null;
  async function abrirEditarCredito(creditoId) {
    const { data: credito } = await _sb.from('creditos').select('*').eq('id', creditoId).maybeSingle();
    if (!credito) { showToast('Crédito no encontrado', 'error'); return; }
    if (Number(credito.saldo_pendiente) <= 0) {
      showToast('Este crédito ya está totalmente pagado, no queda nada por renegociar', 'error');
      return;
    }
    const { data: cuotas } = await _sb.from('creditos_cuotas').select('*').eq('credito_id', creditoId).order('numero');
    const pagadas = (cuotas||[]).filter(c => c.estado === 'pagada');
    const pendientes = (cuotas||[]).filter(c => c.estado !== 'pagada');

    CREDITO_EDITANDO = { credito, totalPagadas: pagadas.length, pendientes };
    document.getElementById('ec-resumen-pagadas').textContent = pagadas.length
      ? `${pagadas.length} cuota(s) ya pagada(s) por ${fmt(pagadas.reduce((s,c)=>s+Number(c.monto_pagado||0),0))} — no se van a tocar.`
      : 'Este crédito todavía no tiene ninguna cuota pagada.';
    document.getElementById('ec-capital').value = credito.saldo_pendiente;
    document.getElementById('ec-num-cuotas').value = pendientes.length || 1;
    document.getElementById('ec-frecuencia').value = credito.frecuencia;
    document.getElementById('ec-fecha-inicio').value = pendientes[0]?.fecha_vencimiento || todayISO();
    const filaInteres = document.getElementById('ec-fila-interes');
    if (credito.tipo_financiamiento === 'con_interes') {
      filaInteres.style.display = '';
      document.getElementById('ec-tasa').value = credito.tasa_interes || 0;
    } else {
      filaInteres.style.display = 'none';
    }
    closeModal('modal-detalle-credito');
    openModal('modal-editar-credito');
  }
  window.abrirEditarCredito = abrirEditarCredito;

  async function guardarEdicionCredito() {
    if (!CREDITO_EDITANDO) return;
    const { credito, totalPagadas } = CREDITO_EDITANDO;

    const nuevoSaldo = round2(parseFloat(document.getElementById('ec-capital').value) || 0);
    const numCuotas = Math.max(1, parseInt(document.getElementById('ec-num-cuotas').value) || 1);
    const frecuencia = document.getElementById('ec-frecuencia').value;
    const fechaInicio = document.getElementById('ec-fecha-inicio').value || todayISO();
    const tasa = credito.tipo_financiamiento === 'con_interes' ? (parseFloat(document.getElementById('ec-tasa').value) || 0) : 0;
    if (nuevoSaldo <= 0) { showToast('El nuevo saldo debe ser mayor a cero', 'error'); return; }

    setBtnLoading('btn-guardar-editar-credito', true);
    try {
      // Protección: se vuelve a traer el crédito y sus cuotas AHORA
      // mismo, por si alguien registró un pago mientras este modal
      // estaba abierto — nunca se debe borrar una cuota que se acabó
      // de pagar sin que este cálculo se haya enterado.
      const { data: cuotasAhora } = await _sb.from('creditos_cuotas').select('*').eq('credito_id', credito.id).order('numero');
      const pagadasAhora = (cuotasAhora||[]).filter(c => c.estado === 'pagada');
      const pendientesAhora = (cuotasAhora||[]).filter(c => c.estado !== 'pagada');
      if (pagadasAhora.length !== totalPagadas) {
        showToast('Se registró un pago mientras tanto — vuelve a abrir "Editar" para ver el saldo actualizado', 'error');
        closeModal('modal-editar-credito');
        return;
      }

      const impuestosLista = (pendientesAhora[0]?.impuestos_detalle || cuotasAhora?.[0]?.impuestos_detalle || []).map(d => ({ id: d.impuesto_id, nombre: d.nombre, tipo_valor: d.tipo_valor, valor: d.valor }));
      const baseImpuesto = credito.tipo === 'financiero' ? 'interes' : 'capital';

      const { cuotas: cuotasNuevas, totalFinanciado: totalRestanteNuevo, valorCuotaAprox } = generarAmortizacion({
        capitalFinanciado: nuevoSaldo, tipoFinanciamiento: credito.tipo_financiamiento, tasaInteres: tasa,
        metodo: credito.metodo_amortizacion, frecuencia, numCuotas, fechaInicio, impuestosLista, baseImpuesto,
      });

      // Se borran SOLO las cuotas que todavía no están pagadas — las
      // pagadas quedan intactas, con su historial real.
      const idsPendientes = pendientesAhora.map(c => c.id);
      if (idsPendientes.length) {
        await _sb.from('creditos_cuotas').delete().in('id', idsPendientes).eq('auth_user_id', CS.userId);
      }

      // Las cuotas nuevas continúan la numeración después de las ya pagadas.
      const cuotasInsert = cuotasNuevas.map((c, i) => ({
        auth_user_id: CS.userId, credito_id: credito.id, numero: pagadasAhora.length + i + 1,
        fecha_vencimiento: c.fecha_vencimiento, capital: c.capital, interes: c.interes,
        impuesto: c.impuesto, impuestos_detalle: c.impuestos_detalle || [], monto_total: c.monto_total, saldo: c.saldo, estado: 'pendiente',
      }));
      await _sb.from('creditos_cuotas').insert(cuotasInsert);

      // El total financiado ahora es: lo que ya se pagó/comprometió en
      // las cuotas pagadas + el nuevo plan de lo restante — así
      // "total_financiado - pagado = saldo_pendiente" se mantiene exacto.
      const totalYaComprometido = pagadasAhora.reduce((s,c) => s + Number(c.monto_total||0), 0);
      const nuevoTotalFinanciado = round2(totalYaComprometido + totalRestanteNuevo);

      await _sb.from('creditos').update({
        tasa_interes: credito.tipo_financiamiento==='con_interes' ? tasa : credito.tasa_interes,
        frecuencia, num_cuotas: pagadasAhora.length + cuotasNuevas.length,
        total_financiado: nuevoTotalFinanciado, valor_cuota_aprox: valorCuotaAprox,
        saldo_pendiente: totalRestanteNuevo, updated_at: new Date().toISOString(),
      }).eq('id', credito.id).eq('auth_user_id', CS.userId);

      await registrarHistorial(credito.id, 'editado', `Saldo restante renegociado: ${fmt(nuevoSaldo)} en ${numCuotas} cuota(s) nueva(s) — ${pagadasAhora.length} cuota(s) previa(s) sin tocar`, { nuevoSaldo, numCuotas, nuevoTotalFinanciado });

      showToast('Crédito actualizado — cuotas pendientes recalculadas');
      closeModal('modal-editar-credito');
      CREDITO_EDITANDO = null;
      await Promise.allSettled([refrescarTodo(), abrirDetalleCredito(credito.id)]);
    } catch (e) {
      console.error('guardarEdicionCredito:', e);
      showToast('Error al guardar los cambios: ' + (e.message||''), 'error');
    } finally {
      setBtnLoading('btn-guardar-editar-credito', false);
    }
  }
  window.guardarEdicionCredito = guardarEdicionCredito;

  /* ===================================================
     LISTA DE CRÉDITOS / KPIs
  =================================================== */
  function badgeEstado(e) { return `<span class="badge-credito badge-${e}">${LABEL_ESTADO[e]||e}</span>`; }
  function badgeTipo(t) { return `<span class="badge-credito badge-tipo-${t}">${t==='venta'?'Por venta':'Financiero'}</span>`; }

  async function loadKpis() {
    const uid = CS.userId;
    const { data: creditos } = await _sb.from('creditos').select('estado,saldo_pendiente,capital_financiado,tipo').eq('auth_user_id', uid);
    const list = creditos || [];
    const activos = list.filter(c => ['activo','al_dia','con_atraso','en_proceso'].includes(c.estado)).length;
    const conAtraso = list.filter(c => c.estado==='con_atraso').length;
    const saldoPendiente = list.reduce((s,c)=>s+Number(c.saldo_pendiente||0),0);
    const capitalColocado = list.reduce((s,c)=>s+Number(c.capital_financiado||0),0);

    const { data: pagosMes } = await _sb.from('creditos_pagos').select('monto').eq('auth_user_id', uid).gte('fecha', startOfMonthISO()).eq('estado','completado');
    const pagosMesTotal = (pagosMes||[]).reduce((s,p)=>s+Number(p.monto||0),0);

    const en7dias = ymd(new Date(Date.now()+7*86400000));
    const { data: proximas } = await _sb.from('creditos_cuotas').select('id').eq('auth_user_id', uid).neq('estado','pagada').lte('fecha_vencimiento', en7dias).gte('fecha_vencimiento', todayISO());

    document.getElementById('kpi-activos').textContent = activos;
    document.getElementById('kpi-atraso').textContent = conAtraso;
    document.getElementById('kpi-saldo-pendiente').textContent = fmt(saldoPendiente);
    document.getElementById('kpi-capital-colocado').textContent = fmt(capitalColocado);
    document.getElementById('kpi-pagos-mes').textContent = fmt(pagosMesTotal);
    document.getElementById('kpi-proximos').textContent = (proximas||[]).length;
  }

  async function marcarCuotasVencidas() {
    // Marca como "vencida" toda cuota pendiente cuya fecha ya pasó (no borra nada, solo actualiza estado)
    try {
      await _sb.from('creditos_cuotas').update({ estado: 'vencida' })
        .eq('auth_user_id', CS.userId).eq('estado','pendiente').lt('fecha_vencimiento', todayISO());
      // Si un crédito tiene alguna cuota vencida, marcarlo con_atraso (sin tocar cancelados/refinanciados)
      const { data: conVencidas } = await _sb.from('creditos_cuotas').select('credito_id').eq('auth_user_id', CS.userId).eq('estado','vencida');
      const ids = [...new Set((conVencidas||[]).map(c=>c.credito_id))];
      if (ids.length) {
        await _sb.from('creditos').update({ estado: 'con_atraso' }).eq('auth_user_id', CS.userId).in('id', ids).in('estado', ['activo','al_dia','en_proceso']);
      }
    } catch (e) { console.warn('marcarCuotasVencidas:', e); }
  }

  async function loadCreditos() {
    let q = _sb.from('creditos').select('*', { count:'exact' }).eq('auth_user_id', CS.userId);
    if (CS.creditosFiltro === 'venta') q = q.eq('tipo','venta');
    else if (CS.creditosFiltro === 'financiero') q = q.eq('tipo','financiero');
    else if (CS.creditosFiltro === 'con_atraso') q = q.eq('estado','con_atraso');
    else if (CS.creditosFiltro === 'cancelado') q = q.eq('estado','cancelado');
    if (CS.creditosSearch) {
      // El campo dice "Buscar cliente o número" -- pero antes solo
      // filtraba por numero_credito, nunca por el nombre del cliente
      // (bug real: buscar un nombre que SI existia siempre decia
      // "no hay resultados"). Ahora busca tambien los clientes cuyo
      // nombre/apellido coincida, y trae los creditos de cualquiera
      // de los dos casos.
      const { data: clientesCoinciden } = await _sb.from('clientes')
        .select('id').eq('auth_user_id', CS.userId)
        .or(`nombre.ilike.%${CS.creditosSearch}%,apellido.ilike.%${CS.creditosSearch}%`);
      const idsClientes = (clientesCoinciden||[]).map(c=>c.id);
      const filtroOr = idsClientes.length
        ? `numero_credito.ilike.%${CS.creditosSearch}%,cliente_id.in.(${idsClientes.join(',')})`
        : `numero_credito.ilike.%${CS.creditosSearch}%`;
      q = q.or(filtroOr);
    }

    const from = (CS.creditosPage-1)*CS.creditosPerPage, to = from + CS.creditosPerPage - 1;
    const { data, count } = await q.order('created_at', { ascending:false }).range(from,to);
    CS.creditos = data || []; CS.creditosTotal = count || 0;
    renderCreditosTable();
    renderPaginacion();
  }

  async function renderCreditosTable() {
    const tbody = document.getElementById('creditos-tbody');
    if (!CS.creditos.length) { tbody.innerHTML = '<tr><td colspan="9" class="empty-cell">No hay créditos registrados</td></tr>'; return; }

    const clienteIds = [...new Set(CS.creditos.map(c=>c.cliente_id))];
    const creditoIds = CS.creditos.map(c=>c.id);
    const [{ data: clientesData }, { data: proxCuotas }] = await Promise.all([
      _sb.from('clientes').select('id,nombre,apellido').in('id', clienteIds),
      _sb.from('creditos_cuotas').select('credito_id,fecha_vencimiento,monto_total,numero').neq('estado','pagada').in('credito_id', creditoIds).order('numero'),
    ]);
    const clienteMap = new Map((clientesData||[]).map(c=>[c.id,c]));
    const proxMap = new Map();
    (proxCuotas||[]).forEach(c => { if (!proxMap.has(c.credito_id)) proxMap.set(c.credito_id, c); });

    tbody.innerHTML = CS.creditos.map(c => {
      const cli = clienteMap.get(c.cliente_id);
      const prox = proxMap.get(c.id);
      return `<tr>
        <td><span class="td-num" style="font-family:var(--font-mono);font-weight:700">${esc(c.numero_credito)}</span></td>
        <td>${esc(cli ? cli.nombre+' '+(cli.apellido||'') : '—')}</td>
        <td>${badgeTipo(c.tipo)}</td>
        <td>${fmt(c.capital_financiado)}</td>
        <td>${fmt(c.saldo_pendiente)}</td>
        <td>${c.num_cuotas}</td>
        <td>${prox ? fmtDate(prox.fecha_vencimiento) : '—'}</td>
        <td>${badgeEstado(c.estado)}</td>
        <td>
          <button class="btn-ghost" style="padding:4px 8px" onclick="abrirDetalleCredito('${c.id}')">Ver</button>
          ${c.estado!=='cancelado' ? `<button class="btn-ghost" style="padding:4px 8px" onclick="abrirRegistrarPago('${c.id}')">Pagar</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  function renderPaginacion() {
    const totalPaginas = Math.max(1, Math.ceil(CS.creditosTotal / CS.creditosPerPage));
    document.getElementById('paginacion-info').textContent = `Página ${CS.creditosPage} de ${totalPaginas} · ${CS.creditosTotal} créditos`;
    document.getElementById('btn-pag-prev').disabled = CS.creditosPage <= 1;
    document.getElementById('btn-pag-next').disabled = CS.creditosPage >= totalPaginas;
  }
  function paginaAnterior() { if (CS.creditosPage>1) { CS.creditosPage--; loadCreditos(); } }
  function paginaSiguiente() { CS.creditosPage++; loadCreditos(); }
  window.paginaAnterior = paginaAnterior; window.paginaSiguiente = paginaSiguiente;

  function setFiltroCreditos(f) {
    CS.creditosFiltro = f; CS.creditosPage = 1;
    document.querySelectorAll('[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===f));
    loadCreditos();
  }
  window.setFiltroCreditos = setFiltroCreditos;

  let _searchTimer;
  function buscarCreditos() {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => { CS.creditosSearch = document.getElementById('creditos-search').value.trim(); CS.creditosPage = 1; loadCreditos(); }, 350);
  }
  window.buscarCreditos = buscarCreditos;

  async function loadPagosRecientes() {
    const { data } = await _sb.from('creditos_pagos').select('*, creditos(numero_credito)').eq('auth_user_id', CS.userId).order('created_at', { ascending:false }).limit(30);
    const pagos = data || [];
    const clienteIds = [...new Set(pagos.map(p=>p.cliente_id))];
    const { data: clientesData } = await _sb.from('clientes').select('id,nombre,apellido').in('id', clienteIds.length?clienteIds:['00000000-0000-0000-0000-000000000000']);
    const clienteMap = new Map((clientesData||[]).map(c=>[c.id,c]));
    const tbody = document.getElementById('pagos-tbody');
    tbody.innerHTML = pagos.length ? pagos.map(p => {
      const cli = clienteMap.get(p.cliente_id);
      return `<tr>
        <td>${fmtDate(p.fecha)}</td>
        <td>${esc(cli ? cli.nombre+' '+(cli.apellido||'') : '—')}</td>
        <td>${esc(p.creditos?.numero_credito||'—')}</td>
        <td>${fmt(p.monto)}</td>
        <td>${esc(p.metodo_pago_nombre||'—')}</td>
        <td>${fmt(p.saldo_nuevo)}</td>
        <td style="max-width:200px;white-space:normal;font-size:12.5px;color:var(--text-secondary)">${p.observaciones ? esc(p.observaciones) : '—'}</td>
        <td></td>
      </tr>`;
    }).join('') : '<tr><td colspan="8" class="empty-cell">Sin pagos registrados</td></tr>';
  }

  function setSection(section) {
    CS.activeSection = section;
    document.querySelectorAll('.section-tab').forEach(t => t.classList.toggle('active', t.dataset.section===section));
    document.querySelectorAll('.section-panel').forEach(p => p.style.display = p.dataset.section===section ? 'block' : 'none');
    if (section === 'pagos') loadPagosRecientes();
  }
  window.setSection = setSection;

  async function refrescarTodo() {
    await marcarCuotasVencidas();
    await Promise.all([loadKpis(), loadCreditos()]);
    if (CS.activeSection === 'pagos') await loadPagosRecientes();
  }

  /* ===================================================
     MODAL HELPERS / TOAST
  =================================================== */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; }
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; }
  }
  window.openModal = openModal; window.closeModal = closeModal;

  function showToast(msg, type='success') {
    const el = document.getElementById('toast'); if (!el) return;
    el.textContent = msg; el.className = `toast toast-${type} toast-show`;
    clearTimeout(el._timer); el._timer = setTimeout(()=>el.classList.remove('toast-show'), 3500);
  }

  /* ===================================================
     INIT
  =================================================== */
  async function initCreditos() {
    applyTheme(localStorage.getItem('n360_theme') || 'light');
    const fechaEl = document.getElementById('header-fecha');
    if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI',{day:'numeric',month:'long',year:'numeric'});
    try {
      const { data: { user }, error } = await _sb.auth.getUser();
      if (error || !user) { window.location.href = 'login.html'; return; }
      CS.userId = user.id; CS.userEmail = user.email;
      if (user.email) checkAdminAccess(user.email);
      await cargarEstadoStockCompartido();
      await cargarConfigTicket();
      await loadEmpresaConfig(user.id);
      const profile = await loadUserProfile(user.id);
      if (profile) renderUserInfo(profile, user.email);
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';

      await Promise.all([loadClientes(), loadProductosYServicios(), loadMetodosPago(), loadImpuestos()]);
      await refrescarTodo();

      const params = new URLSearchParams(window.location.search);
      if (params.get('action') === 'new') abrirNuevoCredito();
      if (params.get('action') === 'pagar') abrirRegistrarPago();
      // Deep link desde el módulo de Rutas — abre el pago de ESE
      // crédito puntual, directamente en la misma pantalla de siempre.
      const abrirPagoId = params.get('abrir_pago');
      if (abrirPagoId) abrirRegistrarPago(abrirPagoId);

      // Deep link desde Proformas ("Pago parcial / a crédito") — abre
      // Nuevo Crédito ya con el cliente y los productos de la proforma
      // cargados, usando el MISMO formulario de siempre. Nunca se crea
      // el crédito con una lógica aparte.
      const desdeProforma = params.get('desde_proforma');
      if (desdeProforma) abrirNuevoCreditoDesdeProforma(desdeProforma);
    } catch (err) {
      console.error('initCreditos:', err);
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
    }
  }

  _sb.auth.onAuthStateChange(event => { if (event==='SIGNED_OUT') window.location.href = 'login.html'; });

  window.toggleSidebar = toggleSidebar;
  window.closeMobileSidebar = closeMobileSidebar;
  window.toggleTheme = toggleTheme;
  window.navigate = navigate;

  document.addEventListener('DOMContentLoaded', () => {
    initCreditos();
    if (window.lucide) lucide.createIcons();
  });

})(); // fin IIFE
