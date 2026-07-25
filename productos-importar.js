/* ============================================================
   PRODUCTOS-IMPORTAR.JS
   Importación masiva de Productos/Servicios desde las plantillas
   oficiales de Negocio360 (.xlsx).

   Hay DOS plantillas oficiales, cada una con sus propias columnas:
     - "Precio fijo"        → un único PrecioVenta por registro.
     - "Escala de precios"  → hasta 5 escalas (Nombre + Precio) por registro.
   El sistema detecta automáticamente cuál de las dos subió el usuario
   (por una firma oculta dentro del archivo) y valida/importa según
   corresponda. No es necesario elegir nada manualmente.

   Módulo independiente y separado por responsabilidad:
     1) Servicio lector de Excel   → leerArchivoExcel()
     2) Servicio de validación     → validarFilas()
     3) Servicio de vista previa   → construirVistaPrevia()
     4) Reporte de errores         → (usa los errores de validarFilas)
     5) Servicio de importación    → ejecutarImportacion()

   No modifica productos.js. Reutiliza sus variables globales
   (supabaseClient, STATE, showToast, cargarProductos, etc.) porque
   ambos scripts corren en el mismo documento sin módulos ni IIFE.
   ============================================================ */
'use strict';

/* ============================================================
   1) CONFIGURACIÓN — debe calzar EXACTO con generar_plantillas.py
   ============================================================ */
const IMPORT_MAX_ESCALAS = 5;

const IMPORT_PLANTILLAS = {
  FIJO: {
    firma: 'NEGOCIO360_PLANTILLA_PRODUCTOS_FIJO_V1',
    nombre: 'Precio fijo',
    columnas: [
      'TipoRegistro', 'Nombre', 'Descripcion', 'Categoria', 'SKU',
      'MarcaProveedor', 'CodigoBarras', 'Costo', 'PrecioVenta',
      'StockInicial', 'StockMinimo',
    ],
  },
  ESCALA: {
    firma: 'NEGOCIO360_PLANTILLA_PRODUCTOS_ESCALA_V1',
    nombre: 'Escala de precios',
    columnas: (() => {
      const base = ['TipoRegistro', 'Nombre', 'Descripcion', 'Categoria', 'SKU',
                    'MarcaProveedor', 'CodigoBarras', 'Costo'];
      for (let n = 1; n <= IMPORT_MAX_ESCALAS; n++) base.push('Escala' + n + 'Nombre', 'Escala' + n + 'Precio');
      base.push('StockInicial', 'StockMinimo');
      return base;
    })(),
  },
};

const IMPORT_STATE = {
  filasValidas: [],   // DTOs listos para enviar al RPC
  errores: [],        // [{fila, campo, motivo}]
  preview: null,
  procesando: false,
  tipoPlantilla: null, // 'FIJO' | 'ESCALA'
};

/* ============================================================
   2) SERVICIO LECTOR DE EXCEL
   Detecta automáticamente cuál plantilla oficial es (por firma
   oculta) y valida que sus encabezados coincidan exactamente.
   ============================================================ */
function detectarPlantilla(wb) {
  const metaSheet = wb.Sheets['_plantilla_meta'];
  const firma = metaSheet ? metaSheet['B1']?.v : null;
  if (!firma) return null;
  return Object.keys(IMPORT_PLANTILLAS).find(key => IMPORT_PLANTILLAS[key].firma === firma) || null;
}

