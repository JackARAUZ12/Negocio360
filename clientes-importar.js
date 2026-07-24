/* ============================================================
   CLIENTES-IMPORTAR.JS
   Importación masiva de Clientes desde las plantillas oficiales
   de Negocio360 (.xlsx) — una para clientes "Recurrente" y otra
   para clientes "Aleatorio".

   Mismo patrón que productos-importar.js: lector de Excel → DTO →
   validación → vista previa → importación (una sola transacción
   vía RPC; si algo falla, no se guarda nada).

   No modifica clientes.js. Reutiliza sus variables globales
   (sb, CS, showToast, cargarClientes, esc, fmt) porque ambos
   scripts corren en el mismo documento sin módulos ni IIFE.
   ============================================================ */
'use strict';

/* ============================================================
   1) CONFIGURACIÓN — debe calzar EXACTO con generar_plantillas_clientes.py
   ============================================================ */
const CI_COLS_COMUNES = ['Nombre', 'Apellido', 'Telefono', 'Email', 'Direccion', 'Ciudad', 'Empresa'];
const CI_COLS_ALEATORIO = [...CI_COLS_COMUNES, 'CanalAdquisicion', 'LimiteCredito', 'Notas', 'Observaciones', 'Etiquetas'];
const CI_COLS_RECURRENTE = [...CI_COLS_COMUNES, 'FrecuenciaPago', 'MontoRecurrente', 'DiaPago', 'LimiteCredito', 'Notas', 'Observaciones', 'Etiquetas'];

const CI_FIRMAS = {
  aleatorio: 'NEGOCIO360_PLANTILLA_CLIENTES_ALEATORIO_V1',
  recurrente: 'NEGOCIO360_PLANTILLA_CLIENTES_RECURRENTE_V1',
};
const CI_HOJAS = { aleatorio: 'ClientesAleatorio', recurrente: 'ClientesRecurrente' };
const CI_FRECUENCIAS_VALIDAS = ['mensual', 'semanal', 'quincenal', 'anual'];

const CI_STATE = {
  tipo: null,        // 'aleatorio' | 'recurrente'
  filasValidas: [],
  errores: [],
  preview: null,
  procesando: false,
};

/* ============================================================
   2) SERVICIO LECTOR DE EXCEL
   ============================================================ */
