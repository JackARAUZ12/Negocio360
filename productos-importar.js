/* ============================================================
   PRODUCTOS-IMPORTAR.JS
   Importación masiva de Productos/Servicios desde la plantilla
   oficial de Negocio360 (.xlsx).

   Módulo independiente y separado por responsabilidad, tal como
   se pidió en la arquitectura:
     1) Servicio lector de Excel   → leerArchivoExcel()
     2) DTO de importación         → filaAJson() / construirPayloadRpc()
     3) Servicio de validación     → validarFilas()
     4) Servicio de vista previa   → construirVistaPrevia()
     5) Reporte de errores         → (usa los errores de validarFilas)
     6) Servicio de importación    → ejecutarImportacion()

   No modifica productos.js. Reutiliza sus variables globales
   (supabaseClient, STATE, showToast, cargarProductos, etc.) porque
   ambos scripts corren en el mismo documento sin módulos ni IIFE.
   ============================================================ */
'use strict';

/* ============================================================
   1) CONFIGURACIÓN — debe calzar EXACTO con generar_plantilla.py
   ============================================================ */
const IMPORT_COLUMNAS = [
  'TipoRegistro', 'Nombre', 'Descripcion', 'Categoria', 'SKU',
  'MarcaProveedor', 'CodigoBarras', 'Costo', 'TipoPrecio', 'PrecioVenta',
  'Escala1Cantidad', 'Escala1Precio', 'Escala2Cantidad', 'Escala2Precio',
  'Escala3Cantidad', 'Escala3Precio', 'Escala4Cantidad', 'Escala4Precio',
  'Escala5Cantidad', 'Escala5Precio', 'StockInicial', 'StockMinimo',
];
const IMPORT_FIRMA_PLANTILLA = 'NEGOCIO360_PLANTILLA_PRODUCTOS_V1';
const IMPORT_MAX_ESCALAS = 5;

const IMPORT_STATE = {
  filasValidas: [],   // DTOs listos para enviar al RPC
  errores: [],        // [{fila, campo, motivo}]
  preview: null,
  procesando: false,
};

/* ============================================================
   2) SERVICIO LECTOR DE EXCEL
   Solo acepta la plantilla oficial: valida firma oculta + encabezados.
   ============================================================ */
