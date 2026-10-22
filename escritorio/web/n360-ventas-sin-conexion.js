/* Negocio360 Escritorio — Ventas sin conexión (solo dentro del programa).
 *
 * Envuelve los botones reales de ventas.js ("Cerrar venta" y "Cobrar" de
 * Venta rápida). Para las cuentas con el modo sin conexión, cada venta de
 * contado o pago dividido:
 *   1. se arma con el MISMO código de la web, pero "grabando" lo que guardaría;
 *   2. se guarda completa en el equipo (una sola transacción);
 *   3. recién entonces se imprime el ticket y se muestra el aviso;
 *   4. el programa la sube sola (con internet, en segundos; sin internet,
 *      cuando vuelva). El servidor la registra completa o nada.
 * Lo que sin internet no se permite (fiado, crédito, cliente nuevo, stock de
 * otra sucursal…) sigue el camino normal de la web cuando hay conexión.
 */
(function () {
  'use strict';
  const N = window.N360SinConexion;
  if (!N || typeof window.confirmarVenta !== 'function' || typeof window.confirmarVentaRapida !== 'function' || !window.N360RegistroAPayload) return;
  const API = N.api;
  const originalNueva = window.confirmarVenta;
  const originalRapida = window.confirmarVentaRapida;
  let enCurso = false;

  const esCredito = (id, nombre) => id === 'fiado' || /cr[eé]dito|fiado/i.test(String(nombre || ''));

  // Por qué esta venta NO puede hacerse sin conexión (null = sí puede).
  function motivoNoElegible(tipo) {
    if ((S._seriesRecolectadas || []).length) return 'ventas con números de serie';
    if (tipo === 'rapida') {
      if (esCredito(VR.metodoPagoId, VR.metodoPagoNombre)) return 'ventas al crédito o fiado';
      if ((VR.carrito || []).some((i) => i && i.origenStockId)) return 'vender stock de otra sucursal';
      return null;
    }
    if (S.correccion) return 'corregir una venta';
    if (esCredito(S.metodoPagoId, S.metodoPagoNombre)) return 'ventas al crédito o fiado';
    if (S.clienteOpcion === 'nuevo') return 'crear un cliente nuevo';
    if (S._txOrdenId || S._vetConsultaId || S._vetEstanciaId) return 'cobros de transporte o veterinaria';
    if (document.getElementById('sel-receta-vincular')?.value) return 'vincular una receta';
    if (S.canje) return 'canjear puntos';
    if ((S.carrito || []).some((i) => i && i.origenStockId)) return 'vender stock de otra sucursal';
    return null;
  }

  // Lo que el servidor necesita y que no está en las filas: precio del
  // catálogo del equipo (para avisar si cambió) y productos de cada promoción.
  function datosExtra(tipo) {
    const carrito = tipo === 'rapida' ? VR.carrito : S.carrito;
    const cat = (id) => (S.productosCache.find((p) => p.id === id) || {}).precio;
    return {
      fecha_hoy: todayISO(),
      vendida_en: new Date().toISOString(),
      componentes_promo: Object.fromEntries(carrito.map((it, i) => [i, it.esPromocion ? (it.componentesPromo || []) : null]).filter(([, c]) => c)),
      precios_catalogo: Object.fromEntries(carrito.map((it, i) => [i, (!it.esCombo && !it.esPromocion && !it.escalaId && !it.presentacionId) ? cat(it.id) : null]).filter(([, v]) => v != null)),
    };
  }

  function aviso(titulo, texto) {
    let caja = document.getElementById('n360-aviso-sin-conexion');
    if (!caja) {
      caja = document.createElement('div');
      caja.id = 'n360-aviso-sin-conexion';
      caja.style.cssText = 'position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:rgba(10,10,16,.6)';
      caja.innerHTML = '<div style="background:#fff;color:#1a1a2e;max-width:420px;border-radius:14px;padding:24px 26px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35)">'
        + '<h3 style="margin:0 0 8px;font-size:17px"></h3><p style="margin:0 0 16px;color:#444"></p>'
        + '<button type="button" style="background:#6C63FF;color:#fff;border:0;border-radius:10px;padding:9px 20px;font-weight:600;cursor:pointer">Entendido</button></div>';
      caja.querySelector('button').addEventListener('click', () => { caja.style.display = 'none'; });
      document.body.appendChild(caja);
    }
    caja.querySelector('h3').textContent = titulo;
    caja.querySelector('p').textContent = texto;
    caja.style.display = 'flex';
  }

  async function vender(tipo, original, args) {
    await N.listo;
    if (!N.disponible()) return original.apply(window, args);       // cuenta sin el modo: igual que la web
    const motivo = motivoNoElegible(tipo);
    if (motivo) {
      if (N.enLinea()) return original.apply(window, args);
      aviso('Necesita internet', `Sin conexión no se puede: ${motivo}. Sin internet solo se registran ventas de contado o con pago dividido.`);
      return undefined;
    }
    if (enCurso) return undefined;
    enCurso = true;
    const extra = datosExtra(tipo);
    const uuid = N.uuid();
    const toastOriginal = window.showToast;
    const toasts = [];
    window.showToast = (msg, t) => { toasts.push([msg, t]); };
    API.retenerImpresion();
    let g;
    try {
      g = await N.grabar(() => original.apply(window, args));
    } catch (e) {
      g = { registro: [], bloqueos: ['error'], filasLocales: [], deltas: [], error: e };
    } finally {
      window.showToast = toastOriginal;
    }
    try {
      const est = N.estado();
      const conv = window.N360RegistroAPayload.convertir(g.registro, { ...extra, uuid, tipo, dispositivo_uid: est.dispositivo_uid });
      if (!conv.payload.venta) {
        // La web no llegó a armar la venta (faltaba un dato): sus avisos se muestran tal cual.
        API.descartarImpresion();
        N.descartarGrabacion();
        for (const [m, t] of toasts) showToast(m, t);
        return undefined;
      }
      const problemas = [...g.bloqueos, ...conv.noPermitido];
      if (problemas.length) {
        API.descartarImpresion();
        N.descartarGrabacion();
        aviso('La venta NO se guardó', `Esta venta incluye algo que necesita internet (${problemas.join(', ')}). No se cobró nada en el sistema: vuelve a registrarla ${N.enLinea() ? 'sin esa opción' : 'cuando vuelva la conexión'}.`);
        return undefined;
      }
      const v = conv.payload.venta;
      try {
        await API.ventaGuardar({
          uuid, payload: conv.payload, numero: v.numero_venta, total: Number(v.total) || 0,
          resumen: { cliente: v.cliente_nombre || 'Consumidor Final', metodo: v.metodo_pago || '', lineas: conv.payload.detalles.length, tipo },
          filasLocales: g.filasLocales, deltas: g.deltas,
        });
      } catch (e) {
        API.descartarImpresion();
        N.descartarGrabacion();
        aviso('La venta NO se guardó', 'No se pudo guardar en este equipo (' + (e && e.message ? e.message : 'error') + '). Vuelve a registrarla.');
        return undefined;
      }
      // Guardada: ahora sí, ticket y aviso.
      API.liberarImpresion().then((rs) => {
        const malo = (rs || []).find((r) => r && r.ok === false);
        if (malo) showToast('La venta quedó guardada, pero no se pudo imprimir el ticket: ' + (malo.motivo || 'revisa la impresora'), 'error');
      }).catch(() => {});
      const ultimo = [...toasts].reverse().find(([, t]) => t === 'success') || toasts[toasts.length - 1];
      if (ultimo) showToast(N.enLinea() ? ultimo[0] : `${ultimo[0]} · Guardada en este equipo, se sube sola al volver internet`, ultimo[1]);
      return undefined;
    } finally {
      enCurso = false;
    }
  }

  window.confirmarVenta = function (...args) { return vender('nueva', originalNueva, args); };
  window.confirmarVentaRapida = function (...args) { return vender('rapida', originalRapida, args); };

  // Cuando el servidor ya recibió ventas: la lista y los totales vuelven a leerse.
  N.alCambiar((ev) => {
    if (!ev || ev.tipo !== 'subidas' || enCurso) return;
    setTimeout(() => {
      try { if (typeof loadVentas === 'function') loadVentas(); } catch (_) { /* nada */ }
      try { if (typeof loadKPIs === 'function') loadKPIs(); } catch (_) { /* nada */ }
      try { if (typeof loadProductosCache === 'function') loadProductosCache(); } catch (_) { /* nada */ }
    }, 1500);
  });
})();
