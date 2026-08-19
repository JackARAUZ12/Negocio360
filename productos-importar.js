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
  encabezadosCrudos: null, // para el mapeo inteligente (archivo propio del cliente)
  filasCrudas: null,
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
    if (!/\.xlsx$/i.test(file.name)) { reject(new Error('El archivo debe tener extensión .xlsx.')); return; }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });

        const tipoPlantilla = detectarPlantilla(wb);
        if (tipoPlantilla) {
          const plantilla = IMPORT_PLANTILLAS[tipoPlantilla];
          const sheet = wb.Sheets['Productos'];
          if (!sheet) {
            reject(new Error('El archivo no contiene la hoja "Productos" de la plantilla "' + plantilla.nombre + '".'));
            return;
          }
          const filasArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
          const encabezado = (filasArray[0] || []).map(h => String(h).trim());
          const encabezadoOk = plantilla.columnas.every((col, i) => encabezado[i] === col);
          if (!encabezadoOk) {
            reject(new Error('Las columnas del archivo no coinciden con la plantilla "' + plantilla.nombre + '". Descarga la plantilla actual e intenta de nuevo sin modificar los encabezados.'));
            return;
          }
          const filas = [];
          for (let r = 1; r < filasArray.length; r++) {
            const arr = filasArray[r];
            const vacio = !arr || arr.every(v => v === '' || v === null || v === undefined);
            if (vacio) continue;
            const obj = { _filaExcel: r + 1 };
            plantilla.columnas.forEach((col, i) => { obj[col] = arr[i] !== undefined ? arr[i] : ''; });
            filas.push(obj);
          }
          resolve({ tipoPlantilla, filas });
          return;
        }

        // No es una plantilla oficial de Negocio360 — en vez de
        // rechazarlo, se devuelven los datos crudos para intentar un
        // mapeo inteligente de columnas (ver detectarMapeoInteligente).
        const nombreHoja = wb.SheetNames.find(n => n !== '_plantilla_meta') || wb.SheetNames[0];
        const sheet = wb.Sheets[nombreHoja];
        if (!sheet) { reject(new Error('El archivo no tiene ninguna hoja con datos.')); return; }
        const filasArray = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const encabezadosCrudos = (filasArray[0] || []).map(h => String(h).trim()).filter(h => h !== '');
        if (!encabezadosCrudos.length) { reject(new Error('No se encontraron encabezados en la primera fila del archivo.')); return; }
        const filasCrudas = filasArray.slice(1).filter(arr => arr && !arr.every(v => v === '' || v === null || v === undefined));
        if (!filasCrudas.length) { reject(new Error('El archivo no tiene ninguna fila de datos debajo de los encabezados.')); return; }

        resolve({ tipoPlantilla: null, encabezadosCrudos, filasCrudas });
      } catch (err) {
        console.error('leerArchivoExcel:', err);
        reject(new Error('No se pudo procesar el archivo. Verifica que sea un .xlsx válido.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ============================================================
   1.5) MAPEO INTELIGENTE — cuando el archivo NO es una plantilla
   oficial de Negocio360 (ej. el cliente ya tenía su propia lista en
   Excel), se intenta adivinar a qué campo corresponde cada columna
   comparando el encabezado contra palabras clave conocidas. Nunca
   se importa nada sin que el cliente confirme el mapeo primero.
   ============================================================ */
const IMPORT_CAMPOS_DESTINO = [
  { key: 'Nombre',        label: 'Nombre del producto', requerido: true,
    palabras: ['nombre', 'producto', 'articulo', 'artículo', 'item', 'descripcion corta', 'descripción corta'] },
  { key: 'PrecioVenta',   label: 'Precio de venta', requerido: true,
    palabras: ['precio venta', 'precio de venta', 'pvp', 'venta', 'precio unitario', 'precio', 'p.v.p'] },
  { key: 'Costo',         label: 'Costo', requerido: false,
    palabras: ['costo', 'costo unitario', 'precio compra', 'precio de compra', 'compra'] },
  { key: 'StockInicial',  label: 'Stock / cantidad', requerido: false,
    palabras: ['stock', 'cantidad', 'existencia', 'existencias', 'inventario', 'unidades'] },
  { key: 'StockMinimo',   label: 'Stock mínimo (alerta)', requerido: false,
    palabras: ['stock minimo', 'stock mínimo', 'minimo', 'mínimo', 'alerta'] },
  { key: 'Categoria',     label: 'Categoría', requerido: false,
    palabras: ['categoria', 'categoría', 'rubro', 'familia', 'grupo', 'linea', 'línea'] },
  { key: 'SKU',           label: 'SKU / código interno', requerido: false,
    palabras: ['sku', 'codigo interno', 'código interno', 'referencia', 'ref'] },
  { key: 'CodigoBarras',  label: 'Código de barras', requerido: false,
    palabras: ['codigo de barras', 'código de barras', 'barras', 'ean', 'upc', 'codigo barras'] },
  { key: 'MarcaProveedor',label: 'Marca / proveedor', requerido: false,
    palabras: ['marca', 'proveedor', 'fabricante', 'distribuidor'] },
  { key: 'Descripcion',   label: 'Descripción', requerido: false,
    palabras: ['descripcion', 'descripción', 'detalle', 'observaciones'] },
];

function normalizarTextoMapeo(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // quita acentos
}

/* Para cada columna del archivo del cliente, busca el campo destino
   cuyas palabras clave mejor calcen — coincidencia exacta primero,
   luego "la columna contiene la palabra clave". Nunca asigna el
   mismo campo destino dos veces (se queda con la mejor coincidencia). */
function detectarMapeoInteligente(encabezadosCrudos) {
  const normalizados = encabezadosCrudos.map(normalizarTextoMapeo);
  const usados = new Set();
  const mapeo = {}; // { CampoDestino: indiceColumnaOriginal | null }

  IMPORT_CAMPOS_DESTINO.forEach(campo => { mapeo[campo.key] = null; });

  IMPORT_CAMPOS_DESTINO.forEach(campo => {
    let mejorIdx = -1, mejorPuntaje = 0;
    normalizados.forEach((col, idx) => {
      if (usados.has(idx)) return;
      campo.palabras.forEach(palabra => {
        const p = normalizarTextoMapeo(palabra);
        let puntaje = 0;
        if (col === p) puntaje = 100;
        else if (col.includes(p)) puntaje = 60 + p.length;
        if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejorIdx = idx; }
      });
    });
    if (mejorIdx >= 0 && mejorPuntaje >= 60) {
      mapeo[campo.key] = mejorIdx;
      usados.add(mejorIdx);
    }
  });

  return mapeo;
}

function firmaEncabezados(encabezadosCrudos) {
  return encabezadosCrudos.map(normalizarTextoMapeo).join('|');
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
function normalizarNombreImport(s) {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

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

  // Detección de duplicados — compara cada fila del archivo contra
  // los productos ACTIVOS que ya existen en el sistema, ignorando
  // mayúsculas y espacios de más (la misma causa que generó los
  // duplicados que ya corregimos manualmente en varios negocios).
  const existentesPorTipoYNombre = new Map();
  (STATE.productos || []).forEach(p => {
    if (p.activo === false) return;
    existentesPorTipoYNombre.set(`${p.tipo}::${normalizarNombreImport(p.nombre)}`, p);
  });
  const duplicados = [];

  validas.forEach(v => {
    if (v.tipo === 'producto') productos++; else servicios++;
    if (v.categoria && !categoriasExistentes.has(v.categoria.toLowerCase())) categoriasNuevas.add(v.categoria.toLowerCase());
    if (v.marca_proveedor && !marcasExistentes.has(v.marca_proveedor.toLowerCase())) marcasNuevas.add(v.marca_proveedor.toLowerCase());

    const key = `${v.tipo}::${normalizarNombreImport(v.nombre)}`;
    const existente = existentesPorTipoYNombre.get(key);
    if (existente) duplicados.push({ nombreArchivo: v.nombre, stockArchivo: v.stock_actual, stockExistente: existente.stock_actual });
  });

  return {
    total: validas.length,
    productos,
    servicios,
    categoriasNuevas: categoriasNuevas.size,
    marcasNuevas: marcasNuevas.size,
    duplicados,
  };
}

/* ============================================================
   5) SERVICIO DE IMPORTACIÓN
   Una sola llamada RPC = una sola transacción en la base de datos.
   Si cualquier registro falla, NADA queda guardado.
   ============================================================ */
async function ejecutarImportacion(validas, modoDuplicados) {
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

  const { data, error } = await supabaseClient.rpc('importar_productos_masivo', {
    p_registros: payload,
    p_modo_duplicados: modoDuplicados || 'crear_nuevos',
  });
  if (error) throw error;
  return data; // { ok, productos, servicios, marcas_creadas, actualizados, omitidos }
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
  IMPORT_STATE.encabezadosCrudos = null;
  IMPORT_STATE.filasCrudas = null;
  IMPORT_STATE.modoDuplicados = 'sumar';
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

/* ============================================================
   PASO: MAPEO DE COLUMNAS (archivo propio del cliente)
   ============================================================ */
function renderPasoMapeoColumnas(encabezadosCrudos, mapeoDetectado, mapeoYaConocido) {
  const badgeConfianza = mapeoYaConocido
    ? `<div style="margin-bottom:14px;padding:10px 14px;background:var(--success-soft,#DCFCE7);border-radius:var(--radius-md);color:var(--success);font-size:13px;font-weight:600">
         ✅ Reconocimos esta plantilla — es la misma que usaste la vez pasada, ya viene lista.
       </div>`
    : `<div style="margin-bottom:14px;padding:10px 14px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:var(--radius-md);color:#92400E;font-size:13px">
         ⚠️ Este archivo no es una plantilla oficial de Negocio360, pero identificamos qué es cada columna automáticamente. Revisa que esté bien antes de continuar.
       </div>`;

  const filas = IMPORT_CAMPOS_DESTINO.map(campo => {
    const idxActual = mapeoDetectado[campo.key];
    const opciones = ['<option value="">— No usar —</option>']
      .concat(encabezadosCrudos.map((h, i) => `<option value="${i}" ${i===idxActual?'selected':''}>${escHtml(h)}</option>`));
    const detectado = idxActual !== null && idxActual !== undefined;
    return `
      <tr>
        <td style="padding:8px 10px;font-size:13px">
          ${escHtml(campo.label)}
          ${campo.requerido ? '<span style="color:var(--danger)" title="Obligatorio"> *</span>' : ''}
        </td>
        <td style="padding:8px 10px">
          <select class="form-select" data-campo="${campo.key}" onchange="revisarCamposObligatoriosMapeo()" style="width:100%;font-size:13px">
            ${opciones.join('')}
          </select>
        </td>
        <td style="padding:8px 10px;text-align:center;font-size:16px">${detectado ? '✅' : (campo.requerido ? '❌' : '—')}</td>
      </tr>`;
  }).join('');

  document.getElementById('importarBody').innerHTML = `
    ${badgeConfianza}
    <p style="font-size:12.5px;color:var(--text-muted);margin-bottom:10px">
      Encontramos ${escHtml(String(encabezadosCrudos.length))} columna${encabezadosCrudos.length===1?'':'s'} en tu archivo. Dinos cuál es cuál — las marcadas con * son obligatorias.
    </p>
    <div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-md)">
      <table style="width:100%;border-collapse:collapse">
        <thead style="position:sticky;top:0;background:var(--bg-surface)">
          <tr style="border-bottom:1px solid var(--border)">
            <th style="text-align:left;padding:8px 10px;font-size:12px;color:var(--text-muted)">En Negocio360 es…</th>
            <th style="text-align:left;padding:8px 10px;font-size:12px;color:var(--text-muted)">¿Cuál columna de tu archivo?</th>
            <th style="padding:8px 10px;font-size:12px;color:var(--text-muted)">Detectado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12.5px;cursor:pointer">
      <input type="checkbox" id="chk-recordar-mapeo" checked/>
      Recordar este mapeo — la próxima vez que suba este mismo tipo de archivo, no preguntar de nuevo
    </label>
    <p id="mapeo-error" style="color:var(--danger);font-size:12.5px;margin-top:8px"></p>
  `;
  document.getElementById('importarFooter').innerHTML = `
    <button class="btn-secondary" onclick="renderPasoInicial()">Cancelar</button>
    <button class="btn-primary" id="btn-confirmar-mapeo" onclick="confirmarMapeoColumnas()">Continuar</button>
  `;
  revisarCamposObligatoriosMapeo();
}

function revisarCamposObligatoriosMapeo() {
  const btn = document.getElementById('btn-confirmar-mapeo');
  if (!btn) return;
  const faltantes = IMPORT_CAMPOS_DESTINO.filter(c => c.requerido).filter(c => {
    const sel = document.querySelector(`select[data-campo="${c.key}"]`);
    return !sel || sel.value === '';
  });
  btn.disabled = faltantes.length > 0;
  const errEl = document.getElementById('mapeo-error');
  if (errEl) errEl.textContent = faltantes.length
    ? `Falta indicar: ${faltantes.map(c => c.label).join(', ')}`
    : '';
}

async function confirmarMapeoColumnas() {
  const mapeoFinal = {};
  IMPORT_CAMPOS_DESTINO.forEach(campo => {
    const sel = document.querySelector(`select[data-campo="${campo.key}"]`);
    const val = sel?.value;
    mapeoFinal[campo.key] = (val === '' || val === undefined) ? null : parseInt(val, 10);
  });

  // Transformar las filas crudas (arreglo por posición) al mismo
  // formato de objeto que ya usa la plantilla "FIJO" oficial — así
  // se reutiliza TODA la validación e importación ya construida y
  // probada, sin duplicar nada.
  const filas = IMPORT_STATE.filasCrudas.map((arr, i) => {
    const obj = { _filaExcel: i + 2, TipoRegistro: 'Producto' };
    IMPORT_CAMPOS_DESTINO.forEach(campo => {
      const idx = mapeoFinal[campo.key];
      obj[campo.key] = (idx !== null && arr[idx] !== undefined) ? arr[idx] : '';
    });
    return obj;
  });

  if (document.getElementById('chk-recordar-mapeo')?.checked) {
    try {
      await supabaseClient.from('plantillas_importacion_personalizadas').upsert({
        auth_user_id: STATE.user.id,
        firma_encabezados: firmaEncabezados(IMPORT_STATE.encabezadosCrudos),
        mapeo: mapeoFinal,
      }, { onConflict: 'auth_user_id,firma_encabezados' });
    } catch (e) { console.warn('No se pudo recordar el mapeo (no afecta la importación):', e); }
  }

  IMPORT_STATE.tipoPlantilla = 'FIJO';
  procesarFilasYMostrarVistaPrevia(filas, 'FIJO');
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

  const hayDuplicados = preview.duplicados && preview.duplicados.length > 0;
  if (!IMPORT_STATE.modoDuplicados) IMPORT_STATE.modoDuplicados = 'sumar';

  const bloqueDuplicados = !hayDuplicados ? '' : `
    <div style="margin-top:16px;padding:14px;background:#FEF3C7;border:1px solid #F59E0B;border-radius:var(--radius-md)">
      <div style="font-weight:700;font-size:13px;color:#92400E;margin-bottom:6px">
        ⚠️ Encontramos ${preview.duplicados.length} producto${preview.duplicados.length===1?'':'s'} que parece${preview.duplicados.length===1?'':'n'} que ya existe${preview.duplicados.length===1?'':'n'} en tu inventario
      </div>
      <div style="max-height:110px;overflow-y:auto;font-size:12px;color:#78350F;margin-bottom:10px">
        ${preview.duplicados.slice(0, 30).map(d => `• ${escHtml(d.nombreArchivo)} (ya tienes ${d.stockExistente} en stock)`).join('<br>')}
        ${preview.duplicados.length > 30 ? `<br>… y ${preview.duplicados.length - 30} más` : ''}
      </div>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:#78350F;margin-bottom:6px;cursor:pointer">
        <input type="radio" name="modoDuplicados" value="sumar" ${IMPORT_STATE.modoDuplicados==='sumar'?'checked':''} onchange="IMPORT_STATE.modoDuplicados=this.value">
        <span><b>Sumar el stock del archivo</b> a los productos que ya tenía (recomendado)</span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:12.5px;color:#78350F;cursor:pointer">
        <input type="radio" name="modoDuplicados" value="crear_nuevos" ${IMPORT_STATE.modoDuplicados==='crear_nuevos'?'checked':''} onchange="IMPORT_STATE.modoDuplicados=this.value">
        <span>Crearlos de todas formas como productos nuevos y separados</span>
      </label>
      <p style="font-size:11.5px;color:#92400E;margin-top:10px;padding-top:8px;border-top:1px solid #F59E0B">
        💡 Tip: si un producto ya existe y solo necesitas agregarle stock de una compra real, también puedes hacerlo desde
        <b>Compras</b> — así queda registrado el gasto y el historial de esa compra, no solo el stock.
      </p>
    </div>`;

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
    ${bloqueDuplicados}
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
  const extra = [];
  if (resultado.actualizados) extra.push(`${resultado.actualizados} con stock sumado a lo que ya existía`);
  if (resultado.omitidos) extra.push(`${resultado.omitidos} omitidos por ya existir`);
  document.getElementById('importarBody').innerHTML = `
    <div style="text-align:center;padding:24px 8px">
      <div style="font-size:44px;margin-bottom:10px">🎉</div>
      <h3 style="font-size:15px;font-weight:700;margin-bottom:6px">¡Importación completada!</h3>
      <p style="font-size:13px;color:var(--text-secondary)">
        ${resultado.productos} producto${resultado.productos===1?'':'s'} y ${resultado.servicios} servicio${resultado.servicios===1?'':'s'} agregados
        ${resultado.marcas_creadas ? '· ' + resultado.marcas_creadas + ' marca' + (resultado.marcas_creadas===1?'':'s') + '/proveedor' + (resultado.marcas_creadas===1?'':'es') + ' nuevos' : ''}
      </p>
      ${extra.length ? `<p style="font-size:12px;color:var(--text-muted);margin-top:6px">${extra.join(' · ')}</p>` : ''}
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

  renderPasoProcesando('Leyendo el archivo…');

  try {
    const resultado = await leerArchivoExcel(file);

    if (resultado.tipoPlantilla) {
      // Plantilla oficial de Negocio360 — camino de siempre, sin cambios.
      IMPORT_STATE.tipoPlantilla = resultado.tipoPlantilla;
      if (!resultado.filas.length) {
        renderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: 'No se encontraron filas con datos para importar' }]);
        return;
      }
      procesarFilasYMostrarVistaPrevia(resultado.filas, resultado.tipoPlantilla);
      return;
    }

    // No es plantilla oficial — se intenta el mapeo inteligente.
    IMPORT_STATE.encabezadosCrudos = resultado.encabezadosCrudos;
    IMPORT_STATE.filasCrudas = resultado.filasCrudas;
    const firma = firmaEncabezados(resultado.encabezadosCrudos);

    // ¿Ya se había mapeado este mismo tipo de archivo antes? Si sí,
    // se aplica directo, sin volver a preguntar.
    let mapeoGuardado = null;
    try {
      const { data } = await supabaseClient.from('plantillas_importacion_personalizadas')
        .select('mapeo').eq('auth_user_id', STATE.user.id).eq('firma_encabezados', firma).maybeSingle();
      mapeoGuardado = data?.mapeo || null;
    } catch (e) { /* si falla la consulta, simplemente se detecta de nuevo */ }

    const mapeoDetectado = mapeoGuardado || detectarMapeoInteligente(resultado.encabezadosCrudos);
    renderPasoMapeoColumnas(resultado.encabezadosCrudos, mapeoDetectado, !!mapeoGuardado);

  } catch (e) {
    console.error('onArchivoImportSeleccionado:', e);
    renderPasoErrores([{ fila: '—', campo: 'Archivo', motivo: e.message || 'No se pudo procesar el archivo' }]);
  } finally {
    ev.target.value = ''; // permite volver a elegir el mismo archivo si hace falta
  }
}
window.onArchivoImportSeleccionado = onArchivoImportSeleccionado;

function procesarFilasYMostrarVistaPrevia(filas, tipoPlantilla) {
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
}

async function confirmarImportacionFinal() {
  if (IMPORT_STATE.procesando) return;
  IMPORT_STATE.procesando = true;
  renderPasoProcesando('Importando registros… esto puede tardar unos segundos.');

  try {
    const resultado = await ejecutarImportacion(IMPORT_STATE.filasValidas, IMPORT_STATE.modoDuplicados);
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