function leerArchivoExcel(file) {
  return new Promise((resolve, reject) => {
    if (!window.XLSX) { reject(new Error('No se pudo cargar el lector de Excel. Recarga la página e intenta de nuevo.')); return; }
    if (!/\.xlsx$/i.test(file.name)) { reject(new Error('El archivo debe tener extensión .xlsx (la de la plantilla oficial).')); return; }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });

        // Firma de plantilla oficial (hoja muy oculta)
        const metaSheet = wb.Sheets['_plantilla_meta'];
        const firma = metaSheet ? metaSheet['B1']?.v : null;
        if (firma !== IMPORT_FIRMA_PLANTILLA) {
          reject(new Error('Este archivo no es la plantilla oficial de Negocio360. Descarga la plantilla actual con el botón "📥 Descargar plantilla" y no cambies su estructura.'));
          return;
        }

        const sheet = wb.Sheets['Productos'];
        if (!sheet) {
          reject(new Error('El archivo no contiene la hoja "Productos" de la plantilla oficial.'));
          return;
        }

        // Encabezados (fila 1) — deben coincidir exacto, en el mismo orden
        const filasArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const encabezado = (filasArray[0] || []).map(h => String(h).trim());
        const encabezadoOk = IMPORT_COLUMNAS.every((col, i) => encabezado[i] === col);
        if (!encabezadoOk) {
          reject(new Error('Las columnas del archivo no coinciden con la plantilla oficial. Descarga la plantilla actual e intenta de nuevo sin modificar los encabezados.'));
          return;
        }

        // Filas de datos → objetos con nombre de columna, ignorando filas vacías
        const filas = [];
        for (let r = 1; r < filasArray.length; r++) {
          const arr = filasArray[r];
          const vacio = !arr || arr.every(v => v === '' || v === null || v === undefined);
          if (vacio) continue;
          const obj = { _filaExcel: r + 1 }; // fila 1 = encabezado, así que datos empiezan en fila 2
          IMPORT_COLUMNAS.forEach((col, i) => { obj[col] = arr[i] !== undefined ? arr[i] : ''; });
          filas.push(obj);
        }

        resolve(filas);
      } catch (err) {
        console.error('leerArchivoExcel:', err);
        reject(new Error('No se pudo procesar el archivo. Verifica que sea un .xlsx válido de la plantilla oficial.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ============================================================
   3) SERVICIO DE VALIDACIÓN
   Aplica todas las reglas del negocio y arma el reporte de errores
   fila por fila, además de las filas válidas ya normalizadas (DTO).
   ============================================================ */
function esVacio(v) { return v === '' || v === null || v === undefined; }
function numeroValido(v) { const n = parseFloat(v); return !isNaN(n) && isFinite(n); }

function validarFilas(filas) {
  const errores = [];
  const validas = [];

  // Para detectar SKU duplicado dentro del propio archivo
  const skusEnArchivo = new Set();
  // SKUs y marcas ya existentes en el catálogo del usuario (cache ya cargado por productos.js)
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

    // --- TipoPrecio ---
    const tipoPrecioRaw = String(row.TipoPrecio || '').trim().toUpperCase();
    if (!['FIJO', 'ESCALA'].includes(tipoPrecioRaw)) {
      agregarError('TipoPrecio', 'Debe ser FIJO o ESCALA');
    }
    const esEscala = tipoPrecioRaw === 'ESCALA';

    // --- PrecioVenta (solo si FIJO) ---
    let precioVenta = 0;
    if (tipoPrecioRaw === 'FIJO') {
      if (esVacio(row.PrecioVenta) || !numeroValido(row.PrecioVenta) || parseFloat(row.PrecioVenta) < 0) {
        agregarError('PrecioVenta', 'PrecioVenta requerido (≥ 0) cuando TipoPrecio = FIJO');
      } else {
        precioVenta = parseFloat(row.PrecioVenta);
      }
    }

    // --- Escalas (solo si ESCALA; se ignoran por completo si FIJO) ---
    const escalas = [];
    if (esEscala) {
      for (let n = 1; n <= IMPORT_MAX_ESCALAS; n++) {
        const cRaw = row[`Escala${n}Cantidad`];
        const pRaw = row[`Escala${n}Precio`];
        const cLlena = !esVacio(cRaw);
        const pLlena = !esVacio(pRaw);
        if (!cLlena && !pLlena) continue; // no se llenó esta escala, se omite

        if (cLlena !== pLlena) {
          agregarError(`Escala${n}`, `Escala ${n} incompleta (falta Cantidad o Precio)`);
          continue;
        }
        if (!numeroValido(cRaw) || parseFloat(cRaw) <= 0) {
          agregarError(`Escala${n}Cantidad`, `Escala ${n}: la cantidad debe ser mayor a 0`);
          continue;
        }
        if (!numeroValido(pRaw) || parseFloat(pRaw) < 0) {
          agregarError(`Escala${n}Precio`, `Escala ${n}: el precio debe ser mayor o igual a 0`);
          continue;
        }
        const cantidad = parseFloat(cRaw);
        escalas.push({
          cantidad,
          precio: parseFloat(pRaw),
          nombre: `Desde ${cantidad % 1 === 0 ? cantidad : cantidad.toFixed(2)} unidades`,
          orden: n - 1,
        });
      }
      if (!escalas.length) {
        agregarError('Escalas', 'Agrega al menos una escala completa (Cantidad y Precio) cuando TipoPrecio = ESCALA');
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

    // --- DTO normalizado ---
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
   6) SERVICIO DE IMPORTACIÓN
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
        Solo se acepta la <strong>plantilla oficial de Negocio360</strong>. Descárgala, complétala
        y súbela aquí. El sistema valida todo antes de guardar nada — si algún registro tiene un
        error, no se importa ningún producto hasta que lo corrijas.
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

function renderPasoPreview(preview) {
  const tarjeta = (label, valor, color) => `
    <div style="flex:1;min-width:120px;background:var(--bg-app);border-radius:var(--radius-md);padding:14px;text-align:center">
      <div style="font-size:22px;font-weight:800;color:${color}">${valor}</div>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:2px">${label}</div>
    </div>`;

  document.getElementById('importarBody').innerHTML = `
    <div style="margin-bottom:14px;padding:10px 14px;background:var(--success-soft, #DCFCE7);border-radius:var(--radius-md);color:var(--success);font-size:13px;font-weight:600">
      ✅ El archivo es válido. Revisa el resumen antes de confirmar.
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
        ${resultado.marcas_creadas ? `· ${resultado.marcas_creadas} marca${resultado.marcas_creadas===1?'':'s'}/proveedor${resultado.marcas_creadas===1?'':'es'} nuevos` : ''}
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
    const filas = await leerArchivoExcel(file);

    if (!filas.length) {
      renderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: 'No se encontraron filas con datos para importar' }]);
      return;
    }

    const { errores, validas } = validarFilas(filas);
    IMPORT_STATE.errores = errores;
    IMPORT_STATE.filasValidas = validas;

    if (errores.length) {
      renderPasoErrores(errores);
      return;
    }

    const preview = construirVistaPrevia(validas);
    IMPORT_STATE.preview = preview;
    renderPasoPreview(preview);

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
    showToast('success', 'Importación completada', `${resultado.productos} productos y ${resultado.servicios} servicios agregados`);

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
