/* ============================================================
   ADMIN-SALUD.JS — Negocio360 · Panel de administración
   1) "Salud de los datos": revisa cada noche (y cuando tocas "Revisar
      ahora") que el dinero de cada negocio cuadre: ventas vs Caja,
      anulaciones, créditos, abonos, fiados, gastos y fichas de clientes.
   2) "Errores en vivo": lo que les falla a tus clientes en pantalla.
   SOLO LEE los datos de los negocios. Lo único que escribe es tu marca de
   "revisado" / "resuelto" en las tablas del panel (nunca en sus cuentas).
   ============================================================ */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => Number(n || 0).toLocaleString('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf = n => Number(n || 0).toLocaleString('es-NI');
  const $ = id => document.getElementById(id);
  const aviso = (t, m, tipo) => { try { (window.toast || console.log)(t, m, tipo); } catch (_) {} };
  const fechaHora = d => d ? new Date(d).toLocaleString('es-NI', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const fecha = d => d ? new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-NI', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const hace = d => {
    if (!d) return '—';
    const min = Math.round((Date.now() - new Date(d).getTime()) / 60000);
    if (min < 1) return 'hace un momento'; if (min < 60) return `hace ${min} min`;
    const h = Math.round(min / 60); if (h < 24) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} d`;
  };

  /* ---------- Qué significa cada chequeo (en palabras sencillas) ---------- */
  const CHEQ = {
    venta_sin_caja:          { t: 'Venta pagada sin entrada en Caja',      q: 'La venta dice "pagada" pero el dinero no entró a Caja. Caja queda corta.' },
    venta_caja_distinta:     { t: 'Caja no coincide con la venta',         q: 'Lo que entró a Caja es distinto al total de la venta.' },
    anulada_en_caja:         { t: 'Venta anulada que sigue en Caja',       q: 'La venta se anuló pero su dinero sigue sumando en Caja.' },
    ingreso_doble:           { t: 'Cobro registrado dos veces',            q: 'El mismo cobro de una venta entró dos veces a Caja (posible doble clic).' },
    credito_saldo:           { t: 'Saldo de crédito no cuadra',            q: 'El saldo no es lo financiado menos lo abonado.' },
    credito_cuotas:          { t: 'Crédito con cuotas desalineadas',       q: 'El saldo no coincide con las cuotas pendientes. El dueño debe usar "Renegociar".' },
    abono_doble:             { t: 'Abono repetido',                        q: 'Dos abonos iguales al mismo crédito en menos de 90 segundos. Confirmar con el negocio.' },
    gasto_cancelado_en_caja: { t: 'Gasto cancelado que sigue en Caja',     q: 'El gasto se canceló pero su salida de Caja sigue activa.' },
    fiado_saldo:             { t: 'Fiado que no cuadra',                   q: 'El saldo del fiado no es el total menos lo abonado.' },
    ficha_cliente:           { t: '"Total comprado" del cliente distinto', q: 'La ficha del cliente no coincide con sus ventas reales. No afecta dinero.' },
    stock_negativo:          { t: 'Existencia negativa',                   q: 'Un producto quedó con existencia menor a cero.' },
  };
  const tituloCheq = c => (CHEQ[c] && CHEQ[c].t) || c;

  /* =========================================================
     1) SALUD DE LOS DATOS
     ========================================================= */
  const S = { corrida: null, hallazgos: [], abierto: null, cargando: false, revisando: false };

  async function cargarSalud() {
    if (S.cargando) return; S.cargando = true;
    const cuerpo = $('sd-lista');
    if (cuerpo && !S.hallazgos.length) cuerpo.innerHTML = '<div class="sd-vacio">Cargando…</div>';
    try {
      const { data: corr, error } = await sb.from('admin_salud_corridas').select('*').order('creado_en', { ascending: false }).limit(1);
      if (error) throw error;
      S.corrida = (corr || [])[0] || null;
      S.hallazgos = [];
      if (S.corrida) {
        // Paginado para no cortar resultados (la API entrega máx. 1000 por consulta)
        for (let desde = 0; desde < 20000; desde += 1000) {
          const { data, error: e2 } = await sb.from('admin_salud_hallazgos').select('*').eq('corrida_id', S.corrida.id)
            .order('nivel', { ascending: false }).range(desde, desde + 999);
          if (e2) throw e2;
          S.hallazgos.push(...(data || []));
          if (!data || data.length < 1000) break;
        }
      }
      pintarSalud();
    } catch (e) {
      console.error('Salud de datos:', e);
      if (cuerpo) cuerpo.innerHTML = '<div class="sd-vacio">No se pudo cargar la revisión. Intenta de nuevo.</div>';
    } finally { S.cargando = false; }
  }

  async function revisarAhora() {
    if (S.revisando) return; S.revisando = true;
    const b = $('sd-revisar'); if (b) { b.disabled = true; b.textContent = 'Revisando todos los negocios…'; }
    try {
      const { error } = await sb.rpc('admin_salud_ejecutar', { p_origen: 'manual' });
      if (error) throw error;
      await cargarSalud();
      aviso('Revisión completa', 'Se revisaron todos los negocios', 'success');
    } catch (e) {
      console.error(e); aviso('No se pudo revisar', e.message || 'Intenta de nuevo', 'error');
    } finally { S.revisando = false; if (b) { b.disabled = false; b.textContent = '↻ Revisar ahora'; } }
  }

  function porNegocio(lista) {
    const m = new Map();
    lista.forEach(h => {
      const k = h.auth_user_id || h.negocio;
      if (!m.has(k)) m.set(k, { id: k, negocio: h.negocio || '(sin nombre)', rojos: 0, amarillos: 0, nuevos: 0, monto: 0, items: [] });
      const g = m.get(k);
      if (h.nivel === 'rojo') { g.rojos++; g.monto += Math.abs(Number(h.monto) || 0); } else g.amarillos++;
      if (h.nuevo) g.nuevos++;
      g.items.push(h);
    });
    return [...m.values()].sort((a, b) => (b.nuevos - a.nuevos) || (b.rojos - a.rojos) || (b.amarillos - a.amarillos) || a.negocio.localeCompare(b.negocio));
  }

  function filtrados() {
    const q = ($('sd-buscar')?.value || '').trim().toLowerCase();
    const nivel = $('sd-nivel')?.value || '';
    const soloNuevos = $('sd-nuevos')?.checked;
    return S.hallazgos.filter(h => (!nivel || h.nivel === nivel) && (!soloNuevos || h.nuevo)
      && (!q || [h.negocio, h.referencia, tituloCheq(h.chequeo), h.detalle].join(' ').toLowerCase().includes(q)));
  }

  function pintarSalud() {
    const info = $('sd-ultima');
    if (info) info.textContent = S.corrida
      ? `Última revisión: ${fechaHora(S.corrida.creado_en)} (${S.corrida.origen === 'auto' ? 'automática de la noche' : 'manual'}) · ${hace(S.corrida.creado_en)}`
      : 'Todavía no hay revisiones. Toca "Revisar ahora".';
    const todos = porNegocio(S.hallazgos);
    $('sd-stat-rojo').textContent = nf(todos.filter(g => g.rojos).length);
    $('sd-stat-amarillo').textContent = nf(todos.filter(g => !g.rojos && g.amarillos).length);
    $('sd-stat-nuevos').textContent = nf(S.hallazgos.filter(h => h.nuevo).length);
    $('sd-stat-monto').textContent = num(todos.reduce((s, g) => s + g.monto, 0));

    const grupos = porNegocio(filtrados());
    const cont = $('sd-lista');
    if (!S.corrida) { cont.innerHTML = '<div class="sd-vacio">Todavía no hay revisiones.</div>'; return; }
    if (!grupos.length) {
      cont.innerHTML = `<div class="sd-vacio">${S.hallazgos.length ? 'Nada coincide con el filtro.' : '✅ Todo en orden: ningún negocio tiene descuadres.'}</div>`;
      return;
    }
    cont.innerHTML = grupos.map(g => {
      const sem = g.rojos ? 'rojo' : 'amarillo';
      const abierto = S.abierto === g.id;
      return `<div class="sd-neg ${abierto ? 'abierto' : ''}">
        <button type="button" class="sd-neg-cab" data-sd-abrir="${esc(g.id)}" aria-expanded="${abierto}">
          <span class="sd-sem ${sem}" aria-hidden="true"></span>
          <span class="sd-neg-nom">${esc(g.negocio)}${g.nuevos ? ` <span class="sd-badge nuevo">${g.nuevos} nuevo${g.nuevos === 1 ? '' : 's'}</span>` : ''}</span>
          <span class="sd-neg-cnt">${g.rojos ? `<b class="t-rojo">${g.rojos}</b> de dinero` : ''}${g.rojos && g.amarillos ? ' · ' : ''}${g.amarillos ? `<b class="t-amarillo">${g.amarillos}</b> a revisar` : ''}</span>
          <span class="sd-neg-monto">${g.monto ? num(g.monto) : ''}</span>
          <span class="sd-flecha" aria-hidden="true">${abierto ? '▾' : '▸'}</span>
        </button>
        ${abierto ? pintarDetalle(g) : ''}
      </div>`;
    }).join('');
  }

  function pintarDetalle(g) {
    const porCheq = {};
    g.items.forEach(h => { (porCheq[h.chequeo] = porCheq[h.chequeo] || []).push(h); });
    return `<div class="sd-det">` + Object.keys(porCheq).map(c => {
      const it = porCheq[c];
      return `<div class="sd-cheq">
        <div class="sd-cheq-t"><span class="sd-sem ${it[0].nivel}" aria-hidden="true"></span> ${esc(tituloCheq(c))} <small>(${it.length})</small></div>
        <div class="sd-cheq-q">${esc((CHEQ[c] && CHEQ[c].q) || '')}</div>
        <div class="table-responsive"><table class="data-table sd-tabla"><thead><tr><th>Referencia</th><th>Fecha</th><th style="text-align:right">Monto</th><th>Detalle</th><th></th></tr></thead><tbody>
        ${it.slice(0, 100).map(h => `<tr>
          <td><b>${esc(h.referencia || '—')}</b>${h.nuevo ? ' <span class="sd-badge nuevo">nuevo</span>' : ''}</td>
          <td style="white-space:nowrap">${fecha(h.fecha)}</td>
          <td style="text-align:right;white-space:nowrap">${h.monto != null ? num(h.monto) : '—'}</td>
          <td class="sd-detalle">${esc(h.detalle || '')}</td>
          <td style="text-align:right">${h.ref_id ? `<button type="button" class="btn-icon btn-ghost btn-sm" data-sd-revisado="${esc(h.id)}" title="Ya lo revisé: no volver a mostrarlo">✓ Revisado</button>` : ''}</td>
        </tr>`).join('')}
        </tbody></table></div>${it.length > 100 ? `<div class="sd-mas">Mostrando 100 de ${it.length}.</div>` : ''}
      </div>`;
    }).join('') + `</div>`;
  }

  async function marcarRevisado(hid) {
    const h = S.hallazgos.find(x => x.id === hid); if (!h || !h.ref_id) return;
    const nota = prompt(`Marcar como revisado:\n${tituloCheq(h.chequeo)} — ${h.referencia || ''} (${h.negocio})\n\nNo se cambia nada del negocio: solo deja de mostrarse aquí.\n\nNota (opcional):`, '');
    if (nota === null) return;
    try {
      const { error } = await sb.from('admin_salud_revisados').upsert({ chequeo: h.chequeo, ref_id: h.ref_id, nota: nota.trim().slice(0, 300) || null, revisado_por: (typeof adminRecord !== 'undefined' && adminRecord && (adminRecord.nombre || adminRecord.email)) || 'admin' });
      if (error) throw error;
      S.hallazgos = S.hallazgos.filter(x => !(x.chequeo === h.chequeo && x.ref_id === h.ref_id));
      pintarSalud();
      aviso('Marcado como revisado', 'Ya no aparecerá en las próximas revisiones', 'success');
    } catch (e) { console.error(e); aviso('No se pudo marcar', e.message || '', 'error'); }
  }

  /* =========================================================
     2) ERRORES EN VIVO
     ========================================================= */
  const E = { filas: [], negocios: new Map(), abierto: null, cargando: false };

  async function cargarErrores() {
    if (E.cargando) return; E.cargando = true;
    const cont = $('er-lista');
    if (cont && !E.filas.length) cont.innerHTML = '<div class="sd-vacio">Cargando…</div>';
    try {
      const dias = Number($('er-rango')?.value || 7);
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      E.filas = [];
      for (let ini = 0; ini < 10000; ini += 1000) {
        const { data, error } = await sb.from('errores_cliente').select('*').gte('ultima_vez', desde)
          .order('ultima_vez', { ascending: false }).range(ini, ini + 999);
        if (error) throw error;
        E.filas.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const ids = [...new Set(E.filas.map(f => f.auth_user_id))].filter(id => !E.negocios.has(id));
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await sb.from('usuarios').select('auth_user_id, nombre_negocio, nombre').in('auth_user_id', ids.slice(i, i + 200));
        (data || []).forEach(u => E.negocios.set(u.auth_user_id, u.nombre_negocio || u.nombre || 'Cuenta'));
      }
      pintarErrores();
    } catch (e) {
      console.error('Errores en vivo:', e);
      if (cont) cont.innerHTML = '<div class="sd-vacio">No se pudieron cargar los errores.</div>';
    } finally { E.cargando = false; }
  }

  function agrupar() {
    const q = ($('er-buscar')?.value || '').trim().toLowerCase();
    const tipo = $('er-tipo')?.value || '';
    const verResueltos = $('er-resueltos')?.checked;
    const m = new Map();
    E.filas.forEach(f => {
      if (tipo && f.tipo !== tipo) return;
      if (!verResueltos && f.resuelto) return;
      const neg = E.negocios.get(f.auth_user_id) || 'Cuenta';
      if (q && ![f.mensaje, f.pagina, neg].join(' ').toLowerCase().includes(q)) return;
      if (!m.has(f.firma)) m.set(f.firma, { firma: f.firma, mensaje: f.mensaje, pagina: f.pagina, tipo: f.tipo, veces: 0, cuentas: new Set(), ultima: f.ultima_vez, primera: f.primera_vez, detalle: f.detalle, ua: f.user_agent, resuelto: true, ids: [] });
      const g = m.get(f.firma);
      g.veces += f.veces; g.cuentas.add(neg); g.ids.push(f.id);
      if (!f.resuelto) g.resuelto = false;
      if (f.ultima_vez > g.ultima) { g.ultima = f.ultima_vez; g.detalle = f.detalle || g.detalle; g.ua = f.user_agent || g.ua; }
      if (f.primera_vez < g.primera) g.primera = f.primera_vez;
    });
    return [...m.values()].sort((a, b) => (a.resuelto - b.resuelto) || (b.cuentas.size - a.cuentas.size) || (new Date(b.ultima) - new Date(a.ultima)));
  }

  const TIPO = { js: 'Error de la página', promesa: 'Error al procesar', aviso: 'Aviso rojo al usuario' };

  function pintarErrores() {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Managua' });
    const deHoy = E.filas.filter(f => f.dia === hoy);
    $('er-stat-hoy').textContent = nf(deHoy.reduce((s, f) => s + f.veces, 0));
    $('er-stat-cuentas').textContent = nf(new Set(deHoy.map(f => f.auth_user_id)).size);
    $('er-stat-abiertos').textContent = nf(new Set(E.filas.filter(f => !f.resuelto).map(f => f.firma)).size);
    const grupos = agrupar();
    const cont = $('er-lista');
    if (!grupos.length) {
      cont.innerHTML = `<div class="sd-vacio">${E.filas.length ? 'Nada coincide con el filtro.' : '✅ Ningún error registrado en este período.'}</div>`;
      return;
    }
    cont.innerHTML = grupos.map(g => {
      const ab = E.abierto === g.firma;
      const cuentas = [...g.cuentas];
      return `<div class="sd-neg ${ab ? 'abierto' : ''} ${g.resuelto ? 'resuelto' : ''}">
        <button type="button" class="sd-neg-cab" data-er-abrir="${esc(g.firma)}" aria-expanded="${ab}">
          <span class="sd-sem ${g.resuelto ? 'verde' : (g.tipo === 'aviso' ? 'amarillo' : 'rojo')}" aria-hidden="true"></span>
          <span class="sd-neg-nom er-msg">${esc(g.mensaje)}<small>${esc(g.pagina || '')} · ${esc(TIPO[g.tipo] || g.tipo)}</small></span>
          <span class="sd-neg-cnt"><b>${nf(g.veces)}</b> ${g.veces === 1 ? 'vez' : 'veces'} · <b>${cuentas.length}</b> negocio${cuentas.length === 1 ? '' : 's'}</span>
          <span class="sd-neg-monto">${hace(g.ultima)}</span>
          <span class="sd-flecha" aria-hidden="true">${ab ? '▾' : '▸'}</span>
        </button>
        ${ab ? `<div class="sd-det">
          <div class="er-fila"><b>Negocios afectados:</b> ${cuentas.map(esc).join(', ')}</div>
          <div class="er-fila"><b>Primera vez:</b> ${fechaHora(g.primera)} · <b>Última:</b> ${fechaHora(g.ultima)}</div>
          ${g.ua ? `<div class="er-fila"><b>Navegador:</b> ${esc(g.ua)}</div>` : ''}
          ${g.detalle ? `<pre class="er-pre">${esc(g.detalle)}</pre>` : ''}
          <div style="margin-top:10px">${g.resuelto
            ? '<span class="sd-badge ok">Marcado como resuelto</span>'
            : `<button type="button" class="btn-icon btn-primary btn-sm" data-er-resolver="${esc(g.firma)}">✓ Marcar como resuelto</button> <small style="color:var(--text-muted)">Si vuelve a pasar, se reabre solo.</small>`}</div>
        </div>` : ''}
      </div>`;
    }).join('');
  }

  async function resolver(firma) {
    try {
      const { error } = await sb.from('errores_cliente').update({ resuelto: true }).eq('firma', firma).eq('resuelto', false);
      if (error) throw error;
      E.filas.forEach(f => { if (f.firma === firma) f.resuelto = true; });
      pintarErrores();
      aviso('Marcado como resuelto', 'Si vuelve a pasar, aparecerá de nuevo', 'success');
    } catch (e) { console.error(e); aviso('No se pudo marcar', e.message || '', 'error'); }
  }

  /* ---------- Eventos ---------- */
  document.addEventListener('click', ev => {
    const t = ev.target.closest && ev.target.closest('[data-sd-abrir],[data-sd-revisado],[data-er-abrir],[data-er-resolver],#sd-revisar,#sd-actualizar,#er-actualizar');
    if (!t) return;
    if (t.id === 'sd-revisar') return revisarAhora();
    if (t.id === 'sd-actualizar') return cargarSalud();
    if (t.id === 'er-actualizar') return cargarErrores();
    if (t.dataset.sdRevisado) return marcarRevisado(t.dataset.sdRevisado);
    if (t.dataset.sdAbrir) { S.abierto = S.abierto === t.dataset.sdAbrir ? null : t.dataset.sdAbrir; return pintarSalud(); }
    if (t.dataset.erResolver) return resolver(t.dataset.erResolver);
    if (t.dataset.erAbrir) { E.abierto = E.abierto === t.dataset.erAbrir ? null : t.dataset.erAbrir; return pintarErrores(); }
  });
  document.addEventListener('input', ev => {
    const id = ev.target && ev.target.id;
    if (id === 'sd-buscar') pintarSalud();
    if (id === 'er-buscar') pintarErrores();
  });
  document.addEventListener('change', ev => {
    const id = ev.target && ev.target.id;
    if (id === 'sd-nivel' || id === 'sd-nuevos') pintarSalud();
    if (id === 'er-tipo' || id === 'er-resueltos') pintarErrores();
    if (id === 'er-rango') cargarErrores();
  });

  window.AdminSalud = { cargar: cargarSalud, revisarAhora, _S: S };
  window.AdminErrores = { cargar: cargarErrores, _E: E };
})();