function ciLeerArchivoExcel(file, tipo) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('No se pudo cargar el lector de Excel. Recarga la página e intenta de nuevo.')); return; }
    if (!/\.xlsx$/i.test(file.name)) { reject(new Error('El archivo debe tener extensión .xlsx (la de la plantilla oficial).')); return; }

    const columnas = tipo === 'recurrente' ? CI_COLS_RECURRENTE : CI_COLS_ALEATORIO;
    const hoja = CI_HOJAS[tipo];
    const firmaEsperada = CI_FIRMAS[tipo];

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });

        const metaSheet = wb.Sheets['_plantilla_meta'];
        const firma = metaSheet ? metaSheet['B1']?.v : null;
        if (firma !== firmaEsperada) {
          const otraCosa = firma === CI_FIRMAS.aleatorio ? 'Aleatorio' : firma === CI_FIRMAS.recurrente ? 'Recurrente' : null;
          reject(new Error(otraCosa
            ? `Este archivo es la plantilla de clientes "${otraCosa}", pero elegiste importar "${tipo === 'recurrente' ? 'Recurrente' : 'Aleatorio'}". Descarga la plantilla correcta o cambia el tipo seleccionado.`
            : 'Este archivo no es una plantilla oficial de Negocio360. Descarga la plantilla actual y no cambies su estructura.'));
          return;
        }

        const sheet = wb.Sheets[hoja];
        if (!sheet) {
          reject(new Error(`El archivo no contiene la hoja "${hoja}" de la plantilla oficial.`));
          return;
        }

        const filasArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const encabezado = (filasArray[0] || []).map(h => String(h).trim());
        const encabezadoOk = columnas.every((col, i) => encabezado[i] === col);
        if (!encabezadoOk) {
          reject(new Error('Las columnas del archivo no coinciden con la plantilla oficial. Descarga la plantilla actual e intenta de nuevo sin modificar los encabezados.'));
          return;
        }

        const filas = [];
        for (let r = 1; r < filasArray.length; r++) {
          const arr = filasArray[r];
          const vacio = !arr || arr.every(v => v === '' || v === null || v === undefined);
          if (vacio) continue;
          const obj = { _filaExcel: r + 1 };
          columnas.forEach((col, i) => { obj[col] = arr[i] !== undefined ? arr[i] : ''; });
          filas.push(obj);
        }

        resolve(filas);
      } catch (err) {
        console.error('ciLeerArchivoExcel:', err);
        reject(new Error('No se pudo procesar el archivo. Verifica que sea un .xlsx válido de la plantilla oficial.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ============================================================
   3) SERVICIO DE VALIDACIÓN
   Solo el Nombre es obligatorio — todo lo demás se sube tal
   como esté (lleno o vacío), tal como se pidió.
   ============================================================ */
function ciEsVacio(v) { return v === '' || v === null || v === undefined; }
function ciNumeroValido(v) { const n = parseFloat(v); return !isNaN(n) && isFinite(n); }

function ciValidarFilas(filas, tipo) {
  const errores = [];
  const validas = [];

  filas.forEach(row => {
    const fila = row._filaExcel;
    const erroresFila = [];
    const agregarError = (campo, motivo) => erroresFila.push({ fila, campo, motivo });

    const nombre = String(row.Nombre || '').trim();
    if (!nombre) agregarError('Nombre', 'Campo obligatorio');

    // LimiteCredito: si se llena, debe ser numérico ≥ 0 (si no, se sube igual como 0)
    let limiteCredito = 0;
    if (!ciEsVacio(row.LimiteCredito)) {
      if (!ciNumeroValido(row.LimiteCredito) || parseFloat(row.LimiteCredito) < 0) {
        agregarError('LimiteCredito', 'Si se llena, debe ser un número ≥ 0');
      } else {
        limiteCredito = parseFloat(row.LimiteCredito);
      }
    }

    let frecuenciaPago = null, montoRecurrente = 0, diaPago = null;
    if (tipo === 'recurrente') {
      const frecRaw = String(row.FrecuenciaPago || '').trim().toLowerCase();
      if (frecRaw) {
        if (!CI_FRECUENCIAS_VALIDAS.includes(frecRaw)) {
          agregarError('FrecuenciaPago', 'Si se llena, debe ser: mensual, semanal, quincenal o anual');
        } else {
          frecuenciaPago = frecRaw;
        }
      }
      if (!ciEsVacio(row.MontoRecurrente)) {
        if (!ciNumeroValido(row.MontoRecurrente) || parseFloat(row.MontoRecurrente) < 0) {
          agregarError('MontoRecurrente', 'Si se llena, debe ser un número ≥ 0');
        } else {
          montoRecurrente = parseFloat(row.MontoRecurrente);
        }
      }
      if (!ciEsVacio(row.DiaPago)) {
        if (!ciNumeroValido(row.DiaPago) || !Number.isInteger(parseFloat(row.DiaPago))) {
          agregarError('DiaPago', 'Si se llena, debe ser un número entero');
        } else {
          diaPago = parseFloat(row.DiaPago);
        }
      }
    }

    if (erroresFila.length) {
      errores.push(...erroresFila);
      return;
    }

    validas.push({
      nombre,
      apellido: String(row.Apellido || '').trim() || null,
      telefono: String(row.Telefono || '').trim() || null,
      email: String(row.Email || '').trim() || null,
      direccion: String(row.Direccion || '').trim() || null,
      ciudad: String(row.Ciudad || '').trim() || null,
      empresa: String(row.Empresa || '').trim() || null,
      canal_adquisicion: tipo === 'aleatorio' ? (String(row.CanalAdquisicion || '').trim() || null) : null,
      limite_credito: limiteCredito,
      notas: String(row.Notas || '').trim() || null,
      observaciones: String(row.Observaciones || '').trim() || null,
      etiquetas: String(row.Etiquetas || '').trim() || null,
      tipo_cliente: tipo,
      frecuencia_pago: frecuenciaPago,
      monto_recurrente: montoRecurrente,
      dia_pago: diaPago,
    });
  });

  return { errores, validas };
}

/* ============================================================
   4) VISTA PREVIA
   ============================================================ */
function ciConstruirVistaPrevia(validas, tipo) {
  return {
    total: validas.length,
    tipo,
    conTelefono: validas.filter(v => v.telefono).length,
    conEmail: validas.filter(v => v.email).length,
  };
}

/* ============================================================
   5) IMPORTACIÓN (una sola llamada RPC = una sola transacción)
   ============================================================ */
async function ciEjecutarImportacion(validas) {
  const { data, error } = await sb.rpc('importar_clientes_masivo', { p_registros: validas });
  if (error) throw error;
  return data; // { ok, total, recurrentes, aleatorios }
}

/* ============================================================
   CONTROLADOR DE UI DEL MODAL
   ============================================================ */
function abrirModalImportarClientes() {
  CI_STATE.tipo = null;
  CI_STATE.filasValidas = [];
  CI_STATE.errores = [];
  CI_STATE.preview = null;
  CI_STATE.procesando = false;
  const inputFile = document.getElementById('inputImportarClientesExcel');
  if (inputFile) inputFile.value = '';
  ciRenderPasoElegirTipo();
  openModal('modal-importar-clientes');
}
function cerrarModalImportarClientes() {
  closeModal('modal-importar-clientes');
  const inputFile = document.getElementById('inputImportarClientesExcel');
  if (inputFile) inputFile.value = '';
}
window.abrirModalImportarClientes = abrirModalImportarClientes;
window.cerrarModalImportarClientes = cerrarModalImportarClientes;

function ciRenderPasoElegirTipo() {
  document.getElementById('ci-body').innerHTML = `
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px;line-height:1.6">
      Elige qué tipo de clientes vas a importar. Cada tipo tiene su propia plantilla —
      solo el <strong>Nombre</strong> es obligatorio, lo demás se sube tal como lo dejes
      (lleno o vacío).
    </p>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="ci-tipo-card" onclick="ciElegirTipo('aleatorio')">
        <div class="ci-tipo-icon">🧾</div>
        <div>
          <div class="ci-tipo-nombre">Clientes Aleatorio</div>
          <div class="ci-tipo-desc">Compra esporádica, sin ciclo de pago fijo</div>
        </div>
      </div>
      <div class="ci-tipo-card" onclick="ciElegirTipo('recurrente')">
        <div class="ci-tipo-icon">🔁</div>
        <div>
          <div class="ci-tipo-nombre">Clientes Recurrente</div>
          <div class="ci-tipo-desc">Paga bajo mensualidad/semanal/quincenal/anual</div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('ci-footer').innerHTML = `
    <button class="btn-ghost" onclick="cerrarModalImportarClientes()">Cerrar</button>
  `;
}
window.ciElegirTipo = function (tipo) {
  CI_STATE.tipo = tipo;
  ciRenderPasoInicial(tipo);
};

function ciRenderPasoInicial(tipo) {
  const archivo = tipo === 'recurrente' ? 'plantilla_clientes_recurrente_negocio360.xlsx' : 'plantilla_clientes_aleatorio_negocio360.xlsx';
  const label = tipo === 'recurrente' ? 'Recurrente' : 'Aleatorio';
  document.getElementById('ci-body').innerHTML = `
    <div style="text-align:center;padding:12px 8px">
      <div style="font-size:40px;margin-bottom:8px">📊</div>
      <h3 style="font-size:15px;font-weight:700;margin-bottom:6px">Importar clientes — ${label}</h3>
      <p style="font-size:13px;color:var(--text-secondary);max-width:440px;margin:0 auto 18px;line-height:1.6">
        Descarga la plantilla oficial, complétala (solo el Nombre es obligatorio) y súbela aquí.
        El sistema valida todo antes de guardar nada.
      </p>
      <a class="btn-secondary" href="${archivo}" download="${archivo}" style="margin-bottom:10px;display:inline-flex">
        📥 Descargar plantilla ${label}
      </a>
      <br/>
      <button class="btn-primary" style="margin-top:10px" onclick="document.getElementById('inputImportarClientesExcel').click()">
        📤 Seleccionar archivo .xlsx
      </button>
    </div>
  `;
  document.getElementById('ci-footer').innerHTML = `
    <button class="btn-ghost" onclick="ciRenderPasoElegirTipo()">← Cambiar tipo</button>
    <button class="btn-ghost" onclick="cerrarModalImportarClientes()">Cerrar</button>
  `;
}

function ciRenderPasoProcesando(mensaje) {
  document.getElementById('ci-body').innerHTML = `
    <div style="text-align:center;padding:40px 8px;color:var(--text-secondary)">
      <div class="loader-spinner" style="margin:0 auto 14px;border-color:rgba(90,90,244,.15);border-top-color:var(--accent)"></div>
      <p style="font-size:13.5px">${mensaje}</p>
    </div>`;
  document.getElementById('ci-footer').innerHTML = '';
}

function ciRenderPasoErrores(errores) {
  document.getElementById('ci-body').innerHTML = `
    <div style="margin-bottom:12px;padding:10px 14px;background:var(--danger-soft);border-radius:var(--radius-md);color:var(--danger);font-size:13px;font-weight:600">
      ⚠️ Se encontraron ${errores.length} error${errores.length===1?'':'es'}. No se importó ningún cliente — corrige el archivo e intenta de nuevo.
    </div>
    <div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md)">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead style="position:sticky;top:0;background:var(--bg-surface-2)">
          <tr><th style="text-align:left;padding:8px 10px">Fila</th><th style="text-align:left;padding:8px 10px">Campo</th><th style="text-align:left;padding:8px 10px">Motivo</th></tr>
        </thead>
        <tbody>
          ${errores.map(e => `<tr style="border-top:1px solid var(--border)">
            <td style="padding:7px 10px;font-weight:700;color:var(--accent)">${e.fila}</td>
            <td style="padding:7px 10px">${esc(e.campo)}</td>
            <td style="padding:7px 10px">${esc(e.motivo)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  document.getElementById('ci-footer').innerHTML = `
    <button class="btn-ghost" onclick="cerrarModalImportarClientes()">Cerrar</button>
    <button class="btn-primary" onclick="document.getElementById('inputImportarClientesExcel').click()">Elegir otro archivo</button>
  `;
}

function ciRenderPasoPreview(preview) {
  const tarjeta = (label, valor, color) => `
    <div style="flex:1;min-width:110px;background:var(--bg-surface-2);border-radius:var(--radius-md);padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${color}">${valor}</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${label}</div>
    </div>`;
  document.getElementById('ci-body').innerHTML = `
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--success-soft);border-radius:var(--radius-md);color:var(--success);font-size:13px;font-weight:600">
      ✅ El archivo es válido. Revisa el resumen antes de confirmar.
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${tarjeta('Clientes a importar', preview.total, 'var(--accent)')}
      ${tarjeta('Con teléfono', preview.conTelefono, 'var(--text-primary)')}
      ${tarjeta('Con email', preview.conEmail, 'var(--text-primary)')}
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:16px">
      Al confirmar, todos los registros se guardan en una sola operación: si algo fallara a mitad de camino, no queda nada guardado.
    </p>`;
  document.getElementById('ci-footer').innerHTML = `
    <button class="btn-ghost" onclick="cerrarModalImportarClientes()">Cancelar</button>
    <button class="btn-primary" onclick="ciConfirmarImportacionFinal()">✅ Confirmar importación</button>
  `;
}

function ciRenderPasoExito(resultado) {
  document.getElementById('ci-body').innerHTML = `
    <div style="text-align:center;padding:24px 8px">
      <div style="font-size:44px;margin-bottom:10px">🎉</div>
      <h3 style="font-size:15px;font-weight:700;margin-bottom:6px">¡Importación completada!</h3>
      <p style="font-size:13px;color:var(--text-secondary)">${resultado.total} cliente${resultado.total===1?'':'s'} agregado${resultado.total===1?'':'s'}</p>
    </div>`;
  document.getElementById('ci-footer').innerHTML = `<button class="btn-primary" onclick="cerrarModalImportarClientes()">Listo</button>`;
}

async function ciOnArchivoSeleccionado(ev) {
  const file = ev.target.files?.[0];
  if (!file || !CI_STATE.tipo) return;
  ciRenderPasoProcesando('Leyendo y validando el archivo…');
  try {
    const filas = await ciLeerArchivoExcel(file, CI_STATE.tipo);
    if (!filas.length) {
      ciRenderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: 'No se encontraron filas con datos para importar' }]);
      return;
    }
    const { errores, validas } = ciValidarFilas(filas, CI_STATE.tipo);
    CI_STATE.errores = errores;
    CI_STATE.filasValidas = validas;
    if (errores.length) { ciRenderPasoErrores(errores); return; }
    const preview = ciConstruirVistaPrevia(validas, CI_STATE.tipo);
    CI_STATE.preview = preview;
    ciRenderPasoPreview(preview);
  } catch (e) {
    console.error('ciOnArchivoSeleccionado:', e);
    ciRenderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: e.message || 'No se pudo procesar el archivo' }]);
  } finally {
    ev.target.value = '';
  }
}
window.ciOnArchivoSeleccionado = ciOnArchivoSeleccionado;

async function ciConfirmarImportacionFinal() {
  if (CI_STATE.procesando) return;
  CI_STATE.procesando = true;
  ciRenderPasoProcesando('Importando clientes… esto puede tardar unos segundos.');
  try {
    const resultado = await ciEjecutarImportacion(CI_STATE.filasValidas);
    ciRenderPasoExito(resultado);
    showToast(`${resultado.total} clientes importados correctamente`, 'success');
    if (typeof loadClientes === 'function') await loadClientes();
    if (typeof loadKPIs === 'function') await loadKPIs();
  } catch (e) {
    console.error('ciConfirmarImportacionFinal:', e);
    ciRenderPasoErrores([{ fila: '—', campo: 'Importación', motivo: 'No se pudo completar la importación. No se guardó ningún registro. Detalle: ' + (e.message || 'error desconocido') }]);
  } finally {
    CI_STATE.procesando = false;
  }
}
window.ciConfirmarImportacionFinal = ciConfirmarImportacionFinal;
