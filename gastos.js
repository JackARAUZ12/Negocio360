/* =====================================================
   GASTOS.JS — NEGOCIO360  v1.5
   IIFE wrapper: todas las variables son privadas al
   módulo y no chocan con las de cajaAPI.js (STATE,
   sbClient, SUPABASE_URL, SUPABASE_KEY, etc.)
   Las funciones llamadas desde HTML se exponen
   explícitamente en window.xxx al final.
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

  /* ===================================================
     CATEGORÍAS / FRECUENCIAS
  =================================================== */
  const CATEGORIAS_GASTO = [
    'Publicidad', 'Salarios', 'Internet', 'Electricidad', 'Agua', 'Alquiler',
    'Combustible', 'Impuestos', 'Activos Fijos', 'Licencias', 'Hosting',
    'Dominio', 'Servicios', 'Mantenimiento', 'Otros',
  ];

  const FRECUENCIAS = [
    { v: 'semanal',    l: 'Semanal' },
    { v: 'quincenal',  l: 'Quincenal' },
    { v: 'mensual',    l: 'Mensual' },
    { v: 'trimestral', l: 'Trimestral' },
    { v: 'semestral',  l: 'Semestral' },
    { v: 'anual',      l: 'Anual' },
  ];

  /* ===================================================
     ESTADO LOCAL (privado al módulo)
  =================================================== */
  const GS = {
    userId:        null,
    userEmail:     null,
    empresaConfig: {},
    currentUser:   {},
    metodosPago:   [],
    gastos:          [],
    gastosPage:      1,
    gastosPerPage:   15,
    gastosTotal:     0,
    gastosFiltro:    'todos',
    gastosSearch:    '',
    gastosCategoria: '',
    gastosProgramados: [],
    kpis: { hoy:0, mes:0, anio:0, pendientes:0, recurrentesActivos:0, salariosPendientes:0 },
    activeSection: 'gastos',
  };

  /* ===================================================
     HELPERS FECHA
     FIX CRÍTICO DE ZONA HORARIA: toISOString() da la fecha en UTC;
     en Nicaragua (UTC-6) eso adelanta el "día" a las 6 PM hora local.
  =================================================== */
  function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function todayISO() { return ymd(new Date()); }
  function startOfMonthISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
  }
  function startOfYearISO() { return `${new Date().getFullYear()}-01-01`; }

  function daysDiff(dateISO) {
    const t = new Date(todayISO()+'T00:00:00');
    const x = new Date(dateISO  +'T00:00:00');
    return Math.round((x - t) / 86400000);
  }

  function calcularProximaFecha(fechaBaseISO, frecuencia) {
    const d = new Date(fechaBaseISO + 'T12:00:00');
    switch (frecuencia) {
      case 'semanal':    d.setDate(d.getDate() + 7);        break;
      case 'quincenal':  d.setDate(d.getDate() + 15);       break;
      case 'mensual':    d.setMonth(d.getMonth() + 1);      break;
      case 'trimestral': d.setMonth(d.getMonth() + 3);      break;
      case 'semestral':  d.setMonth(d.getMonth() + 6);      break;
      case 'anual':      d.setFullYear(d.getFullYear() + 1); break;
      default:           d.setMonth(d.getMonth() + 1);
    }
    return ymd(d);
  }

  /* ===================================================
     HELPERS FORMATO
  =================================================== */
  function sym() { return GS.empresaConfig?.moneda || 'C$'; }

  function fmt(amount) {
    if (amount === null || amount === undefined) return `${sym()} —`;
    return `${sym()} ${Number(amount).toLocaleString('es-NI', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
  }

  function fmtDate(isoDate) {
    if (!isoDate) return '—';
    return new Date(isoDate + 'T12:00:00').toLocaleDateString('es-NI', { day:'2-digit', month:'short', year:'numeric' });
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setEl(id, value) { const e = document.getElementById(id); if (e) e.textContent = value; }

  /* ===================================================
     NOMBRE DEL NEGOCIO
     El onboarding (personalizacion.html) guarda el nombre
     comercial en la columna `nombre_comercial` de
     `configuracion_empresa`. Aceptamos también variantes
     por si el esquema cambia (nombre_negocio / nombre).
  =================================================== */
  function nombreNegocio() {
    return (
      GS.empresaConfig?.nombre_comercial ||
      GS.empresaConfig?.nombre_negocio ||
      GS.empresaConfig?.nombre ||
      GS.currentUser?.nombre_negocio ||
      'Mi negocio'
    );
  }

  /* ===================================================
     CAJA API
  =================================================== */
  async function _registrarEnCaja(params) {
    if (!window.CajaAPI || typeof window.CajaAPI.registrarMovimiento !== 'function') {
      console.error('CajaAPI no disponible');
      return { ok: false, error: 'CajaAPI no disponible' };
    }
    return window.CajaAPI.registrarMovimiento(params);
  }

  /* ===================================================
     THEME
  =================================================== */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('n360_theme', theme);
    const sun  = document.getElementById('icon-sun');
    const moon = document.getElementById('icon-moon');
    if (sun)  sun.style.display  = theme === 'dark'  ? 'block' : 'none';
    if (moon) moon.style.display = theme === 'light' ? 'block' : 'none';
  }
  function toggleTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  /* ===================================================
     SIDEBAR / NAV (con soporte responsive para móvil)
  =================================================== */
  let _sidebarCollapsed = false;

  function isMobileViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
  }

  function toggleSidebar() {
    if (isMobileViewport()) {
      // En móvil, el sidebar es un drawer que se superpone
      const sb = document.getElementById('sidebar');
      const ov = document.getElementById('sidebar-overlay');
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
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    sb.classList.remove('mobile-open');
    if (ov) ov.classList.remove('show');
    document.body.style.overflow = '';
  }

  function navigate(url) {
    closeMobileSidebar();
    window.location.href = url;
  }

  // Si la ventana pasa de móvil a escritorio (o rota), limpiar estado del drawer
  window.addEventListener('resize', () => {
    if (!isMobileViewport()) closeMobileSidebar();
  });

  /* ===================================================
     EMPRESA CONFIG / PERFIL
  =================================================== */
  async function loadEmpresaConfig(userId) {
    try {
      const { data } = await _sb.from('configuracion_empresa').select('*').eq('auth_user_id', userId).maybeSingle();
      if (data) {
        GS.empresaConfig = data;
        const logoText = document.getElementById('sidebar-logo-text');
        if (logoText) logoText.textContent = nombreNegocio();
        if (data.color_principal) {
          document.documentElement.style.setProperty('--accent', data.color_principal);
          document.documentElement.style.setProperty('--accent-soft', data.color_principal + '22');
          document.documentElement.style.setProperty('--border-focus', data.color_principal);
        } else if (data.color_primario) {
          document.documentElement.style.setProperty('--accent', data.color_primario);
          document.documentElement.style.setProperty('--accent-soft', data.color_primario + '22');
          document.documentElement.style.setProperty('--border-focus', data.color_primario);
        }
        if (data.logo_principal_url || data.logo_url) {
          const li = document.querySelector('.logo-icon');
          if (li) li.innerHTML = `<img src="${data.logo_principal_url || data.logo_url}" style="width:28px;height:28px;object-fit:contain;border-radius:6px" alt="logo">`;
        }
      }
    } catch(e) { console.warn('loadEmpresaConfig:', e); }
  }

  async function loadUserProfile(userId) {
    try {
      const { data } = await _sb.from('usuarios').select('*').eq('auth_user_id', userId).maybeSingle();
      return data;
    } catch(e) { return null; }
  }

  function renderUserInfo(user, email) {
    if (!user) return;
    GS.currentUser = user;
    const nombre   = user.nombre   || email?.split('@')[0] || 'Usuario';
    const apellido = user.apellido || '';
    const plan     = user.plan || 'Gratuito';
    const initials = ((nombre[0]||'') + (apellido[0]||'')).toUpperCase();
    document.getElementById('header-name').textContent   = `${nombre} ${apellido}`.trim();
    document.getElementById('header-biz').textContent    = nombreNegocio();
    document.getElementById('header-avatar').textContent = initials || nombre[0]?.toUpperCase() || 'U';
    document.getElementById('plan-text').textContent     = plan.charAt(0).toUpperCase() + plan.slice(1);
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
    document.getElementById('greeting-text').textContent = `${greet}, ${nombre}`;
  }

  async function checkAdminAccess(email) {
    try {
      const { data } = await _sb.from('administradores').select('email,activo').eq('email', email).eq('activo', true).maybeSingle();
      if (data) { const el = document.getElementById('nav-admin'); if (el) el.style.display = 'flex'; }
    } catch(e) {}
  }

  /* ===================================================
     MÉTODOS DE PAGO
  =================================================== */
  async function loadMetodosPago() {
    try {
      const { data } = await _sb.from('metodos_pago').select('*').eq('auth_user_id', GS.userId).eq('activo', true).order('orden');
      GS.metodosPago = data || [];
      populateMetodoSelects();
    } catch(e) { console.warn('loadMetodosPago:', e); }
  }

  function populateMetodoSelects() {
    ['gasto-metodo','pago-metodo'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = `<option value="">Efectivo (predeterminado)</option>` +
        GS.metodosPago.map(m => `<option value="${m.id}">${escHtml(m.nombre)}</option>`).join('');
    });
  }

  /* ===================================================
     KPIs
  =================================================== */
  async function loadKpis() {
    try {
      const [hoyRes,mesRes,anioRes,pendRes,progActRes] = await Promise.all([
        _sb.from('gastos').select('monto').eq('auth_user_id',GS.userId).eq('estado','activo').eq('fecha',todayISO()),
        _sb.from('gastos').select('monto').eq('auth_user_id',GS.userId).eq('estado','activo').gte('fecha',startOfMonthISO()),
        _sb.from('gastos').select('monto').eq('auth_user_id',GS.userId).eq('estado','activo').gte('fecha',startOfYearISO()),
        _sb.from('gastos_programados').select('id,monto,fecha_proxima').eq('auth_user_id',GS.userId).eq('activo',true),
        _sb.from('gastos_programados').select('id',{count:'exact',head:true}).eq('auth_user_id',GS.userId).eq('activo',true),
      ]);
      const sum = rows => (rows||[]).reduce((s,r)=>s+Number(r.monto||0),0);
      GS.kpis.hoy  = sum(hoyRes.data);
      GS.kpis.mes  = sum(mesRes.data);
      GS.kpis.anio = sum(anioRes.data);
      const hoyDate = todayISO();
      const pendList = pendRes.data || [];
      GS.kpis.pendientes         = sum(pendList.filter(p=>p.fecha_proxima<=hoyDate));
      GS.kpis.recurrentesActivos = progActRes.count || 0;
      const { data: sal } = await _sb.from('gastos_programados').select('monto,fecha_proxima,categoria').eq('auth_user_id',GS.userId).eq('activo',true).eq('categoria','Salarios');
      GS.kpis.salariosPendientes = sum((sal||[]).filter(s=>s.fecha_proxima<=hoyDate));
      renderKpis();
    } catch(e) { console.warn('loadKpis:', e); }
  }

  function renderKpis() {
    setEl('kpi-gastos-hoy',  fmt(GS.kpis.hoy));
    setEl('kpi-gastos-mes',  fmt(GS.kpis.mes));
    setEl('kpi-gastos-anio', fmt(GS.kpis.anio));
    setEl('kpi-pendientes',  fmt(GS.kpis.pendientes));
    setEl('kpi-recurrentes', GS.kpis.recurrentesActivos.toString());
    setEl('kpi-salarios',    fmt(GS.kpis.salariosPendientes));
  }

  /* ===================================================
     TABLA GASTOS
  =================================================== */
  async function loadGastos() {
    try {
      let q = _sb.from('gastos').select('*',{count:'exact'}).eq('auth_user_id',GS.userId)
        .order('fecha',{ascending:false}).order('created_at',{ascending:false});
      if (GS.gastosFiltro==='inmediatos')  q = q.eq('tipo','inmediato').eq('estado','activo');
      else if (GS.gastosFiltro==='programados') q = q.eq('tipo','programado').eq('estado','activo');
      else if (GS.gastosFiltro==='pagados')     q = q.eq('estado','activo');
      if (GS.gastosCategoria)         q = q.eq('categoria', GS.gastosCategoria);
      if (GS.gastosSearch.trim())     q = q.ilike('concepto', `%${GS.gastosSearch.trim()}%`);
      const from = (GS.gastosPage-1)*GS.gastosPerPage;
      q = q.range(from, from+GS.gastosPerPage-1);
      const { data, count } = await q;
      GS.gastos      = data || [];
      GS.gastosTotal = count || 0;
      renderGastosTable();
      renderPaginacion();
    } catch(e) {
      console.warn('loadGastos:', e);
      const tbody = document.getElementById('gastos-tbody');
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="empty-cell">Error al cargar gastos.</td></tr>`;
    }
  }

  function renderGastosTable() {
    const tbody = document.getElementById('gastos-tbody');
    if (!tbody) return;
    if (!GS.gastos.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-cell"><div class="empty-state-mini"><p>Sin gastos registrados</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = GS.gastos.map(g => {
      const tipoLabel = g.tipo==='inmediato' ? 'Inmediato' : 'Programado';
      const tipoClass = g.tipo==='inmediato' ? 'badge-inmediato' : 'badge-programado';
      const estadoBadge = g.estado==='cancelado'
        ? `<span class="status-badge badge-inactive">Cancelado</span>`
        : `<span class="status-badge badge-active">Pagado</span>`;
      const prog    = g.gasto_programado_id ? GS.gastosProgramados.find(p=>p.id===g.gasto_programado_id) : null;
      const proximo = prog ? fmtDate(prog.fecha_proxima) : '—';
      return `<tr class="mov-row ${g.estado==='cancelado'?'mov-anulado':''}">
        <td class="td-fecha">${fmtDate(g.fecha)}</td>
        <td class="td-concepto">
          <span class="concepto-text">${escHtml(g.concepto)}</span>
          ${g.empleado      ? `<span class="concepto-obs">Empleado: ${escHtml(g.empleado)}</span>` : ''}
          ${g.observaciones ? `<span class="concepto-obs">${escHtml(g.observaciones)}</span>` : ''}
        </td>
        <td><span class="cat-badge">${escHtml(g.categoria)}</span></td>
        <td><span class="tipo-badge ${tipoClass}">${tipoLabel}</span></td>
        <td class="td-monto td-salida">${fmt(g.monto)}</td>
        <td>${estadoBadge}</td>
        <td class="td-fecha">${proximo}</td>
        <td class="td-actions"><div class="action-cell">
          <button class="btn-icon" onclick="verDetalleGasto('${g.id}')" title="Ver detalle">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
          ${g.estado!=='cancelado' ? `<button class="btn-icon btn-icon-danger" onclick="confirmarCancelarGasto('${g.id}')" title="Cancelar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
        </div></td>
      </tr>`;
    }).join('');
  }

  function renderPaginacion() {
    const totalPages = Math.ceil(GS.gastosTotal / GS.gastosPerPage) || 1;
    const info = document.getElementById('paginacion-info');
    if (info) {
      const from = Math.min((GS.gastosPage-1)*GS.gastosPerPage+1, GS.gastosTotal);
      const to   = Math.min(GS.gastosPage*GS.gastosPerPage, GS.gastosTotal);
      info.textContent = GS.gastosTotal > 0 ? `Mostrando ${from}–${to} de ${GS.gastosTotal}` : 'Sin resultados';
    }
    const prev = document.getElementById('btn-pag-prev');
    const next = document.getElementById('btn-pag-next');
    if (prev) prev.disabled = GS.gastosPage <= 1;
    if (next) next.disabled = GS.gastosPage >= totalPages;
  }

  function paginaAnterior()  { if (GS.gastosPage > 1) { GS.gastosPage--; loadGastos(); } }
  function paginaSiguiente() {
    if (GS.gastosPage < Math.ceil(GS.gastosTotal/GS.gastosPerPage)) { GS.gastosPage++; loadGastos(); }
  }

  function setFiltroGastos(filtro) {
    GS.gastosFiltro = filtro; GS.gastosPage = 1;
    document.querySelectorAll('.filter-btn[data-filtro]').forEach(b => b.classList.toggle('active', b.dataset.filtro===filtro));
    loadGastos();
  }

  function setCategoriaFiltro() {
    GS.gastosCategoria = document.getElementById('filtro-categoria')?.value || '';
    GS.gastosPage = 1; loadGastos();
  }

  function buscarGastos() {
    GS.gastosSearch = document.getElementById('gastos-search')?.value || '';
    GS.gastosPage = 1; loadGastos();
  }

  /* ===================================================
     GASTOS PROGRAMADOS
  =================================================== */
  async function loadGastosProgramados() {
    try {
      const { data } = await _sb.from('gastos_programados').select('*').eq('auth_user_id',GS.userId).order('fecha_proxima',{ascending:true});
      GS.gastosProgramados = data || [];
      renderGastosProgramados();
    } catch(e) { console.warn('loadGastosProgramados:', e); }
  }

  function vencimientoBadge(fechaISO, activo) {
    if (!activo) return `<span class="status-badge badge-inactive">Pausado</span>`;
    const diff = daysDiff(fechaISO);
    if (diff < 0)  return `<span class="venc-badge venc-vencido">⚠ Vencido</span>`;
    if (diff===0)  return `<span class="venc-badge venc-hoy">⚠ Vence hoy</span>`;
    if (diff===1)  return `<span class="venc-badge venc-pronto">⚠ Vence mañana</span>`;
    if (diff<=3)   return `<span class="venc-badge venc-pronto">⚠ Vence en ${diff} días</span>`;
    return `<span class="venc-badge venc-ok">${fmtDate(fechaISO)}</span>`;
  }

  function renderGastosProgramados() {
    const tbody = document.getElementById('programados-tbody');
    if (!tbody) return;
    if (!GS.gastosProgramados.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Sin gastos programados.</td></tr>`;
      return;
    }
    tbody.innerHTML = GS.gastosProgramados.map(p => {
      const freqLabel = (FRECUENCIAS.find(f=>f.v===p.frecuencia)||{}).l || p.frecuencia;
      return `<tr class="mov-row ${!p.activo?'mov-anulado':''}">
        <td><span class="concepto-text">${escHtml(p.nombre)}</span>${p.empleado?`<span class="concepto-obs">Empleado: ${escHtml(p.empleado)}</span>`:''}</td>
        <td><span class="cat-badge">${escHtml(p.categoria)}</span></td>
        <td class="td-monto td-salida">${fmt(p.monto)}</td>
        <td>${freqLabel}</td>
        <td>${vencimientoBadge(p.fecha_proxima,p.activo)}</td>
        <td><span class="status-badge ${p.activo?'badge-active':'badge-inactive'}">${p.activo?'Activo':'Pausado'}</span></td>
        <td class="td-actions"><div class="action-cell">
          ${p.activo ? `
          <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick="abrirRegistrarPago('${p.id}')">Registrar pago</button>
          <button class="btn-icon" onclick="editarProgramado('${p.id}')" title="Editar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-icon-danger" onclick="togglePausarProgramado('${p.id}',false)" title="Pausar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>` : `
          <button class="btn-icon btn-icon-success" onclick="togglePausarProgramado('${p.id}',true)" title="Reactivar">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          </button>`}
        </div></td>
      </tr>`;
    }).join('');
  }

  /* ===================================================
     MODAL: NUEVO GASTO
  =================================================== */
  function openNuevoGasto() {
    document.getElementById('gasto-form').reset();
    document.getElementById('gasto-tipo-flujo').value = 'inmediato';
    document.getElementById('gasto-fecha').value = todayISO();
    document.getElementById('gasto-frecuencia-wrap').style.display = 'none';
    document.getElementById('gasto-checkbox-wrap').style.display   = 'none';
    toggleCategoriaEspecial();
    openModal('modal-gasto');
  }

  function toggleTipoGasto() {
    const tipo = document.getElementById('gasto-tipo-flujo').value;
    document.getElementById('gasto-frecuencia-wrap').style.display = tipo==='programado' ? 'block' : 'none';
    document.getElementById('gasto-checkbox-wrap').style.display   = tipo==='programado' ? 'flex'  : 'none';
    document.getElementById('gasto-fecha-label').textContent = tipo==='programado'
      ? 'Fecha de inicio / próximo vencimiento' : 'Fecha del gasto';
  }

  function toggleCategoriaEspecial() {
    const cat = document.getElementById('gasto-categoria').value;
    const wrap = document.getElementById('gasto-empleado-wrap');
    if (wrap) wrap.style.display = cat==='Salarios' ? 'block' : 'none';
  }

  async function saveGasto() {
    const tipo          = document.getElementById('gasto-tipo-flujo').value;
    const categoria     = document.getElementById('gasto-categoria').value;
    const concepto      = document.getElementById('gasto-concepto').value.trim();
    const monto         = parseFloat(document.getElementById('gasto-monto').value);
    const fecha         = document.getElementById('gasto-fecha').value || todayISO();
    const metodoId      = document.getElementById('gasto-metodo').value;
    const observaciones = document.getElementById('gasto-obs').value.trim();
    const empleado      = document.getElementById('gasto-empleado')?.value.trim() || null;

    if (!concepto)            { showToast('El concepto es requerido','error'); return; }
    if (!monto || monto <= 0) { showToast('El monto debe ser mayor a 0','error'); return; }
    if (categoria==='Salarios' && !empleado) { showToast('Indica el nombre del empleado','error'); return; }

    const metodoNombre = GS.metodosPago.find(m=>m.id===metodoId)?.nombre || 'Efectivo';

    try {
      setBtnLoading('btn-save-gasto', true);
      if (tipo==='inmediato') {
        await registrarGastoInmediato({ categoria, concepto, monto, fecha, metodoId, metodoNombre, observaciones, empleado });
      } else {
        const frecuencia = document.getElementById('gasto-frecuencia').value;
        const pagarYa    = document.getElementById('gasto-pagar-ya').checked;
        await crearGastoProgramado({ categoria, nombre: concepto, monto, fecha, frecuencia, metodoId, metodoNombre, observaciones, empleado, pagarYa });
      }
      closeModal('modal-gasto');
      showToast('Gasto registrado correctamente');
      await refrescarTodo();
    } catch(e) {
      console.error('saveGasto:', e);
      showToast('Error al guardar: ' + (e.message||e), 'error');
    } finally {
      setBtnLoading('btn-save-gasto', false);
    }
  }

  /* ===================================================
     GASTO INMEDIATO
  =================================================== */
  async function registrarGastoInmediato({ categoria, concepto, monto, fecha, metodoId, metodoNombre, observaciones, empleado }) {
    const { data: gastoRow, error: errGasto } = await _sb.from('gastos').insert({
      auth_user_id: GS.userId, tipo:'inmediato', concepto, categoria, monto, fecha,
      metodo_pago_id: metodoId||null, metodo_pago_nombre: metodoNombre,
      observaciones: observaciones||null, empleado: empleado||null, estado:'activo',
    }).select().single();
    if (errGasto) throw errGasto;

    const mov = await _registrarEnCaja({
      auth_user_id: GS.userId, tipo_flujo:'EGRESO', tipo_movimiento:'GASTO',
      concepto: `${categoria}: ${concepto}`, monto,
      metodo_pago_id: metodoId||null, metodo_pago_nombre: metodoNombre,
      referencia_tipo:'gasto', referencia_id: gastoRow.id, observaciones, fecha,
    });
    if (!mov.ok) { console.error('No se pudo registrar en Caja:', mov.error); return; }

    const movId = await getUltimoMovimientoId();
    if (movId) await _sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', gastoRow.id);
  }

  async function getUltimoMovimientoId() {
    try {
      const { data } = await _sb.from('movimientos_financieros').select('id').eq('auth_user_id',GS.userId).order('created_at',{ascending:false}).limit(1).maybeSingle();
      return data?.id || null;
    } catch(e) { return null; }
  }

  /* ===================================================
     GASTO PROGRAMADO
  =================================================== */
  async function crearGastoProgramado({ categoria, nombre, monto, fecha, frecuencia, metodoId, metodoNombre, observaciones, empleado, pagarYa }) {
    const { data: progRow, error } = await _sb.from('gastos_programados').insert({
      auth_user_id: GS.userId, nombre, categoria, monto, frecuencia,
      fecha_proxima: fecha, empleado: empleado||null, observaciones: observaciones||null, activo: true,
    }).select().single();
    if (error) throw error;
    if (pagarYa) await ejecutarPagoProgramado(progRow, { fecha, metodoId, metodoNombre, observaciones });
  }

  async function ejecutarPagoProgramado(programado, { fecha, metodoId, metodoNombre, observaciones }) {
    const fechaPago   = fecha || todayISO();
    const metodoFinal = metodoNombre || 'Efectivo';

    const { data: gastoRow, error } = await _sb.from('gastos').insert({
      auth_user_id: GS.userId, tipo:'programado', concepto: programado.nombre,
      categoria: programado.categoria, monto: programado.monto, fecha: fechaPago,
      metodo_pago_id: metodoId||null, metodo_pago_nombre: metodoFinal,
      observaciones: observaciones||programado.observaciones||null,
      empleado: programado.empleado||null, gasto_programado_id: programado.id, estado:'activo',
    }).select().single();
    if (error) throw error;

    const mov = await _registrarEnCaja({
      auth_user_id: GS.userId, tipo_flujo:'EGRESO', tipo_movimiento:'GASTO',
      concepto: `${programado.categoria}: ${programado.nombre}`, monto: programado.monto,
      metodo_pago_id: metodoId||null, metodo_pago_nombre: metodoFinal,
      referencia_tipo:'gasto', referencia_id: gastoRow.id, observaciones, fecha: fechaPago,
    });
    if (mov.ok) {
      const movId = await getUltimoMovimientoId();
      if (movId) await _sb.from('gastos').update({ movimiento_financiero_id: movId }).eq('id', gastoRow.id);
    } else {
      console.error('No se pudo registrar pago en Caja:', mov.error);
    }

    await _sb.from('historial_gastos').insert({
      auth_user_id: GS.userId, gasto_programado_id: programado.id,
      gasto_id: gastoRow.id, monto: programado.monto, fecha_pago: fechaPago,
    });

    const proxima = calcularProximaFecha(fechaPago, programado.frecuencia);
    await _sb.from('gastos_programados').update({ fecha_proxima: proxima }).eq('id', programado.id);
  }

  /* ===================================================
     MODAL REGISTRAR PAGO
  =================================================== */
  let _programadoEnPago = null;

  function abrirRegistrarPago(programadoId) {
    const prog = GS.gastosProgramados.find(p=>p.id===programadoId);
    if (!prog) return;
    _programadoEnPago = prog;
    document.getElementById('pago-prog-nombre').textContent    = prog.nombre;
    document.getElementById('pago-prog-monto').textContent     = fmt(prog.monto);
    document.getElementById('pago-prog-vencimiento').innerHTML = vencimientoBadge(prog.fecha_proxima, prog.activo);
    document.getElementById('pago-fecha').value  = todayISO();
    document.getElementById('pago-metodo').innerHTML = document.getElementById('gasto-metodo').innerHTML;
    document.getElementById('pago-metodo').value = '';
    document.getElementById('pago-obs').value    = '';
    openModal('modal-registrar-pago');
  }

  async function confirmarRegistrarPago() {
    if (!_programadoEnPago) return;
    const fecha        = document.getElementById('pago-fecha').value || todayISO();
    const metodoId     = document.getElementById('pago-metodo').value;
    const metodoNombre = GS.metodosPago.find(m=>m.id===metodoId)?.nombre || 'Efectivo';
    const observaciones = document.getElementById('pago-obs').value.trim();
    try {
      setBtnLoading('btn-confirmar-pago', true);
      await ejecutarPagoProgramado(_programadoEnPago, { fecha, metodoId, metodoNombre, observaciones });
      closeModal('modal-registrar-pago');
      _programadoEnPago = null;
      showToast('Pago registrado correctamente');
      await refrescarTodo();
    } catch(e) {
      showToast('Error al registrar el pago','error');
    } finally {
      setBtnLoading('btn-confirmar-pago', false);
    }
  }

  /* ===================================================
     EDITAR / PAUSAR PROGRAMADO
  =================================================== */
  function editarProgramado(id) {
    const p = GS.gastosProgramados.find(x=>x.id===id);
    if (!p) return;
    document.getElementById('edit-prog-id').value         = p.id;
    document.getElementById('edit-prog-nombre').value     = p.nombre;
    document.getElementById('edit-prog-categoria').value  = p.categoria;
    document.getElementById('edit-prog-monto').value      = p.monto;
    document.getElementById('edit-prog-frecuencia').value = p.frecuencia;
    document.getElementById('edit-prog-fecha').value      = p.fecha_proxima;
    document.getElementById('edit-prog-obs').value        = p.observaciones || '';
    const empWrap = document.getElementById('edit-prog-empleado-wrap');
    if (empWrap) {
      empWrap.style.display = p.categoria==='Salarios' ? 'block' : 'none';
      document.getElementById('edit-prog-empleado').value = p.empleado || '';
    }
    openModal('modal-editar-programado');
  }

  function toggleCategoriaEspecialEdit() {
    const cat = document.getElementById('edit-prog-categoria').value;
    const wrap = document.getElementById('edit-prog-empleado-wrap');
    if (wrap) wrap.style.display = cat==='Salarios' ? 'block' : 'none';
  }

  async function guardarEdicionProgramado() {
    const id           = document.getElementById('edit-prog-id').value;
    const nombre       = document.getElementById('edit-prog-nombre').value.trim();
    const categoria    = document.getElementById('edit-prog-categoria').value;
    const monto        = parseFloat(document.getElementById('edit-prog-monto').value);
    const frecuencia   = document.getElementById('edit-prog-frecuencia').value;
    const fechaProxima = document.getElementById('edit-prog-fecha').value;
    const observaciones = document.getElementById('edit-prog-obs').value.trim();
    const empleado     = document.getElementById('edit-prog-empleado')?.value.trim() || null;
    if (!nombre)            { showToast('El nombre es requerido','error'); return; }
    if (!monto || monto<=0) { showToast('El monto debe ser mayor a 0','error'); return; }
    try {
      setBtnLoading('btn-guardar-edicion-prog', true);
      await _sb.from('gastos_programados').update({
        nombre, categoria, monto, frecuencia, fecha_proxima: fechaProxima,
        observaciones: observaciones||null, empleado: empleado||null,
      }).eq('id',id).eq('auth_user_id',GS.userId);
      closeModal('modal-editar-programado');
      showToast('Programación actualizada');
      await refrescarTodo();
    } catch(e) { showToast('Error al actualizar','error'); }
    finally { setBtnLoading('btn-guardar-edicion-prog', false); }
  }

  async function togglePausarProgramado(id, activar) {
    try {
      await _sb.from('gastos_programados').update({activo:activar}).eq('id',id).eq('auth_user_id',GS.userId);
      showToast(activar ? 'Programación reactivada' : 'Programación pausada');
      await refrescarTodo();
    } catch(e) { showToast('Error al actualizar','error'); }
  }

  /* ===================================================
     CANCELAR GASTO
  =================================================== */
  let _gastoToCancelar = null;

  function confirmarCancelarGasto(id) { _gastoToCancelar = id; openModal('modal-confirmar-cancelar'); }

  async function cancelarGasto() {
    if (!_gastoToCancelar) return;
    try {
      setBtnLoading('btn-confirmar-cancelar', true);
      await _sb.from('gastos').update({
        estado:'cancelado', cancelado_en: new Date().toISOString(), cancelado_motivo:'Cancelado manualmente',
      }).eq('id',_gastoToCancelar).eq('auth_user_id',GS.userId);
      closeModal('modal-confirmar-cancelar');
      _gastoToCancelar = null;
      showToast('Gasto cancelado.');
      await refrescarTodo();
    } catch(e) { showToast('Error al cancelar','error'); }
    finally { setBtnLoading('btn-confirmar-cancelar', false); }
  }

  /* ===================================================
     DETALLE GASTO
  =================================================== */
  async function verDetalleGasto(id) {
    const g = GS.gastos.find(x=>x.id===id);
    if (!g) return;
    let historialHtml = '<p style="color:var(--text-muted);font-size:12.5px">Sin historial.</p>';
    let progInfo = '';
    if (g.gasto_programado_id) {
      const prog = GS.gastosProgramados.find(p=>p.id===g.gasto_programado_id);
      if (prog) {
        const fl = (FRECUENCIAS.find(f=>f.v===prog.frecuencia)||{}).l || prog.frecuencia;
        progInfo = `<div class="detalle-row"><span>Frecuencia</span><strong>${fl}</strong></div>
          <div class="detalle-row"><span>Próximo vencimiento</span><strong>${fmtDate(prog.fecha_proxima)}</strong></div>`;
      }
      try {
        const { data: hist } = await _sb.from('historial_gastos').select('monto,fecha_pago')
          .eq('gasto_programado_id',g.gasto_programado_id).eq('auth_user_id',GS.userId)
          .order('fecha_pago',{ascending:false}).limit(10);
        if (hist?.length) historialHtml = hist.map(h=>`<div class="detalle-row"><span>${fmtDate(h.fecha_pago)}</span><strong>${fmt(h.monto)}</strong></div>`).join('');
      } catch(e) {}
    }
    document.getElementById('detalle-gasto-body').innerHTML = `
      <div class="detalle-row"><span>Concepto</span><strong>${escHtml(g.concepto)}</strong></div>
      <div class="detalle-row"><span>Categoría</span><strong>${escHtml(g.categoria)}</strong></div>
      <div class="detalle-row"><span>Tipo</span><strong>${g.tipo==='inmediato'?'Inmediato':'Programado'}</strong></div>
      <div class="detalle-row"><span>Monto</span><strong>${fmt(g.monto)}</strong></div>
      <div class="detalle-row"><span>Fecha</span><strong>${fmtDate(g.fecha)}</strong></div>
      <div class="detalle-row"><span>Método</span><strong>${escHtml(g.metodo_pago_nombre||'Efectivo')}</strong></div>
      ${g.empleado ? `<div class="detalle-row"><span>Empleado</span><strong>${escHtml(g.empleado)}</strong></div>` : ''}
      <div class="detalle-row"><span>Estado</span><strong>${g.estado==='activo'?'Pagado':'Cancelado'}</strong></div>
      ${g.observaciones ? `<div class="detalle-row"><span>Observaciones</span><strong>${escHtml(g.observaciones)}</strong></div>` : ''}
      ${g.movimiento_financiero_id ? `<div class="detalle-row"><span>En Caja</span><strong style="color:var(--accent)">Generado ✓</strong></div>` : ''}
      ${progInfo}
      <div class="detalle-divider"></div>
      <p style="font-size:11.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Historial de pagos</p>
      ${historialHtml}`;
    openModal('modal-detalle-gasto');
  }

  /* ===================================================
     SECCIONES / REFRESCAR
  =================================================== */
  function setSection(section) {
    GS.activeSection = section;
    document.querySelectorAll('.section-tab').forEach(t => t.classList.toggle('active', t.dataset.section===section));
    document.querySelectorAll('.section-panel').forEach(p => p.style.display = p.dataset.section===section ? 'block' : 'none');
    if (section==='gastos')      loadGastos();
    if (section==='programados') loadGastosProgramados();
  }

  async function refrescarTodo() {
    await Promise.allSettled([loadKpis(), loadGastos(), loadGastosProgramados()]);
  }

  /* ===================================================
     MODALES
  =================================================== */
  function openModal(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display='flex'; el.classList.add('modal-open'); document.body.style.overflow='hidden'; }
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) { el.style.display='none'; el.classList.remove('modal-open'); document.body.style.overflow=''; }
  }

  document.addEventListener('click', e => {
    if (e.target.classList.contains('modal-overlay')) {
      e.target.style.display = 'none'; document.body.style.overflow = '';
    }
  });

  /* ===================================================
     TOAST / HELPERS UI
  =================================================== */
  function showToast(msg, type='success') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast toast-${type} toast-show`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('toast-show'), 3500);
  }

  function setBtnLoading(id, loading) {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = loading; el.style.opacity = loading ? '0.6' : '1';
  }

  function populateCategoriaSelects() {
    ['gasto-categoria','edit-prog-categoria','filtro-categoria'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const isFiltro = id==='filtro-categoria';
      sel.innerHTML = (isFiltro ? '<option value="">Todas las categorías</option>' : '') +
        CATEGORIAS_GASTO.map(c=>`<option value="${c}">${c}</option>`).join('');
    });
    ['gasto-frecuencia','edit-prog-frecuencia'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = FRECUENCIAS.map(f=>`<option value="${f.v}">${f.l}</option>`).join('');
    });
  }

  /* ===================================================
     INIT
  =================================================== */
  async function initGastos() {
    applyTheme(localStorage.getItem('n360_theme') || 'light');
    const fechaEl = document.getElementById('header-fecha');
    if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString('es-NI',{day:'numeric',month:'long',year:'numeric'});
    populateCategoriaSelects();
    try {
      const { data: { user }, error } = await _sb.auth.getUser();
      if (error || !user) { window.location.href = 'login.html'; return; }
      GS.userId = user.id; GS.userEmail = user.email;
      if (user.email) checkAdminAccess(user.email);
      await loadEmpresaConfig(user.id);
      const profile = await loadUserProfile(user.id);
      if (profile) renderUserInfo(profile, user.email);
      else {
        document.getElementById('header-name').textContent   = user.email?.split('@')[0]||'Usuario';
        document.getElementById('header-avatar').textContent = (user.email||'U')[0].toUpperCase();
        document.getElementById('header-biz').textContent    = nombreNegocio();
      }
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
      await loadMetodosPago();
      await refrescarTodo();
      if (new URLSearchParams(window.location.search).get('action')==='new') openNuevoGasto();
    } catch(err) {
      console.error('initGastos:', err);
      document.getElementById('loader').classList.add('hidden');
      document.getElementById('app').style.display = 'flex';
    }
  }

  _sb.auth.onAuthStateChange(event => {
    if (event==='SIGNED_OUT') window.location.href = 'login.html';
  });

  /* ===================================================
     EXPONER AL SCOPE GLOBAL (para onclick en HTML)
  =================================================== */
  window.openNuevoGasto          = openNuevoGasto;
  window.saveGasto               = saveGasto;
  window.toggleTipoGasto         = toggleTipoGasto;
  window.toggleCategoriaEspecial = toggleCategoriaEspecial;
  window.toggleCategoriaEspecialEdit = toggleCategoriaEspecialEdit;
  window.setSection              = setSection;
  window.setFiltroGastos         = setFiltroGastos;
  window.setCategoriaFiltro      = setCategoriaFiltro;
  window.buscarGastos            = buscarGastos;
  window.paginaAnterior          = paginaAnterior;
  window.paginaSiguiente         = paginaSiguiente;
  window.openModal               = openModal;
  window.closeModal              = closeModal;
  window.abrirRegistrarPago      = abrirRegistrarPago;
  window.confirmarRegistrarPago  = confirmarRegistrarPago;
  window.editarProgramado        = editarProgramado;
  window.guardarEdicionProgramado= guardarEdicionProgramado;
  window.togglePausarProgramado  = togglePausarProgramado;
  window.confirmarCancelarGasto  = confirmarCancelarGasto;
  window.cancelarGasto           = cancelarGasto;
  window.verDetalleGasto         = verDetalleGasto;
  window.toggleSidebar           = toggleSidebar;
  window.closeMobileSidebar      = closeMobileSidebar;
  window.toggleTheme             = toggleTheme;
  window.navigate                = navigate;

  document.addEventListener('DOMContentLoaded', () => {
    initGastos();
    if (window.lucide) lucide.createIcons();
  });

})(); // fin IIFE
