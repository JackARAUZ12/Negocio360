/* =====================================================
   Supabase SIMULADO para las pruebas en navegador (Playwright).
   Reemplaza al SDK real: guarda una base en memoria (en
   sessionStorage, así sobrevive al pasar de una página a otra)
   y anota cada escritura en __LOG para poder comparar.
   NUNCA se carga en producción: la prueba lo inyecta
   interceptando la descarga del SDK.
===================================================== */
(function () {
  const UID = 'u-prueba-0000-0000-000000000001';
  const leerDB = () => JSON.parse(sessionStorage.getItem('__DB') || 'null') || (window.__SEED ? JSON.parse(JSON.stringify(window.__SEED)) : {});
  const guardarDB = db => sessionStorage.setItem('__DB', JSON.stringify(db));
  const log = (op, tabla, datos, filtros) => { const l = JSON.parse(sessionStorage.getItem('__LOG') || '[]'); l.push({ op, tabla, datos, filtros }); sessionStorage.setItem('__LOG', JSON.stringify(l)); };
  let n = 0; const uuid = () => 'id-' + Date.now().toString(36) + '-' + (++n) + '-' + Math.random().toString(36).slice(2, 8);
  const REL = { clinica_pacientes: 'paciente_id', ventas: 'venta_id', productos: 'producto_id', clientes: 'cliente_id', clinica_personal: 'medico_id', restaurante_mesas: 'mesa_id', restaurante_comandas: 'comanda_id' };
  const HIJOS = { agenda_citas_servicios: 'cita_id', restaurante_comanda_items: 'comanda_id', receta_componentes: 'receta_id', receta_despiece_salidas: 'receta_id' };          // relaciones uno-a-muchos: nombre(campos) -> lista

  function partirTope(s) {            // separa "a, b(c, d), e" respetando paréntesis
    const out = []; let nivel = 0, cur = '';
    for (const ch of s) { if (ch === '(') nivel++; if (ch === ')') nivel--; if (ch === ',' && nivel === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) out.push(cur.trim()); return out;
  }
  const comoTexto = v => v == null ? '' : String(v);
  function cumple(fila, f) {
    const v = fila[f.col];
    switch (f.op) {
      case 'eq': return comoTexto(v) === comoTexto(f.val);
      case 'neq': return comoTexto(v) !== comoTexto(f.val);
      case 'gt': return v != null && v > f.val; case 'gte': return v != null && v >= f.val;
      case 'lt': return v != null && v < f.val; case 'lte': return v != null && v <= f.val;
      case 'in': return f.val.map(comoTexto).includes(comoTexto(v));
      case 'is': return f.val === null || f.val === 'null' ? v == null : v === (f.val === true || f.val === 'true');
      case 'like': { const re = new RegExp('^' + String(f.val).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$'); return re.test(comoTexto(v)); }
      case 'ilike': { const re = new RegExp('^' + String(f.val).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i'); return re.test(comoTexto(v)); }
      case 'or': return f.val.some(g => cumple(fila, g));
      case 'not': return !cumple(fila, f.val);
      default: return true;
    }
  }
  function parseOr(txt) {
    return partirTope(txt).map(p => { const [col, op, ...resto] = p.split('.'); let val = resto.join('.'); if (op === 'is') val = val === 'null' ? null : val; return { col, op, val }; });
  }

  function builder(tabla) {
    const st = { tabla, filtros: [], orden: [], limite: null, rango: null, modo: 'select', datos: null, cols: '*', uno: null, head: false, count: null, devolver: false, conflicto: null };
    const ejecutar = () => {
      const db = leerDB(); db[tabla] = db[tabla] || [];
      let filas = db[tabla];
      const aplica = f => st.filtros.every(x => cumple(f, x));
      let resultado = null, error = null;
      if (st.modo === 'upsert') {             // si ya existe (misma llave), solo cambia lo que se manda
        const lista = (Array.isArray(st.datos) ? st.datos : [st.datos]).map(d => {
          const ya = db[tabla].find(f => comoTexto(f[st.conflicto]) === comoTexto(d[st.conflicto]));
          if (ya) { Object.assign(ya, d); return ya; }
          const fila = { created_at: new Date().toISOString(), ...d }; db[tabla].push(fila); return fila;
        });
        log('upsert', tabla, st.datos); resultado = lista;
      } else if (st.modo === 'insert') {
        const lista = (Array.isArray(st.datos) ? st.datos : [st.datos]).map(d => {
          const fila = { id: uuid(), created_at: new Date().toISOString(), ...d };
          if (tabla === 'clinica_pacientes' && !fila.numero_expediente) fila.numero_expediente = 'EXP-' + String(db[tabla].length + 1).padStart(6, '0');
          if (tabla.startsWith('clinica_') && fila.activo === undefined && ['clinica_pacientes', 'clinica_consultorios', 'clinica_personal'].includes(tabla)) fila.activo = true;
          if (tabla === 'clientes' && fila.activo === undefined) fila.activo = true;
          if (tabla === 'clinica_estancias') { const pref = fila.tipo === 'hospitalizacion' ? 'HOS' : 'OBS'; fila.numero = pref + '-' + String(db[tabla].filter(x => String(x.numero).startsWith(pref)).length + 1).padStart(6, '0');
            fila.estado = fila.estado || 'activa'; fila.ingreso_en = fila.ingreso_en || new Date().toISOString(); if (!fila.tipo) fila.tipo = 'observacion';
            if (db[tabla].some(x => x.paciente_id === fila.paciente_id && x.estado === 'activa')) { error = { message: 'duplicate key value violates unique constraint "clinica_estancias_una_activa"' }; return null; } }
          if (tabla === 'clinica_reclamos' && !fila.estado) fila.estado = 'enviado';
          if (tabla === 'clinica_convenios' && fila.activo === undefined) fila.activo = true;
          if (tabla === 'clinica_citas' && !fila.estado) fila.estado = 'programada';
          if (tabla === 'clinica_citas' && !fila.duracion_min) fila.duracion_min = 30;
          return fila;
        });
        if (error) { resultado = null; } else { db[tabla].push(...lista); log('insert', tabla, st.datos); resultado = lista; }
      } else if (st.modo === 'update') {
        const afectadas = filas.filter(aplica); afectadas.forEach(f => { Object.assign(f, st.datos); if (tabla === 'clinica_estancias' && st.datos.estado === 'alta' && !f.alta_en) f.alta_en = new Date().toISOString(); if (tabla === 'clinica_reclamos' && st.datos.estado === 'facturado') f.facturado_en = new Date().toISOString(); });
        log('update', tabla, st.datos, st.filtros); resultado = afectadas;
      } else if (st.modo === 'delete') {
        const quedan = filas.filter(f => !aplica(f)); resultado = filas.filter(aplica); db[tabla] = quedan; log('delete', tabla, null, st.filtros);
      } else {
        resultado = filas.filter(aplica);
        st.orden.forEach(o => { /* orden estable: el último .order() pesa menos */ });
        for (let i = st.orden.length - 1; i >= 0; i--) { const o = st.orden[i]; resultado = resultado.slice().sort((a, b) => (a[o.col] > b[o.col] ? 1 : a[o.col] < b[o.col] ? -1 : 0) * (o.asc ? 1 : -1)); }
      }
      if (st.modo !== 'select') guardarDB(db);
      const total = (resultado || []).length;
      if (st.rango) resultado = resultado.slice(st.rango[0], st.rango[1] + 1);
      if (st.limite != null) resultado = resultado.slice(0, st.limite);
      // relaciones incrustadas: nombre(campos)
      const embebidos = partirTope(st.cols || '*').filter(c => c.includes('(')).map(c => c.slice(0, c.indexOf('(')).trim());
      if (embebidos.length && resultado) {
        const db2 = leerDB();
        // también anidadas: restaurante_comandas(restaurante_mesas(numero))
        const incrustar = (f, cols) => { const g = { ...f };
          partirTope(cols || '*').filter(c => c.includes('(')).forEach(c => { const rel = c.slice(0, c.indexOf('(')).trim(), dentro = c.slice(c.indexOf('(') + 1, c.lastIndexOf(')'));
            if (HIJOS[rel]) { g[rel] = (db2[rel] || []).filter(x => x.id && comoTexto(x[HIJOS[rel]]) === comoTexto(f.id)).map(x => incrustar(x, dentro)); return; }
            const fk = REL[rel]; const otra = (db2[rel] || []).find(x => x.id === f[fk]); g[rel] = otra ? incrustar(otra, dentro) : null; });
          return g; };
        resultado = resultado.map(f => incrustar(f, st.cols));
      }
      let data = resultado;
      if (st.uno === 'single') { if (!data || data.length !== 1) { error = { message: 'JSON object requested, multiple (or no) rows returned' }; data = null; } else data = data[0]; }
      else if (st.uno === 'maybe') data = data && data.length ? data[0] : null;
      if (st.head) data = null;
      if (st.modo !== 'select' && !st.devolver && !st.uno) data = null;
      return { data, error, count: total };
    };
    const api = {
      select(cols, opts) { if (st.modo !== 'select') st.devolver = true; st.cols = cols || '*'; if (opts?.head) st.head = true; return prox; },
      insert(d) { st.modo = 'insert'; st.datos = d; return prox; },
      upsert(d, o) { st.modo = 'upsert'; st.datos = d; st.conflicto = (o && o.onConflict) || 'id'; return prox; },
      update(d) { st.modo = 'update'; st.datos = d; return prox; },
      delete() { st.modo = 'delete'; return prox; },
      eq(c, v) { st.filtros.push({ col: c, op: 'eq', val: v }); return prox; }, neq(c, v) { st.filtros.push({ col: c, op: 'neq', val: v }); return prox; },
      gt(c, v) { st.filtros.push({ col: c, op: 'gt', val: v }); return prox; }, gte(c, v) { st.filtros.push({ col: c, op: 'gte', val: v }); return prox; },
      lt(c, v) { st.filtros.push({ col: c, op: 'lt', val: v }); return prox; }, lte(c, v) { st.filtros.push({ col: c, op: 'lte', val: v }); return prox; },
      in(c, v) { st.filtros.push({ col: c, op: 'in', val: v || [] }); return prox; }, is(c, v) { st.filtros.push({ col: c, op: 'is', val: v }); return prox; },
      ilike(c, v) { st.filtros.push({ col: c, op: 'ilike', val: v }); return prox; },
      like(c, v) { st.filtros.push({ col: c, op: 'like', val: v }); return prox; },
      or(txt) { st.filtros.push({ op: 'or', val: parseOr(txt) }); return prox; },
      not(c, op, v) { st.filtros.push({ op: 'not', val: { col: c, op, val: v } }); return prox; },
      order(c, o) { st.orden.push({ col: c, asc: o?.ascending !== false }); return prox; },
      limit(n) { st.limite = n; return prox; }, range(a, b) { st.rango = [a, b]; return prox; },
      single() { st.uno = 'single'; return prox; }, maybeSingle() { st.uno = 'maybe'; return prox; },
      then(res, rej) { try { return Promise.resolve(ejecutar()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } },
    };
    const prox = new Proxy(api, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => prox : undefined)) });
    return prox;
  }

  // ---- funciones del servidor del Restaurante (misma lógica que supabase/migraciones/20261028_restaurante_fase1_cobro.sql) ----
  function rpcRestaurante(nombre, a) {
    const db = leerDB(); const T = k => (db[k] = db[k] || []);
    const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
    const res = v => { guardarDB(db); return v; };
    switch (nombre) {
      case 'restaurante_cobro_reservar': {
        const c = T('restaurante_comandas').find(x => x.id === a.p_comanda_id);
        if (!c) return { ok: false, motivo: 'no_existe' };
        if (!['abierta', 'enviada', 'lista'].includes(c.estado)) return { ok: false, motivo: 'cerrada' };
        if (T('restaurante_cobros').some(k => k.comanda_id === c.id && k.estado === 'reservado')) return { ok: false, motivo: 'en_cobro' };
        const items = T('restaurante_comanda_items');
        items.filter(i => i.comanda_id === c.id && !i.venta_id).forEach(i => { i.cobro_id = null; });
        const pedidos = Array.isArray(a.p_items) && a.p_items.length ? a.p_items
          : items.filter(i => i.comanda_id === c.id && i.estado !== 'cancelado' && !i.venta_id).map(i => ({ item_id: i.id, cantidad: Number(i.cantidad) }));
        const vistos = new Set();
        for (const p of pedidos) {
          const r = items.find(i => i.id === p.item_id && i.comanda_id === c.id);
          if (!p.item_id || vistos.has(p.item_id)) return { ok: false, motivo: 'items_invalidos' }; vistos.add(p.item_id);
          if (!r || r.estado === 'cancelado' || r.venta_id) return { ok: false, motivo: 'item_no_disponible' };
          if (!r.producto_id) return { ok: false, motivo: 'sin_producto', nombre: r.nombre_producto };
          if (!(p.cantidad > 0) || p.cantidad > Number(r.cantidad)) return { ok: false, motivo: 'cantidad_invalida', nombre: r.nombre_producto };
        }
        if (!pedidos.length) return { ok: false, motivo: 'nada_por_cobrar' };
        const k = { id: uuid(), auth_user_id: UID, comanda_id: c.id, estado: 'reservado', items: [], subtotal: 0, venta_id: null, propina: 0, creado_por: a.p_quien || null, created_at: new Date().toISOString() };
        T('restaurante_cobros').push(k);
        let sub = 0;
        for (const p of pedidos) {
          const r = items.find(i => i.id === p.item_id); let id = r.id;
          if (p.cantidad < Number(r.cantidad)) { r.cantidad = Number(r.cantidad) - p.cantidad; const n2 = { ...r, id: uuid(), cantidad: p.cantidad, cobro_id: k.id }; items.push(n2); id = n2.id; }
          else r.cobro_id = k.id;
          k.items.push({ item_id: id, producto_id: r.producto_id, nombre: r.nombre_producto, cantidad: p.cantidad, precio: Number(r.precio_unitario), total: r2(p.cantidad * r.precio_unitario) });
          sub += r2(p.cantidad * r.precio_unitario);
        }
        k.subtotal = r2(sub);
        const mesa = T('restaurante_mesas').find(m => m.id === c.mesa_id);
        return res({ ok: true, cobro_id: k.id, lineas: k.items, subtotal: k.subtotal, mesa: mesa && mesa.numero });
      }
      case 'restaurante_cobro_confirmar': {
        const k = T('restaurante_cobros').find(x => x.id === a.p_cobro_id); if (!k) return { ok: false, motivo: 'no_existe' };
        const c = T('restaurante_comandas').find(x => x.id === k.comanda_id);
        if (k.estado === 'cobrado') return { ok: k.venta_id === a.p_venta_id, ya: true, cerrada: c.estado === 'cerrada' };
        const v = T('ventas').find(x => x.id === a.p_venta_id); if (!v || v.estado === 'anulada') return { ok: false, motivo: 'venta_invalida' };
        const ids = k.items.map(x => x.item_id), items = T('restaurante_comanda_items');
        if (items.some(i => ids.includes(i.id) && i.venta_id && i.venta_id !== a.p_venta_id)) return { ok: false, motivo: 'conflicto' };
        items.filter(i => ids.includes(i.id) && !i.venta_id).forEach(i => { i.venta_id = a.p_venta_id; i.cobro_id = k.id; });
        Object.assign(k, { estado: 'cobrado', venta_id: a.p_venta_id, cobrado_en: new Date().toISOString() });
        let cerrada = false;
        if (!items.some(i => i.comanda_id === c.id && i.estado !== 'cancelado' && !i.venta_id)) {
          const ks = T('restaurante_cobros').filter(x => x.comanda_id === c.id && x.estado === 'cobrado');
          const ventas = T('ventas').filter(x => ks.some(q => q.venta_id === x.id));
          Object.assign(c, { estado: 'cerrada', cerrada_at: new Date().toISOString(), propina_monto: r2(ks.reduce((s, q) => s + q.propina, 0)),
            total_cobrado: r2(ventas.reduce((s, x) => s + Number(x.total), 0) + ks.reduce((s, q) => s + q.propina, 0)),
            metodo_pago: new Set(ventas.map(x => x.metodo_pago_nombre)).size > 1 ? 'Varios' : (ventas[0] || {}).metodo_pago_nombre });
          const m = T('restaurante_mesas').find(x => x.id === c.mesa_id); if (m) Object.assign(m, { estado: 'limpieza', en_este_estado_desde: new Date().toISOString() });
          cerrada = true;
        }
        return res({ ok: true, cerrada });
      }
      case 'restaurante_cobro_propina': {
        const k = T('restaurante_cobros').find(x => x.id === a.p_cobro_id);
        if (!k || k.estado !== 'cobrado') return { ok: false, motivo: 'no_cobrado' };
        if (a.p_monto > 0 && k.propina > 0) return { ok: false, motivo: 'ya_tiene_propina' };
        const c = T('restaurante_comandas').find(x => x.id === k.comanda_id);
        if (c.estado === 'cerrada') c.total_cobrado = r2((c.total_cobrado || 0) - k.propina + Number(a.p_monto));
        k.propina = r2(a.p_monto); k.propina_metodo = a.p_metodo || null;
        c.propina_monto = r2(T('restaurante_cobros').filter(x => x.comanda_id === c.id && x.estado === 'cobrado').reduce((s, q) => s + q.propina, 0));
        return res({ ok: true });
      }
      case 'restaurante_cobro_liberar': {
        let n2 = 0; T('restaurante_cobros').forEach(k => { if (k.estado === 'reservado' && ((a.p_cobro_id && k.id === a.p_cobro_id) || (!a.p_cobro_id && k.comanda_id === a.p_comanda_id))) { k.estado = 'liberado'; n2++; } });
        return res({ ok: true, liberados: n2 });
      }
    }
    return null;
  }

  // ---- funciones del servidor de la Clínica (lógica mínima para la interfaz; la real se probó en SQL) ----
  const PIN_OK = '1357';
  function rpcClinica(nombre, a) {
    const db = leerDB(); const T = k => (db[k] = db[k] || []);
    const sesion = () => T('_sesiones').find(s => s.token === a.p_token && !s.cerrada);
    const persona = s => T('clinica_personal').find(p => p.id === s.personal_id);
    // Como en el servidor: la verificación de siempre solo acepta médico y administración; la de enfermería, también enfermería.
    const exigirEnf = () => { const s = sesion(); const p = s && persona(s); if (!p || !['medico', 'admin', 'enfermeria'].includes(p.rol)) throw { message: 'clinica_sesion_invalida' }; return p; };
    const exigir = () => { const p = exigirEnf(); if (p.rol === 'enfermeria') throw { message: 'clinica_sesion_invalida' }; return p; };
    const guardar = () => guardarDB(db);
    switch (nombre) {
      case 'clinica_iniciar_sesion_perfil': {
        const perfil = T('perfiles_acceso').find(x => x.id === a.p_perfil_id);
        if (!perfil) return { ok: false, motivo: 'no_encontrado' };
        const p = T('clinica_personal').find(x => x.perfil_id === a.p_perfil_id && x.activo !== false && ['medico', 'admin', 'enfermeria'].includes(x.rol));
        if (!p) return { ok: false, motivo: 'sin_acceso_clinico' };
        if (a.p_pin !== (perfil.tipo === 'admin' ? '2468' : PIN_OK)) return { ok: false, motivo: 'incorrecto', restantes: 4 };
        const token = (p.id.length % 2 ? 'cd' : 'ab').repeat(32); T('_sesiones').push({ token, personal_id: p.id }); guardar();
        return { ok: true, token, personal_id: p.id, perfil_id: perfil.id, nombre: perfil.nombre, rol: p.rol };
      }
      case 'clinica_sesion_estado': { const s = sesion(); return s ? { ok: true, ...persona(s) } : { ok: false }; }
      case 'clinica_cerrar_sesion': { T('_sesiones').forEach(s => { if (s.token === a.p_token) s.cerrada = true; }); guardar(); return null; }
      case 'clinica_expediente_abrir': {
        const p = exigir(); T('clinica_bitacora').push({ accion: 'abrir_expediente', paciente_id: a.p_paciente_id, quien: p.nombre }); guardar();
        return { yo: { id: p.id, nombre: p.nombre, rol: p.rol }, antecedentes: T('clinica_antecedentes').find(x => x.paciente_id === a.p_paciente_id) || null,
          consultas: T('clinica_consultas').filter(c => c.paciente_id === a.p_paciente_id).map(c => ({ ...c, adendas: T('clinica_adendas').filter(d => d.consulta_id === c.id) })),
          documentos: T('clinica_documentos').filter(d => d.paciente_id === a.p_paciente_id).slice().reverse(), adjuntos: T('clinica_adjuntos').filter(x => x.paciente_id === a.p_paciente_id && x.estado !== 'pendiente').map(x => { const y = { ...x }; delete y.ruta; return y; }) };
      }
      case 'clinica_antecedentes_guardar': { const p = exigir(); const lista = T('clinica_antecedentes'); const i = lista.findIndex(x => x.paciente_id === a.p_paciente_id);
        const fila = { paciente_id: a.p_paciente_id, ...a.p_datos, actualizado_en: new Date().toISOString(), actualizado_por_nombre: p.nombre }; if (i >= 0) lista[i] = fila; else lista.push(fila); guardar(); return { ok: true }; }
      case 'clinica_alergias': { exigir(); const o = {}; T('clinica_antecedentes').forEach(x => { if (a.p_ids.includes(x.paciente_id) && x.alergias) o[x.paciente_id] = x.alergias; }); return o; }
      case 'clinica_consulta_guardar': {
        const p = exigir(); const d = a.p_datos || {};
        if (!d.motivo) return { ok: false, motivo: 'falta_motivo' };
        const num = k => d[k] == null ? null : Number(d[k]);
        const imc = num('peso_kg') && num('talla_cm') ? Math.round(num('peso_kg') / Math.pow(num('talla_cm') / 100, 2) * 100) / 100 : null;
        if (!a.p_id) {
          if (d.agenda_cita_id && T('clinica_consultas').some(c => c.agenda_cita_id === d.agenda_cita_id && c.estado !== 'anulada')) return { ok: false, motivo: 'cita_con_nota' };
          const c = { id: uuid(), ...d, imc, medico_id: p.id, medico_nombre: p.nombre, estado: 'borrador', fecha: new Date().toISOString(), created_at: new Date().toISOString() };
          T('clinica_consultas').push(c);
          if (d.agenda_cita_id) {
            const ci = T('agenda_citas').find(x => x.id === d.agenda_cita_id); if (ci && ['reservada', 'confirmada'].includes(ci.estado)) ci.estado = 'en_atencion';
            const inf = T('clinica_cita_info').find(x => x.agenda_cita_id === d.agenda_cita_id);
            if (inf) inf.paciente_id = d.paciente_id; else T('clinica_cita_info').push({ agenda_cita_id: d.agenda_cita_id, auth_user_id: UID, paciente_id: d.paciente_id });
          }
          guardar(); return { ok: true, id: c.id };
        }
        const c = T('clinica_consultas').find(x => x.id === a.p_id);
        if (c.estado !== 'borrador') return { ok: false, motivo: 'no_borrador' };
        if (c.medico_id !== p.id) return { ok: false, motivo: 'no_autor' };
        Object.assign(c, d, { imc }); delete c.paciente_id_; guardar(); return { ok: true, id: c.id };
      }
      case 'clinica_consulta_cerrar': {
        const p = exigir(); const c = T('clinica_consultas').find(x => x.id === a.p_id);
        if (c.estado !== 'borrador') return { ok: false, motivo: 'no_borrador' };
        if (c.medico_id !== p.id) return { ok: false, motivo: 'no_autor' };
        if (!c.diagnostico && !c.plan) return { ok: false, motivo: 'incompleta' };
        c.estado = 'cerrada'; c.cerrada_en = new Date().toISOString(); c.firma_hash = 'f'.repeat(64);
        if (c.agenda_cita_id) { const inf = T('clinica_cita_info').find(x => x.agenda_cita_id === c.agenda_cita_id); if (inf && !inf.atendida_en) inf.atendida_en = new Date().toISOString(); }
        guardar(); return { ok: true };
      }
      case 'clinica_consulta_adenda': { const p = exigir(); const c = T('clinica_consultas').find(x => x.id === a.p_id);
        if (c.estado !== 'cerrada') return { ok: false, motivo: 'no_cerrada' }; T('clinica_adendas').push({ id: uuid(), consulta_id: c.id, autor_nombre: p.nombre, texto: a.p_texto, created_at: new Date().toISOString() }); guardar(); return { ok: true }; }
      case 'clinica_consulta_anular': { const p = exigir(); const c = T('clinica_consultas').find(x => x.id === a.p_id);
        if (!a.p_motivo || a.p_motivo.length < 5) return { ok: false, motivo: 'falta_motivo' }; c.estado = 'anulada'; c.motivo_anulacion = a.p_motivo; c.anulada_por_nombre = p.nombre;
        if (c.agenda_cita_id) { const ci = T('agenda_citas').find(x => x.id === c.agenda_cita_id); if (ci && ci.estado === 'en_atencion') ci.estado = 'confirmada';
          const inf = T('clinica_cita_info').find(x => x.agenda_cita_id === c.agenda_cita_id); if (inf) inf.atendida_en = null; }
        guardar(); return { ok: true }; }
      case 'clinica_personal_guardar': {
        const auth = a.p_auth || {}; const ses = T('_sesiones').find(s => s.token === auth.token && !s.cerrada);
        const okAdmin = (ses && persona(ses)?.rol === 'admin') || auth.admin_pin === '2468';
        if (!okAdmin) return { ok: false, motivo: auth.admin_pin ? 'incorrecto' : 'sin_permiso', restantes: 4 };
        const d = a.p_datos;
        if (!a.p_id) {
          const perfil = T('perfiles_acceso').find(x => x.id === d.perfil_id); if (!perfil) return { ok: false, motivo: 'perfil' };
          if (T('clinica_personal').some(x => x.perfil_id === d.perfil_id)) return { ok: false, motivo: 'perfil_repetido' };
          if (d.rol === 'enfermeria') { d.agenda_profesional_id = null; d.honorario_tipo = 'ninguno'; d.honorario_valor = 0; }
          const prof = d.agenda_profesional_id && T('agenda_profesionales').find(x => x.id === d.agenda_profesional_id);
          const f = { id: uuid(), auth_user_id: UID, nombre: perfil.nombre, perfil_id: perfil.id, rol: d.rol || 'medico', especialidad: d.especialidad, registro_profesional: d.registro_profesional,
            consultorio_id: d.consultorio_id, agenda_profesional_id: d.agenda_profesional_id || null, honorario_tipo: d.honorario_tipo || 'ninguno', honorario_valor: d.honorario_valor || 0,
            empleado_id: d.empleado_id || (prof && prof.empleado_id) || null, activo: true };
          T('clinica_personal').push(f); guardar(); return { ok: true, id: f.id }; }
        const f = T('clinica_personal').find(x => x.id === a.p_id); Object.assign(f, d); guardar(); return { ok: true, id: f.id };
      }
      case 'clinica_personal_nuevo': {      // como la del servidor: usuario + columna en la Agenda + ficha, todo o nada
        const demo = window.__DEMO === true, d = a.p_datos || {}, rol = d.rol || 'medico', nombre = String(a.p_nombre || '').trim();
        if (!['medico', 'admin', 'enfermeria'].includes(rol)) return { ok: false, motivo: 'rol' };
        if (nombre.length < 3 || nombre.length > 80) return { ok: false, motivo: 'nombre' };
        if (!demo) {
          const auth = a.p_auth || {}; const ses = T('_sesiones').find(x => x.token === auth.token && !x.cerrada);
          if (!((ses && persona(ses)?.rol === 'admin') || auth.admin_pin === '2468')) return { ok: false, motivo: auth.admin_pin ? 'incorrecto' : 'sin_permiso', restantes: 4 };
          if (!/^[0-9]{4,12}$/.test(a.p_codigo || '')) return { ok: false, motivo: 'codigo' };
          if (T('perfiles_acceso').some(x => String(x.nombre).trim().toLowerCase() === nombre.toLowerCase())) return { ok: false, motivo: 'nombre_repetido' };
        }
        if (d.honorario_tipo === 'porcentaje' && Number(d.honorario_valor) > 100) return { ok: false, motivo: 'honorario' };
        let perfil = null, prof = null;
        if (!demo) { perfil = { id: uuid(), auth_user_id: UID, nombre, tipo: 'restringido', activo: true, codigo_simulado: a.p_codigo,
          modulos: rol === 'enfermeria' ? ['clinica_panel', 'clinica_sala', 'clinica_hospital'] : ['clinica_panel', 'clinica_sala', 'clinica_pacientes', 'clinica_hospital', 'agenda'] }; T('perfiles_acceso').push(perfil); }
        if (a.p_columna_agenda !== false && rol !== 'enfermeria') { prof = { id: uuid(), auth_user_id: UID, nombre, color: '#3b82f6', orden: T('agenda_profesionales').length, activo: true, perfil_id: perfil && perfil.id }; T('agenda_profesionales').push(prof); }
        const f = { id: uuid(), auth_user_id: UID, nombre, perfil_id: perfil && perfil.id, rol, especialidad: d.especialidad || null, registro_profesional: d.registro_profesional || null,
          consultorio_id: d.consultorio_id || null, agenda_profesional_id: prof && prof.id, honorario_tipo: rol === 'enfermeria' ? 'ninguno' : (d.honorario_tipo || 'ninguno'),
          honorario_valor: rol === 'enfermeria' ? 0 : Number(d.honorario_valor || 0), activo: true };
        T('clinica_personal').push(f); guardar();
        return { ok: true, id: f.id, perfil_id: f.perfil_id, agenda_profesional_id: f.agenda_profesional_id, demo };
      }
      case 'clinica_bitacora_ver': {
        const auth = a.p_auth || {}; if (auth.admin_pin !== '2468' && !T('_sesiones').some(s => s.token === auth.token)) return { ok: false, motivo: 'incorrecto', restantes: 3 };
        return { ok: true, filas: T('clinica_bitacora').map(b => ({ fecha: new Date().toISOString(), quien: b.quien, accion: b.accion, paciente: '<b>Ana</b>', expediente: 'EXP-000001' })) };
      }
      case 'clinica_documento_emitir': {
        const p = exigir(); const d = a.p_datos || {}; const pref = { receta: 'RX', orden_lab: 'LAB', orden_imagen: 'IMG', constancia: 'CON', certificado: 'CER', referencia: 'REF', consentimiento: 'CI' }[d.tipo];
        if (!pref) return { ok: false, motivo: 'tipo' };
        if (d.tipo === 'receta' && !(d.contenido?.items || []).length) return { ok: false, motivo: 'incompleto' };
        const n = T('clinica_documentos').filter(x => x.tipo === d.tipo).length + 1;
        const doc = { id: uuid(), paciente_id: d.paciente_id, consulta_id: d.consulta_id || null, tipo: d.tipo, numero: pref + '-' + String(n).padStart(6, '0'), fecha: new Date().toISOString(),
          medico_id: p.id, medico_nombre: p.nombre, medico_registro: p.registro_profesional || null, medico_especialidad: p.especialidad || null, contenido: d.contenido, estado: 'emitido' };
        T('clinica_documentos').push(doc); guardar(); return { ok: true, id: doc.id, numero: doc.numero };
      }
      case 'clinica_documento_anular': { exigir(); const d = T('clinica_documentos').find(x => x.id === a.p_id); if (!a.p_motivo || a.p_motivo.length < 5) return { ok: false, motivo: 'falta_motivo' }; d.estado = 'anulado'; d.motivo_anulacion = a.p_motivo; guardar(); return { ok: true }; }
      case 'clinica_documento_farmacia': { exigir(); const d = T('clinica_documentos').find(x => x.id === a.p_id); if (d.farmacia_receta_id) return { ok: false, motivo: 'ya_en_farmacia' }; d.farmacia_receta_id = a.p_farmacia_receta_id; guardar(); return { ok: true }; }
      case 'clinica_adjunto_anular': { exigir(); const x = T('clinica_adjuntos').find(y => y.id === a.p_id); x.estado = 'anulado'; x.motivo_anulacion = a.p_motivo; guardar(); return { ok: true }; }
      case 'clinica_reporte_clinico': {
        const auth = a.p_auth || {}; const ok = auth.admin_pin === '2468' || T('_sesiones').some(x => x.token === auth.token && !x.cerrada);
        if (!ok) return { ok: false, motivo: 'incorrecto', restantes: 3 };
        const cuenta = {}; T('clinica_consultas').filter(c => c.estado === 'cerrada').forEach(c => (c.diagnosticos || []).forEach(d => { const k = d.codigo || d.nombre; cuenta[k] = cuenta[k] || { codigo: d.codigo || '—', nombre: d.nombre, total: 0 }; cuenta[k].total++; }));
        return { ok: true, diagnosticos: Object.values(cuenta).sort((x, y) => y.total - x.total), notas: [] };
      }
      case 'clinica_estancia_nota_agregar': {
        const p = exigirEnf(); const e = T('clinica_estancias').find(x => x.id === a.p_estancia_id); const d = a.p_datos || {};
        if (!e) return { ok: false, motivo: 'no_encontrado' }; if (e.estado !== 'activa') return { ok: false, motivo: 'estancia_cerrada' };
        if (!String(d.texto || '').trim()) return { ok: false, motivo: 'texto' };
        if (p.rol === 'enfermeria' && (d.tipo || 'evolucion') !== 'enfermeria') return { ok: false, motivo: 'solo_enfermeria' };
        if (d.fc != null && (Number(d.fc) < 20 || Number(d.fc) > 250)) return { ok: false, motivo: 'signos' };
        T('clinica_estancia_notas').push({ id: uuid(), estancia_id: e.id, paciente_id: e.paciente_id, ...d, autor_id: p.id, autor_nombre: p.nombre, created_at: new Date().toISOString() });
        T('clinica_bitacora').push({ accion: 'nota_estancia', quien: p.nombre }); guardar(); return { ok: true };
      }
      case 'clinica_estancia_notas': { const p = exigirEnf(); const e = T('clinica_estancias').find(x => x.id === a.p_estancia_id);
        return { ok: true, rol: p.rol, alergias: (T('clinica_antecedentes').find(x => e && x.paciente_id === e.paciente_id) || {}).alergias || null,
          notas: T('clinica_estancia_notas').filter(n => n.estancia_id === a.p_estancia_id) }; }
      case 'clinica_iniciar_sesion_demo': {
        if (window.__DEMO !== true) return { ok: false, motivo: 'solo_demo' };
        const p = T('clinica_personal').find(x => x.id === a.p_personal_id && x.activo !== false && ['medico', 'admin', 'enfermeria'].includes(x.rol));
        if (!p) return { ok: false, motivo: 'no_encontrado' };
        const token = 'de'.repeat(32); T('_sesiones').push({ token, personal_id: p.id }); guardar();
        return { ok: true, token, personal_id: p.id, nombre: p.nombre, rol: p.rol };
      }
      case 'clinica_cambiar_pin': return { ok: false, motivo: 'usar_usuarios' };
    }
    return undefined;
  }

  function crearCliente() {
    const sesion = { user: { id: UID, email: 'prueba@clinica.test' }, access_token: 'x' };
    return {
      auth: {
        // Cerrar sesión de verdad (en esta pestaña): después no hay usuario, como en el real.
        getUser: async () => sessionStorage.getItem('__SALIO') ? ({ data: { user: null }, error: null }) : ({ data: { user: sesion.user }, error: null }),
        getSession: async () => ({ data: { session: sessionStorage.getItem('__SALIO') ? null : sesion }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => { sessionStorage.setItem('__SALIO', '1'); return { error: null }; }, refreshSession: async () => ({ data: { session: sesion }, error: null }),
      },
      from: t => builder(t),
      rpc: async (nombre, args) => {
        const l = JSON.parse(sessionStorage.getItem('__LOG') || '[]'); l.push({ op: 'rpc', tabla: nombre, datos: args }); sessionStorage.setItem('__LOG', JSON.stringify(l));
        if (nombre === 'clinica_demo_preparar') { window.__demoPreparada = (window.__demoPreparada || 0) + 1; return { data: window.__DEMO === true ? { ok: true, creadas: 0 } : { ok: false, motivo: 'solo_demo' }, error: null }; }
        if (nombre.startsWith('restaurante_cobro_')) { try { const r = rpcRestaurante(nombre, args || {}); return { data: r ?? null, error: null }; } catch (e) { return { data: null, error: e }; } }
        if (nombre.startsWith('clinica_')) { try { const r = rpcClinica(nombre, args || {}); return { data: r ?? null, error: null }; } catch (e) { return { data: null, error: e }; } }
        if (nombre === 'agenda_cita_guardar') {            // guarda la cita y sus servicios (sin revisar cruces de horario)
          const db = leerDB(); db.agenda_citas = db.agenda_citas || []; db.agenda_citas_servicios = db.agenda_citas_servicios || [];
          const id = args.p_cita_id || uuid(); const d = args.p_datos || {};
          db.agenda_citas = db.agenda_citas.filter(c => c.id !== id); db.agenda_citas.push({ id, auth_user_id: UID, ...d });
          db.agenda_citas_servicios = db.agenda_citas_servicios.filter(x => x.cita_id !== id).concat((args.p_servicios || []).map((x, i) => ({ id: uuid(), cita_id: id, orden: i, ...x })));
          guardarDB(db); return { data: { ok: true, cita_id: id }, error: null };
        }
        if (nombre === 'soy_cuenta_demo') return { data: window.__DEMO === true, error: null };
        if (nombre === 'listar_perfiles_del_grupo_v2') { const db = leerDB(); return { data: (db.perfiles_acceso || []).map(p => ({ ...p, activo: p.activo !== false })), error: null }; }
        if (nombre === 'generar_numero_venta') { const db = leerDB(); const k = (db.ventas || []).length + 1; return { data: 'V-' + String(k).padStart(5, '0'), error: null }; }
        if (nombre === 'venta_registrar_atomica') {        // guarda la venta como lo haría el servidor (en una sola operación)
          const db = leerDB(); db.ventas = db.ventas || []; const id = uuid(); const num = 'V-' + String(db.ventas.length + 1).padStart(5, '0');
          db.ventas.push({ id, numero_venta: num, ...args.p_venta, estado: args.p_venta?.estado || 'completada' }); guardarDB(db);
          return { data: { venta_id: id, numero_venta: num }, error: null };
        }
        if (window.__RPC && window.__RPC[nombre]) return { data: window.__RPC[nombre](args), error: null };
        return { data: null, error: null };
      },
      storage: { from: bucket => ({
        // Guarda lo subido (bucket/ruta → tipo y tamaño) para poder revisarlo; la dirección pública imita la real.
        upload: async (ruta, archivo, op) => { const l = JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}'); l[bucket + '/' + ruta] = { tamano: archivo && archivo.size, tipo: (op && op.contentType) || (archivo && archivo.type) }; sessionStorage.setItem('__ALMACEN', JSON.stringify(l)); return { data: { path: ruta }, error: null }; },
        remove: async rutas => { const l = JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}'); (rutas || []).forEach(r => { delete l[bucket + '/' + r]; }); sessionStorage.setItem('__ALMACEN', JSON.stringify(l)); return { data: null, error: null }; },
        getPublicUrl: ruta => ({ data: { publicUrl: ruta ? `https://simulado.supabase.co/storage/v1/object/public/${bucket}/${ruta}` : '' } }), createSignedUrl: async () => ({ data: null, error: null }),
        uploadToSignedUrl: async (ruta, tok, archivo) => { const l = JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}'); l[bucket + '/' + ruta] = { tok, tamano: archivo.size, tipo: archivo.type }; sessionStorage.setItem('__ALMACEN', JSON.stringify(l)); return { data: { path: ruta }, error: null }; } }) },
      // Canal en vivo simulado: otra pestaña del mismo navegador hace de "otro equipo". Como la base simulada vive en
      // cada pestaña, el aviso lleva una copia (solo en la simulación; el aviso real no lleva datos).
      channel: (nombre) => {
        const hs = []; let bc = null;
        const c = { on: (tipo, f, cb) => { if (tipo === 'broadcast') hs.push({ ev: f.event, cb }); return c; },
          subscribe: (cb) => { if (typeof BroadcastChannel !== 'undefined') { bc = new BroadcastChannel('mock-' + nombre);
              bc.onmessage = e => { if (e.data.db) sessionStorage.setItem('__DB', e.data.db); hs.filter(h => h.ev === e.data.event).forEach(h => h.cb({ event: e.data.event, payload: e.data.payload })); }; }
            setTimeout(() => cb && cb('SUBSCRIBED'), 0); return c; },
          send: async (m) => { const l = JSON.parse(sessionStorage.getItem('__LOG') || '[]'); l.push({ op: 'aviso', tabla: nombre, datos: m.payload }); sessionStorage.setItem('__LOG', JSON.stringify(l));
            if (bc) bc.postMessage({ event: m.event, payload: m.payload, db: sessionStorage.getItem('__DB') }); return 'ok'; },
          unsubscribe() { if (bc) bc.close(); } };
        return c; },
      removeChannel() {}, functions: { invoke: async (nombre, op) => {
        const b = (op && op.body) || {}; const db = leerDB(); const T = k => (db[k] = db[k] || []);
        const l = JSON.parse(sessionStorage.getItem('__LOG') || '[]'); l.push({ op: 'funcion', tabla: nombre, datos: { ...b, token: '***' } }); sessionStorage.setItem('__LOG', JSON.stringify(l));
        if (nombre !== 'clinica-adjuntos') return { data: null, error: null };
        const ses = T('_sesiones').find(x => x.token === b.token && !x.cerrada); if (!ses) return { data: { ok: false, motivo: 'sesion' }, error: null };
        const per = T('clinica_personal').find(p => p.id === ses.personal_id);
        if (b.accion === 'subir') {
          if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(b.mime)) return { data: { ok: false, motivo: 'tipo_archivo' }, error: null };
          if (b.tamano > 10485760) return { data: { ok: false, motivo: 'tamano' }, error: null };
          const id = uuid(), ruta = UID + '/' + b.paciente_id + '/' + id;
          T('clinica_adjuntos').push({ id, paciente_id: b.paciente_id, consulta_id: b.consulta_id, nombre: b.nombre, mime: b.mime, tamano: b.tamano, ruta, descripcion: b.descripcion, estado: 'pendiente', subido_por_nombre: per.nombre, created_at: new Date().toISOString() });
          guardarDB(db); return { data: { ok: true, id, ruta, subida: 'tok-' + id }, error: null };
        }
        const x = T('clinica_adjuntos').find(y => y.id === b.id);
        if (b.accion === 'confirmar') { const alm = JSON.parse(sessionStorage.getItem('__ALMACEN') || '{}'); if (!alm['clinica-adjuntos/' + x.ruta]) return { data: { ok: false, motivo: 'archivo_no_llego' }, error: null }; x.estado = 'listo'; guardarDB(db); return { data: { ok: true }, error: null }; }
        if (b.accion === 'ver') return x && x.estado === 'listo' ? { data: { ok: true, url: 'https://almacen.simulado/firmado/' + x.id, nombre: x.nombre }, error: null } : { data: { ok: false, motivo: 'no_encontrado' }, error: null };
        return { data: { ok: false }, error: null };
      } },
    };
  }
  window.supabase = { createClient: () => crearCliente() };
})();