function leerArchivoExcel(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('No se pudo cargar el lector de Excel. Recarga la página e intenta de nuevo.')); return; }
    if (!/\.xlsx$/i.test(file.name)) { reject(new Error('El archivo debe tener extensión .xlsx (la de alguna de las plantillas oficiales).')); return; }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });

        const tipoPlantilla = detectarPlantilla(wb);
        if (!tipoPlantilla) {
          reject(new Error('Este archivo no es ninguna de las plantillas oficiales de Negocio360. Descarga la plantilla "Precio fijo" o "Escala de precios" con el botón "📥 Descargar plantilla" y no cambies su estructura.'));
          return;
        }
        const plantilla = IMPORT_PLANTILLAS[tipoPlantilla];

        const sheet = wb.Sheets['Productos'];
        if (!sheet) {
          reject(new Error('El archivo no contiene la hoja "Productos" de la plantilla "' + plantilla.nombre + '".'));
          return;
        }

        // Encabezados (fila 1) — deben coincidir exacto, en el mismo orden
        const filasArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const encabezado = (filasArray[0] || []).map(h => String(h).trim());
        const encabezadoOk = plantilla.columnas.every((col, i) => encabezado[i] === col);
        if (!encabezadoOk) {
          reject(new Error('Las columnas del archivo no coinciden con la plantilla "' + plantilla.nombre + '". Descarga la plantilla actual e intenta de nuevo sin modificar los encabezados.'));
          return;
        }

        // Filas de datos → objetos con nombre de columna, ignorando filas vacías
        const filas = [];
        for (let r = 1; r < filasArray.length; r++) {
          const arr = filasArray[r];
          const vacio = !arr || arr.every(v => v === '' || v === null || v === undefined);
          if (vacio) continue;
          const obj = { _filaExcel: r + 1 }; // fila 1 = encabezado, así que datos empiezan en fila 2
          plantilla.columnas.forEach((col, i) => { obj[col] = arr[i] !== undefined ? arr[i] : ''; });
          filas.push(obj);
        }

        resolve({ tipoPlantilla, filas });
      } catch (err) {
        console.error('leerArchivoExcel:', err);
        reject(new Error('No se pudo procesar el archivo. Verifica que sea un .xlsx válido de alguna plantilla oficial.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ============================================================
   3) SERVICIO DE VALIDACIÓN
   Aplica todas las reglas del negocio y arma el reporte de errores
   fila por fila, además de las filas válidas ya normalizadas (DTO).
   Las reglas de precio cambian según tipoPlantilla ('FIJO'/'ESCALA'),
   ya que cada plantilla solo trae las columnas que le corresponden.
   ============================================================ */
function esVacio(v) { return v === '' || v === null || v === undefined; }
function numeroValido(v) { const n = parseFloat(v); return !isNaN(n) && isFinite(n); }

function validarFilas(filas, tipoPlantilla) {
  const errores = [];
  const validas = [];
  const esEscala = tipoPlantilla === 'ESCALA';

  // Para detectar SKU duplicado dentro del propio archivo
  const skusEnArchivo = new Set();
  // SKUs ya existentes en el catálogo del usuario (cache ya cargado por productos.js)
  const skusExistentes = new Set(
    (STATE.productos || []).filter(p => p.sku).map(p => p.sku.trim().toLowerCase())
  );

  filas.forEach(row => {
    const fila = row._filaExcel;
    const erroresFila = [];
    const agregarError = (campo, motivo) => erroresFila.push({ fila, campo, motivo });

    // --- TipoRegistro ---
    const tipoRegistroRaw = String(row.TipoRegistro || '').trim().toUpperCase();
    if (!['PRODUCTO', 'SERVICIO'].includes(tipoRegistroRaw)) {
      agregarError('TipoRegistro', 'Debe ser PRODUCTO o SERVICIO');
    }
    const esProducto = tipoRegistroRaw === 'PRODUCTO';

    // --- Nombre ---
    const nombre = String(row.Nombre || '').trim();
    if (!nombre) agregarError('Nombre', 'Campo obligatorio');

    // --- Costo ---
    const costoRaw = row.Costo;
    let costo = 0;
    if (esVacio(costoRaw) || !numeroValido(costoRaw) || parseFloat(costoRaw) < 0) {
      agregarError('Costo', 'Debe ser un número decimal mayor o igual a 0');
    } else {
      costo = parseFloat(costoRaw);
    }

    // --- Precio (FIJO) o Escalas (ESCALA) — según la plantilla usada ---
    let precioVenta = 0;
    const escalas = [];

    if (!esEscala) {
      // Plantilla "Precio fijo"
      if (esVacio(row.PrecioVenta) || !numeroValido(row.PrecioVenta) || parseFloat(row.PrecioVenta) < 0) {
        agregarError('PrecioVenta', 'PrecioVenta es obligatorio y debe ser ≥ 0');
      } else {
        precioVenta = parseFloat(row.PrecioVenta);
      }
    } else {
      // Plantilla "Escala de precios"
      for (let n = 1; n <= IMPORT_MAX_ESCALAS; n++) {
        const nomRaw = row['Escala' + n + 'Nombre'];
        const precRaw = row['Escala' + n + 'Precio'];
        const nomLlena = !esVacio(nomRaw) && String(nomRaw).trim() !== '';
        const precLlena = !esVacio(precRaw);
        if (!nomLlena && !precLlena) continue; // no se llenó esta escala, se omite

        if (nomLlena !== precLlena) {
          agregarError('Escala' + n, 'Escala ' + n + ' incompleta (falta Nombre o Precio)');
          continue;
        }
        if (!numeroValido(precRaw) || parseFloat(precRaw) < 0) {
          agregarError('Escala' + n + 'Precio', 'Escala ' + n + ': el precio debe ser un número ≥ 0');
          continue;
        }
        escalas.push({
          nombre: String(nomRaw).trim(),
          precio: parseFloat(precRaw),
          orden: n - 1,
        });
      }
      if (!escalas.length) {
        agregarError('Escalas', 'Agrega al menos una escala completa (Nombre y Precio)');
      }
    }

    // --- SKU (opcional, único) ---
    const sku = String(row.SKU || '').trim();
    if (sku) {
      const skuKey = sku.toLowerCase();
      if (skusEnArchivo.has(skuKey)) {
        agregarError('SKU', 'SKU duplicado dentro del archivo');
      } else if (skusExistentes.has(skuKey)) {
        agregarError('SKU', 'SKU duplicado: ya existe en tu catálogo');
      }
      skusEnArchivo.add(skuKey);
    }

    // --- Stock (solo aplica a productos; se ignora en servicios) ---
    let stockInicial = 0, stockMinimo = 0;
    if (esProducto) {
      if (!esVacio(row.StockInicial)) {
        if (!numeroValido(row.StockInicial) || parseFloat(row.StockInicial) < 0 || !Number.isInteger(parseFloat(row.StockInicial))) {
          agregarError('StockInicial', 'Debe ser un número entero mayor o igual a 0');
        } else {
          stockInicial = parseFloat(row.StockInicial);
        }
      }
      if (!esVacio(row.StockMinimo)) {
        if (!numeroValido(row.StockMinimo) || parseFloat(row.StockMinimo) < 0 || !Number.isInteger(parseFloat(row.StockMinimo))) {
          agregarError('StockMinimo', 'Debe ser un número entero mayor o igual a 0');
        } else {
          stockMinimo = parseFloat(row.StockMinimo);
        }
      }
    }

    if (erroresFila.length) {
      errores.push(...erroresFila);
      return; // esta fila no se agrega a "validas"
    }

    // --- DTO normalizado (idéntico sin importar de qué plantilla vino) ---
    validas.push({
      tipo:             esProducto ? 'producto' : 'servicio',
      nombre,
      descripcion:      String(row.Descripcion || '').trim() || null,
      categoria:        String(row.Categoria || '').trim() || null,
      sku:              sku || null,
      marca_proveedor:  String(row.MarcaProveedor || '').trim() || null,
      codigo_barras:    String(row.CodigoBarras || '').trim() || null,
      costo,
      tipo_precio:      esEscala ? 'escala' : 'fijo',
      precio:           esEscala ? 0 : precioVenta,
      escalas:          esEscala ? escalas : [],
      stock_actual:     esProducto ? stockInicial : 0,
      stock_minimo:     esProducto ? stockMinimo : 0,
    });
  });

  return { errores, validas };
}

/* ============================================================
   4) SERVICIO DE VISTA PREVIA
   ============================================================ */
function construirVistaPrevia(validas) {
  const categoriasExistentes = new Set(
    (STATE.productos || []).filter(p => p.categoria).map(p => p.categoria.trim().toLowerCase())
  );
  const marcasExistentes = new Set(
    (STATE.proveedores || []).map(p => p.nombre.trim().toLowerCase())
  );

  const categoriasNuevas = new Set();
  const marcasNuevas = new Set();
  let productos = 0, servicios = 0;

  validas.forEach(v => {
    if (v.tipo === 'producto') productos++; else servicios++;
    if (v.categoria && !categoriasExistentes.has(v.categoria.toLowerCase())) categoriasNuevas.add(v.categoria.toLowerCase());
    if (v.marca_proveedor && !marcasExistentes.has(v.marca_proveedor.toLowerCase())) marcasNuevas.add(v.marca_proveedor.toLowerCase());
  });

  return {
    total: validas.length,
    productos,
    servicios,
    categoriasNuevas: categoriasNuevas.size,
    marcasNuevas: marcasNuevas.size,
  };
}

/* ============================================================
   5) SERVICIO DE IMPORTACIÓN
   Una sola llamada RPC = una sola transacción en la base de datos.
   Si cualquier registro falla, NADA queda guardado.
   ============================================================ */
async function ejecutarImportacion(validas) {
  const payload = validas.map(v => ({
    tipo:            v.tipo,
    nombre:          v.nombre,
    descripcion:     v.descripcion,
    categoria:       v.categoria,
    sku:             v.sku,
    marca_proveedor: v.marca_proveedor,
    codigo_barras:   v.codigo_barras,
    costo:           v.costo,
    tipo_precio:     v.tipo_precio,
    precio:          v.precio,
    escalas:         v.escalas,
    stock_actual:    v.stock_actual,
    stock_minimo:    v.stock_minimo,
  }));

  const { data, error } = await supabaseClient.rpc('importar_productos_masivo', { p_registros: payload });
  if (error) throw error;
  return data; // { ok, productos, servicios, marcas_creadas }
}

/* ============================================================
   CONTROLADOR DE UI DEL MODAL
   ============================================================ */
function abrirModalImportar() {
  IMPORT_STATE.filasValidas = [];
  IMPORT_STATE.errores = [];
  IMPORT_STATE.preview = null;
  IMPORT_STATE.procesando = false;
  IMPORT_STATE.tipoPlantilla = null;
  const inputFile = document.getElementById('inputImportarExcel');
  if (inputFile) inputFile.value = '';
  renderPasoInicial();
  document.getElementById('modalImportar').classList.add('open');
}
function cerrarModalImportar() {
  document.getElementById('modalImportar').classList.remove('open');
  document.getElementById('inputImportarExcel').value = '';
}
window.abrirModalImportar = abrirModalImportar;
window.cerrarModalImportar = cerrarModalImportar;

function renderPasoInicial() {
  document.getElementById('importarBody').innerHTML = `
    <div style="text-align:center;padding:16px 8px">
      <div style="font-size:40px;margin-bottom:8px">📊</div>
      <h3 style="font-size:15px;font-weight:700;margin-bottom:6px">Importa muchos productos o servicios a la vez</h3>
      <p style="font-size:13px;color:var(--text-secondary);max-width:440px;margin:0 auto 20px;line-height:1.6">
        Solo se aceptan las <strong>plantillas oficiales de Negocio360</strong>: "Precio fijo" o
        "Escala de precios" (botón "📥 Descargar plantilla"). El sistema detecta solo cuál de las
        dos subiste y valida todo antes de guardar nada — si algún registro tiene un error, no se
        importa ningún producto hasta que lo corrijas.
      </p>
      <button class="btn btn-primary" onclick="document.getElementById('inputImportarExcel').click()">
        📤 Seleccionar archivo .xlsx
      </button>
    </div>
  `;
  document.getElementById('importarFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="cerrarModalImportar()">Cerrar</button>
  `;
}

function renderPasoProcesando(mensaje) {
  document.getElementById('importarBody').innerHTML = `
    <div style="text-align:center;padding:40px 8px;color:var(--text-secondary)">
      <div class="loader-spinner" style="margin:0 auto 14px;border-color:rgba(90,90,244,0.15);border-top-color:var(--accent)"></div>
      <p style="font-size:13.5px">${mensaje}</p>
    </div>
  `;
  document.getElementById('importarFooter').innerHTML = '';
}

function renderPasoErrores(errores) {
  document.getElementById('importarBody').innerHTML = `
    <div style="margin-bottom:12px;padding:10px 14px;background:var(--danger-soft, #FEE2E2);border-radius:var(--radius-md);color:var(--danger);font-size:13px;font-weight:600">
      ⚠️ Se encontraron ${errores.length} error${errores.length===1?'':'es'}. No se importó ningún registro — corrige el archivo y vuelve a intentarlo.
    </div>
    <div style="max-height:360px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md)">
      <table style="width:100%;border-collapse:collapse;font-size:12.5px">
        <thead style="position:sticky;top:0;background:var(--bg-app)">
          <tr>
            <th style="text-align:left;padding:8px 10px">Fila</th>
            <th style="text-align:left;padding:8px 10px">Campo</th>
            <th style="text-align:left;padding:8px 10px">Motivo</th>
          </tr>
        </thead>
        <tbody>
          ${errores.map(e => `
            <tr style="border-top:1px solid var(--border)">
              <td style="padding:7px 10px;font-weight:700;color:var(--accent)">${e.fila}</td>
              <td style="padding:7px 10px">${escHtml(e.campo)}</td>
              <td style="padding:7px 10px">${escHtml(e.motivo)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('importarFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="cerrarModalImportar()">Cerrar</button>
    <button class="btn btn-primary" onclick="document.getElementById('inputImportarExcel').click()">Elegir otro archivo</button>
  `;
}

function renderPasoPreview(preview, tipoPlantilla) {
  const tarjeta = (label, valor, color) => `
    <div style="flex:1;min-width:120px;background:var(--bg-app);border-radius:var(--radius-md);padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${color}">${valor}</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${label}</div>
    </div>`;
  const nombrePlantilla = (IMPORT_PLANTILLAS[tipoPlantilla] && IMPORT_PLANTILLAS[tipoPlantilla].nombre) || tipoPlantilla;

  document.getElementById('importarBody').innerHTML = `
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--success-soft, #DCFCE7);border-radius:var(--radius-md);color:var(--success);font-size:13px;font-weight:600">
      ✅ El archivo es válido (plantilla "${escHtml(nombrePlantilla)}"). Revisa el resumen antes de confirmar.
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${tarjeta('Registros totales', preview.total, 'var(--accent)')}
      ${tarjeta('Productos', preview.productos, 'var(--text-primary)')}
      ${tarjeta('Servicios', preview.servicios, 'var(--text-primary)')}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${tarjeta('Categorías nuevas', preview.categoriasNuevas, '#F59E0B')}
      ${tarjeta('Marcas/Proveedores nuevos', preview.marcasNuevas, '#F59E0B')}
    </div>
    <p style="font-size:12px;color:var(--text-muted);margin-top:16px">
      Al confirmar, todos los registros se guardan en una sola operación: si algo fallara a mitad de camino, no queda nada guardado.
    </p>
  `;
  document.getElementById('importarFooter').innerHTML = `
    <button class="btn btn-secondary" onclick="cerrarModalImportar()">Cancelar</button>
    <button class="btn btn-primary" onclick="confirmarImportacionFinal()">✅ Confirmar importación</button>
  `;
}

function renderPasoExito(resultado) {
  document.getElementById('importarBody').innerHTML = `
    <div style="text-align:center;padding:24px 8px">
      <div style="font-size:44px;margin-bottom:10px">🎉</div>
      <h3 style="font-size:15px;font-weight:700;margin-bottom:6px">¡Importación completada!</h3>
      <p style="font-size:13px;color:var(--text-secondary)">
        ${resultado.productos} producto${resultado.productos===1?'':'s'} y ${resultado.servicios} servicio${resultado.servicios===1?'':'s'} agregados
        ${resultado.marcas_creadas ? '· ' + resultado.marcas_creadas + ' marca' + (resultado.marcas_creadas===1?'':'s') + '/proveedor' + (resultado.marcas_creadas===1?'':'es') + ' nuevos' : ''}
      </p>
    </div>
  `;
  document.getElementById('importarFooter').innerHTML = `
    <button class="btn btn-primary" onclick="cerrarModalImportar()">Listo</button>
  `;
}

/* ============================================================
   EVENTO: archivo seleccionado
   ============================================================ */
async function onArchivoImportSeleccionado(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;

  renderPasoProcesando('Leyendo y validando el archivo…');

  try {
    const { tipoPlantilla, filas } = await leerArchivoExcel(file);
    IMPORT_STATE.tipoPlantilla = tipoPlantilla;

    if (!filas.length) {
      renderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: 'No se encontraron filas con datos para importar' }]);
      return;
    }

    const { errores, validas } = validarFilas(filas, tipoPlantilla);
    IMPORT_STATE.errores = errores;
    IMPORT_STATE.filasValidas = validas;

    if (errores.length) {
      renderPasoErrores(errores);
      return;
    }

    const preview = construirVistaPrevia(validas);
    IMPORT_STATE.preview = preview;
    renderPasoPreview(preview, tipoPlantilla);

  } catch (e) {
    console.error('onArchivoImportSeleccionado:', e);
    renderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: e.message || 'No se pudo procesar el archivo' }]);
  } finally {
    ev.target.value = ''; // permite volver a elegir el mismo archivo si hace falta
  }
}
window.onArchivoImportSeleccionado = onArchivoImportSeleccionado;

async function confirmarImportacionFinal() {
  if (IMPORT_STATE.procesando) return;
  IMPORT_STATE.procesando = true;
  renderPasoProcesando('Importando registros… esto puede tardar unos segundos.');

  try {
    const resultado = await ejecutarImportacion(IMPORT_STATE.filasValidas);
    renderPasoExito(resultado);
    showToast('success', 'Importación completada', resultado.productos + ' productos y ' + resultado.servicios + ' servicios agregados');

    // Refrescar el catálogo, escalas y marcas para reflejar lo recién importado
    await Promise.all([cargarProductos(), cargarEscalas()]);
    cargarProveedores();

  } catch (e) {
    console.error('confirmarImportacionFinal:', e);
    renderPasoErrores([{
      fila: '—', campo: 'Importación',
      motivo: 'No se pudo completar la importación. No se guardó ningún registro. Detalle: ' + (e.message || 'error desconocido'),
    }]);
  } finally {
    IMPORT_STATE.procesando = false;
  }
}
window.confirmarImportacionFinal = confirmarImportacionFinal;
