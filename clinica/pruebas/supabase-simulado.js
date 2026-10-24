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
  const REL = { clinica_pacientes: 'paciente_id', ventas: 'venta_id', productos: 'producto_id', clientes: 'cliente_id', clinica_personal: 'medico_id' };

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
      case 'ilike': { const re = new RegExp('^' + String(f.val).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); return re.test(comoTexto(v)); }
      case 'or': return f.val.some(g => cumple(fila, g));
      default: return true;
    }
  }
  function parseOr(txt) {
    return partirTope(txt).map(p => { const [col, op, ...resto] = p.split('.'); let val = resto.join('.'); if (op === 'is') val = val === 'null' ? null : val; return { col, op, val }; });
  }

  function builder(tabla) {
    const st = { tabla, filtros: [], orden: [], limite: null, rango: null, modo: 'select', datos: null, cols: '*', uno: null, head: false, count: null, devolver: false };
    const ejecutar = () => {
      const db = leerDB(); db[tabla] = db[tabla] || [];
      let filas = db[tabla];
      const aplica = f => st.filtros.every(x => cumple(f, x));
      let resultado = null, error = null;
      if (st.modo === 'insert') {
        const lista = (Array.isArray(st.datos) ? st.datos : [st.datos]).map(d => {
          const fila = { id: uuid(), created_at: new Date().toISOString(), ...d };
          if (tabla === 'clinica_pacientes' && !fila.numero_expediente) fila.numero_expediente = 'EXP-' + String(db[tabla].length + 1).padStart(6, '0');
          if (tabla.startsWith('clinica_') && fila.activo === undefined && ['clinica_pacientes', 'clinica_consultorios', 'clinica_personal'].includes(tabla)) fila.activo = true;
          if (tabla === 'clientes' && fila.activo === undefined) fila.activo = true;
          if (tabla === 'clinica_citas' && !fila.estado) fila.estado = 'programada';
          if (tabla === 'clinica_citas' && !fila.duracion_min) fila.duracion_min = 30;
          return fila;
        });
        db[tabla].push(...lista); log('insert', tabla, st.datos); resultado = lista;
      } else if (st.modo === 'update') {
        const afectadas = filas.filter(aplica); afectadas.forEach(f => Object.assign(f, st.datos));
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
        resultado = resultado.map(f => { const g = { ...f }; embebidos.forEach(rel => { const fk = REL[rel]; const otra = (db2[rel] || []).find(x => x.id === f[fk]); g[rel] = otra ? { ...otra } : null; }); return g; });
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
      upsert(d) { st.modo = 'insert'; st.datos = d; return prox; },
      update(d) { st.modo = 'update'; st.datos = d; return prox; },
      delete() { st.modo = 'delete'; return prox; },
      eq(c, v) { st.filtros.push({ col: c, op: 'eq', val: v }); return prox; }, neq(c, v) { st.filtros.push({ col: c, op: 'neq', val: v }); return prox; },
      gt(c, v) { st.filtros.push({ col: c, op: 'gt', val: v }); return prox; }, gte(c, v) { st.filtros.push({ col: c, op: 'gte', val: v }); return prox; },
      lt(c, v) { st.filtros.push({ col: c, op: 'lt', val: v }); return prox; }, lte(c, v) { st.filtros.push({ col: c, op: 'lte', val: v }); return prox; },
      in(c, v) { st.filtros.push({ col: c, op: 'in', val: v || [] }); return prox; }, is(c, v) { st.filtros.push({ col: c, op: 'is', val: v }); return prox; },
      ilike(c, v) { st.filtros.push({ col: c, op: 'ilike', val: v }); return prox; },
      or(txt) { st.filtros.push({ op: 'or', val: parseOr(txt) }); return prox; },
      order(c, o) { st.orden.push({ col: c, asc: o?.ascending !== false }); return prox; },
      limit(n) { st.limite = n; return prox; }, range(a, b) { st.rango = [a, b]; return prox; },
      single() { st.uno = 'single'; return prox; }, maybeSingle() { st.uno = 'maybe'; return prox; },
      then(res, rej) { try { return Promise.resolve(ejecutar()).then(res, rej); } catch (e) { return Promise.reject(e).then(res, rej); } },
    };
    const prox = new Proxy(api, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? () => prox : undefined)) });
    return prox;
  }

  // ---- funciones del servidor de la Clínica (lógica mínima para la interfaz; la real se probó en SQL) ----
  const PIN_OK = '1357';
  function rpcClinica(nombre, a) {
    const db = leerDB(); const T = k => (db[k] = db[k] || []);
    const sesion = () => T('_sesiones').find(s => s.token === a.p_token && !s.cerrada);
    const persona = s => T('clinica_personal').find(p => p.id === s.personal_id);
    const exigir = () => { const s = sesion(); if (!s) throw { message: 'clinica_sesion_invalida' }; return persona(s); };
    const guardar = () => guardarDB(db);
    switch (nombre) {
      case 'clinica_iniciar_sesion': {
        const p = T('clinica_personal').find(x => x.id === a.p_personal_id);
        if (!p) return { ok: false, motivo: 'no_encontrado' };
        if (a.p_pin !== PIN_OK) return { ok: false, motivo: 'incorrecto', restantes: 4 };
        const token = 'ab'.repeat(32); T('_sesiones').push({ token, personal_id: p.id }); guardar();
        return { ok: true, token, personal_id: p.id, nombre: p.nombre, rol: p.rol };
      }
      case 'clinica_sesion_estado': { const s = sesion(); return s ? { ok: true, ...persona(s) } : { ok: false }; }
      case 'clinica_cerrar_sesion': { T('_sesiones').forEach(s => { if (s.token === a.p_token) s.cerrada = true; }); guardar(); return null; }
      case 'clinica_expediente_abrir': {
        const p = exigir(); T('clinica_bitacora').push({ accion: 'abrir_expediente', paciente_id: a.p_paciente_id, quien: p.nombre }); guardar();
        return { yo: { id: p.id, nombre: p.nombre, rol: p.rol }, antecedentes: T('clinica_antecedentes').find(x => x.paciente_id === a.p_paciente_id) || null,
          consultas: T('clinica_consultas').filter(c => c.paciente_id === a.p_paciente_id).map(c => ({ ...c, adendas: T('clinica_adendas').filter(d => d.consulta_id === c.id) })) };
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
          if (d.cita_id && T('clinica_consultas').some(c => c.cita_id === d.cita_id && c.estado !== 'anulada')) return { ok: false, motivo: 'cita_con_nota' };
          const c = { id: uuid(), ...d, imc, medico_id: p.id, medico_nombre: p.nombre, estado: 'borrador', fecha: new Date().toISOString(), created_at: new Date().toISOString() };
          T('clinica_consultas').push(c);
          if (d.cita_id) { const ci = T('clinica_citas').find(x => x.id === d.cita_id); if (ci && ['programada', 'confirmada', 'en_espera'].includes(ci.estado)) ci.estado = 'en_consulta'; }
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
        if (c.cita_id) { const ci = T('clinica_citas').find(x => x.id === c.cita_id); if (ci) ci.estado = 'atendida'; }
        guardar(); return { ok: true };
      }
      case 'clinica_consulta_adenda': { const p = exigir(); const c = T('clinica_consultas').find(x => x.id === a.p_id);
        if (c.estado !== 'cerrada') return { ok: false, motivo: 'no_cerrada' }; T('clinica_adendas').push({ id: uuid(), consulta_id: c.id, autor_nombre: p.nombre, texto: a.p_texto, created_at: new Date().toISOString() }); guardar(); return { ok: true }; }
      case 'clinica_consulta_anular': { const p = exigir(); const c = T('clinica_consultas').find(x => x.id === a.p_id);
        if (!a.p_motivo || a.p_motivo.length < 5) return { ok: false, motivo: 'falta_motivo' }; c.estado = 'anulada'; c.motivo_anulacion = a.p_motivo; c.anulada_por_nombre = p.nombre; guardar(); return { ok: true }; }
      case 'clinica_personal_guardar': {
        const auth = a.p_auth || {}; const ses = T('_sesiones').find(s => s.token === auth.token && !s.cerrada);
        const okAdmin = (ses && persona(ses)?.rol === 'admin') || auth.admin_pin === '2468';
        if (!okAdmin) return { ok: false, motivo: auth.admin_pin ? 'incorrecto' : 'sin_permiso', restantes: 4 };
        const d = a.p_datos;
        if (!a.p_id) { if (d.rol !== 'recepcion' && !d.pin) return { ok: false, motivo: 'pin_requerido' };
          const f = { id: uuid(), auth_user_id: UID, nombre: d.nombre, rol: d.rol, atiende: d.atiende, especialidad: d.especialidad, registro_profesional: d.registro_profesional, telefono: d.telefono, consultorio_id: d.consultorio_id, pin_configurado: !!d.pin, activo: true };
          T('clinica_personal').push(f); guardar(); return { ok: true, id: f.id }; }
        const f = T('clinica_personal').find(x => x.id === a.p_id); Object.assign(f, { ...d, pin: undefined, pin_configurado: f.pin_configurado || !!d.pin }); guardar(); return { ok: true, id: f.id };
      }
      case 'clinica_bitacora_ver': {
        const auth = a.p_auth || {}; if (auth.admin_pin !== '2468' && !T('_sesiones').some(s => s.token === auth.token)) return { ok: false, motivo: 'incorrecto', restantes: 3 };
        return { ok: true, filas: T('clinica_bitacora').map(b => ({ fecha: new Date().toISOString(), quien: b.quien, accion: b.accion, paciente: '<b>Ana</b>', expediente: 'EXP-000001' })) };
      }
      case 'clinica_cambiar_pin': return a.p_pin_actual === PIN_OK ? { ok: true } : { ok: false, motivo: 'incorrecto', restantes: 4 };
    }
    return undefined;
  }

  function crearCliente() {
    const sesion = { user: { id: UID, email: 'prueba@clinica.test' }, access_token: 'x' };
    return {
      auth: {
        getUser: async () => ({ data: { user: sesion.user }, error: null }),
        getSession: async () => ({ data: { session: sesion }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signOut: async () => ({ error: null }), refreshSession: async () => ({ data: { session: sesion }, error: null }),
      },
      from: t => builder(t),
      rpc: async (nombre, args) => {
        const l = JSON.parse(sessionStorage.getItem('__LOG') || '[]'); l.push({ op: 'rpc', tabla: nombre, datos: args }); sessionStorage.setItem('__LOG', JSON.stringify(l));
        if (nombre.startsWith('clinica_')) { try { const r = rpcClinica(nombre, args || {}); return { data: r ?? null, error: null }; } catch (e) { return { data: null, error: e }; } }
        if (nombre === 'generar_numero_venta') { const db = leerDB(); const k = (db.ventas || []).length + 1; return { data: 'V-' + String(k).padStart(5, '0'), error: null }; }
        if (nombre === 'venta_registrar_atomica') {        // guarda la venta como lo haría el servidor (en una sola operación)
          const db = leerDB(); db.ventas = db.ventas || []; const id = uuid(); const num = 'V-' + String(db.ventas.length + 1).padStart(5, '0');
          db.ventas.push({ id, numero_venta: num, ...args.p_venta, estado: args.p_venta?.estado || 'completada' }); guardarDB(db);
          return { data: { venta_id: id, numero_venta: num }, error: null };
        }
        if (window.__RPC && window.__RPC[nombre]) return { data: window.__RPC[nombre](args), error: null };
        return { data: null, error: null };
      },
      storage: { from: () => ({ upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), createSignedUrl: async () => ({ data: null, error: null }) }) },
      channel: () => { const c = { on: () => c, subscribe: () => c, unsubscribe() {} }; return c; },
      removeChannel() {}, functions: { invoke: async () => ({ data: null, error: null }) },
    };
  }
  window.supabase = { createClient: () => crearCliente() };
})();
