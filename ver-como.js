/* ============================================================
   VER-COMO.JS — NEGOCIO360
   ------------------------------------------------------------
   Modo "Ver como cliente" (SOLO LECTURA) para el administrador.

   Qué hace (y solo cuando la pestaña fue abierta desde el panel
   de administrador con ver-como.html):
   1) Aísla el almacenamiento de ESTA pestaña: la sesión del cliente
      y todo lo que la app guarde en localStorage vive solo en esta
      pestaña (sessionStorage). Nunca toca la sesión del administrador
      ni la de otro negocio en el mismo navegador.
   2) Bloquea TODA escritura: cualquier petición que no sea de lectura
      (guardar, editar, anular, subir archivos, cerrar sesión global…)
      se rechaza antes de salir del navegador. Solo pasan las lecturas
      y unas pocas consultas (RPC) que únicamente leen.
   3) Muestra una barra visible "Solo lectura" con botón Salir.

   Si la pestaña NO está en modo ver-como, este archivo no hace NADA
   (no cambia ningún comportamiento de la app).
   ============================================================ */
'use strict';

(function () {
  if (window.N360VerComo) return;

  var FLAG = 'n360_ver_como';
  var PREFIJO = 'vc:';
  var HORAS_MAX = 4;                       // la vista se cierra sola a las 4 h
  var SS = null;
  try { SS = window.sessionStorage; } catch (e) { SS = null; }

  // Consultas RPC que SOLO leen. Cualquier otra se bloquea.
  var RPC_LECTURA = {
    listar_sucursales_grupo: 1, listar_perfiles_del_grupo: 1, listar_perfiles_del_grupo_v2: 1,
    listar_proveedores_grupo: 1, listar_auth_ids_sucursales_shadow: 1,
    obtener_stock_compartido: 1, obtener_stock_compartido_config: 1, obtener_datos_grupo: 1,
    stock_grupo_por_nombre: 1, sumar_movimientos_por_cuenta: 1, saldo_efectivo_hasta_fecha: 1,
    fecha_mas_antigua_pendiente_contabilizar: 1, contar_pendientes_contabilizar: 1, contar_grupo: 1,
    ventas_sin_movimiento_caja: 1, ventas_pendientes_entrega: 1, sucursales_para_reabastecer: 1,
    get_clientes_kpi: 1, flujo_efectivo_por_categoria: 1, clientes_inactivos: 1,
    clientes_con_cobro_pendiente: 1, asistente_top_clientes: 1, asistente_productos_mas_vendidos: 1,
    catalogo_obtener_limites: 1, catalogo_resumen_eventos: 1, catalogo_visitas_por_catalogo: 1,
    nombres_miembros_chat_grupal: 1
  };

  function leerInfo() {
    try {
      var s = SS && SS.getItem(FLAG);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }

  // ── Almacenamiento aislado (reemplaza a localStorage en esta pestaña) ──
  function claves() {
    var r = [];
    for (var i = 0; i < SS.length; i++) {
      var k = SS.key(i);
      if (k && k.indexOf(PREFIJO) === 0) r.push(k.slice(PREFIJO.length));
    }
    return r;
  }
  function crearAlmacen() {
    var api = {
      getItem: function (k) { var v = SS.getItem(PREFIJO + k); return v === null ? null : v; },
      setItem: function (k, v) { SS.setItem(PREFIJO + k, String(v)); },
      removeItem: function (k) { SS.removeItem(PREFIJO + k); },
      clear: function () { claves().forEach(function (k) { SS.removeItem(PREFIJO + k); }); },
      key: function (i) { return claves()[i] || null; }
    };
    return new Proxy(api, {
      get: function (t, p) {
        if (p === 'length') return claves().length;
        if (p in t) return t[p];
        if (typeof p === 'string') { var v = t.getItem(p); return v === null ? undefined : v; }
        return undefined;
      },
      set: function (t, p, v) { if (typeof p === 'string') t.setItem(p, v); return true; },
      deleteProperty: function (t, p) { if (typeof p === 'string') t.removeItem(p); return true; },
      has: function (t, p) { return (p in t) || (typeof p === 'string' && t.getItem(p) !== null); },
      ownKeys: function () { return claves(); },
      getOwnPropertyDescriptor: function (t, p) {
        if (typeof p === 'string' && t.getItem(p) !== null) {
          return { value: t.getItem(p), writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      }
    });
  }

  // ── Guardia de escritura ──
  function esPermitida(url, metodo) {
    if (metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS') return true;
    var u;
    try { u = new URL(url, window.location.href); } catch (e) { return false; }
    // Renovar el pase de sesión de esta pestaña y entrar con el pase del administrador
    if (u.pathname.indexOf('/auth/v1/verify') === 0 || u.pathname === '/auth/v1/verify') return true;
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return true;
    var m = u.pathname.match(/^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)$/);
    if (m && RPC_LECTURA[m[1]] === 1) return true;
    return false;
  }

  var avisos = { total: 0, ultimo: 0 };
  function registrarBloqueo(url, metodo) {
    avisos.total++;
    try { console.warn('[Solo lectura] Se bloqueó ' + metodo + ' ' + String(url).split('?')[0]); } catch (e) {}
    actualizarBarra();
    var ahora = Date.now();
    if (ahora - avisos.ultimo > 4000) {
      avisos.ultimo = ahora;
      avisoFlotante('Modo solo lectura: no se guardó ningún cambio.');
    }
  }
  function respuestaBloqueada() {
    return new Response(JSON.stringify({
      message: 'Modo solo lectura: no se guardó ningún cambio.',
      code: 'N360_SOLO_LECTURA', details: null, hint: null
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  function instalarGuardias() {
    var fetchOriginal = window.fetch ? window.fetch.bind(window) : null;
    if (fetchOriginal) {
      window.fetch = function (input, init) {
        var url = '', metodo = 'GET';
        try {
          url = (typeof input === 'string') ? input : ((input && input.url) || String(input));
          metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        } catch (e) { metodo = 'POST'; }
        if (!esPermitida(url, metodo)) {
          registrarBloqueo(url, metodo);
          return Promise.resolve(respuestaBloqueada());
        }
        return fetchOriginal(input, init);
      };
    }
    if (window.XMLHttpRequest) {
      var open0 = XMLHttpRequest.prototype.open;
      var send0 = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (metodo, url) {
        this.__vcBloquear = !esPermitida(String(url), String(metodo).toUpperCase());
        this.__vcInfo = [String(url), String(metodo).toUpperCase()];
        return open0.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        if (this.__vcBloquear) {
          registrarBloqueo(this.__vcInfo[0], this.__vcInfo[1]);
          var self = this;
          setTimeout(function () {
            try { self.dispatchEvent(new Event('error')); } catch (e) {}
          }, 0);
          return;
        }
        return send0.apply(this, arguments);
      };
    }
    if (navigator && navigator.sendBeacon) {
      navigator.sendBeacon = function (url) { registrarBloqueo(url, 'BEACON'); return false; };
    }
  }

  // ── Barra visible ──
  var barra = null, spanContador = null;
  function avisoFlotante(texto) {
    try {
      var d = document.createElement('div');
      d.textContent = texto;
      d.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;' +
        'background:#1f2937;color:#fff;padding:9px 16px;border-radius:8px;font:13px/1.3 system-ui,sans-serif;' +
        'box-shadow:0 4px 14px rgba(0,0,0,.3);max-width:90vw;text-align:center;';
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3200);
    } catch (e) {}
  }
  function actualizarBarra() {
    if (spanContador) {
      spanContador.textContent = avisos.total ? (' · ' + avisos.total + ' intento(s) de guardar bloqueado(s)') : '';
    }
  }
  function crearBarra(info) {
    if (barra || !document.body) return;
    barra = document.createElement('div');
    barra.id = 'n360-vc-barra';
    barra.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:2147483646;' +
      'background:#7c2d12;color:#fff;padding:8px 10px 8px 14px;border-radius:999px;display:flex;align-items:center;' +
      'gap:10px;font:13px/1.2 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);max-width:94vw;';
    var t = document.createElement('span');
    t.textContent = 'Solo lectura · ' + (info.negocio || info.email || 'cliente');
    spanContador = document.createElement('span');
    spanContador.style.opacity = '.8';
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Salir';
    b.style.cssText = 'border:0;border-radius:999px;background:#fff;color:#7c2d12;font:600 12px system-ui,sans-serif;' +
      'padding:6px 12px;cursor:pointer;';
    b.onclick = function () { api.salir(); };
    barra.appendChild(t); barra.appendChild(spanContador); barra.appendChild(b);
    document.body.appendChild(barra);
    try { document.title = '👁 ' + (info.negocio || 'Cliente') + ' (solo lectura)'; } catch (e) {}
    actualizarBarra();
  }

  var instalado = false;
  function instalar(info) {
    if (instalado) return true;
    try {
      Object.defineProperty(window, 'localStorage', { configurable: true, get: function () { return almacen; } });
    } catch (e) { return false; }
    // Comprobación: lo que se guarde en localStorage debe caer en sessionStorage, no en el navegador.
    try {
      window.localStorage.setItem('__vc_prueba', '1');
      var ok = SS.getItem(PREFIJO + '__vc_prueba') === '1';
      window.localStorage.removeItem('__vc_prueba');
      if (!ok) return false;
    } catch (e) { return false; }
    instalarGuardias();
    instalado = true;
    api.activo = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { crearBarra(info); });
    } else { crearBarra(info); }
    return true;
  }

  var almacen = null;
  var api = {
    activo: false,
    // Lo llama ver-como.html antes de iniciar la sesión del cliente.
    activar: function (info) {
      if (!SS) return false;
      try { SS.clear(); } catch (e) {}
      info = { negocio: (info && info.negocio) || '', email: (info && info.email) || '', ts: Date.now() };
      try { SS.setItem(FLAG, JSON.stringify(info)); } catch (e) { return false; }
      almacen = almacen || crearAlmacen();
      if (!instalar(info)) { try { SS.removeItem(FLAG); } catch (e) {} return false; }
      return true;
    },
    // Termina la vista: borra todo lo de esta pestaña y la cierra.
    salir: function () {
      try { SS.clear(); } catch (e) {}
      try { window.close(); } catch (e) {}
      setTimeout(function () { window.location.href = 'admin.html'; }, 300);
    },
    bloqueos: function () { return avisos.total; }
  };
  window.N360VerComo = api;

  // Pestaña ya en modo ver-como (cada página nueva de la misma pestaña lo retoma).
  var info = leerInfo();
  if (info) {
    if (Date.now() - (info.ts || 0) > HORAS_MAX * 3600 * 1000) {
      try { SS.clear(); } catch (e) {}
    } else {
      almacen = crearAlmacen();
      if (!instalar(info)) {
        // Si no se puede garantizar el aislamiento, no se sigue: se cierra la vista.
        try { SS.clear(); } catch (e) {}
        window.location.href = 'admin.html';
      }
    }
  }
})();
