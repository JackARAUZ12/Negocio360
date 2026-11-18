/* ============================================================
   RECURRENTES-EDITAR.JS — NEGOCIO360
   ✏️ Editar el pago recurrente de un cliente (Ventas › Clientes con
   pago recurrente): próxima fecha, monto y frecuencia.

   Qué toca: SOLO la fila del cliente (su calendario de cobro).
   Qué NO toca: ventas, Caja, impuestos ni el historial de pagos ya
   registrados. Un pago parcial pendiente se respeta tal cual.

   Candados:
     - El día de pago se toma de la fecha elegida, así el calendario
       siempre sigue el mismo día (ej. "cada mes el 5").
     - Si mientras se editaba alguien registró un pago a ese cliente,
       NO se guarda encima: se avisa y se recarga la lista.
   ============================================================ */
(function () {
  'use strict';
  if (window.N360RecEditar) return;

  let cli = null;          // cliente que se edita (copia de cómo estaba al abrir)
  let guardando = false;
  const $ = id => document.getElementById(id);
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const fechaLarga = iso => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-NI', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  };
  const fechaOk = iso => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && !isNaN(new Date(iso + 'T00:00:00'));

  // Lo que se va a guardar, leído del formulario (null si falta algo).
  function leer() {
    const fecha = $('er-fecha').value;
    const monto = Math.round((parseFloat($('er-monto').value) || 0) * 100) / 100;
    const freq = $('er-frecuencia').value;
    let unidad = null, intervalo = null;
    if (freq === 'personalizado') {
      unidad = $('er-unidad').value === 'mes' ? 'mes' : 'semana';
      intervalo = parseInt($('er-intervalo').value, 10);
    }
    const errores = [];
    if (!fechaOk(fecha)) errores.push('Elige la próxima fecha a pagar.');
    if (!(monto > 0)) errores.push('El monto de cada periodo debe ser mayor que 0.');
    if (freq === 'personalizado' && !(intervalo >= 1 && intervalo <= 99)) errores.push('Indica cada cuántas semanas o meses se repite (1 a 99).');
    if (errores.length) return { errores };
    // El día de pago sale de la fecha elegida: día del mes, o día de la semana.
    const f = new Date(fecha + 'T00:00:00');
    const porSemana = freq === 'semanal' || (freq === 'personalizado' && unidad === 'semana');
    const diaPago = porSemana ? f.getDay() : f.getDate();
    return { fecha, monto, freq, unidad, intervalo, diaPago, porSemana, errores: [] };
  }

  function vista() {
    if (!cli) return;
    const freq = $('er-frecuencia').value;
    $('er-wrap-pers').style.display = freq === 'personalizado' ? '' : 'none';
    const v = leer(), box = $('er-resumen');
    if (v.errores.length) { box.innerHTML = `<span style="color:var(--danger)">${v.errores.map(esc).join('<br>')}</span>`; $('er-guardar').disabled = true; return; }
    $('er-guardar').disabled = false;
    // Las siguientes fechas con la MISMA función que usa "Crear pago"
    const pers = { unidad: v.unidad, intervalo: v.intervalo };
    const sig1 = calcularSiguienteFecha(v.fecha, v.freq, v.diaPago, pers);
    const sig2 = calcularSiguienteFecha(sig1, v.freq, v.diaPago, pers);
    const cada = v.freq === 'mensual' ? `cada mes, el día ${v.diaPago}`
      : v.freq === 'semanal' ? `cada semana, el ${DIAS[v.diaPago]}`
      : v.freq === 'quincenal' ? 'cada 15 días'
      : v.freq === 'anual' ? 'cada año, en la misma fecha'
      : v.unidad === 'mes' ? `cada ${v.intervalo === 1 ? 'mes' : v.intervalo + ' meses'}, el día ${v.diaPago}`
      : `cada ${v.intervalo === 1 ? 'semana' : v.intervalo + ' semanas'}, el ${DIAS[v.diaPago]}`;
    const hoy = todayISO();
    const atraso = v.fecha < hoy ? Math.round((new Date(hoy + 'T00:00:00') - new Date(v.fecha + 'T00:00:00')) / 86400000) : 0;
    const saldo = Number(cli.saldo_pendiente || 0);
    const cobraAhora = saldo > 0 ? saldo : v.monto;
    const cambios = [];
    if (v.fecha !== (cli.fecha_proxima_pago || '')) cambios.push(`Fecha: ${esc(fechaLarga(cli.fecha_proxima_pago))} → <b>${esc(fechaLarga(v.fecha))}</b>`);
    if (Math.abs(v.monto - Number(cli.monto_recurrente || 0)) > 0.004) cambios.push(`Monto: ${esc(fmt(cli.monto_recurrente || 0))} → <b>${esc(fmt(v.monto))}</b>`);
    const freqAntes = frecuenciaLabel(cli), freqNueva = frecuenciaLabel({ frecuencia_pago: v.freq, frecuencia_personalizada_unidad: v.unidad, frecuencia_personalizada_intervalo: v.intervalo, dia_pago: v.diaPago });
    if (freqAntes !== freqNueva) cambios.push(`Frecuencia: ${esc(freqAntes)} → <b>${esc(freqNueva)}</b>`);
    box.innerHTML =
      `<div><b>Así queda:</b> próximo cobro el <b>${esc(fechaLarga(v.fecha))}</b> por <b>${esc(fmt(cobraAhora))}</b>` +
      `${atraso ? ` <span style="color:var(--danger);font-weight:600">(quedará atrasado ${atraso} día${atraso === 1 ? '' : 's'})</span>` : ''}.</div>` +
      `<div>Después: ${esc(cada)} → ${esc(fechaLarga(sig1))}, ${esc(fechaLarga(sig2))}…</div>` +
      (cambios.length ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border)">${cambios.join('<br>')}</div>`
                      : `<div style="margin-top:8px;color:var(--text-muted)">Aún no has cambiado nada.</div>`);
  }

  function abrir(clienteId) {
    const c = (S.clientesRecurrentes || []).find(x => x.id === clienteId);
    if (!c) return;
    cli = Object.assign({}, c);
    $('er-cliente-nombre').textContent = c.nombre || '';
    $('er-fecha').value = c.fecha_proxima_pago || todayISO();
    $('er-monto').value = Number(c.monto_recurrente || 0) ? Number(c.monto_recurrente).toFixed(2) : '';
    $('er-frecuencia').value = ['mensual', 'semanal', 'quincenal', 'anual', 'personalizado'].includes(c.frecuencia_pago) ? c.frecuencia_pago : 'mensual';
    $('er-unidad').value = c.frecuencia_personalizada_unidad === 'mes' ? 'mes' : 'semana';
    $('er-intervalo').value = c.frecuencia_personalizada_intervalo || 1;
    const saldo = Number(c.saldo_pendiente || 0), par = $('er-parcial');
    if (saldo > 0) {
      par.style.display = '';
      par.innerHTML = `Este cliente tiene un <b>pago parcial</b>: todavía debe <b>${esc(fmt(saldo))}</b> del periodo actual. Eso se mantiene igual; el monto nuevo aplica desde el siguiente periodo.`;
    } else { par.style.display = 'none'; par.innerHTML = ''; }
    $('er-guardar').textContent = 'Guardar cambios';
    guardando = false;
    vista();
    openModal('modal-editar-recurrente');
  }

  function cerrar() { closeModal('modal-editar-recurrente'); cli = null; }

  async function guardar() {
    if (!cli || guardando) return;
    const v = leer();
    if (v.errores.length) { showToast(v.errores[0], 'error'); return; }
    const upd = {
      fecha_proxima_pago: v.fecha,
      monto_recurrente: v.monto,
      frecuencia_pago: v.freq,
      dia_pago: v.diaPago,
      frecuencia_personalizada_unidad: v.freq === 'personalizado' ? v.unidad : null,
      frecuencia_personalizada_intervalo: v.freq === 'personalizado' ? v.intervalo : null,
    };
    const sinCambios = upd.fecha_proxima_pago === (cli.fecha_proxima_pago || '') && Math.abs(upd.monto_recurrente - Number(cli.monto_recurrente || 0)) < 0.005
      && upd.frecuencia_pago === cli.frecuencia_pago && Number(upd.dia_pago) === Number(cli.dia_pago)
      && (upd.frecuencia_personalizada_unidad || null) === (cli.frecuencia_personalizada_unidad || null)
      && Number(upd.frecuencia_personalizada_intervalo || 0) === Number(cli.frecuencia_personalizada_intervalo || 0);
    if (sinCambios) { cerrar(); return; }
    guardando = true;
    const btn = $('er-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      // Candado: solo se guarda si el cliente sigue como estaba al abrir (nadie registró un pago entretanto).
      let q = sb.from('clientes').update(upd).eq('id', cli.id).eq('auth_user_id', S.userId).eq('tipo_cliente', 'recurrente');
      q = cli.fecha_proxima_pago ? q.eq('fecha_proxima_pago', cli.fecha_proxima_pago) : q.is('fecha_proxima_pago', null);
      q = Number(cli.saldo_pendiente || 0) > 0 ? q.eq('saldo_pendiente', cli.saldo_pendiente) : q.or('saldo_pendiente.is.null,saldo_pendiente.eq.0');
      const { data, error } = await q.select('id');
      if (error) throw error;
      if (!data || !data.length) {
        showToast('Este cliente cambió mientras lo editabas (¿alguien registró un pago?). No se guardó nada: revisa la lista y vuelve a intentar.', 'warning');
        cerrar(); await loadClientesRecurrentes(); return;
      }
      showToast('Pago recurrente actualizado', 'success');
      cerrar();
      await loadClientesRecurrentes();
    } catch (e) {
      console.warn('Editar pago recurrente:', e);
      showToast('No se pudo guardar: ' + (e.message || 'revisa tu conexión'), 'error');
      btn.disabled = false; btn.textContent = 'Guardar cambios';
    } finally { guardando = false; }
  }

  window.N360RecEditar = { abrir, cerrar, guardar, vista, _leer: leer };
})();
