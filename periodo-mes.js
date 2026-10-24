/* =====================================================
   PERIODO-MES.JS — NEGOCIO360 (24-oct-2026)
   "Este mes" según el DÍA DE CIERRE que eligió el negocio
   (Configuración › Cierres de caja). OPCIONAL: si el negocio no eligió
   día (lo normal), inicioISO() devuelve null y cada módulo sigue usando
   el día 1, exactamente como siempre.
   Ejemplo con día 20: hoy 24-oct → el período va del 21-oct al 20-nov.
   El día queda guardado en este navegador (por cuenta) para poder
   calcularlo al instante; al cargar la página se vuelve a leer de la base.
===================================================== */
(function () {
  'use strict';
  if (window.N360PeriodoMes) return;
  const CLAVE = 'n360_periodo_mes';
  const SUPABASE_URL = 'https://zvlincmqmmoclqhykejv.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_RY59EmL8V2zRkOQg7RUJAw_dw6yr69t';

  function uidSesion() {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^sb-.*-auth-token$/.test(k)) continue;
        const v = JSON.parse(localStorage.getItem(k) || 'null');
        const id = v?.user?.id || v?.currentSession?.user?.id;
        if (id) return id;
      }
    } catch (_) {}
    return null;
  }
  function leer() {
    try {
      const c = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      const u = uidSesion();
      if (c && u && c.uid === u) return c;
    } catch (_) {}
    return null;
  }
  function guardar(uid, dia, empezarCero) {
    try { localStorage.setItem(CLAVE, JSON.stringify({ uid, dia: dia || null, empezarCero: !!empezarCero, t: Date.now() })); } catch (_) {}
  }
  function dia() { const d = Number(leer()?.dia); return d >= 1 && d <= 28 ? d : null; }
  function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  // Período en curso: del día siguiente al último cierre, al próximo día de cierre
  function rangoActual(hoy) {
    const d = dia(); if (!d) return null;
    hoy = hoy || new Date();
    let y = hoy.getFullYear(), m = hoy.getMonth();
    if (hoy.getDate() <= d) m -= 1;          // el período empezó el mes anterior
    return { desde: ymd(new Date(y, m, d + 1)), hasta: ymd(new Date(y, m + 1, d)), dia: d };
  }
  // El mismo tramo de días, pero del período anterior (para comparar)
  function rangoAnterior(hoy) {
    const r = rangoActual(hoy); if (!r) return null;
    hoy = hoy || new Date();
    const ini = new Date(r.desde + 'T12:00:00');
    const iniAnt = new Date(ini.getFullYear(), ini.getMonth() - 1, ini.getDate());
    const finAnt = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() - 1);
    const dias = Math.round((new Date(ymd(hoy) + 'T12:00:00') - ini) / 86400000);
    const hastaAnt = new Date(iniAnt.getFullYear(), iniAnt.getMonth(), iniAnt.getDate() + dias);
    return { desde: ymd(iniAnt), hasta: ymd(hastaAnt > finAnt ? finAnt : hastaAnt) };
  }
  function etiqueta(hoy) {
    const r = rangoActual(hoy); if (!r) return null;
    const f = iso => new Date(iso + 'T12:00:00').toLocaleDateString('es-NI', { day: 'numeric', month: 'short' });
    return `${f(r.desde)} – ${f(r.hasta)}`;
  }

  async function refrescar() {
    try {
      if (!window.supabase) return;
      const cli = window.__n360PeriodoCli || (window.__n360PeriodoCli = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));
      const { data: { session } } = await cli.auth.getSession();
      const uid = session?.user?.id; if (!uid) return;
      const { data } = await cli.from('configuracion_empresa').select('dia_cierre_mensual, cierre_empezar_cero').eq('auth_user_id', uid).maybeSingle();
      if (data) guardar(uid, data.dia_cierre_mensual, data.cierre_empezar_cero);
    } catch (_) { /* sin red: se queda lo guardado; sin nada guardado, el mes de siempre */ }
  }

  window.N360PeriodoMes = {
    dia, rangoActual, rangoAnterior, etiqueta, guardar, refrescar,
    inicioISO(hoy) { const r = rangoActual(hoy); return r ? r.desde : null; },
    empezarCero() { return !!leer()?.empezarCero; },
  };
  window.N360PeriodoMes.listo = refrescar();
})();
