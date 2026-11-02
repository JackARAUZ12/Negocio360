/* =====================================================
   CLINICA-CITAS.JS — NEGOCIO360 · Módulo Clínica
   Las citas de la clínica SON las citas de la Agenda del
   sistema (agenda_citas). Aquí solo se leen y se les agrega
   lo propio de la clínica (clinica_cita_info: paciente,
   consultorio, llegada, llamado, recordatorio). El médico de
   una cita es el profesional de la Agenda ligado a un médico
   en Clínica · Médicos. Nunca se mueve dinero aquí: el cobro
   va por el mismo camino de la Agenda (Ventas).
   Requiere de la página: sb, STATE, y clinica-comun.js.
===================================================== */
const ClinicaCitas = (() => {
  const trozos = (arr, n) => { const r = []; for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n)); return r; };
  async function porIds(tabla, cols, campo, ids) {
    const out = [];
    for (const t of trozos([...new Set(ids.filter(Boolean))], 150)) {
      const { data, error } = await sb.from(tabla).select(cols).eq('auth_user_id', STATE.userId).in(campo, t);
      if (error) throw error;
      out.push(...(data || []));
    }
    return out;
  }
  async function medicos() {
    const { data, error } = await sb.from('clinica_personal')
      .select('id, nombre, rol, activo, perfil_id, agenda_profesional_id, consultorio_id, especialidad, honorario_tipo, honorario_valor, empleado_id')
      .eq('auth_user_id', STATE.userId).order('nombre');
    if (error) throw error;
    // En las cuentas reales un médico es un usuario del sistema; en las demos (sin multiusuario) basta el médico de ejemplo.
    const demo = typeof ClinicaSesion !== 'undefined' && ClinicaSesion.esDemo ? await ClinicaSesion.esDemo() : false;
    return (data || []).filter(m => m.perfil_id || demo);
  }
  // Solo en la demo de simulación: el servidor genera el día de hoy y lo hace avanzar con el reloj
  // (en cualquier otra cuenta responde 'solo_demo' sin tocar nada). Como mucho cada 3 minutos.
  let demoListo = null, demoEn = 0;
  function prepararDemo() {
    if (demoListo && Date.now() - demoEn < 180000) return demoListo;
    demoEn = Date.now();
    demoListo = (async () => {
      const demo = typeof ClinicaSesion !== 'undefined' && ClinicaSesion.esDemo ? await ClinicaSesion.esDemo() : false;
      if (demo) { try { await sb.rpc('clinica_demo_preparar'); } catch (_) {} }
    })();
    return demoListo;
  }
  // Citas de la Agenda entre dos fechas, ya vistas por la clínica (ver clinicaCitaDeAgenda).
  async function cargar(desde, hasta, { soloEstados } = {}) {
    await prepararDemo();
    const consulta = () => { let q = sb.from('agenda_citas').select('*, agenda_citas_servicios(*)').eq('auth_user_id', STATE.userId).gte('fecha', desde).lte('fecha', hasta);
      if (soloEstados) q = q.in('estado', soloEstados);
      return q.order('fecha').order('id'); };
    const traer = async () => {            // por páginas: un rango largo puede tener miles de citas
      let todo = [];
      for (let i = 0; i < 50; i++) {
        const { data, error } = await consulta().range(i * 1000, i * 1000 + 999);
        if (error) throw error;
        todo = todo.concat(data || []);
        if (!data || data.length < 1000) break;
      }
      return todo;
    };
    const [agenda, meds] = await Promise.all([traer(), medicos()]);
    return { medicos: meds, citas: await armar(agenda, meds) };
  }
  // Arma las citas (ya cargadas de la Agenda con sus servicios) con su info clínica y sus pacientes.
  async function armar(agenda, meds) {
    const info = await porIds('clinica_cita_info', '*', 'agenda_cita_id', agenda.map(a => a.id));
    const infoDe = {}; info.forEach(i => { infoDe[i.agenda_cita_id] = i; });
    const cols = 'id, nombres, apellidos, telefono, numero_expediente, cliente_id, convenio_id, poliza, poliza_vence';
    const [pPorId, pPorCliente, clientes] = await Promise.all([
      porIds('clinica_pacientes', cols, 'id', info.map(i => i.paciente_id)),
      porIds('clinica_pacientes', cols, 'cliente_id', agenda.map(a => a.cliente_id)),
      porIds('clientes', 'id, telefono', 'id', agenda.map(a => a.cliente_id)),
    ]);
    const pacientes = [...pPorId, ...pPorCliente.filter(p => !pPorId.some(x => x.id === p.id))];
    return agenda.map(a => clinicaCitaDeAgenda(a, { info: infoDe[a.id], medicos: meds, pacientes, clientes }));
  }
  // Una cita (para atenderla desde el expediente).
  async function una(id) {
    const [c, meds] = await Promise.all([
      sb.from('agenda_citas').select('*, agenda_citas_servicios(*)').eq('id', id).eq('auth_user_id', STATE.userId).maybeSingle(), medicos()]);
    if (c.error) throw c.error;
    return c.data ? (await armar([c.data], meds))[0] : null;
  }
  // Historial de citas de un paciente: las ligadas a su expediente y las de su mismo cliente.
  async function delPaciente(pac) {
    const { data: inf, error } = await sb.from('clinica_cita_info').select('agenda_cita_id').eq('auth_user_id', STATE.userId).eq('paciente_id', pac.id);
    if (error) throw error;
    let ids = (inf || []).map(i => i.agenda_cita_id);
    if (pac.cliente_id) {
      const { data: delCliente } = await sb.from('agenda_citas').select('id').eq('auth_user_id', STATE.userId).eq('cliente_id', pac.cliente_id);
      ids = ids.concat((delCliente || []).map(x => x.id));
    }
    const agenda = await porIds('agenda_citas', '*, agenda_citas_servicios(*), ventas(numero_venta, estado)', 'id', ids);
    const meds = await medicos();
    const citas = (await armar(agenda, meds)).filter(c => !c.paciente_id || c.paciente_id === pac.id);
    citas.forEach(c => { const a = agenda.find(x => x.id === c.id); c.ventas = a && a.ventas; });
    return { medicos: meds, citas: citas.sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora)).slice(0, 60) };
  }
  // Guarda lo propio de la clínica en una cita de la Agenda (crea la fila si no existe).
  async function guardarInfo(citaId, cambios) {
    const { error } = await sb.from('clinica_cita_info').upsert({ agenda_cita_id: citaId, auth_user_id: STATE.userId, ...cambios }, { onConflict: 'agenda_cita_id' });
    if (error) throw error;
  }
  // Mismo cambio de estado que hace la Agenda (cancelar, no asistió...).
  async function cambiarEstado(citaId, estado) {
    const { error } = await sb.from('agenda_citas').update({ estado, updated_at: new Date().toISOString() }).eq('id', citaId).eq('auth_user_id', STATE.userId);
    if (error) throw error;
  }
  // Cuenta extra de la visita (medicamentos de la receta, insumos).
  async function cargos(citaId) {
    const { data, error } = await sb.from('clinica_cita_cargos').select('id, producto_id, descripcion, cantidad, productos(precio, nombre)')
      .eq('auth_user_id', STATE.userId).eq('agenda_cita_id', citaId).order('created_at');
    if (error) throw error;
    return data || [];
  }
  // Cobrar = el MISMO camino de la Agenda: Ventas abre la venta con el cliente, los servicios de la cita
  // y lo que se agregó a la cuenta; al confirmar, la cita queda cobrada (venta_id) y completada.
  // Con seguro (convenio vigente del paciente): el paciente paga su parte y lo que cubre la aseguradora queda
  // anotado en la cita para facturárselo después desde Clínica · Seguros.
  async function cobrar(cita, { convenio, convenioDisponible, alCerrar } = {}) {
    const { data: actual, error } = await sb.from('agenda_citas').select('id, venta_id, cliente_id, cliente_nombre, agenda_citas_servicios(*), ventas(estado, numero_venta)')
      .eq('id', cita.id).eq('auth_user_id', STATE.userId).maybeSingle();
    if (error) throw error;
    if (!actual) return { ok: false, motivo: 'No se encontró la cita.' };
    if (actual.venta_id && actual.ventas && actual.ventas.estado !== 'anulada') return { ok: false, motivo: `Esta visita ya fue cobrada (${actual.ventas.numero_venta || 'venta'}).` };
    // El paciente se cobra como cliente: si la cita aún no tiene cliente, se usa el del paciente o se crea con sus
    // datos (igual que en Observación), y queda ligado a la cita y al expediente. Así Ventas abre con el cliente listo.
    if (!actual.cliente_id && cita.paciente_id) {
      const { data: pac } = await sb.from('clinica_pacientes').select('id, nombres, apellidos, telefono, cliente_id').eq('id', cita.paciente_id).eq('auth_user_id', STATE.userId).maybeSingle();
      if (pac) {
        let cid = pac.cliente_id;
        if (!cid) {
          const { data: nuevo, error: eC } = await sb.from('clientes').insert({ auth_user_id: STATE.userId, nombre: [pac.nombres, pac.apellidos].filter(Boolean).join(' ').slice(0, 100) || 'Paciente', telefono: pac.telefono || null }).select('id').single();
          if (eC) throw eC;
          cid = nuevo.id;
          await sb.from('clinica_pacientes').update({ cliente_id: cid }).eq('id', pac.id).eq('auth_user_id', STATE.userId).is('cliente_id', null);
        }
        await sb.from('agenda_citas').update({ cliente_id: cid }).eq('id', cita.id).eq('auth_user_id', STATE.userId).is('cliente_id', null);
        actual.cliente_id = cid;
      }
    }
    const extra = await cargos(cita.id);
    const base = clinicaCobroAgenda(actual, extra);
    if (!base.items.length) return { ok: false, motivo: 'La cuenta está vacía: los servicios de la cita no están en tu catálogo.' };
    // Arma lo que se cobra, con o sin el seguro (se puede cambiar en la pantalla de cobro).
    let tipos = null;
    const preparar = async conv => {
      const d = { ...base, items: base.items.map(x => ({ ...x })) };
      if (conv) {
        if (!tipos) {
          const { data: prods } = await sb.from('productos').select('id, tipo').eq('auth_user_id', STATE.userId).in('id', d.items.map(x => x.producto_id));
          tipos = {}; (prods || []).forEach(x => { tipos[x.id] = x.tipo; });
        }
        const rep = clinicaAplicarConvenio(d.items, conv.cobertura_pct, tipos);
        d.items = rep.paciente;
        await guardarInfo(cita.id, { convenio_id: conv.id, cobertura_pct: Number(conv.cobertura_pct), monto_cubierto: rep.cubierto, cubierto_servicios: rep.cubiertoServicios });
      } else await guardarInfo(cita.id, { convenio_id: null, cobertura_pct: null, monto_cubierto: null, cubierto_servicios: null });
      sessionStorage.setItem('n360_agenda_cobro', JSON.stringify(d));
      return d;
    };
    const d = await preparar(convenio || null);
    const disponible = convenioDisponible || convenio || null;
    // Se cobra en la pantalla de cobro de la Clínica (si no se puede, como antes, en Ventas).
    if (typeof clinicaAbrirCobro === 'function' && clinicaAbrirCobro({ titulo: `Cobrar visita · ${d.cliente || ''}`.trim(), alCerrar,
      seguro: disponible ? { nombre: disponible.nombre, pct: Number(disponible.cobertura_pct), aplicado: !!convenio, cambiar: aplicar => preparar(aplicar ? disponible : null) } : null,
      alTerminar: ventaId => clinicaLigarVenta('agenda_citas', cita.id, ventaId, { estado: 'completada', updated_at: new Date().toISOString() }) })) return { ok: true, dentro: true };
    window.location.href = 'ventas.html';
    return { ok: true };
  }
  // Seguro vigente del paciente de una cita (para cobrar desde la Agenda): { paciente, convenio } o nulls.
  async function seguroDeCita(citaId, clienteId) {
    let pac = null;
    const { data: inf } = await sb.from('clinica_cita_info').select('paciente_id').eq('auth_user_id', STATE.userId).eq('agenda_cita_id', citaId).maybeSingle();
    const cols = 'id, cliente_id, convenio_id, poliza, poliza_vence';
    if (inf?.paciente_id) { const { data } = await sb.from('clinica_pacientes').select(cols).eq('auth_user_id', STATE.userId).eq('id', inf.paciente_id).maybeSingle(); pac = data; }
    if (!pac && clienteId) { const { data } = await sb.from('clinica_pacientes').select(cols).eq('auth_user_id', STATE.userId).eq('cliente_id', clienteId).eq('activo', true).limit(1); pac = (data || [])[0] || null; }
    if (!pac?.convenio_id) return { paciente: pac, convenio: null };
    const { data: k } = await sb.from('clinica_convenios').select('id, nombre, cobertura_pct, activo').eq('auth_user_id', STATE.userId).eq('id', pac.convenio_id).maybeSingle();
    return { paciente: pac, convenio: clinicaConvenioVigente(pac, k) ? k : null };
  }
  return { cargar, una, delPaciente, medicos, guardarInfo, cambiarEstado, cargos, cobrar, seguroDeCita, prepararDemo };
})();
