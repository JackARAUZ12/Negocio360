/* ============================================================
   EXPORTAR TODA MI INFORMACION (Reportes)
   - En este navegador: arma un Excel (.xlsx) con una hoja por tabla.
   - En segundo plano: pide al servidor un ZIP con un CSV por tabla;
     se puede cerrar la pestaña y descargarlo despues.
   Solo LEE datos del propio negocio (auth_user_id); no modifica nada.
   ============================================================ */
(function () {
  const CAT = {"grupos": [{"k": "ventas", "n": "Ventas", "d": "Ventas con su detalle, garantías y servicio postventa", "t": ["ventas", "venta_detalles", "ventas_items", "garantias_clientes", "servicio_postventa"]}, {"k": "compras", "n": "Compras y proveedores", "d": "Compras, órdenes de compra, devoluciones, proveedores y cuentas por pagar", "t": ["compras", "detalle_compras", "ordenes_compra", "orden_compra_detalles", "devoluciones_proveedor", "proveedores", "cuentas_por_pagar", "cuentas_por_pagar_cuotas", "cuentas_por_pagar_pagos"]}, {"k": "inventario", "n": "Productos e inventario", "d": "Productos, lotes, presentaciones, precios, combos, promociones y movimientos de inventario", "t": ["productos", "producto_lotes", "producto_presentaciones", "precios_escala", "movimientos_inventario", "combos", "combo_items", "combo_precios_escala", "promociones", "promocion_productos", "numeros_serie", "codigos_barras", "unidades_medida", "registro_sustancias_controladas", "log_stock_fallido"]}, {"k": "clientes", "n": "Clientes", "d": "Clientes, interacciones, puntos, pagos recurrentes y rutas", "t": ["clientes", "cliente_interacciones", "puntos_movimientos", "puntos_recompensas", "pagos_clientes_recurrentes", "rutas", "ruta_clientes"]}, {"k": "creditos", "n": "Créditos a clientes", "d": "Créditos, cuotas, pagos e historial", "t": ["creditos", "creditos_cuotas", "creditos_pagos", "creditos_historial"]}, {"k": "proformas", "n": "Proformas", "d": "Proformas y su detalle", "t": ["proformas", "proforma_detalles"]}, {"k": "dinero", "n": "Caja, bancos y movimientos", "d": "Caja, cierres, caja chica, movimientos financieros, bancos, capital, impuestos y métodos de pago", "t": ["caja", "cierres_caja", "caja_chica_sesiones", "movimientos_financieros", "bancos", "conciliaciones_bancarias", "capital_negocio", "metodos_pago", "impuestos", "movimientos_impuestos"]}, {"k": "gastos", "n": "Gastos", "d": "Gastos, gastos programados y su historial", "t": ["gastos", "gastos_programados", "historial_gastos", "categorias_gasto_personalizadas"]}, {"k": "contabilidad", "n": "Contabilidad", "d": "Catálogo de cuentas, asientos y mapeo contable", "t": ["cuentas_contables", "asientos_contables", "asientos_detalle", "contabilidad_mapeo_cuentas"]}, {"k": "personal", "n": "Personal y nómina", "d": "Empleados, pagos, adelantos, vacaciones, liquidaciones, planillas y freelancers", "t": ["empleados", "empleados_pagos", "empleados_adelantos", "empleados_ausencias", "empleados_vacaciones", "empleados_liquidaciones", "empleados_bono_anual_pagos", "empleados_documentos", "empleados_historial_cambios", "nomina_conceptos", "nomina_planillas", "nomina_bono_anual_config", "freelancers", "freelancers_pagos"]}, {"k": "activos", "n": "Activos fijos", "d": "Activos, mantenimientos, mejoras y reasignaciones", "t": ["activos_fijos", "activo_mantenimientos", "activo_mejoras_capitalizadas", "activo_reasignaciones"]}, {"k": "produccion", "n": "Producción y recetas", "d": "Recetas, órdenes de producción y consumos", "t": ["recetas_produccion", "receta_componentes", "receta_despiece_salidas", "ordenes_produccion", "orden_produccion_consumos", "orden_despiece_resultados"]}, {"k": "operaciones", "n": "Operaciones y módulos especiales", "d": "Delivery, agenda, restaurante, hotel, veterinaria, farmacia y convenios", "t": ["delivery_pedidos", "agenda_eventos", "restaurante_mesas", "restaurante_comandas", "restaurante_comanda_items", "hotel_habitaciones", "hotel_reservaciones", "hotel_cargos_estadia", "vet_mascotas", "vet_veterinarios", "vet_citas", "vet_consultas", "vet_vacunas", "vet_estancias", "vet_estancia_notas", "vet_cargos", "vet_recetas_items", "farmacia_medicos", "farmacia_pacientes", "farmacia_recetas", "convenios", "convenio_cuentas", "convenio_empleados", "convenio_consumos", "convenio_gastos", "convenio_pagos", "convenio_pago_detalle"]}, {"k": "auditoria", "n": "Auditoría", "d": "Registro de movimientos y cambios en el sistema", "t": ["auditoria_log"]}, {"k": "config", "n": "Configuración", "d": "Datos de la empresa y preferencias de documentos y ventas", "t": ["configuracion_empresa", "configuracion_venta_rapida", "configuracion_documentos", "configuracion_proforma", "dashboard_configuracion"]}], "sinId": ["configuracion_documentos", "configuracion_proforma"]};
  const PAGINA = 1000;
  const MAX_FILAS_HOJA = 1000000;
  let sbc = null, uid = null, cancelar = false, corriendo = false, pollTimer = null;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoy = () => new Date().toISOString().slice(0, 10);

  function gruposElegidos() {
    return [...document.querySelectorAll('#exp-todo-grupos input[type=checkbox]:checked')].map(i => i.value);
  }
  function tablasDe(grupos) {
    const set = new Set(grupos);
    return CAT.grupos.filter(g => set.has(g.k)).flatMap(g => g.t.map(t => ({ tabla: t, grupo: g.n })));
  }

  function pintarGrupos() {
    const c = $('exp-todo-grupos'); if (!c) return;
    c.innerHTML = CAT.grupos.map(g => `
      <label style="display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;background:var(--bg-card,transparent)">
        <input type="checkbox" value="${g.k}" checked style="margin-top:3px">
        <span><strong style="font-size:13.5px">${esc(g.n)}</strong><br><span style="font-size:12px;color:var(--text-muted)">${esc(g.d)}</span></span>
      </label>`).join('');
  }
  function marcarTodos(v) { document.querySelectorAll('#exp-todo-grupos input[type=checkbox]').forEach(i => { i.checked = v; }); }

  function progreso(pct, texto) {
    const w = $('exp-todo-progreso'); if (!w) return;
    w.style.display = pct == null ? 'none' : 'block';
    if (pct == null) return;
    $('exp-todo-barra').style.width = Math.max(2, Math.min(100, pct)) + '%';
    $('exp-todo-texto').textContent = texto || '';
  }
  function aviso(msg, tipo) {
    if (typeof showToast === 'function') showToast(msg, tipo || 'success'); else alert(msg);
  }
  function antesDeSalir(e) { if (corriendo) { e.preventDefault(); e.returnValue = ''; } }

  // Valores que Excel/CSV no entienden (objetos, listas) pasan a texto JSON
  function plano(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
    if (typeof v === 'string' && v.length > 32000) return v.slice(0, 32000) + '…';
    return v;
  }

  async function leerTabla(tabla, onFilas) {
    const sinId = CAT.sinId.includes(tabla);
    let ultimo = null, total = 0, todas = [];
    for (;;) {
      if (cancelar) throw new Error('cancelado');
      let q = sbc.from(tabla).select('*').eq('auth_user_id', uid).limit(PAGINA);
      if (!sinId) { q = q.order('id', { ascending: true }); if (ultimo !== null) q = q.gt('id', ultimo); }
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) break;
      todas = todas.concat(data); total += data.length;
      if (onFilas) onFilas(total);
      if (sinId || data.length < PAGINA) break;
      ultimo = data[data.length - 1].id;
    }
    return todas;
  }

  async function exportarExcel() {
    if (corriendo) return;
    const grupos = gruposElegidos();
    if (!grupos.length) { aviso('Elige al menos un grupo de información.', 'error'); return; }
    if (!window.XLSX) { aviso('No se pudo cargar el generador de Excel. Recarga la página.', 'error'); return; }
    const tablas = tablasDe(grupos);
    corriendo = true; cancelar = false;
    window.addEventListener('beforeunload', antesDeSalir);
    $('exp-todo-btn-excel').disabled = true; $('exp-todo-btn-servidor').disabled = true; $('exp-todo-btn-cancelar').style.display = '';
    const wb = XLSX.utils.book_new();
    const resumen = [['Tabla', 'Grupo', 'Filas', 'Observación']];
    let filasTotal = 0, hojas = 0;
    try {
      for (let i = 0; i < tablas.length; i++) {
        const { tabla, grupo } = tablas[i];
        progreso((i / tablas.length) * 100, `Leyendo ${tabla} (${i + 1} de ${tablas.length})…`);
        let filas;
        try { filas = await leerTabla(tabla, n => progreso((i / tablas.length) * 100, `Leyendo ${tabla}: ${n.toLocaleString('es-NI')} filas…`)); }
        catch (e) {
          if (e && e.message === 'cancelado') throw e;
          resumen.push([tabla, grupo, 0, 'No disponible en esta cuenta']); continue;   // tabla inexistente o sin permiso
        }
        if (!filas.length) { resumen.push([tabla, grupo, 0, 'Sin datos']); continue; }
        const cols = [...new Set(filas.flatMap(f => Object.keys(f)))];
        const trozo = filas.length > MAX_FILAS_HOJA ? filas.slice(0, MAX_FILAS_HOJA) : filas;
        const aoa = [cols, ...trozo.map(f => cols.map(c => plano(f[c])))];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = cols.map(c => ({ wch: Math.min(Math.max(c.length + 2, 10), 40) }));
        XLSX.utils.book_append_sheet(wb, ws, tabla.slice(0, 31));
        resumen.push([tabla, grupo, filas.length, filas.length > MAX_FILAS_HOJA ? `Excel admite ~1 millón de filas: se exportaron las primeras ${MAX_FILAS_HOJA.toLocaleString('es-NI')}. Usa la exportación en segundo plano (ZIP) para todo.` : '']);
        filasTotal += filas.length; hojas++;
        await new Promise(r => setTimeout(r, 0));   // deja respirar al navegador
      }
      const wsR = XLSX.utils.aoa_to_sheet([['Exportación de mi información — Negocio360'], ['Fecha', hoy()], ['Hojas', hojas], ['Filas en total', filasTotal], [], ...resumen]);
      wsR['!cols'] = [{ wch: 34 }, { wch: 30 }, { wch: 10 }, { wch: 60 }];
      XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');
      wb.SheetNames.unshift(wb.SheetNames.pop());   // "Resumen" va primero
      progreso(98, 'Generando el archivo Excel…');
      await new Promise(r => setTimeout(r, 30));
      XLSX.writeFile(wb, `negocio360_mi_informacion_${hoy()}.xlsx`);
      progreso(100, `Listo: ${hojas} hojas y ${filasTotal.toLocaleString('es-NI')} filas.`);
      aviso('Exportación lista. Revisa tus descargas.');
    } catch (e) {
      if (e && e.message === 'cancelado') { progreso(null); aviso('Exportación cancelada.', 'warning'); }
      else { console.error('exportarExcel:', e); progreso(null); aviso('No se pudo completar la exportación. Intenta con la opción en segundo plano.', 'error'); }
    } finally {
      corriendo = false; window.removeEventListener('beforeunload', antesDeSalir);
      $('exp-todo-btn-excel').disabled = false; $('exp-todo-btn-servidor').disabled = false; $('exp-todo-btn-cancelar').style.display = 'none';
    }
  }

  /* ---------- Segundo plano (servidor) ---------- */
  const ESTADOS = { pendiente: ['En cola', '#f59e0b'], procesando: ['Preparando…', '#3b82f6'], listo: ['Listo', '#10b981'], error: ['Con error', '#ef4444'], vencido: ['Vencido', '#94a3b8'] };
  function fmtBytes(b) { b = Number(b || 0); return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }

  async function cargarSolicitudes() {
    const lista = $('exp-todo-lista'); if (!lista) return;
    const { data, error } = await sbc.from('exportaciones').select('*').eq('auth_user_id', uid).order('created_at', { ascending: false }).limit(8);
    if (error) {
      // La tabla aun no existe en esta base: se oculta solo la opcion de segundo plano
      $('exp-todo-servidor-wrap').style.display = 'none';
      $('exp-todo-servidor-nd').style.display = 'block';
      return false;
    }
    $('exp-todo-servidor-wrap').style.display = '';
    $('exp-todo-servidor-nd').style.display = 'none';
    const ahora = Date.now();
    lista.innerHTML = (data || []).length ? data.map(x => {
      const vencido = x.estado === 'listo' && x.expira_at && new Date(x.expira_at).getTime() < ahora;
      const [txt, col] = ESTADOS[vencido ? 'vencido' : x.estado] || [x.estado, '#888'];
      const pct = x.tablas_total ? Math.round((x.tablas_hechas || 0) * 100 / x.tablas_total) : 0;
      const fecha = new Date(x.created_at).toLocaleString('es-NI', { dateStyle: 'medium', timeStyle: 'short' });
      const accion = x.estado === 'listo' && !vencido
        ? `<button class="btn-primary btn-sm" onclick="N360Export.descargar('${x.id}')">Descargar${x.tamano_bytes ? ' (' + fmtBytes(x.tamano_bytes) + ')' : ''}</button>`
        : (x.estado === 'error' ? `<span style="font-size:12px;color:var(--danger,#ef4444)">${esc(x.error_msg || 'Ocurrió un error')}</span>`
          : (x.estado === 'pendiente' || x.estado === 'procesando' ? `<span style="font-size:12px;color:var(--text-muted)">${pct}% · puedes cerrar esta página</span>` : ''));
      return `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-top:8px">
        <div><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px"></span><strong style="font-size:13px">${txt}</strong>
        <span style="font-size:12px;color:var(--text-muted);margin-left:8px">${fecha} · ${(x.grupos || []).length} grupos${x.filas_total ? ' · ' + Number(x.filas_total).toLocaleString('es-NI') + ' filas' : ''}</span></div>
        <div>${accion}</div></div>`;
    }).join('') : '<div style="font-size:12.5px;color:var(--text-muted);margin-top:8px">Aún no has pedido ninguna exportación en segundo plano.</div>';
    const activa = (data || []).some(x => x.estado === 'pendiente' || x.estado === 'procesando');
    clearTimeout(pollTimer);
    if (activa) pollTimer = setTimeout(cargarSolicitudes, 5000);
    return activa;
  }

  async function pedirServidor() {
    const grupos = gruposElegidos();
    if (!grupos.length) { aviso('Elige al menos un grupo de información.', 'error'); return; }
    const btn = $('exp-todo-btn-servidor'); btn.disabled = true;
    try {
      const activa = await cargarSolicitudes();
      if (activa) { aviso('Ya tienes una exportación en proceso. Espera a que termine.', 'warning'); return; }
      const tablas = tablasDe(grupos).length;
      const { data: fila, error } = await sbc.from('exportaciones').insert({ auth_user_id: uid, grupos, estado: 'pendiente', tablas_total: tablas }).select().single();
      if (error) throw error;
      const { error: e2 } = await sbc.functions.invoke('exportar-datos', { body: { id: fila.id } });
      if (e2) {
        await sbc.from('exportaciones').delete().eq('id', fila.id);
        throw e2;
      }
      aviso('Listo: tu exportación se está preparando. Puedes cerrar esta página y volver más tarde a descargarla.');
      cargarSolicitudes();
    } catch (e) {
      console.error('pedirServidor:', e);
      aviso('No se pudo iniciar la exportación en segundo plano. Intenta de nuevo o usa la opción de Excel.', 'error');
    } finally { btn.disabled = false; }
  }

  async function descargar(id) {
    try {
      const { data: x, error } = await sbc.from('exportaciones').select('archivo_path').eq('id', id).eq('auth_user_id', uid).single();
      if (error || !x || !x.archivo_path) throw error || new Error('sin archivo');
      const { data, error: e2 } = await sbc.storage.from('exportaciones').createSignedUrl(x.archivo_path, 600, { download: `negocio360_mi_informacion_${hoy()}.zip` });
      if (e2) throw e2;
      window.location.href = data.signedUrl;
    } catch (e) { console.error('descargar export:', e); aviso('No se pudo descargar. Puede que el archivo ya haya vencido (duran 48 horas).', 'error'); }
  }

  function init(client, userId) {
    sbc = client; uid = userId;
    pintarGrupos();
    cargarSolicitudes();
  }

  window.N360Export = { init, marcarTodos, exportarExcel, pedirServidor, descargar, cancelar: () => { cancelar = true; }, refrescar: cargarSolicitudes };
})();
